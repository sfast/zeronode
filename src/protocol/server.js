/**
 * Server - Application layer for server-side communication
 * 
 * ARCHITECTURE: Protocol-First Design
 * - Extends Protocol (inherits request/response, tick, handler management)
 * - Uses RouterSocket for transport (passed to Protocol)
 * - ONLY listens to ProtocolEvent (NEVER SocketEvent)
 * - Tracks client activity (clientLastSeen Map for health checks)
 * - Implements health check mechanism
 * - Handles application-level events
 * 
 * STATE MODEL:
 * - Client is "joined" when: clientLastSeen.has(clientId) (in map)
 * - Client is "left" when: !clientLastSeen.has(clientId) (not in map)
 * - Health check removes clients on timeout (automatic cleanup)
 * - Options are NOT stored (passed through to Node via events)
 */

import Globals from '../globals.js'
import Protocol, { ProtocolEvent, ProtocolSystemEvent } from './protocol.js'
import { resolvePingInterval } from './config.js'
import { ProtocolErrorCode } from './protocol-errors.js'
import { Transport } from '../transport/transport.js'

// ============================================================================
// SERVER EVENTS
// ============================================================================
export const ServerEvent = {
  READY: 'server:ready',               // Server is ready to accept clients
  NOT_READY: 'server:not_ready',       // Server transport not ready
  CLOSED: 'server:closed',             // Server closed
  CLIENT_JOINED: 'server:client_joined',   // Client connected & authenticated
  CLIENT_LEFT: 'server:client_left',       // Client left (graceful, timeout, or failed)
  CLIENT_OPTIONS_UPDATED: 'server:client_options_updated', // Joined client changed its options
  ERROR: 'server:error'                    // Server-level error (transport/protocol failure)
}

let _private = new WeakMap()

export default class Server extends Protocol {
  constructor ({ id, options, config } = {}) {
    config = config || {}
    options = options || {}

    // Create server socket via Transport factory
    const socket = Transport.createServerSocket({ id, config })
    
    // Pass socket and config to Protocol (store app-level config)
    super(socket, config)

    let _scope = {
      bindAddress: null,
      clientLastSeen: new Map(),    // clientId → timestamp (for health checks)
      clientInstances: new Map(),   // clientId → instance id from the handshake (restart detection)
      pendingHandshakes: new Map(), // clientId → when a resurrection handshake was requested
      stopping: false,              // unbind()/close() started: no handshake is accepted
      unbinding: null,              // promise of the unbind() under way
      healthCheckInterval: null,
      options  // ✅ Store node options for handshake responses
    }

    _private.set(this, _scope)

    // ✅ ONLY listen to Protocol events
    this._attachProtocolEventHandlers()

    // ✅ ONLY listen to application events (via Protocol)
    this._attachApplicationEventHandlers()
  }
  
  // ============================================================================
  // PROTOCOL EVENT HANDLERS (High-Level)
  // ============================================================================
  
  _attachProtocolEventHandlers () {
    // ============================================================================
    // MANUAL PEER DISCOVERY
    // 
    // Transport ready → Clients send handshake → Discover peers from messages
    // ============================================================================
    
    // Transport can send/receive - server is ready to accept messages
    this.on(ProtocolEvent.TRANSPORT_READY, () => {
      this._startHealthChecks()
      this.emit(ServerEvent.READY, { serverId: this.getId() })
    })

    // Transport disconnected - stop health checks
    this.on(ProtocolEvent.TRANSPORT_NOT_READY, () => {
      this._stopHealthChecks()
      this.emit(ServerEvent.NOT_READY)
    })

    // Transport permanently closed - cleanup
    this.on(ProtocolEvent.TRANSPORT_CLOSED, () => {
      this._stopHealthChecks()
      this.emit(ServerEvent.CLOSED)
    })

    // Protocol/transport error (e.g. a failing tick handler) - surface it
    this.on(ProtocolEvent.ERROR, (err) => {
      this.emit(ServerEvent.ERROR, err)
    })
    
    // A send found no route to a joined client: it is gone (crash, kill),
    // don't wait for the ghost timeout
    this.on(ProtocolEvent.PEER_UNREACHABLE, ({ peerId }) => {
      let { clientLastSeen, clientInstances } = _private.get(this)
      if (!clientLastSeen.has(peerId)) return
      
      clientLastSeen.delete(peerId)
      clientInstances.delete(peerId)
      this.emit(ServerEvent.CLIENT_LEFT, { clientId: peerId, reason: 'UNREACHABLE' })
    })
    
    // Whatever the reason a client left, requests waiting on it cannot be
    // answered any more: reject them now instead of at their timeout.
    // Registered in the constructor, so it runs before Node's listeners.
    this.on(ServerEvent.CLIENT_LEFT, ({ clientId, reason }) => {
      const unreachable = reason === 'UNREACHABLE'
      this._rejectPendingRequestsTo(clientId, {
        code: unreachable ? ProtocolErrorCode.PEER_UNREACHABLE : ProtocolErrorCode.PEER_LEFT,
        message: `Client '${clientId}' left (${reason}) before replying`
      })
    })
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers () {
    // ============================================================================
    // HANDSHAKE - Client discovery via messages
    // ============================================================================
    this.onTick(ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT, (envelope) => {
      const _scope = _private.get(this)
      let { clientLastSeen, clientInstances, pendingHandshakes } = _scope

      // Going down: accept no session (the client retries elsewhere or times out)
      if (_scope.stopping) return
      
      const clientId = envelope.owner
      const clientOptions = envelope.data
      const instance = typeof envelope.metadata?.instance === 'string' ? envelope.metadata.instance : undefined
      
      // Same id, different instance: a restarted process (or a duplicate id)
      // replaced the joined one. Close out the old session first so PEER_LEFT /
      // PEER_JOINED stay consistent. A re-handshake from the same instance
      // (e.g. after a transport blip) is not a replacement.
      if (clientLastSeen.has(clientId) && clientInstances.get(clientId) !== instance) {
        const logger = this.getConfig().logger || this.logger
        logger?.warn?.(`[Server] Client '${clientId}' re-handshaked as a new instance (restart or duplicate id); replacing the old session`)
        
        clientLastSeen.delete(clientId)
        clientInstances.delete(clientId)
        this.emit(ServerEvent.CLIENT_LEFT, { clientId, reason: 'REPLACED' })
        // A CLIENT_LEFT listener may have started unbind()/close()
        if (_scope.stopping) return
      }
      
      // Mark as seen (this IS the "joined" state)
      clientLastSeen.set(clientId, Date.now())
      clientInstances.set(clientId, instance)
      
      // 🔥 Clear pending handshake flag (resurrection completed)
      if (pendingHandshakes.has(clientId)) {
        pendingHandshakes.delete(clientId)
        
        const config = this.getConfig()
        const logger = config.logger
        if (logger) {
          logger.info(`[Server] Client '${clientId}' resurrection handshake completed`)
        }
      }
      
      // ✅ Emit CLIENT_JOINED with options (pass through to Node)
      this.emit(ServerEvent.CLIENT_JOINED, { 
        clientId,
        clientOptions: clientOptions || {}
      })
      
      // A CLIENT_JOINED listener may have started unbind()/close(): no ack
      // after the SERVER_STOP the unbind sent
      if (_scope.stopping) return

      // Send welcome response (complete handshake) with server options
      const { options: serverOptions } = _private.get(this)
      
      this._sendSystemTick({
        to: clientId,
        event: ProtocolSystemEvent.HANDSHAKE_ACK_FROM_SERVER,
        data: serverOptions || {}
      })
    })
    
    // ============================================================================
    // HEARTBEAT - Client ping
    // ============================================================================
    this.onTick(ProtocolSystemEvent.CLIENT_PING, (envelope) => {
      let { clientLastSeen, pendingHandshakes } = _private.get(this)
      
      const clientId = envelope.owner
      
      // A joined client: just note it is alive
      if (clientLastSeen.has(clientId)) {
        clientLastSeen.set(clientId, Date.now())
        return
      }
      
      // 🔥 Resurrection: a client that timed out is pinging again. It is not
      // joined until it handshakes again (marking it seen here made the later
      // handshake look like a new instance: a spurious REPLACED)
      const config = this.getConfig()
      const logger = config.logger
      
      // Ask once per ping interval at most (an unanswered request is repeated)
      const requestedAt = pendingHandshakes.get(clientId)
      if (requestedAt === undefined || Date.now() - requestedAt >= resolvePingInterval(config)) {
        pendingHandshakes.set(clientId, Date.now())
        
        if (logger) {
          logger.warn(`[Server] Client '${clientId}' resurrected after timeout, requesting fresh handshake`)
        }

        // Request client to resend handshake with full options
        this._sendSystemTick({
          to: clientId,
          event: ProtocolSystemEvent.REQUEST_HANDSHAKE,
          data: null
        })
      } else if (logger) {
        logger.debug(`[Server] Client '${clientId}' resurrection handshake already requested, waiting...`)
      }
    })
    
    // ============================================================================
    // OPTIONS UPDATE - a joined client changed its options
    // ============================================================================
    this.onTick(ProtocolSystemEvent.OPTIONS_UPDATE, (envelope) => {
      let { clientLastSeen } = _private.get(this)
      
      const clientId = envelope.owner
      const clientOptions = envelope.data
      
      // Only from a joined client, only a plain object (identity is the
      // self-declared owner, the same trust level as handshake and ping)
      if (!clientLastSeen.has(clientId) || !isPlainObject(clientOptions)) return
      
      clientLastSeen.set(clientId, Date.now())
      this.emit(ServerEvent.CLIENT_OPTIONS_UPDATED, { clientId, clientOptions })
    })
    
    // ============================================================================
    // CLIENT LIFECYCLE
    // ============================================================================
    this.onTick(ProtocolSystemEvent.CLIENT_STOP, (envelope) => {
      let { clientLastSeen, clientInstances } = _private.get(this)
      const { pendingHandshakes } = _private.get(this)
      
      const clientId = envelope.owner
      
      // A client that is not joined (it timed out, or never handshook) has
      // no session to end
      pendingHandshakes.delete(clientId)
      if (!clientLastSeen.has(clientId)) return

      // Remove client data (this IS the state change - client is now "left")
      clientLastSeen.delete(clientId)
      clientInstances.delete(clientId)
      
      this.emit(ServerEvent.CLIENT_LEFT, { 
        clientId,
        // dont change the name of reason to CLIENT_STOP - it is used by client to identify the reason for the disconnect
        reason: "CLIENT_STOP"
      })
    })
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  async bind (bindAddress) {
      let _scope = _private.get(this)
    // An unbind() still under way (e.g. started by a listener just before
    // this) finishes first; until then no handshake is accepted
    if (_scope.unbinding) await _scope.unbinding.catch(() => {})
    _scope.stopping = false
    
    // Check if already bound to this address (idempotent)
    const currentAddress = this.getAddress()
    if (currentAddress === bindAddress) {
      return // Already bound to this address
    }
    
    _scope.bindAddress = bindAddress
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    
    await socket.bind(bindAddress)
    // Protocol will emit ProtocolEvent.READY when bound
  }
  
  async unbind () {
    // Synchronously, before anything is awaited: no handshake is accepted
    // from now on (also one already being processed when a listener calls this)
    this._stopAccepting()

    const _scope = _private.get(this)
    const unbinding = this._unbind()
    _scope.unbinding = unbinding
    try {
      await unbinding
    } finally {
      if (_scope.unbinding === unbinding) _scope.unbinding = null
    }
  }

  /**
   * unbind() body
   * @private
   */
  async _unbind () {
    this._stopHealthChecks()
    
    // Notify all clients individually with system event before unbind
    try {
      let { clientLastSeen } = _private.get(this)
      for (const clientId of clientLastSeen.keys()) {
        this._sendSystemTick({
          to: clientId,
          event: ProtocolSystemEvent.SERVER_STOP,
          data: { serverId: this.getId() }
        })
      }
      
      // ⏱️ Wait a tick to ensure messages are delivered before unbinding
      // This prevents ZeroMQ pipe state assertion failures
      await new Promise(resolve => setImmediate(resolve))
    } catch (err) {
      this.debug && this.logger?.error('Error sending server stop: ', err)
    }
    
    // Clear state (a resurrection requested before the unbind is void too)
    let _scope = _private.get(this)
    _scope.clientLastSeen.clear()
    _scope.clientInstances.clear()
    _scope.pendingHandshakes.clear()
    
    // unbind from transport and detach listeners
    await super.unbind()

    // The transport refused to unbind (it reported the error) and is still
    // bound and receiving: keep serving (clients re-handshake when asked
    // after their next ping, as after a resurrection)
    if (this._getSocket().isOnline()) {
      _scope.stopping = false
      this._startHealthChecks()
    }
  }
  
  /**
   * Accept no handshake from now on (unbind()/close() under way)
   * @protected
   */
  _stopAccepting () {
    _private.get(this).stopping = true
  }

  async close () {
    this._stopAccepting()
    await this.unbind()
    this._stopAccepting() // also if the transport refused to unbind
    await super.close() // close underlying transport and cleanup
  }
  
  getAddress () {
    const socket = this._getSocket()
    return socket.getAddress()
  }
  
  /**
   * Replace this server's options (sent in later handshake acks) and tell every
   * joined client. Resolves once the updates are handed to the transport;
   * clients do not acknowledge them.
   * @param {Object} options
   * @returns {Promise<void>}
   */
  async setOptions (options) {
    let _scope = _private.get(this)
    _scope.options = options
    
    const sends = []
    for (const clientId of _scope.clientLastSeen.keys()) {
      try {
        sends.push(this._sendSystemTick({ to: clientId, event: ProtocolSystemEvent.OPTIONS_UPDATE, data: options || {} }))
      } catch (err) {
        // Offline: the next handshake carries the new options anyway
      }
    }
    await Promise.allSettled(sends)
  }
  
  /**
   * Check if client is joined (has active session)
   * @param {string} clientId - Client ID to check
   * @returns {boolean} True if client is joined
   */
  hasClient (clientId) {
    let { clientLastSeen } = _private.get(this)
    return clientLastSeen.has(clientId)
  }
  
  /**
   * Get all joined client IDs
   * @returns {string[]} Array of client IDs
   */
  getAllClientIds () {
    let { clientLastSeen } = _private.get(this)
    return Array.from(clientLastSeen.keys())
  }
  
  /**
   * Get client's last seen timestamp
   * @param {string} clientId - Client ID
   * @returns {number|null} Timestamp or null if not found
   */
  getClientLastSeen (clientId) {
    let { clientLastSeen } = _private.get(this)
    return clientLastSeen.get(clientId) || null
  }
  
  getConnectedClientCount () {
    let { clientLastSeen } = _private.get(this)
    return clientLastSeen.size
  }
  
  /**
   * Remove a client from the server's maps
   * Useful for cleaning up disconnected clients from memory
   * 
   * @param {string} clientId - The client ID to remove
   * @returns {boolean} - True if client was removed, false if not found
   */
  removeClient (clientId) {
    let { clientLastSeen, clientInstances } = _private.get(this)
    clientInstances.delete(clientId)
    return clientLastSeen.delete(clientId)
  }
  
  // ============================================================================
  // HEALTH CHECK MECHANISM (Private)
  // ============================================================================
  
  _startHealthChecks () {
    let _scope = _private.get(this)
    
    // Don't start multiple health check intervals
    if (_scope.healthCheckInterval) {
      return
    }
    
    const config = this.getConfig()
    const checkInterval = (config.CLIENT_HEALTH_CHECK_INTERVAL ?? config.clientHealthCheckInterval) || Globals.CLIENT_HEALTH_CHECK_INTERVAL || 30000
    // Unless configured, a client is a ghost after 3 missed pings (with the
    // default 10s ping: Globals.CLIENT_GHOST_TIMEOUT, 30s)
    const ghostThreshold = (config.CLIENT_GHOST_TIMEOUT ?? config.clientGhostTimeout) || 3 * resolvePingInterval(config)
    
    _scope.healthCheckInterval = setInterval(() => {
      this._checkClientHealth(ghostThreshold)
    }, checkInterval)
  }
  
  _stopHealthChecks () {
  let _scope = _private.get(this)
    
    if (_scope.healthCheckInterval) {
      clearInterval(_scope.healthCheckInterval)
      _scope.healthCheckInterval = null
    }
  }
  
  _checkClientHealth (ghostThreshold) {
    let { clientLastSeen, clientInstances } = _private.get(this)
    const { pendingHandshakes } = _private.get(this)
    const now = Date.now()
    
    // A resurrection request nobody answered (the client stopped pinging)
    pendingHandshakes.forEach((requestedAt, clientId) => {
      if (now - requestedAt > ghostThreshold) pendingHandshakes.delete(clientId)
    })

    clientLastSeen.forEach((lastSeen, clientId) => {
      const timeSinceLastSeen = now - lastSeen
      
      if (timeSinceLastSeen > ghostThreshold) {
        // Client timeout - remove and emit LEFT
        clientLastSeen.delete(clientId)
        clientInstances.delete(clientId)
          
        // Emit CLIENT_LEFT - client is gone
          this.emit(ServerEvent.CLIENT_LEFT, { 
            clientId, 
            reason: 'TIMEOUT'
          })
      }
    })
  }
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
