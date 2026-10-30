/**
 * Node - Network orchestration layer
 * 
 * Manages N clients + 1 server to create a mesh network node.
 * Handles routing, options, and node identity.
 * 
 * Architecture:
 * - One Node has one identity (node ID)
 * - Server and Clients use the same node ID (envelope.owner)
 * - Central handler registry (handlers work even if server/clients created later)
 * - Smart routing based on node ID and options
 * - Options sync for dynamic routing
 * 
 * STATE MODEL (Single Source of Truth):
 * - Node tracks JOINED/LEFT state explicitly, per direction:
 *   • peers.upstream: Map<peerId, options> - servers/routers we connected to
 *   • peers.downstream: Map<peerId, options> - clients connected to our server
 *   One id may be joined both ways (two nodes connected to each other).
 * 
 * - Routing Guarantee: JOINED = ROUTABLE (strict)
 *   • Peer in joinedPeers Set → routable ✅
 *   • Peer NOT in joinedPeers Set → not routable ❌
 * 
 * - State Updates (edge-triggered: one event per transition, per direction):
 *   • joined → PEER_JOINED; a re-handshake of a joined peer → PEER_UPDATED
 *     if its options changed, otherwise nothing
 *   • left → PEER_LEFT { reason, category }, only if it was joined
 * 
 * - Benefits:
 *   • No querying Server/Client during routing (faster)
 *   • Single source of truth (no state divergence)
 *   • Clean semantics: in Set = online, not in Set = offline
 */

import winston from 'winston'
import _ from 'underscore'
import md5 from 'md5'
import animal from 'animal-id'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { PatternEmitter } from '@sfast/pattern-emitter-ts'

import { NodeError, NodeErrorCode, assertValidAddress, kProxyMiss } from './node-errors.js'
import NodeUtils from './utils.js'
import Globals from './globals.js'
import Server, { ServerEvent } from './protocol/server.js'
import Client, { ClientEvent } from './protocol/client.js'
import { ProtocolErrorCode } from './protocol/protocol-errors.js'
import { TransportError, TransportErrorCode } from './transport/errors.js'

// ============================================================================
// NODE EVENTS (Orchestration Layer - Public API)
// ============================================================================
export const NodeEvent = {
  PEER_JOINED: 'node:peer_joined', // New peer discovered (upstream or downstream)
  PEER_LEFT: 'node:peer_left',     // Peer disconnected: { peerId, direction, reason, category }
  STOPPED: 'node:stopped',         // Node stopped
  ERROR: 'node:error',             // Node-level error (normalized payload)
  PEER_UPDATED: 'node:peer_updated', // Joined peer changed its options: { peerId, direction, peerOptions }
  // An upstream connection is being retried by the transport: { address,
  // interval, peerId } (peerId: the last server seen there, or null). An
  // attempt, not a state change: PEER_JOINED / PEER_LEFT report those.
  RECONNECT_ATTEMPT: 'node:reconnect_attempt'
}

// What a PEER_LEFT was observed as (`reason` keeps the raw signal). It names
// the signal that arrived first, not a proven cause: a server's stop message
// and the dropped link race.
export const PeerLeftCategory = {
  GRACEFUL: 'graceful', // the peer said it stops (server_left, CLIENT_STOP)
  LOST: 'lost',         // the link or the peer went away (transport, TIMEOUT, UNREACHABLE)
  REPLACED: 'replaced', // another session took its place (replaced, REPLACED)
  LOCAL: 'local'        // this node ended it (disconnect, close, unbind)
}

const DOWNSTREAM_LEFT_CATEGORY = {
  CLIENT_STOP: PeerLeftCategory.GRACEFUL,
  TIMEOUT: PeerLeftCategory.LOST,
  UNREACHABLE: PeerLeftCategory.LOST,
  REPLACED: PeerLeftCategory.REPLACED,
  UNBOUND: PeerLeftCategory.LOCAL
}

// ============================================================================
// RECONNECT POLICY
// ============================================================================
export const ReconnectPolicy = {
  ALWAYS: 'always',         // Always reconnect upstream peers (graceful or crash)
  ON_FAILURE: 'on_failure', // Only reconnect on unexpected failures (crashes, network issues)
  DISABLED: 'disabled'      // No automatic reconnection
}

const _private = new WeakMap()
// client → [[event, listener]] attached by the Node (see _attachClientEvents)
const clientNodeListeners = new WeakMap()
// clients already discarded (detached + closed) by the Node
const discardedClients = new WeakSet()
// clients this Node is disconnecting/closing itself (PEER_LEFT category local)
const locallyEndedClients = new WeakSet()

const defaultLogger = winston.createLogger({
  transports: [
    new winston.transports.Console({ level: 'error' })
  ]
})

/**
 * Node - Network node with server and multiple client connections
 */
export default class Node extends EventEmitter {
  constructor ({ id, bind, options, config } = {}) {
    super()
    
    // Node identity
    id = id || _generateNodeId()
    options = options || {}
    config = config || {}
    
    // Bind node identity to options (used for routing and handshakes)
    Object.defineProperty(options, '_id', {
      value: id,
      writable: false,
      configurable: true,
      enumerable: true
    })
    
    // Private state
    const _scope = {
      id,
      options,
      config,
      logger: config.logger || defaultLogger,
      
      // Server (created on bind) - Server manages its own state
      server: null,
      bindAddress: bind || null,  // Cache bind address for async initialization window
      
      // Clients (nodeId → Client) - Clients manage their own state
      clients: new Map(),
      clientsAddressIndex: new Map(), // addressHash → nodeId
      
      // Peer state tracking (Node's single source of truth for routing):
      // joined (routable) peers per direction, peerId → options (for filtering)
      peers: { upstream: new Map(), downstream: new Map() },
      
      // Central handler registry (single source of truth)
      handlerRegistry: {
        request: new PatternEmitter(),
        tick: new PatternEmitter()
      },
      
      // Auto-reconnect state
      // reconnect: ReconnectPolicy.ALWAYS | ReconnectPolicy.ON_FAILURE | ReconnectPolicy.DISABLED
      reconnect: config.reconnect !== undefined ? config.reconnect : ReconnectPolicy.ALWAYS,
      connectionTargets: new Map(), // address → { peerId, attempts, timer, timeout }
      peerIdToAddress: new Map(),   // peerId → address
      pendingConnects: new Map(),   // address → { client, cancelled, promise } (handshake in progress)
      endingConnections: new Map(), // address → promise of a teardown the reconnect policy started
      closed: false,                // set by close(); connect() rejects afterwards
      forwardedTicks: new Map(),    // tickId → record of a proxied tick this node forwarded
      forwardedTickSweep: null      // interval dropping expired forwardedTicks
    }
    
    _private.set(this, _scope)
    
    // A proxied tick this node forwarded came back unplaced: try the next router
    this.onTick('_system:proxy_tick_miss', (envelope) => this._handleProxyTickMiss(envelope))
    
    // Setup auto-reconnect listener if enabled
    if (_scope.reconnect !== ReconnectPolicy.DISABLED) {
      this._setupAutoReconnect()
    }
    
    // Default error handler for NO_NODES_MATCH_FILTER
    // Users can override by adding their own 'error' listener
    this.on('error', (err) => {
      if (err.code === NodeErrorCode.NO_NODES_MATCH_FILTER) {
        // Only throw if no other error listeners are registered
        if (this.listenerCount('error') === 1) {
          throw err
        }
      }
    })
    
    // Initialize server if bind address provided
    if (bind) {
      // Initialize and bind server asynchronously
      this._initServer(bind)
      
      // Bind in background (Node should be fully initialized when used)
      setImmediate(() => {
        // close() already ran: nothing to bind
        if (_scope.closed) return
        this.bind(bind).catch(err => {
          _scope.logger.error(`[Node] Failed to bind server to ${bind}:`, err)
          this.emit('error', err)
          this.emit(NodeEvent.ERROR, {
            source: 'server',
            stage: 'bind',
            address: bind,
            error: err
          })
        })
      })
    }
  }
  
  // ============================================================================
  // IDENTITY & INFO
  // ============================================================================
  
  getId () {
    const { id } = _private.get(this)
    return id
  }
  
  getAddress () {
    const { server, bindAddress } = _private.get(this)
    // Prefer server's address (source of truth), fallback to cached bind address
    return server?.getAddress() || bindAddress
  }
  
  getOptions () {
    const { options } = _private.get(this)
    return options
  }
  
  /**
   * Get connected peers with optional direction filter
   * @param {Object} [options]
   * @param {'upstream'|'downstream'} [options.direction]
   * @returns {Array<{id: string, options: Object, direction: string|null}>}
   */
  getPeers ({ direction } = {}) {
    const { peers } = _private.get(this)
    const list = []

    // A peer joined both ways is listed once per direction
    for (const peerDirection of ['upstream', 'downstream']) {
      if (direction && direction !== peerDirection) continue
      for (const [peerId, peerOptions] of peers[peerDirection]) {
        list.push({ id: peerId, options: peerOptions || {}, direction: peerDirection })
      }
    }
    
    return list
  }
  
  /**
   * Get IDs of downstream peers (connected clients)
   * @returns {string[]}
   */
  getNodesDownstream () {
    return this.getPeers({ direction: 'downstream' }).map(peer => peer.id)
  }
  
  /**
   * Get IDs of upstream peers (connected servers/routers)
   * @returns {string[]}
   */
  getNodesUpstream () {
    return this.getPeers({ direction: 'upstream' }).map(peer => peer.id)
  }
  
  /**
   * Get logger instance
   * @returns {Object} Winston logger instance
   */
  getLogger () {
    const { logger } = _private.get(this)
    return logger
  }
  
  // ============================================================================
  // PEER STATE TRACKING (Private Helpers)
  // ============================================================================
  
  /**
   * Apply an options update from a joined peer
   * @private
   */
  _updatePeerOptions (peerId, peerOptions, direction) {
    const table = _private.get(this).peers[direction]
    if (!table.has(peerId)) return

    table.set(peerId, peerOptions || {})
    this.emit(NodeEvent.PEER_UPDATED, { peerId, direction, peerOptions: peerOptions || {} })
  }
  
  /**
   * Joined in `direction`, or in either direction when it is omitted
   * @private
   */
  _isJoinedPeer (peerId, direction) {
    const { peers } = _private.get(this)
    if (direction) return peers[direction].has(peerId)
    return peers.upstream.has(peerId) || peers.downstream.has(peerId)
  }
  
  /**
   * Options of a joined peer (upstream session first), or undefined
   * @private
   */
  _joinedPeerOptions (peerId) {
    const { peers } = _private.get(this)
    return peers.upstream.get(peerId) ?? peers.downstream.get(peerId)
  }
  
  /**
   * Remove peer from joined state (single operation for consistency)
   * @private
   * @returns {boolean} whether it was joined in that direction
   */
  _removeJoinedPeer (peerId, direction) {
    return _private.get(this).peers[direction].delete(peerId)
  }

  /**
   * A session with a peer is (again) established. PEER_JOINED only on the
   * transition to joined; for a peer already joined in this direction (a
   * re-handshake) its options are refreshed and PEER_UPDATED is emitted if
   * they changed. `announceAgain`: the re-handshake may be a new session that
   * cannot be told apart (a peer older than 2.0.16): PEER_JOINED again. State
   * is updated before anything is emitted.
   * @private
   * @returns {boolean} whether the peer newly joined
   */
  _peerJoined (peerId, peerOptions, direction, { announceAgain = false } = {}) {
    const table = _private.get(this).peers[direction]
    const options = peerOptions || {}

    if (table.has(peerId) && !announceAgain) {
      const before = table.get(peerId)
      table.set(peerId, options)
      if (!_.isEqual(before, options)) {
        this._emitPeerEvent(NodeEvent.PEER_UPDATED, { peerId, direction, peerOptions: options })
      }
      return false
    }

    table.set(peerId, options)
    this._emitPeerEvent(NodeEvent.PEER_JOINED, { peerId, direction, peerOptions: options })
    return true
  }

  /**
   * A session with a peer ended. PEER_LEFT only if it was joined in this
   * direction (the first signal wins); state is removed before the event.
   * `beforeEmit` runs after the state change and before the event (so that
   * what it sets up is visible to PEER_LEFT listeners).
   * @private
   * @returns {boolean} whether the peer was joined
   */
  _peerLeft (peerId, direction, reason, category, beforeEmit) {
    if (!this._removeJoinedPeer(peerId, direction)) return false
    if (beforeEmit) beforeEmit()
    this._emitPeerEvent(NodeEvent.PEER_LEFT, { peerId, direction, reason, category })
    return true
  }
  
  // ============================================================================
  // SERVER MANAGEMENT
  // ============================================================================
  
  /**
   * Initialize server (can be called later if not provided in constructor)
   * @private
   */
  _initServer (bindAddress) {
    const _scope = _private.get(this)
    
    if (_scope.server) {
      _scope.logger.warn(`[Node] Server already initialized`)
      return
    }
    
    const { id, options, config } = _scope
    
    // Create server with node identity
    const server = new Server({ 
      id,              // ✅ Server uses Node's ID
      bind: bindAddress, 
      options, 
      config 
    })
    
    // Apply all registered handlers to server
    this._syncHandlersToTarget(server)
    
    // Transform and forward server events to node
    this._attachServerEvents(server)
    
    _scope.server = server
    
    _scope.logger.info(`[Node] Server initialized: ${id}`)
  }
  
  /**
   * Bind server to address
   * @returns {string} The bound address
   */
  async bind (address) {
    const _scope = _private.get(this)
    
    // A closed node binds nothing (no server is created after close())
    if (_scope.closed) {
      throw new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: `Node '${_scope.id}' is closed: cannot bind to ${address || _scope.bindAddress}`,
        address: address || _scope.bindAddress
      })
    }

    // Use cached bind address if no address provided
    if (!address) {
      address = _scope.bindAddress
    }
    
    // Cache the bind address
    _scope.bindAddress = address
    
    // Initialize server if not already done
    if (!_scope.server) {
      this._initServer(address)
    }
    
    // Server handles idempotency and state management
    await _scope.server.bind(address)
    
    // Return the actual bound address (important for port 0)
    return this.getAddress()
  }
  
  /**
   * Unbind server
   */
  async unbind () {
    const { server } = _private.get(this)
    
    if (!server) {
      return Promise.resolve()
    }
    
    try {
      await server.unbind()
    } finally {
      // The server forgot its clients (also when the transport refused to
      // unbind): so does the Node, or they would stay joined (and selected by
      // requestAny) with no route behind them
      this._forgetDownstreamPeers()
    }
  }

  /**
   * End every downstream session (the server no longer has these clients):
   * PEER_LEFT { reason: 'UNBOUND', category: 'local' } for each
   * @private
   */
  _forgetDownstreamPeers () {
    const { peers } = _private.get(this)
    for (const peerId of Array.from(peers.downstream.keys())) {
      this._peerLeft(peerId, 'downstream', 'UNBOUND', PeerLeftCategory.LOCAL)
    }
  }
  
  /**
   * Attach server event handlers and transform to Node events
   * @private
   */
  _attachServerEvents (server) {
    const { logger } = _private.get(this)
    
    // Forward errors
    server.on('error', (err) => {
      logger.error('[Node] Server error:', err)
      
      this.emit('error', err)
      this.emit(NodeEvent.ERROR, {
        source: 'server',
        address: this.getAddress?.(),
        error: err
      })
    })
    
    // Structured server error (protocol/transport failure, e.g. a failing tick handler)
    server.on(ServerEvent.ERROR, (err) => {
      logger.error('[Node] Server error:', err)
      this.emit(NodeEvent.ERROR, {
        source: 'server',
        address: this.getAddress?.(),
        error: err
      })
    })
    
    // Transform: Server.CLIENT_OPTIONS_UPDATED → Node.PEER_UPDATED
    server.on(ServerEvent.CLIENT_OPTIONS_UPDATED, ({ clientId, clientOptions }) => {
      this._updatePeerOptions(clientId, clientOptions, 'downstream')
    })
    
    // Transform: Server.CLIENT_JOINED → Node.PEER_JOINED
    server.on(ServerEvent.CLIENT_JOINED, ({ clientId, clientOptions, sameSession }) => {
      // close() under way (e.g. called from a PEER_LEFT listener): no new session
      if (_private.get(this).closed) return
      // Client connected TO our server. A re-handshake of the same session
      // (same instance id, e.g. after a transport blip) is not a new join; a
      // client older than 2.0.16 cannot prove that (no instance id), so each
      // of its handshakes is announced, as before (it may have restarted)
      this._peerJoined(clientId, clientOptions, 'downstream', { announceAgain: !sameSession })
    })
    
    // Transform: Server.CLIENT_LEFT → Node.PEER_LEFT
    server.on(ServerEvent.CLIENT_LEFT, ({ clientId, reason }) => {
      // Pass through the reason from the server
      this._peerLeft(clientId, 'downstream', reason || 'disconnected',
        DOWNSTREAM_LEFT_CATEGORY[reason] || PeerLeftCategory.LOST)
    })
    
    // Server ready
    server.on(ServerEvent.READY, () => {
      // Server is bound and ready to accept clients
      // No event emitted - users can await bind() if needed
    })
  }
  
  // ============================================================================
  // CLIENT MANAGEMENT
  // ============================================================================
  
  /**
   * Connect to remote node
   * @param {Object} params
   * @param {string} params.address - Remote address (tcp://...)
   * @param {number} [params.timeout] - Connection timeout
   * @param {number} [params.reconnectionTimeout] - Deprecated, has no effect
   * @returns {Promise<Object>} Remote node info
   */
  async connect ({ address, timeout, reconnectionTimeout } = {}) {
    assertValidAddress(address)
    
    const _scope = _private.get(this)
    const { pendingConnects, endingConnections } = _scope
    
    if (_scope.closed) {
      throw connectCancelledError(address, 'node is closed')
    }
    
    // The reconnect policy is ending the old connection to this address:
    // connect once it is gone (it would otherwise look already connected)
    const ending = endingConnections.get(address)
    if (ending) {
      await ending
      if (_scope.closed) throw connectCancelledError(address, 'node is closed')
    }

    // A connect to this address is already waiting for its handshake: share it
    // (two clients for one address would leak the second). The joining caller's
    // timeout still applies to its own wait; it cannot extend the shared attempt.
    const pending = pendingConnects.get(address)
    if (pending) {
      return timeout === undefined ? pending.promise : withTimeout(pending.promise, timeout, address)
    }
    
    const attempt = { client: null, cancelled: false, promise: null }
    attempt.promise = this._connect({ address, timeout, reconnectionTimeout }, attempt)
    pendingConnects.set(address, attempt)
    
    try {
      return await attempt.promise
    } finally {
      if (pendingConnects.get(address) === attempt) {
        pendingConnects.delete(address)
      }
    }
  }
  
  /**
   * connect() body; `attempt` lets disconnect()/close() cancel it mid-handshake
   * @private
   */
  async _connect ({ address, timeout, reconnectionTimeout }, attempt) {
    const _scope = _private.get(this)
    const { id, options, config, clients, clientsAddressIndex, logger, connectionTargets, peerIdToAddress } = _scope
    
    const addressHash = md5(address)
    
    // Check if already connected
    if (clientsAddressIndex.has(addressHash)) {
      const existingNodeId = clientsAddressIndex.get(addressHash)
      const client = clients.get(existingNodeId)
      
      logger.info(`[Node] Already connected to ${address}`)
      
      // Peer info only for a live session: the client keeps the id of a
      // server that left (its DEALER may still be reconnecting)
      if (!this._hasSession(address)) {
        return null
      }
      
      const serverId = client.getServerId()
      return {
        id: serverId,
        options: _scope.peers.upstream.get(serverId) || {}
      }
    }
    
    // reconnectionTimeout has had no effect since 2.0 (the transport timer it
    // configured was removed; ZeroMQ reconnects without giving up). Say so
    // once instead of silently passing it on.
    if (reconnectionTimeout !== undefined && !_scope.warnedReconnectionTimeout) {
      _scope.warnedReconnectionTimeout = true
      logger.warn('[Node] connect({ reconnectionTimeout }) has no effect: ZeroMQ reconnects without giving up (deprecated, ignored)')
    }
    
    // Create client with node identity
    const client = new Client({ 
      id,              // ✅ Client uses Node's ID
      options,         // ✅ Node's options for handshake
      config
    })
    
    // Apply all registered handlers to client
    this._syncHandlersToTarget(client)
    
    // Attach client event handlers
    this._attachClientEvents(client, address, attempt)
    attempt.client = client
    
    // Connect (Client.connect() waits for handshake to complete).
    // On failure the client must not outlive this call: its DEALER would keep
    // reconnecting and later join as a ghost upstream peer that is not in `clients`.
    try {
      await client.connect(address, timeout)
    } catch (err) {
      await this._discardClient(client, address)
      throw attempt.cancelled ? connectCancelledError(address) : err
    }
    
    // disconnect()/close() ran while the handshake was completing
    if (attempt.cancelled || _scope.closed) {
      await this._discardClient(client, address)
      throw connectCancelledError(address)
    }
    
    // setOptions() ran during the handshake: the server may have the old ones.
    // Sent in the background: it must neither extend connect()'s timeout nor
    // hold a disconnect()/close() (Client.setOptions never rejects).
    if (_scope.options !== options) {
      client.setOptions(_scope.options).catch(() => {})
    }
    
    // Get server ID (now available after handshake)
    const serverId = client.getServerId()
    
    const remoteNodeId = serverId

    // Already connected to this server through another address (an alias of
    // it). Both connections carry this node's id, so at the server the newer
    // one has taken over (ROUTER handover) and the older one no longer gets
    // anything: the newer one replaces it. The older client is closed
    // silently (a CLIENT_STOP would end the shared session) and its address
    // forgotten, after this one owns the id (so the peer does not leave).
    const holder = clients.get(remoteNodeId)
    const displaced = holder !== undefined && holder !== client ? holder : null
    if (displaced) {
      logger.warn(`[Node] ${address} answers as '${remoteNodeId}', already connected through another address; the newer connection replaces the older one`)
    }

    logger.info(`[Node] Connected: ${id} → ${remoteNodeId} (${address})`)
    
    // Store client by remote node's ID; later handshakes of this client
    // (its DEALER reconnecting by itself) re-key it in the SERVER_JOINED listener
    clients.set(remoteNodeId, client)
    clientsAddressIndex.set(addressHash, remoteNodeId)
    attempt.registered = true

    if (displaced) {
      this._dropDisplacedClient(displaced, remoteNodeId, address)
    }

    // Track connection for auto-reconnect
    if (_scope.reconnect !== ReconnectPolicy.DISABLED) {
      if (!connectionTargets.has(address)) {
        connectionTargets.set(address, { peerId: remoteNodeId, attempts: 0, timer: null })
      } else {
        const target = connectionTargets.get(address)
        target.peerId = remoteNodeId
        target.attempts = 0 // Reset attempts on successful connect
      }
      peerIdToAddress.set(remoteNodeId, address)
    }
    
    // Announce the peer only now that it is routable (the SERVER_JOINED
    // listener held the first handshake back for this)
    this._announceUpstreamPeer(remoteNodeId, attempt.joined?.serverOptions)

    // A PEER_JOINED listener ran disconnect()/close(): they clean up
    if (attempt.cancelled || _scope.closed) {
      throw connectCancelledError(address)
    }

    // Return server info with options from Node
    return {
      id: remoteNodeId,
      options: _scope.peers.upstream.get(remoteNodeId) || {}
    }
  }
  
  /**
   * Disconnect from remote node
   * @param {string} address - Remote address
   */
  async disconnect (address) {
    assertValidAddress(address)
    
    const _scope = _private.get(this)
    const { clients, clientsAddressIndex, logger } = _scope
    
    const addressHash = md5(address)
    
    // This node is ending that connection: from now on (also from a listener
    // running further up this stack) it must not join again
    const indexedId = clientsAddressIndex.get(addressHash)
    if (indexedId !== undefined && clients.has(indexedId)) {
      locallyEndedClients.add(clients.get(indexedId))
    }

    // Forget the reconnect target BEFORE disconnecting: the client emits
    // NOT_READY/CLOSED while going down, and the reconnect listener must not
    // find the address and bring the connection back. Done even when not
    // connected, so a reconnect currently in flight is abandoned too.
    this._forgetConnectionTarget(address)
    
    // A connect() to this address still waiting for its handshake: cancel it
    await this._cancelPendingConnect(address)
    
    if (!clientsAddressIndex.has(addressHash)) {
      logger.warn(`[Node] Not connected to ${address}`)
      return true
    }
    
    const nodeId = clientsAddressIndex.get(addressHash)
    const client = clients.get(nodeId)
    
    // Disconnect client (will emit ClientEvent.NOT_READY → PEER_LEFT, local)
    locallyEndedClients.add(client)
    await client.disconnect()
    
    // Then detach the Node and release the socket too (disconnect() alone left
    // the DEALER open). Node listeners go first, so no second PEER_LEFT.
    await this._discardClient(client, address)
    
    // Clean up
    clients.delete(nodeId)
    clientsAddressIndex.delete(addressHash)
    
    logger.info(`[Node] Disconnected from ${address}`)
    
    return true
  }
  
  /**
   * Attach client event handlers and transform to Node events
   * @private
   */
  _attachClientEvents (client, address, attempt) {
    const _scope = _private.get(this)
    const { logger } = _scope
    
    // Remember what the Node attaches, so it can detach exactly these later
    // without touching the Client's own internal listeners
    const attached = []
    clientNodeListeners.set(client, attached)
    const listen = (event, listener) => {
      client.on(event, listener)
      attached.push([event, listener])
    }
    
    // Also listen to structured client error event
    listen(ClientEvent.ERROR, (err) => {
      logger.error('[Node] Client error:', err)
      const serverId = client.getServerId()
      this.emit(NodeEvent.ERROR, {
        source: 'client',
        serverId: serverId || null,
        error: err
      })
    })
    
    // Transform: Client.SERVER_JOINED → Node.PEER_JOINED (handshake complete, peer identified)
    listen(ClientEvent.SERVER_JOINED, ({ serverId, serverOptions }) => {
      // A late handshake after close(), or of a client already let go or
      // being ended by this node (disconnect(), reconnect policy), must not
      // repopulate anything
      if (_scope.closed || discardedClients.has(client) || locallyEndedClients.has(client)) return

      // First handshake: this fires before `await client.connect()` resumes.
      // connect() registers the client and announces the peer then, so that
      // PEER_JOINED is only seen once the peer is routable (and a cancelled
      // connect announces nothing)
      if (!attempt.registered) {
        attempt.joined = { serverId, serverOptions }
        return
      }

      // A later handshake (the DEALER reconnected by itself): the server at
      // this address may have restarted under a new id
      if (!this._rekeyClient(client, address, serverId)) return
      // A PEER_LEFT listener of the old id may have disconnected or closed
      if (_scope.closed || discardedClients.has(client) || locallyEndedClients.has(client)) return

      this._announceUpstreamPeer(serverId, serverOptions)
    })
    
    // The session behind `serverId` is this client's, unless another client
    // holds that id (only after an id collision when re-keying): then this
    // client's events must not end the other connection's session
    const ownsSession = (serverId) => {
      const owner = _scope.clients.get(serverId)
      return owner === undefined || owner === client
    }

    // Transform: Client.RECONNECTING → Node.RECONNECT_ATTEMPT (observability)
    listen(ClientEvent.RECONNECTING, ({ serverId, interval }) => {
      this.emit(NodeEvent.RECONNECT_ATTEMPT, { address, interval, peerId: serverId })
    })

    // Transform: Client.SERVER_OPTIONS_UPDATED → Node.PEER_UPDATED
    listen(ClientEvent.SERVER_OPTIONS_UPDATED, ({ serverId, serverOptions }) => {
      if (!ownsSession(serverId)) return
      this._updatePeerOptions(serverId, serverOptions, 'upstream')
    })
    
    // Transform: Client.NOT_READY → Node.PEER_LEFT (transport lost readiness)
    // The first of these signals ends the session (PEER_LEFT once); the
    // others find the peer no longer joined. Don't cleanup the client here:
    // the transport might recover (only an explicit disconnect() does).

    // Transform: Client.NOT_READY → Node.PEER_LEFT (transport lost readiness)
    listen(ClientEvent.NOT_READY, ({ serverId, reason }) => {
      if (!ownsSession(serverId)) return
      const category = locallyEndedClients.has(client) ? PeerLeftCategory.LOCAL : PeerLeftCategory.LOST
      this._peerLeft(serverId, 'upstream', reason || 'not_ready', category,
        () => this._applyReconnectPolicy(client, address, category))
    })
    
    // Transform: Client.CLOSED → Node.PEER_LEFT (transport permanently closed)
    listen(ClientEvent.CLOSED, ({ serverId }) => {
      if (!ownsSession(serverId)) return
      this._peerLeft(serverId, 'upstream', 'closed', PeerLeftCategory.LOCAL)
    })
    
    // Transform: Client.SERVER_LEFT → Node.PEER_LEFT (server shutdown/stopped)
    listen(ClientEvent.SERVER_LEFT, ({ serverId }) => {
      if (!ownsSession(serverId)) return
      this._peerLeft(serverId, 'upstream', 'server_left', PeerLeftCategory.GRACEFUL,
        () => this._applyReconnectPolicy(client, address, PeerLeftCategory.GRACEFUL))
    })
  }

  /**
   * An upstream session ended (`category` of its PEER_LEFT). ZeroMQ would
   * reconnect the client by itself whatever the policy; where the policy says
   * not to (DISABLED: any loss; ON_FAILURE: a graceful stop), the connection
   * is ended as disconnect(address) would. Sessions this node ended itself,
   * or that a re-handshake replaced, are left alone.
   * @private
   */
  _applyReconnectPolicy (client, address, category) {
    const _scope = _private.get(this)
    if (category === PeerLeftCategory.LOCAL || category === PeerLeftCategory.REPLACED) return

    const { reconnect } = _scope
    const keep = reconnect === ReconnectPolicy.ALWAYS ||
      (reconnect === ReconnectPolicy.ON_FAILURE && category === PeerLeftCategory.LOST)
    if (keep) return

    // Decided now, before PEER_LEFT is emitted: the client joins nothing any
    // more (a handshake arriving before the teardown runs is ignored), and a
    // connect() to this address (even from a PEER_LEFT listener) waits for
    // the old connection to be gone. The teardown runs after the listeners,
    // outside the transport's event dispatch.
    locallyEndedClients.add(client)
    const { endingConnections } = _scope
    const ending = new Promise(resolve => setImmediate(resolve)).then(() => {
      if (_scope.closed || discardedClients.has(client)) return
      const nodeId = _scope.clientsAddressIndex.get(md5(address))
      if (nodeId === undefined || _scope.clients.get(nodeId) !== client) return

      _scope.logger.info(`[Node] Not reconnecting to ${address} (reconnect: ${reconnect}, ${category})`)
      // What is still pending on that server will not be answered (a graceful
      // stop already rejected it with PEER_LEFT)
      client._rejectAllPendingRequests({
        code: ProtocolErrorCode.PEER_UNREACHABLE,
        message: `Server at ${address} is gone and reconnect is '${reconnect}'`
      })
      return this.disconnect(address)
    }).catch((err) => {
      _scope.logger.warn(`[Node] Failed to end the connection to ${address}: ${err.message}`)
    }).finally(() => {
      if (endingConnections.get(address) === ending) endingConnections.delete(address)
    })
    endingConnections.set(address, ending)
  }

  /**
   * Mark an upstream peer joined (we connected TO this server): PEER_JOINED,
   * or PEER_UPDATED / nothing for a re-handshake of a joined server
   * @private
   */
  _announceUpstreamPeer (serverId, serverOptions) {
    this._peerJoined(serverId, serverOptions, 'upstream')
  }

  /**
   * Emit a peer event from inside connect()/a re-key: a listener that throws
   * is reported (NodeEvent.ERROR) instead of failing a connect() that has
   * already registered the peer, or leaving a re-key half done
   * @private
   */
  _emitPeerEvent (event, payload) {
    try {
      this.emit(event, payload)
    } catch (err) {
      const { logger } = _private.get(this)
      logger.error(`[Node] A ${event} listener threw:`, err)
      try {
        this.emit(NodeEvent.ERROR, {
          source: 'node',
          stage: 'listener',
          serverId: payload.peerId,
          error: err
        })
      } catch (errorListenerErr) {
        logger.error('[Node] A node:error listener threw:', errorListenerErr)
      }
    }
  }

  /**
   * A registered client handshook again. If the server at `address` now
   * answers under a new id (restarted), move the client, the address index,
   * the reconnect target and the id → address mapping to the new id, and end
   * the old id's session, so that only the current id is known for the
   * address. Runs before the new id is announced, so a PEER_JOINED listener
   * can route to it at once.
   * @private
   * @returns {boolean} false if the new id must not be announced
   */
  _rekeyClient (client, address, serverId) {
    const _scope = _private.get(this)
    const { clients, clientsAddressIndex, connectionTargets, peerIdToAddress, logger } = _scope

    const addressHash = md5(address)
    const oldId = clientsAddressIndex.get(addressHash)

    // Not the client registered at this address (only after an id collision
    // at connect time): leave the maps alone, as before
    if (oldId === undefined || clients.get(oldId) !== client) return true

    const endOldSession = () => {
      if (peerIdToAddress.get(oldId) === address) peerIdToAddress.delete(oldId)
      // Still joined if neither NOT_READY nor SERVER_LEFT was seen for it.
      // Its id → address mapping is gone, so this schedules no reconnect.
      this._peerLeft(oldId, 'upstream', 'replaced', PeerLeftCategory.REPLACED)
    }

    if (oldId !== serverId) {
      // Another connection already holds the new id (one server reachable at
      // two addresses): never take its entry. This client stays registered
      // under the old key, so disconnect(address) still finds and closes it;
      // the peer is joined (and routed) through the other connection.
      const holder = clients.get(serverId)
      if (holder !== undefined && holder !== client) {
        logger.warn(`[Node] Server at ${address} now answers as '${serverId}', already connected through another address; not re-keying '${oldId}'`)
        endOldSession()
        return false
      }

      logger.info(`[Node] Server at ${address} is now '${serverId}' (was '${oldId}')`)
      clients.delete(oldId)
      clients.set(serverId, client)
      clientsAddressIndex.set(addressHash, serverId)
    }

    // The session is back: a reconnect timer for the address is not needed,
    // and the next loss starts at the first backoff step again
    const target = connectionTargets.get(address)
    if (target && !target.cancelled) {
      target.peerId = serverId
      target.attempts = 0
      if (target.timer) {
        clearTimeout(target.timer)
        target.timer = null
      }
      peerIdToAddress.set(serverId, address)
    }

    if (oldId !== serverId) endOldSession()

    return true
  }

  /**
   * A newer connection to the same server (another address) took `serverId`
   * over: forget the older connection's addresses and reconnect target, and
   * close it silently. Called once the newer client owns the id, so nothing
   * is reported (the peer stays joined).
   * @private
   */
  _dropDisplacedClient (displaced, serverId, currentAddress) {
    const { clientsAddressIndex, connectionTargets } = _private.get(this)
    const currentHash = md5(currentAddress)

    for (const [hash, nodeId] of Array.from(clientsAddressIndex)) {
      if (nodeId === serverId && hash !== currentHash) clientsAddressIndex.delete(hash)
    }
    let displacedAddress = null
    for (const [targetAddress, target] of Array.from(connectionTargets)) {
      if (target.peerId === serverId && targetAddress !== currentAddress) {
        displacedAddress = targetAddress
        this._forgetConnectionTarget(targetAddress)
      }
    }

    locallyEndedClients.add(displaced)
    this._discardClient(displaced, displacedAddress || '(displaced connection)', { notify: false }).catch(() => {})
  }

  /**
   * Detach the listeners added by _attachClientEvents (Client internals stay)
   * @private
   */
  _detachClientEvents (client) {
    const attached = clientNodeListeners.get(client)
    if (!attached) return
    for (const [event, listener] of attached) {
      client.off(event, listener)
    }
    clientNodeListeners.delete(client)
  }
  
  /**
   * Detach a client from this Node and release its socket.
   * Emits nothing: Node listeners are removed before the client closes.
   * @private
   */
  async _discardClient (client, address, { notify = true } = {}) {
    if (discardedClients.has(client)) return
    discardedClients.add(client)
    
    const { logger, peers, clients } = _private.get(this)
    
    // The handshake may already have completed (PEER_JOINED emitted) even if
    // connect() has not resumed yet: close out that session before detaching,
    // otherwise the peer stays joined with no client behind it
    const serverId = client.getServerId()
    const owner = serverId ? clients.get(serverId) : undefined
    if (serverId && peers.upstream.has(serverId) && (owner === undefined || owner === client)) {
      this._peerLeft(serverId, 'upstream', 'closed', PeerLeftCategory.LOCAL)
    }
    
    this._detachClientEvents(client)
    this._removeClientHandlers(client)
    try {
      await client.close({ notify })
    } catch (err) {
      logger.warn(`[Node] Failed to close client for ${address}: ${err.message}`)
    }
  }
  
  // ============================================================================
  // AUTO-RECONNECT LOGIC
  // ============================================================================
  
  /**
   * Setup auto-reconnect listener for upstream peers
   * @private
   */
  _setupAutoReconnect () {
    const _scope = _private.get(this)
    const { logger, connectionTargets, peerIdToAddress } = _scope
    
    this.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason }) => {
      // Only handle upstream peers (our outgoing connections)
      if (direction !== 'upstream') {
        return
      }
      
      // Check if we have a tracked address for this peer
      const address = peerIdToAddress.get(peerId)
      if (!address) {
        return
      }
      
      // Determine if we should reconnect based on reason
      const shouldReconnect = this._shouldReconnect(reason, direction)
      
      if (!shouldReconnect) {
        logger.info(`[Node] Peer '${peerId}' left (${reason}), skipping reconnect`)
        return
      }
      
      logger.warn(`[Node] Peer '${peerId}' left unexpectedly (${reason}), scheduling reconnect to ${address}`)
      
      // Schedule reconnect with backoff
      this._scheduleReconnect(address)
    })
  }
  
  /**
   * Determine if we should auto-reconnect based on disconnect reason
   * @private
   */
  _shouldReconnect (reason, direction) {
    const _scope = _private.get(this)
    const { reconnect } = _scope
    
    // Only reconnect upstream peers
    if (direction !== 'upstream') {
      return false
    }
    
    // Check reconnect policy
    if (reconnect === ReconnectPolicy.ALWAYS) {
      // Always reconnect upstream peers, regardless of reason
      return true
    }
    
    if (reconnect === ReconnectPolicy.ON_FAILURE) {
      // Don't reconnect for graceful shutdowns
      if (reason === 'server_left' || reason === 'closed') {
        return false
      }
      
      // Reconnect for unexpected failures
      return true
    }
    
    // reconnect === ReconnectPolicy.DISABLED or unknown value
    return false
  }
  
  /**
   * Stop auto-reconnecting to an address: clear its timer, mark the target
   * cancelled (abandons a reconnect already in flight) and drop the mappings
   * @private
   */
  _forgetConnectionTarget (address) {
    const { connectionTargets, peerIdToAddress } = _private.get(this)
    
    const target = connectionTargets.get(address)
    if (target) {
      if (target.timer) {
        clearTimeout(target.timer)
        target.timer = null
      }
      target.cancelled = true
      connectionTargets.delete(address)
    }
    
    for (const [peerId, peerAddress] of peerIdToAddress.entries()) {
      if (peerAddress === address) {
        peerIdToAddress.delete(peerId)
      }
    }
  }
  
  /**
   * Cancel a connect() that is still waiting for its handshake: closing its
   * client makes Client.connect() reject at once, and connect() then rejects
   * with CONNECT_CANCELLED without registering anything
   * @private
   */
  async _cancelPendingConnect (address) {
    const { pendingConnects } = _private.get(this)
    const attempt = pendingConnects.get(address)
    if (!attempt) return
    
    attempt.cancelled = true
    pendingConnects.delete(address)
    
    if (attempt.client) {
      await this._discardClient(attempt.client, address)
    }
    // Let the connect() promise settle before returning
    await attempt.promise.catch(() => {})
  }
  
  /**
   * Whether the client registered for `address` has a live session
   * (transport up and handshake done)
   * @private
   */
  _hasSession (address) {
    const { clients, clientsAddressIndex, peers } = _private.get(this)
    const nodeId = clientsAddressIndex.get(md5(address))
    const client = nodeId !== undefined ? clients.get(nodeId) : undefined
    if (!client || !client.isOnline()) return false
    // The client keeps the old server id while the transport is down, and the
    // transport may be up again before (or without) a handshake: only an id
    // joined upstream and re-keyed to this client is a session
    const serverId = client.getServerId()
    return peers.upstream.has(serverId) && clients.get(serverId) === client
  }

  /**
   * Schedule a reconnect attempt with exponential backoff
   * @private
   */
  _scheduleReconnect (address) {
    const _scope = _private.get(this)
    const { logger, connectionTargets } = _scope
    
    const target = connectionTargets.get(address)
    if (!target) {
      logger.warn(`[Node] No connection target found for ${address}`)
      return
    }
    
    // Clear existing timer if any
    if (target.timer) {
      clearTimeout(target.timer)
    }
    
    // Calculate backoff: 1s, 2s, 4s, 8s, 16s, 30s (cap)
    const baseDelay = 1000
    const maxDelay = 30000
    const delay = Math.min(baseDelay * Math.pow(2, target.attempts), maxDelay)
    
    target.attempts++
    
    logger.info(`[Node] Reconnecting to ${address} in ${delay}ms (attempt ${target.attempts})`)
    
    target.timer = setTimeout(async () => {
      target.timer = null
      if (target.cancelled) return
      
      try {
        // A disconnect()/close() during this attempt cancels the pending
        // connect itself (CONNECT_CANCELLED), so nothing is registered
        await this.connect({ address })
        if (target.cancelled) return

        // connect() resolves at once for an address whose client is still
        // there, session or not. Without a session that client's DEALER keeps
        // reconnecting by itself; its next handshake re-keys it and ends these
        // retries (_rekeyClient). Until then, keep checking with backoff.
        if (!this._hasSession(address)) {
          // A transport that is up but has no session (the server said it
          // stops without dropping the link, or an ack was lost) gets no new
          // handshake from ZeroMQ: ask for one (ignored until the server
          // accepts sessions again)
          const nodeId = _scope.clientsAddressIndex.get(md5(address))
          _scope.clients.get(nodeId)?._sendClientConnected()
          logger.info(`[Node] Reconnect to ${address}: client known but no session yet, retrying`)
          this._scheduleReconnect(address)
          return
        }
        logger.info(`[Node] Successfully reconnected to ${address}`)
      } catch (err) {
        if (target.cancelled) return
        logger.error(`[Node] Reconnect failed to ${address}:`, err.message)
        // Schedule another attempt
        this._scheduleReconnect(address)
      }
    }, delay)
  }
  
  // ============================================================================
  // HANDLER MANAGEMENT (Central Registry)
  // ============================================================================
  
  /**
   * Register request handler
   * Handlers are stored centrally and applied to all servers/clients
   */
  onRequest (pattern, handler) {
    const { handlerRegistry, server, clients, logger } = _private.get(this)
    
    // Store in central registry
    handlerRegistry.request.on(pattern, handler)
    
    // Apply to server if it exists
    if (server) {
      server.onRequest(pattern, handler)
    }
    
    // Apply to all existing clients
    clients.forEach(client => {
      client.onRequest(pattern, handler)
    })
  }
  
  /**
   * Unregister request handler
   */
  offRequest (pattern, handler) {
    const { handlerRegistry, server, clients } = _private.get(this)
    
    // Remove from registry
    if (handler) {
      handlerRegistry.request.off(pattern, handler)
    } else {
      handlerRegistry.request.removeAllListeners(pattern)
    }
    
    // Remove from server
    if (server) {
      server.offRequest(pattern, handler)
    }
    
    // Remove from clients
    clients.forEach(client => {
      client.offRequest(pattern, handler)
    })
  }
  
  /**
   * Register tick handler
   */
  onTick (pattern, handler) {
    const { handlerRegistry, server, clients } = _private.get(this)
    
    // Store in central registry
    handlerRegistry.tick.on(pattern, handler)
    
    // Apply to server if it exists
    if (server) {
      server.onTick(pattern, handler)
    }
    
    // Apply to all existing clients
    clients.forEach(client => {
      client.onTick(pattern, handler)
    })
  }
  
  /**
   * Unregister tick handler
   */
  offTick (pattern, handler) {
    const { handlerRegistry, server, clients } = _private.get(this)
    
    // Remove from registry
    if (handler) {
      handlerRegistry.tick.off(pattern, handler)
    } else {
      handlerRegistry.tick.removeAllListeners(pattern)
    }
    
    // Remove from server
    if (server) {
      server.offTick(pattern, handler)
    }
    
    // Remove from clients
    clients.forEach(client => {
      client.offTick(pattern, handler)
    })
  }
  
  /**
   * Sync all registered handlers to a target (server or client)
   * @private
   */
  _syncHandlersToTarget (target) {
    const { handlerRegistry } = _private.get(this)
    
    // PatternEmitter.allListeners returns ALL listeners (string events + RegExp patterns)
    // This is much simpler than before!
    
    // Apply all request handlers
    for (const [pattern, handlers] of handlerRegistry.request.allListeners) {
      handlers.forEach(handler => {
        // Pattern can be string, symbol, or RegExp pattern string (like '/test.*/')
        // If it starts with '/', it's a RegExp pattern string, convert back to RegExp
        const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
          ? new RegExp(pattern.slice(1, -1))
          : pattern
        target.onRequest(eventPattern, handler)
      })
    }
    
    // Apply all tick handlers
    for (const [pattern, handlers] of handlerRegistry.tick.allListeners) {
      handlers.forEach(handler => {
        const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
          ? new RegExp(pattern.slice(1, -1))
          : pattern
        target.onTick(eventPattern, handler)
      })
    }
  }
  
  /**
   * Remove all handlers from a client
   * @private
   */
  _removeClientHandlers (client) {
    const { handlerRegistry } = _private.get(this)
    
    // Remove all request handlers
    for (const [pattern] of handlerRegistry.request.allListeners) {
      const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
        ? new RegExp(pattern.slice(1, -1))
        : pattern
      client.offRequest(eventPattern)
    }
    
    // Remove all tick handlers
    for (const [pattern] of handlerRegistry.tick.allListeners) {
      const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
        ? new RegExp(pattern.slice(1, -1))
        : pattern
      client.offTick(eventPattern)
    }
  }
  
  // ============================================================================
  // ROUTING
  // ============================================================================
  
  /**
   * Find route to node
   * @private
   * @returns {{ type: 'server'|'client', target: Server|Client, targetId?: string } | null}
   */
  _findRoute (nodeId, { up = true, down = true } = {}) {
    const { server, clients, peers } = _private.get(this)
    
    // ✅ Only joined peers are routable (Node's joined state is the source of
    // truth), in the allowed directions. A peer joined both ways is reached
    // through our own connection to it first.
    
    // We connected TO this server
    if (up && peers.upstream.has(nodeId) && clients.has(nodeId)) {
      return {
        type: 'client',
        target: clients.get(nodeId)
      }
    }

    // Client connected TO our server
    if (down && peers.downstream.has(nodeId) && server && server.isOnline()) {
      return {
        type: 'server',
        target: server,
        targetId: nodeId
      }
    }
    
    return null
  }
  
  /**
   * Get filtered nodes by options/predicate
   * @private
   */
  _getFilteredNodes ({ options, predicate, up = true, down = true } = {}) {
    const { peers } = _private.get(this)
    const nodes = new Set()
    
    // Build predicate function
    const pred = predicate || NodeUtils.optionsPredicateBuilder(options)
    
    // ✅ Iterate through ALL joined peers of the allowed directions (single
    // source of truth); a peer joined both ways is listed once
    const tables = [up && peers.upstream, down && peers.downstream].filter(Boolean)
    for (const table of tables) {
      for (const [peerId, peerOpts] of table) {
        if (pred(peerOpts || {})) {
          nodes.add(peerId)
        }
      }
    }
    
    return Array.from(nodes)
  }
  
  /**
   * Select node from list (load balancing strategy)
   * @private
   */
  _selectNode (nodeIds, event) {
    if (!nodeIds || nodeIds.length === 0) {
      return null
    }
    
    // Simple random selection
    // Can be enhanced with round-robin, least-connections, etc.
    const idx = Math.floor(Math.random() * nodeIds.length)
    return nodeIds[idx]
  }
  
  // ============================================================================
  // MESSAGING API
  // ============================================================================
  
  /**
   * Send request to specific node
   */
  async request ({ to, event, data, metadata, timeout } = {}) {
    return this._requestVia(this._findRoute(to), to, { event, data, metadata, timeout })
  }

  /**
   * Send a request along a route from _findRoute (NODE_NOT_FOUND if none)
   * @private
   */
  async _requestVia (route, to, { event, data, metadata, timeout }) {
    if (!route) {
      throw new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: `No route to node '${to}'`,
        nodeId: to,
        context: { event }
      })
    }
    
    if (route.type === 'server') {
      // Route through our server to connected client
      return route.target.request({ to: route.targetId, event, data, metadata, timeout })
    } else {
      // Route through client to remote server
      return route.target.request({ event, data, metadata, timeout })
    }
  }
  
  /**
   * Send tick to specific node
   */
  tick ({ to, event, data, metadata } = {}) {
    return this._tickVia(this._findRoute(to), to, { event, data, metadata })
  }

  /**
   * Send a tick along a route from _findRoute (throws NODE_NOT_FOUND if none)
   * @private
   */
  _tickVia (route, to, { event, data, metadata }) {
    if (!route) {
      throw new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: `No route to node '${to}'`,
        nodeId: to,
        context: { event }
      })
    }
    
    if (route.type === 'server') {
      return route.target.tick({ to: route.targetId, event, data, metadata })
    } else {
      return route.target.tick({ event, data, metadata })
    }
  }
  
  /**
   * Send request to any matching node
   */
  async requestAny ({ event, data, timeout, filter, down = true, up = true } = {}) {
    // Routing info is internal: a caller's `_routing` is not taken
    return this._requestAny({ event, data, timeout, filter, down, up })
  }

  /**
   * requestAny, with the routing info of a proxy request being forwarded
   * (`routing` is set by a Router only; undefined for a local call)
   * @private
   */
  async _requestAny ({ event, data, timeout, filter, down = true, up = true }, routing) {
    // Extract options and predicate from filter if wrapped
    const filterOptions = filter?.options || (filter?.predicate ? undefined : filter)
    const filterPredicate = filter?.predicate
    
    // ============================================================================
    // 1. TRY LOCAL DISCOVERY FIRST
    // ============================================================================
    const filteredNodes = this._getFilteredNodes({ 
      options: filterOptions, 
      predicate: filterPredicate, 
      down, 
      up 
    })
    
    if (filteredNodes.length > 0) {
      const targetNode = this._selectNode(filteredNodes, event)
      // Only through a connection of an allowed direction (a peer joined both
      // ways was selected for one of them)
      const route = this._findRoute(targetNode, { up, down })
      const routeDirection = route?.type === 'client' ? 'upstream' : 'downstream'
      return this._requestVia(route, targetNode, { event, data, timeout }).catch((err) => {
        // The chosen peer turned out to be gone (crashed) and the transport
        // refused this very message (delivered === false): it never reached a
        // handler, so another peer may take it. A request that may have been
        // delivered is never retried (at-most-once). That session has been
        // removed, so this terminates.
        if (err?.code === ProtocolErrorCode.PEER_UNREACHABLE && err.context?.delivered === false &&
            !this._isJoinedPeer(targetNode, routeDirection)) {
          return this._requestAny({ event, data, timeout, filter, down, up }, routing)
        }
        throw err
      })
    }
    
    // ============================================================================
    // 2. ROUTER FALLBACK (if no local match)
    // ============================================================================
    
    // Predicate functions cannot be serialized over network
    if (filterPredicate) {
      const error = new NodeError({
        code: NodeErrorCode.PREDICATE_NOT_ROUTABLE,
        message: 'Predicate filters cannot be forwarded to router. Use object-based filters for router fallback.',
        context: { event, down, up }
      })
      return Promise.reject(error)
    }
    
    // Proxy path bookkeeping (routing is set when a Router forwards a proxy request)
    const hop = this._prepareProxyHop(routing)
    if (hop.error) {
      return Promise.reject(hop.error)
    }
    
    return this._forwardRequestToRouters({ event, data, timeout, filterOptions, filter, down, up, hop })
  }
  
  /**
   * Router fallback of requestAny: a depth-first search over routers.
   * Routers are tried one at a time; a router that answers with a routing miss
   * (no match / hop limit) reports the routers it explored, which are then
   * skipped too, so every router is tried at most once per request and a
   * dead-end neighbour no longer hides one that can route.
   * @private
   */
  async _forwardRequestToRouters ({ event, data, timeout, filterOptions, filter, down, up, hop }) {
    const _scope = _private.get(this)
    const startedAt = Date.now()
    let hopTimeout = timeout
    
    while (!hop.atHopLimit) {
      // Routers (both directions), never the sender of this proxy, a node on
      // the path or a router already explored
      const routers = this._proxyCandidates(hop)
      if (routers.length === 0) break
      
      const routerNode = this._selectNode(routers, event)
      hop.visited.add(routerNode)
      
      // Send proxy request to router via system event (use internal method)
      const route = this._findRoute(routerNode)
      if (!route) {
        _scope.logger.debug(`[Router Fallback] Router '${routerNode}' is joined but has no route; skipping it`)
        continue
      }
      
      // Effective timeout of this hop (fixed on the first try); each try gets
      // what is left of it, sent as the next hop's time budget
      hopTimeout = hopTimeout || route.target.getConfig().PROTOCOL_REQUEST_TIMEOUT
      const remaining = hopTimeout - (Date.now() - startedAt)
      if (remaining < Globals.PROXY_MIN_BUDGET_MS) break
      
      _scope.logger.debug(`[Router Fallback] Forwarding requestAny to router: ${routerNode}`)
      
      // Use the ACTUAL event and data, put routing info in metadata
      const requestParams = {
        event: '_system:proxy_request',
        data,  // Original user data (unchanged!)
        metadata: {
          routing: {
            event,           // The real event to route
            filter: filterOptions,
            timeout: remaining,
            down,
            up,
            requestor: hop.requestor,
            path: hop.path,              // Nodes on the proxy path (incl. this one)
            visited: hop.visitedList(),  // Routers already explored for this request
            budget: remaining            // ms the next hop has before this hop gives up
          }
        },
        timeout: remaining
      }
      
      // NOTE: Server vs Client API difference
      // - Server (ROUTER socket): Needs 'to' parameter (which client?)
      // - Client (DEALER socket): No 'to' needed (only one server)
      // This is a semantic difference, not a ZeroMQ leak
      if (route.type === 'server') {
        requestParams.to = route.targetId
      }
      
      try {
        return await route.target._sendSystemRequest(requestParams)
      } catch (err) {
        // The router is gone and the request never reached it: try the next
        if (err?.context?.delivered === false) continue
        
        // A real answer (handler error, timeout, ...) ends the search
        if (!isRoutingMiss(err)) throw err
        
        // The router could not route it: skip everything it explored, try the next
        this._mergeProxyMiss(hop, err.routing)
      }
    }
    
    // ============================================================================
    // 3. NO MATCH (neither local nor router)
    // ============================================================================
    throw this._proxyMiss(hop, { filter, down, up, event })
  }
  
  /**
   * Compute the proxy path for forwarding to a router.
   * `routing` is the sanitized routing info of an incoming proxy message
   * ({ path, from, requestor }) or undefined for a locally originated call.
   * @private
   * @returns {{ path: string[], exclude: Set<string>, requestor: string, error?: NodeError }}
   */
  _prepareProxyHop (routing) {
    const incomingPath = routing?.path || []
    const path = [...incomingPath, this.getId()]
    const onPath = new Set(path)
    
    // Routers explored for this message so far (depth-first search). Kept
    // apart from the path, which always travels in full.
    const visited = new Set(routing?.visited || [])
    if (this.getOptions()?.router) {
      visited.add(this.getId())
    }
    // The router this came from has been explored on this path by definition.
    // Recording it matters when it is an old router: it strips path/visited,
    // so without this the search could be sent back through it again.
    if (routing?.from && this._joinedPeerOptions(routing.from)?.router) {
      visited.add(routing.from)
    }
    
    return {
      path,
      from: routing?.from,
      requestor: routing?.requestor || this.getId(),
      visited,
      // Routers hop-limited branches could not try (reported by misses)
      unexplored: new Set(routing?.unexplored || []),
      error: routing?.error,
      // Proxied ticks: forwards left for this tick in total (all branches)
      forwards: Number.isInteger(routing?.forwards) ? routing.forwards : Globals.PROXY_TICK_MAX_FORWARDS,
      // Never forward to a node on the path, the sender, or an explored router
      isExcluded: (nodeId) => onPath.has(nodeId) || nodeId === routing?.from || visited.has(nodeId),
      visitedList: () => Array.from(visited).slice(-Globals.PROXY_MAX_VISITED),
      atHopLimit: path.length > Globals.PROXY_MAX_HOPS
    }
  }
  
  /**
   * Routers this hop may still forward to
   * @private
   */
  _proxyCandidates (hop) {
    return this._getFilteredNodes({
      options: { router: true },
      down: true,
      up: true
    }).filter(nodeId => !hop.isExcluded(nodeId))
  }
  
  /**
   * The error a hop answers with when it cannot place a proxied message,
   * carrying what it explored back to the previous hop
   * @private
   */
  _proxyMiss (hop, { filter, down, up, event }, noMatchMessage = 'No nodes match filter and no routers available', isTick = false) {
    const candidates = hop.atHopLimit ? this._proxyCandidates(hop) : []
    for (const nodeId of candidates) hop.unexplored.add(nodeId)
    
    // Hop limit only if some router really went unexplored because of it
    const unexplored = Array.from(hop.unexplored).filter(nodeId => !hop.visited.has(nodeId))
    const limited = unexplored.length > 0
    
    const error = new NodeError({
      code: limited ? NodeErrorCode.PROXY_HOP_LIMIT : NodeErrorCode.NO_NODES_MATCH_FILTER,
      message: limited
        ? `Proxy hop limit (${Globals.PROXY_MAX_HOPS}) reached; no reachable node matches the filter`
        : noMatchMessage,
      context: { filter, down, up, event }
    })
    error.routing = {
      miss: true,
      visited: hop.visitedList(),
      unexplored: unexplored.slice(0, Globals.PROXY_MAX_VISITED),
      // Ticks only (requests are bounded by their time budget instead)
      ...(isTick ? { forwards: hop.forwards } : {})
    }
    error[kProxyMiss] = true
    return error
  }
  
  /**
   * Merge what a downstream miss explored into this hop
   * @private
   */
  _mergeProxyMiss (hop, routing) {
    for (const nodeId of sanitizeVisited(routing?.visited) || []) hop.visited.add(nodeId)
    for (const nodeId of sanitizeVisited(routing?.unexplored) || []) hop.unexplored.add(nodeId)
  }
  
  /**
   * Send request to any downstream node
   */
  async requestDownAny ({ event, data, timeout, filter } = {}) {
    return this.requestAny({ event, data, timeout, filter, down: true, up: false })
  }
  
  /**
   * Send request to any upstream node
   */
  async requestUpAny ({ event, data, timeout, filter } = {}) {
    return this.requestAny({ event, data, timeout, filter, down: false, up: true })
  }
  
  /**
   * Send tick to any matching node
   */
  tickAny ({ event, data, filter, down = true, up = true } = {}) {
    // Routing info is internal: a caller's `_routing` is not taken
    return this._tickAny({ event, data, filter, down, up })
  }

  /**
   * tickAny, with the routing info of a proxy tick being placed
   * (`routing` is set by a Router or a returned miss; undefined for a local call)
   * @private
   */
  _tickAny ({ event, data, filter, down = true, up = true }, routing) {
    // Extract options and predicate from filter if wrapped
    const filterOptions = filter?.options || (filter?.predicate ? undefined : filter)
    const filterPredicate = filter?.predicate
    
    // ============================================================================
    // 1. TRY LOCAL DISCOVERY FIRST
    // ============================================================================
    const filteredNodes = this._getFilteredNodes({ 
      options: filterOptions, 
      predicate: filterPredicate, 
      down, 
      up 
    })
    
    if (filteredNodes.length > 0) {
      const targetNode = this._selectNode(filteredNodes, event)
      return this._tickVia(this._findRoute(targetNode, { up, down }), targetNode, { event, data })
    }
    
    // ============================================================================
    // 2. ROUTER FALLBACK (if no local match)
    // ============================================================================
    
    // Predicate functions cannot be serialized
    // For ticks, reject with error (backward compatibility)
    if (filterPredicate) {
      const error = new NodeError({
        code: NodeErrorCode.PREDICATE_NOT_ROUTABLE,
        message: 'Predicate filters cannot be forwarded to router. Use object-based filters for router fallback.',
        context: { event, down, up }
      })
      return Promise.reject(error)
    }
    
    // Proxy path bookkeeping (routing is set when a Router forwards a proxy tick)
    const hop = this._prepareProxyHop(routing)
    if (hop.error) {
      return Promise.reject(hop.error)
    }
    
    // Routers, never the sender of this proxy, a node on the path or a router
    // already explored. A router that cannot place the tick sends it back
    // (_system:proxy_tick_miss) and the next router is tried then.
    const _scope = _private.get(this)
    while (!hop.atHopLimit && hop.forwards > 0) {
      const routers = this._proxyCandidates(hop)
      if (routers.length === 0) break
      
      const routerNode = this._selectNode(routers, event)
      hop.visited.add(routerNode)
      
      // Send proxy tick to router via system event (use internal method)
      const route = this._findRoute(routerNode)
      if (!route) {
        _scope.logger.debug(`[Router Fallback] Router '${routerNode}' is joined but has no route; skipping it`)
        continue
      }
      
      _scope.logger.debug(`[Router Fallback] Forwarding tickAny to router: ${routerNode}`)
      
      // Remember this forward: a miss is accepted only from `routerNode`, for
      // this id, once; and where to send our own miss comes from here, not
      // from the (untrusted) miss message
      const forwards = hop.forwards - 1
      const tickId = this._rememberForwardedTick(routerNode, {
        event,
        filter: filterOptions,
        down,
        up,
        routing,
        // This node's own exploration, kept in full (the forwarded list is capped)
        visited: Array.from(hop.visited),
        forwards
      })
      
      // Use the ACTUAL event and data, put routing info in metadata
      const tickParams = {
        event: '_system:proxy_tick',
        data,  // Original user data (unchanged!)
        metadata: {
          routing: {
            event,           // The real event to route
            filter: filterOptions,
            down,
            up,
            requestor: hop.requestor,
            path: hop.path,              // Nodes on the proxy path (incl. this one)
            visited: hop.visitedList(),  // Routers already explored for this tick
            tick: tickId,                // Echoed back in a miss
            forwards                     // Forwards left for this tick (all branches)
          }
        }
      }
      
      // NOTE: Server vs Client API difference
      // - Server (ROUTER socket): Needs 'to' parameter (which client?)
      // - Client (DEALER socket): No 'to' needed (only one server)
      if (route.type === 'server') {
        tickParams.to = route.targetId
      }
      
      // If the router refuses the tick at the transport (gone, or its queue is
      // full), it never got it: forget the forward and try the next router
      const tryNext = () => {
        if (!this._takeForwardedTick(tickId, routerNode)) return
        this._routeProxyTick({ event, data, filter, down, up }, {
          ...(routing || {}),
          visited: Array.from(hop.visited),
          unexplored: Array.from(hop.unexplored),
          forwards
        })
      }
      try {
        const sent = route.target._sendSystemTick(tickParams)
        if (sent && typeof sent.then === 'function') sent.then(null, tryNext)
      } catch (err) {
        tryNext()
      }
      // Return resolved promise for consistency (tick is fire-and-forget)
      return Promise.resolve()
    }
    
    // ============================================================================
    // 3. NO MATCH (neither local nor router)
    // ============================================================================
    // Reject to maintain backward compatibility with tests
    return Promise.reject(this._proxyMiss(hop, { filter, down, up, event }, 'No nodes match filter criteria and no routers available', true))
  }
  
  /**
   * Place a proxied tick (on a router, or on any node a miss came back to).
   * If it cannot be placed, send it back to the node it came from, with what
   * was explored, so that node tries its next router. Never rejects.
   * @private
   * @returns {Promise<boolean>} true if forwarded or delivered
   */
  _routeProxyTick ({ event, data, filter, down, up }, routing) {
    let result
    try {
      result = this._tickAny({ event, data, filter, down, up }, routing)
    } catch (err) {
      result = Promise.reject(err)
    }
    
    return Promise.resolve(result).then(() => true, (err) => {
      if (isRoutingMiss(err) && routing?.from) {
        this._sendProxyTickMiss({ event, data, filter, down, up }, routing, err.routing)
      } else {
        _private.get(this).logger.debug(`[Router Fallback] Dropping tick '${event}': ${err?.message}`)
      }
      return false
    })
  }
  
  /**
   * Send a tick that could not be placed back to the node it came from
   * @private
   */
  _sendProxyTickMiss ({ event, data, filter, down, up }, routing, missRouting) {
    const to = routing.from
    const route = this._findRoute(to)
    if (!route) return
    
    const tickParams = {
      event: '_system:proxy_tick_miss',
      data,
      metadata: {
        routing: {
          event,
          filter,
          down,
          up,
          requestor: routing.requestor,
          path: routing.path || [],   // as `to` sent it: ends with `to`
          tick: routing.tick,         // the id `to` gave this forward
          visited: missRouting?.visited || [],
          unexplored: missRouting?.unexplored || [],
          forwards: missRouting?.forwards
        }
      }
    }
    if (route.type === 'server') {
      tickParams.to = route.targetId
    }
    
    try {
      route.target._sendSystemTick(tickParams)
    } catch (err) {
      _private.get(this).logger.debug(`[Router Fallback] Could not return tick '${event}' to ${to}: ${err.message}`)
    }
  }
  
  /**
   * A tick this node forwarded could not be placed further on: try the next
   * router (with everything explored so far), or pass the miss back again
   * @private
   */
  _handleProxyTickMiss (envelope) {
    const routing = envelope.metadata?.routing || {}
    
    // Only a miss for a tick this node forwarded, from the router it was
    // forwarded to, once. Anything else (forged, replayed, late) is dropped.
    const record = this._takeForwardedTick(routing.tick, envelope.owner)
    if (!record) return
    
    const { event, filter, down, up } = record
    // Forwards left: what the branch reports, never more than we gave it
    const reported = routing.forwards
    const forwards = Number.isInteger(reported) && reported >= 0 ? Math.min(reported, record.forwards) : record.forwards
    
    this._routeProxyTick({ event, data: envelope.data, filter, down, up }, {
      // Our own routing as we received it (what our own miss would need)
      ...(record.routing || {}),
      // Everything this node explored (kept in full) plus what the branch did
      visited: [...record.visited, ...(sanitizeVisited(routing.visited) || [])],
      unexplored: sanitizeVisited(routing.unexplored) || [],
      forwards
    })
  }
  
  /**
   * Record a proxied tick this node forwards (bounded, short-lived)
   * @private
   * @returns {string} tick id
   */
  _rememberForwardedTick (routerNode, { event, filter, down, up, routing, visited, forwards }) {
    const _scope = _private.get(this)
    const { forwardedTicks } = _scope
    const now = Date.now()
    const tickId = randomUUID()
    
    // Closing: nothing could continue this tick any more; keep no record
    if (_scope.closed) return tickId
    
    this._scheduleForwardedTickSweep()
    
    // Drop expired / excess records (Map keeps insertion order: oldest first)
    for (const [id, record] of forwardedTicks) {
      if (record.expires > now && forwardedTicks.size < Globals.PROXY_TICK_RECORDS) break
      forwardedTicks.delete(id)
    }
    
    forwardedTicks.set(tickId, {
      routerNode,
      event,
      filter,
      down,
      up,
      routing,   // how this node received the tick (undefined if it originated it)
      visited,   // routers this node explored for it so far
      forwards,  // forwards left after this one
      expires: now + Globals.PROXY_TICK_RECORD_MS
    })
    return tickId
  }
  
  /**
   * Drop expired forwarded-tick records while records exist (most ticks are
   * delivered and never come back as a miss). The timer does not keep the
   * process alive and stops once the map is empty.
   * @private
   */
  _scheduleForwardedTickSweep () {
    const _scope = _private.get(this)
    if (_scope.forwardedTickSweep) return
    
    _scope.forwardedTickSweep = setInterval(() => {
      const now = Date.now()
      for (const [id, record] of _scope.forwardedTicks) {
        if (record.expires > now) break
        _scope.forwardedTicks.delete(id)
      }
      if (_scope.forwardedTicks.size === 0) {
        clearInterval(_scope.forwardedTickSweep)
        _scope.forwardedTickSweep = null
      }
    }, Globals.PROXY_TICK_RECORD_MS)
    _scope.forwardedTickSweep.unref?.()
  }
  
  /**
   * Consume the record of a forwarded tick if `sender` is the router it went to
   * @private
   */
  _takeForwardedTick (tickId, sender) {
    const { forwardedTicks } = _private.get(this)
    if (typeof tickId !== 'string') return null
    
    const record = forwardedTicks.get(tickId)
    if (!record) return null
    if (record.expires <= Date.now()) {
      forwardedTicks.delete(tickId)
      return null
    }
    if (record.routerNode !== sender) return null
    
    forwardedTicks.delete(tickId)
    return record
  }
  
  /**
   * Send tick to any downstream node
   */
  tickDownAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: true, up: false })
  }
  
  /**
   * Send tick to any upstream node
   */
  tickUpAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: false, up: true })
  }
  
  /**
   * Send tick to all matching nodes
   */
  async   tickAll ({ event, data, filter, down = true, up = true } = {}) {
    // Extract options and predicate from filter if wrapped
    const filterOptions = filter?.options || (filter?.predicate ? undefined : filter)
    const filterPredicate = filter?.predicate
    const filteredNodes = this._getFilteredNodes({ 
      options: filterOptions, 
      predicate: filterPredicate, 
      down, 
      up 
    })
    
    const promises = filteredNodes.map(nodeId => {
      return this._tickVia(this._findRoute(nodeId, { up, down }), nodeId, { event, data })
    })
    
    return Promise.all(promises)
  }
  
  /**
   * Send tick to all downstream nodes
   */
  tickDownAll ({ event, data, filter } = {}) {
    return this.tickAll({ event, data, filter, down: true, up: false })
  }
  
  /**
   * Send tick to all upstream nodes
   */
  tickUpAll ({ event, data, filter } = {}) {
    return this.tickAll({ event, data, filter, down: false, up: true })
  }
  
  // ============================================================================
  // OPTIONS MANAGEMENT (Used for routing)
  // ============================================================================
  
  /**
   * Update node options and propagate to server/clients
   */
  async setOptions (options = {}) {
    const _scope = _private.get(this)
    
    // Own copy: the caller's object is neither mutated nor required to be extensible
    options = { ...options }
    
    // Maintain node identity
    Object.defineProperty(options, '_id', {
      value: _scope.id,
      writable: false,
      configurable: true,
      enumerable: true
    })
    
    _scope.options = options
    
    // Server and every client hold their own reference for handshakes: replace
    // it (later handshakes must not send stale options), then tell connected
    // peers. Resolves once the updates are handed to the transport; peers do
    // not acknowledge them. Peers on versions without OPTIONS_UPDATE ignore it.
    const updates = []
    if (_scope.server) {
      updates.push(_scope.server.setOptions(options))
    }
    _scope.clients.forEach(client => {
      updates.push(client.setOptions(options))
    })
    // Connects still in their handshake: their next handshake uses the new
    // options (and _connect re-sends them if the handshake already went out)
    _scope.pendingConnects.forEach(attempt => {
      if (attempt.client) updates.push(attempt.client.setOptions(options))
    })
    await Promise.allSettled(updates)
  }
  
  /**
   * Get filtered nodes (with options/predicate)
   */
  getFilteredNodes ({ options, predicate, up = true, down = true } = {}) {
    return this._getFilteredNodes({ options, predicate, up, down })
  }
  
  // ============================================================================
  // PEER INFO
  // ============================================================================
  
  /**
   * Get peer options by ID
   * @param {string} peerId - Peer ID
   * @returns {object|null} Peer options or null if peer not joined
   */
  getPeerOptions (peerId) {
    return this._joinedPeerOptions(peerId) || null
  }
  
  /**
   * Get server ID by connection address
   * @param {string} address - Server address (e.g., 'tcp://127.0.0.1:5000')
   * @returns {string|null} Server ID, or null if there is no live session at
   *   that address (not connected, the server left, or the transport is back
   *   but the server has not answered the handshake yet)
   */
  getServerIdByAddress (address) {
    if (!this._hasSession(address)) {
      return null
    }
    
    const { clients, clientsAddressIndex } = _private.get(this)
    return clients.get(clientsAddressIndex.get(md5(address))).getServerId()
  }
  
  // ============================================================================
  // LIFECYCLE
  // ============================================================================
  
  /**
   * Close the node and all its connections.
   * 
   * This permanently closes:
   * - The server (if bound)
   * - All client connections
   * - All underlying transport sockets
   * 
   * After closing, the node cannot be reused.
   * Pending requests will be rejected.
   * All handlers will be removed.
   */
  async close () {
    const _scope = _private.get(this)
    const { server, clients, clientsAddressIndex, logger, connectionTargets, peerIdToAddress } = _scope
    const promises = []
    
    // connect() rejects from now on (also one already past its handshake),
    // and the server accepts no handshake any more
    _scope.closed = true
    server?._beginClose()
    
    // Proxied ticks forwarded earlier can no longer be continued
    _scope.forwardedTicks.clear()
    
    // Cancel all reconnects (timers and attempts in flight)
    if (connectionTargets) {
      for (const target of connectionTargets.values()) {
        if (target.timer) {
          clearTimeout(target.timer)
          target.timer = null
        }
        target.cancelled = true
      }
      connectionTargets.clear()
    }
    peerIdToAddress?.clear()
    
    // Cancel connects still waiting for their handshake
    const { pendingConnects } = _scope
    await Promise.all(Array.from(pendingConnects.keys()).map(address => this._cancelPendingConnect(address)))
    
    // Close server (also when not online: the socket still has to be released)
    if (server) {
      promises.push(server.close())
    }
    
    // Close all clients (their PEER_LEFT is category local)
    clients.forEach(client => {
      locallyEndedClients.add(client)
      promises.push(client.close())
    })
    
    await Promise.all(promises)
    
    clients.forEach(client => {
      this._detachClientEvents(client)
      this._removeClientHandlers(client)
    })
    clients.clear()
    clientsAddressIndex.clear()
    this._forgetDownstreamPeers()
    
    // Anything recorded while shutting down, and the sweep timer
    _scope.forwardedTicks.clear()
    if (_scope.forwardedTickSweep) {
      clearInterval(_scope.forwardedTickSweep)
      _scope.forwardedTickSweep = null
    }
    
    // Emit stopped event
    this.emit(NodeEvent.STOPPED)
    
    logger.info('[Node] Closed')
  }
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * @private
 */
function connectCancelledError (address, why = 'cancelled by disconnect() or close()') {
  return new NodeError({
    code: NodeErrorCode.CONNECT_CANCELLED,
    message: `Connect to ${address}: ${why}`,
    context: { address }
  })
}

/**
 * Wait for `promise` at most `ms`, without affecting the promise itself
 * @private
 */
function withTimeout (promise, ms, address) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Handshake timeout: server at ${address} did not respond`))
    }, ms)
    // The shared attempt keeps the process alive on its own; this one must not
    timer.unref?.()
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

/**
 * A proxy reply that means "could not route", so another router may be tried
 * @private
 */
function isRoutingMiss (err) {
  // Only a miss a router produced itself (marked `routing.miss`): an error a
  // request handler threw (even with the same code) means the request ran,
  // and sending it elsewhere would run it twice. Old routers do not mark
  // their misses, so the search stops at them (at-most-once wins).
  if (err?.routing?.miss !== true) return false
  return err.code === NodeErrorCode.NO_NODES_MATCH_FILTER || err.code === NodeErrorCode.PROXY_HOP_LIMIT
}

/**
 * Validate a visited-router list reported by a peer (untrusted)
 * @private
 */
function sanitizeVisited (visited) {
  if (!Array.isArray(visited) || visited.length > Globals.PROXY_MAX_VISITED) return null
  return visited.every(id => typeof id === 'string') ? visited : null
}

/**
 * Generate random node ID
 * @private
 */
function _generateNodeId () {
  return animal.getId()
}
