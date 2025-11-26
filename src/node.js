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
 * - Node tracks JOINED/LEFT state explicitly:
 *   • joinedPeers: Set<peerId> - All joined (routable) peers
 *   • peerOptions: Map<peerId, options> - Peer metadata for filtering
 *   • peerDirection: Map<peerId, 'upstream'|'downstream'> - Connection direction
 * 
 * - Routing Guarantee: JOINED = ROUTABLE (strict)
 *   • Peer in joinedPeers Set → routable ✅
 *   • Peer NOT in joinedPeers Set → not routable ❌
 * 
 * - State Updates:
 *   • PEER_JOINED event → Add to joinedPeers (from Server/Client events)
 *   • PEER_LEFT event → Remove from joinedPeers (from Server/Client events)
 * 
 * - Benefits:
 *   • No querying Server/Client during routing (faster)
 *   • Single source of truth (no state divergence)
 *   • Clean semantics: in Set = online, not in Set = offline
 */

import winston from 'winston'
import md5 from 'md5'
import animal from 'animal-id'
import { EventEmitter } from 'events'
import { PatternEmitter } from '@sfast/pattern-emitter-ts'

import { NodeError, NodeErrorCode, assertValidAddress } from './node-errors.js'
import NodeUtils from './utils.js'
import Server, { ServerEvent } from './protocol/server.js'
import Client, { ClientEvent } from './protocol/client.js'

// ============================================================================
// NODE EVENTS (Orchestration Layer - Public API)
// ============================================================================
export const NodeEvent = {
  PEER_JOINED: 'node:peer_joined', // New peer discovered (upstream or downstream)
  PEER_LEFT: 'node:peer_left',     // Peer disconnected
  STOPPED: 'node:stopped',         // Node stopped
  ERROR: 'node:error'              // Node-level error (normalized payload)
}

const _private = new WeakMap()

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
      
      // Peer state tracking (Node's single source of truth for routing)
      joinedPeers: new Set(),                    // peerId → boolean (JOINED = routable)
      peerOptions: new Map(),                    // peerId → options (for filtering)
      peerDirection: new Map(),                  // peerId → 'upstream' | 'downstream'
      
      // Central handler registry (single source of truth)
      handlerRegistry: {
        request: new PatternEmitter(),
        tick: new PatternEmitter()
      }
    }
    
    _private.set(this, _scope)
    
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
  
  // ============================================================================
  // PEER STATE TRACKING (Private Helpers)
  // ============================================================================
  
  /**
   * Add peer to joined state (single operation for consistency)
   * @private
   */
  _addJoinedPeer (peerId, peerOptions, direction) {
    const _scope = _private.get(this)
    _scope.joinedPeers.add(peerId)
    _scope.peerOptions.set(peerId, peerOptions || {})
    _scope.peerDirection.set(peerId, direction)
  }
  
  /**
   * Remove peer from joined state (single operation for consistency)
   * @private
   */
  _removeJoinedPeer (peerId) {
    const _scope = _private.get(this)
    _scope.joinedPeers.delete(peerId)
    _scope.peerOptions.delete(peerId)
    _scope.peerDirection.delete(peerId)
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
    
    return server.unbind()
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
    
    // Transform: Server.CLIENT_JOINED → Node.PEER_JOINED
    server.on(ServerEvent.CLIENT_JOINED, ({ clientId, clientOptions }) => {
      // ✅ Track JOINED state in Node (single operation)
      this._addJoinedPeer(clientId, clientOptions, 'downstream')
      
      this.emit(NodeEvent.PEER_JOINED, {
        peerId: clientId,
        direction: 'downstream',   // Client connected TO our server
        peerOptions: clientOptions
      })
    })
    
    // Transform: Server.CLIENT_LEFT → Node.PEER_LEFT
    server.on(ServerEvent.CLIENT_LEFT, ({ clientId, reason }) => {
      // ✅ Track LEFT state in Node (single operation)
      this._removeJoinedPeer(clientId)
      
      this.emit(NodeEvent.PEER_LEFT, {
        peerId: clientId,
        direction: 'downstream',
        reason: reason || 'disconnected'  // Pass through reason from server
      })
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
   * @param {number} [params.reconnectionTimeout] - Reconnection timeout
   * @returns {Promise<Object>} Remote node info
   */
  async connect ({ address, timeout, reconnectionTimeout } = {}) {
    assertValidAddress(address)
    
    const _scope = _private.get(this)
    const { id, options, config, clients, clientsAddressIndex, logger } = _scope
    
    const addressHash = md5(address)
    
    // Check if already connected
    if (clientsAddressIndex.has(addressHash)) {
      const existingNodeId = clientsAddressIndex.get(addressHash)
      const client = clients.get(existingNodeId)
      
      logger.info(`[Node] Already connected to ${address}`)
      
      const serverId = client.getServerId()
      if (!serverId) {
        return null
      }
      
      return {
        id: serverId,
        options: _scope.peerOptions.get(serverId) || {}
      }
    }
    
    // Prepare client config
    let clientConfig = config
    if (reconnectionTimeout !== undefined) {
      clientConfig = Object.assign({}, config, { 
        RECONNECTION_TIMEOUT: reconnectionTimeout 
      })
    }
    
    // Create client with node identity
    const client = new Client({ 
      id,              // ✅ Client uses Node's ID
      options,         // ✅ Node's options for handshake
      config: clientConfig 
    })
    
    // Apply all registered handlers to client
    this._syncHandlersToTarget(client)
    
    // Attach client event handlers
    this._attachClientEvents(client)
    
    // Connect (Client.connect() waits for handshake to complete)
    await client.connect(address, timeout)
    
    // Get server ID (now available after handshake)
    const serverId = client.getServerId()
    
    const remoteNodeId = serverId
    
    logger.info(`[Node] Connected: ${id} → ${remoteNodeId} (${address})`)
    
    // Store client by remote node's ID
    clients.set(remoteNodeId, client)
    clientsAddressIndex.set(addressHash, remoteNodeId)
    
    // Note: PEER_JOINED event will be emitted when ClientEvent.SERVER_JOINED fires (handshake complete)
    
    // Return server info with options from Node
    return {
      id: remoteNodeId,
      options: _scope.peerOptions.get(remoteNodeId) || {}
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
    
    if (!clientsAddressIndex.has(addressHash)) {
      logger.warn(`[Node] Not connected to ${address}`)
      return true
    }
    
    const nodeId = clientsAddressIndex.get(addressHash)
    const client = clients.get(nodeId)
    
    // Disconnect client (will emit ClientEvent.NOT_READY or ClientEvent.CLOSED)
    await client.disconnect()
    
    // Remove all event listeners AFTER disconnect completes
    client.removeAllListeners()
    
    // Clean up
    this._removeClientHandlers(client)
    clients.delete(nodeId)
    clientsAddressIndex.delete(addressHash)
    
    logger.info(`[Node] Disconnected from ${address}`)
    
    return true
  }
  
  /**
   * Attach client event handlers and transform to Node events
   * @private
   */
  _attachClientEvents (client) {
    const _scope = _private.get(this)
    const { logger } = _scope
    
    // Also listen to structured client error event
    client.on(ClientEvent.ERROR, (err) => {
      logger.error('[Node] Client error:', err)
      const serverId = client.getServerId()
      this.emit(NodeEvent.ERROR, {
        source: 'client',
        serverId: serverId || null,
        error: err
      })
    })
    
    // Transform: Client.SERVER_JOINED → Node.PEER_JOINED (handshake complete, peer identified)
    client.on(ClientEvent.SERVER_JOINED, ({ serverId, serverOptions }) => {
      // ✅ Track JOINED state in Node (single operation)
      this._addJoinedPeer(serverId, serverOptions, 'upstream')
      
      this.emit(NodeEvent.PEER_JOINED, {
        peerId: serverId,
        direction: 'upstream',     // We connected TO this server
        peerOptions: serverOptions || {}
      })
    })
    
    // Transform: Client.NOT_READY → Node.PEER_LEFT (transport lost readiness)
    client.on(ClientEvent.NOT_READY, ({ serverId, reason }) => {
      // ✅ Track LEFT state in Node (single operation)
      this._removeJoinedPeer(serverId)
      
      this.emit(NodeEvent.PEER_LEFT, {
        peerId: serverId,
        direction: 'upstream',
        reason: reason || 'not_ready'
      })
      // Note: Don't cleanup client here - transport might recover
    })
    
    // Transform: Client.CLOSED → Node.PEER_LEFT (transport permanently closed)
    client.on(ClientEvent.CLOSED, ({ serverId }) => {
      // ✅ Track LEFT state in Node (single operation)
      this._removeJoinedPeer(serverId)
      
      this.emit(NodeEvent.PEER_LEFT, {
        peerId: serverId,
        direction: 'upstream',
        reason: 'closed'
      })
      
      // NOTE: Don't auto-cleanup here - client might be needed for reconnection
      // Only cleanup on explicit disconnect() call
    })
    
    // Transform: Client.SERVER_LEFT → Node.PEER_LEFT (server shutdown/stopped)
    client.on(ClientEvent.SERVER_LEFT, ({ serverId }) => {
      // ✅ Track LEFT state in Node (single operation)
      this._removeJoinedPeer(serverId)
      
        this.emit(NodeEvent.PEER_LEFT, {
        peerId: serverId,
          direction: 'upstream',
        reason: 'server_left'
        })
      
      // NOTE: Don't auto-cleanup here - client might be needed for reconnection
      // Only cleanup on explicit disconnect() call
    })
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
  _findRoute (nodeId) {
    const { server, clients, joinedPeers, peerDirection } = _private.get(this)
    
    // ✅ Check Node's joined state (single source of truth)
    if (!joinedPeers.has(nodeId)) {
      return null  // Not joined = not routable
    }
    
    // Peer is joined - determine route based on direction
    const direction = peerDirection.get(nodeId)
    
    if (direction === 'downstream') {
      // Client connected TO our server
      if (server && server.isOnline()) {
        return { 
          type: 'server', 
          target: server, 
          targetId: nodeId 
        }
      }
    } else if (direction === 'upstream') {
      // We connected TO this server
      if (clients.has(nodeId)) {
        const client = clients.get(nodeId)
        return { 
          type: 'client', 
          target: client 
        }
      }
    }
    
    return null
  }
  
  /**
   * Get filtered nodes by options/predicate
   * @private
   */
  _getFilteredNodes ({ options, predicate, up = true, down = true } = {}) {
    const { joinedPeers, peerOptions, peerDirection } = _private.get(this)
    const nodes = new Set()
    
    // Build predicate function
    const pred = predicate || NodeUtils.optionsPredicateBuilder(options)
    
    // ✅ Iterate through ALL joined peers (single source of truth)
    joinedPeers.forEach(peerId => {
      const direction = peerDirection.get(peerId)
      const peerOpts = peerOptions.get(peerId) || {}
      
      // Filter by direction
      if (direction === 'downstream' && !down) return
      if (direction === 'upstream' && !up) return
      
      // Filter by predicate
      if (pred(peerOpts)) {
        nodes.add(peerId)
      }
    })
    
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
  async request ({ to, event, data, timeout } = {}) {
    const route = this._findRoute(to)
    
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
      return route.target.request({ to: route.targetId, event, data, timeout })
    } else {
      // Route through client to remote server
      return route.target.request({ event, data, timeout })
    }
  }
  
  /**
   * Send tick to specific node
   */
  tick ({ to, event, data } = {}) {
    const route = this._findRoute(to)
    
    if (!route) {
      throw new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: `No route to node '${to}'`,
        nodeId: to,
        context: { event }
      })
    }
    
    if (route.type === 'server') {
      return route.target.tick({ to: route.targetId, event, data })
    } else {
      return route.target.tick({ event, data })
    }
  }
  
  /**
   * Send request to any matching node
   */
  async requestAny ({ event, data, timeout, filter, down = true, up = true } = {}) {
    // Extract options and predicate from filter if wrapped
    const filterOptions = filter?.options || (filter?.predicate ? undefined : filter)
    const filterPredicate = filter?.predicate
    const filteredNodes = this._getFilteredNodes({ 
      options: filterOptions, 
      predicate: filterPredicate, 
      down, 
      up 
    })
    
    if (filteredNodes.length === 0) {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'No nodes match filter criteria',
        context: { filter, down, up, event }
      })

      return Promise.reject(error)
    }
    
    const targetNode = this._selectNode(filteredNodes, event)
    return this.request({ to: targetNode, event, data, timeout })
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
    // Extract options and predicate from filter if wrapped
    const filterOptions = filter?.options || (filter?.predicate ? undefined : filter)
    const filterPredicate = filter?.predicate
    const filteredNodes = this._getFilteredNodes({ 
      options: filterOptions, 
      predicate: filterPredicate, 
      down, 
      up 
    })
    
    if (filteredNodes.length === 0) {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'No nodes match filter criteria',
        context: { filter, down, up, event }
      })

      return Promise.reject(error)
    }
    
    const targetNode = this._selectNode(filteredNodes, event)
    return this.tick({ to: targetNode, event, data })
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
      return this.tick({ to: nodeId, event, data })
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
    
    // Maintain node identity
    Object.defineProperty(options, '_id', {
      value: _scope.id,
      writable: false,
      configurable: true,
      enumerable: true
    })
    
    _scope.options = options
    
    // Note: Options are used during handshakes and are part of Node's identity
    // They don't need to be actively propagated to existing connections
    // Server and clients will use updated options for new connections
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
    const { peerOptions } = _private.get(this)
    return peerOptions.get(peerId) || null
  }
  
  /**
   * Get server ID by connection address
   * @param {string} address - Server address (e.g., 'tcp://127.0.0.1:5000')
   * @returns {string|null} Server ID or null if not connected
   */
  getServerIdByAddress (address) {
    const { clients, clientsAddressIndex } = _private.get(this)
    
    const addressHash = md5(address)
    if (!clientsAddressIndex.has(addressHash)) {
      return null
    }
    
    const nodeId = clientsAddressIndex.get(addressHash)
    const client = clients.get(nodeId)
    
    if (!client) {
      return null
    }
    
    // Return the actual server ID (not the node ID key)
    return client.getServerId()
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
    const { server, clients, logger } = _private.get(this)
    const promises = []
    
    // Close server
    if (server && server.isOnline()) {
      promises.push(server.close())
    }
    
    // Close all clients
    clients.forEach(client => {
      promises.push(client.close())
    })
    
    await Promise.all(promises)
    
    logger.info('[Node] Closed')
  }
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Generate random node ID
 * @private
 */
function _generateNodeId () {
  return animal.getId()
}
