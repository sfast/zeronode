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
import { Transport } from '../transport/transport.js'

// ============================================================================
// SERVER EVENTS
// ============================================================================
export const ServerEvent = {
  READY: 'server:ready',               // Server is ready to accept clients
  NOT_READY: 'server:not_ready',       // Server transport not ready
  CLOSED: 'server:closed',             // Server closed
  CLIENT_JOINED: 'server:client_joined',   // Client connected & authenticated
  CLIENT_LEFT: 'server:client_left'        // Client left (graceful, timeout, or failed)
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
      pendingHandshakes: new Set(), // clientIds awaiting resurrection handshake
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
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers () {
    // ============================================================================
    // HANDSHAKE - Client discovery via messages
    // ============================================================================
    this.onTick(ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT, (envelope) => {
      let { clientLastSeen, pendingHandshakes } = _private.get(this)
      
      const clientId = envelope.owner
      const clientOptions = envelope.data
      
      // Mark as seen (this IS the "joined" state)
      clientLastSeen.set(clientId, Date.now())
      
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
      
      // 🔥 FIX: Detect resurrection (client was timed out but is now pinging again)
      const wasTimedOut = !clientLastSeen.has(clientId)
      
      // Update last seen timestamp
      clientLastSeen.set(clientId, Date.now())
      
      // 🔥 FIX: If client was previously timed out, request fresh handshake
      if (wasTimedOut) {
        const config = this.getConfig()
        const logger = config.logger
        
        // Check if we already requested handshake for this client
        if (!pendingHandshakes.has(clientId)) {
          // Mark as pending to avoid multiple requests
          pendingHandshakes.add(clientId)
          
          if (logger) {
            logger.warn(`[Server] Client '${clientId}' resurrected after timeout, requesting fresh handshake`)
          }
          
          // Request client to resend handshake with full options
          this._sendSystemTick({
            to: clientId,
            event: ProtocolSystemEvent.REQUEST_HANDSHAKE,
            data: null
          })
        } else {
          if (logger) {
            logger.debug(`[Server] Client '${clientId}' resurrection handshake already requested, waiting...`)
          }
        }
      }
    })
    
    // ============================================================================
    // CLIENT LIFECYCLE
    // ============================================================================
    this.onTick(ProtocolSystemEvent.CLIENT_STOP, (envelope) => {
      let { clientLastSeen } = _private.get(this)
      
      const clientId = envelope.owner
      
      // Remove client data (this IS the state change - client is now "left")
      clientLastSeen.delete(clientId)
      
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
    
    // Clear state
    let _scope = _private.get(this)
    _scope.clientLastSeen.clear()
    
    // unbind from transport and detach listeners
    await super.unbind()
  }
  
  async close () {
    await this.unbind()
    await super.close() // close underlying transport and cleanup
  }
  
  getAddress () {
    const socket = this._getSocket()
    return socket.getAddress()
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
    let { clientLastSeen } = _private.get(this)
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
    const ghostThreshold = (config.CLIENT_GHOST_TIMEOUT ?? config.clientGhostTimeout) || Globals.CLIENT_GHOST_TIMEOUT || 60000
    
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
    let { clientLastSeen } = _private.get(this)
    const now = Date.now()
    
    clientLastSeen.forEach((lastSeen, clientId) => {
      const timeSinceLastSeen = now - lastSeen
      
      if (timeSinceLastSeen > ghostThreshold) {
        // Client timeout - remove and emit LEFT
        clientLastSeen.delete(clientId)
          
        // Emit CLIENT_LEFT - client is gone
          this.emit(ServerEvent.CLIENT_LEFT, { 
            clientId, 
            reason: 'TIMEOUT'
          })
      }
    })
  }
}
