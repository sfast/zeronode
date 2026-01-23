/**
 * Client - Application layer for client-side communication
 * 
 * ARCHITECTURE: Protocol-First Design
 * - Extends Protocol (inherits request/response, tick, handler management)
 * - Uses DealerSocket for transport (passed to Protocol)
 * - ONLY listens to ProtocolEvent (NEVER SocketEvent)
 * - Tracks server peer state (serverId only)
 * - Implements ping mechanism
 * - Handles application-level events
 * 
 * STATE MODEL:
 * - Server is "joined" when: serverId !== null (handshake complete)
 * - Server is "left" when: serverId === null (no handshake or disconnected)
 * - isOnline() returns true only when transport ready AND server joined
 * - Options are NOT stored (passed through to Node via events)
 */

import Globals from '../globals.js'
import Protocol, { ProtocolEvent, ProtocolSystemEvent } from './protocol.js'
import { Transport } from '../transport/transport.js'

// ============================================================================
// CLIENT EVENTS (Public API)
// ============================================================================
export const ClientEvent = {
  READY: 'client:ready',               // Handshake complete, client can send requests
  NOT_READY: 'client:not_ready',       // Transport lost readiness (disconnect)
  CLOSED: 'client:closed',             // Transport permanently closed
  ERROR: 'client:error',                // Client-level error (transport/protocol failure)
  SERVER_LEFT: 'client:server_left',   // Server left (shutdown, disconnect, etc.)
  SERVER_JOINED: 'client:server_joined',   // Server joined (handshake complete)
}

/**
 * Event Flow Map (Client)
 * 
 * Transport Layer (via Protocol → ProtocolEvent)
 * ┌────────────────────────────┬──────────────────────────────────────────────┐
 * │ Listened (Inbound)        │ Action                                      │
 * ├────────────────────────────┼──────────────────────────────────────────────┤
 * │ TRANSPORT_READY           │ Send handshake, emit client:ready           │
 * │ TRANSPORT_NOT_READY       │ emit client:not_ready                         │
 * │ TRANSPORT_CLOSED          │ Stop ping, emit client:not_ready or client:closed │
 * │ ERROR                     │ Forward as client:error                      │
 * └────────────────────────────┴──────────────────────────────────────────────┘
 * 
 * System Ticks (ProtocolSystemEvent)
 * ┌────────────────────────────┬──────────────────────────────────────────────┐
 * │ Sent (Outbound)           │ Purpose                                     │
 * ├────────────────────────────┼──────────────────────────────────────────────┤
 * │ HANDSHAKE_INIT_FROM_CLIENT│ Handshake request to server                  │
 * │ CLIENT_PING               │ Heartbeat ping to known server ID            │
 * │ CLIENT_STOP               │ Graceful disconnect                          │
 * └────────────────────────────┴──────────────────────────────────────────────┘
 * ┌────────────────────────────┬──────────────────────────────────────────────┐
 * │ Received (Inbound)        │ Purpose                                     │
 * ├────────────────────────────┼──────────────────────────────────────────────┤
 * │ HANDSHAKE_ACK_FROM_SERVER │ Handshake response (welcome + options)       │
 * │ SERVER_STOP               │ Server is shutting down                      │
 * └────────────────────────────┴──────────────────────────────────────────────┘
 * 
 * Application Events (emitted by Client)
 * ┌────────────────────────────┬──────────────────────────────────────────────┐
 * │ Emitted                   │ When                                         │
 * ├────────────────────────────┼──────────────────────────────────────────────┤
 * │ client:ready              │ Transport ready (can send/receive)           ││
 * │ client:not_ready          │ Transport reported NOT_READY                 │
 * │ client:closed             │ Transport reported CLOSED                    │
 * │ client:server_joined      │ Handshake complete, server identified        │
 *   client:server_left        │ Server stopped/failed ...                   │
 * │ client:error              │ Transport/protocol error surfaced by Client  │
 * └────────────────────────────┴──────────────────────────────────────────────┘
 * 
 * Handshake Sequence
 * 1) TRANSPORT_READY → emit client:ready →
 * 2) send _system:handshake_init_from_client →
 * 3) receive _system:handshake_ack_from_server (welcome) →
 * 4) Store serverId, start ping →
 * 5) emit client:server_joined
 */

let _private = new WeakMap()

export default class Client extends Protocol {
  constructor ({ id, options, config } = {}) {
    config = config || {}
    options = options || {}
    
    // Create client socket via Transport factory
    const socket = Transport.createClientSocket({ id, config })
    
    // Pass socket and config to Protocol (store app-level config)
    super(socket, config)
    
    let _scope = {
      serverAddress: null,
      serverId: null,          // Server's ID (set after handshake)
      pingInterval: null,
      options,  // ✅ Store node options for handshake
      closing: false  // ✅ Track if WE (client) are intentionally closing
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
    // Surface protocol-level errors as client-level errors
    this.on(ProtocolEvent.ERROR, (err) => {
      this.emit(ClientEvent.ERROR, err)
    })
    
    // ============================================================================
    // MANUAL HANDSHAKE APPROACH
    // 
    // Transport ready → Send handshake → Wait for welcome → Start session
    // ============================================================================
    
    // Transport can send/receive bytes - send handshake
    this.on(ProtocolEvent.TRANSPORT_READY, () => {
      let { serverId } = _private.get(this)
      
      this.emit(ClientEvent.READY, { serverId: serverId || 'unknown' })
      this._sendClientConnected()
    })
    
    // Transport disconnected - stop ping
    this.on(ProtocolEvent.TRANSPORT_NOT_READY, () => {
      let { serverId } = _private.get(this)
      
      this._stopPing()
      
      // Emit application event with actual server ID
      const serverIdValue = serverId || 'unknown'
      
      // Transport lifecycle parity events
      this.emit(ClientEvent.NOT_READY, { serverId: serverIdValue, reason: 'TRANSPORT_NOT_READY' })
    
    })
    
    // Transport permanently closed - reject all, emit failed (unless we intentionally closed)
    this.on(ProtocolEvent.TRANSPORT_CLOSED, () => {
      let _scope = _private.get(this)
      let { serverId, closing } = _scope
      
      this._stopPing()

      const serverIdValue = serverId || 'unknown'
      
      // ✅ Check if WE (client) intentionally closed
      if (closing) {
        // Intentional close - emit CLOSED event
        this.emit(ClientEvent.CLOSED, { serverId: serverIdValue })
      } else {
        // Unexpected close - emit NOT_READY event
        this.emit(ClientEvent.NOT_READY, { serverId: serverIdValue, reason: 'TRANSPORT_FAILED' })
      }
      
      // Clear server state now that events have been emitted
      _scope.serverId = null
      _scope.closing = false
    })
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers () {
    // ============================================================================
    // HANDSHAKE RESPONSE - Server welcomes client
    // ============================================================================
    this.onTick(ProtocolSystemEvent.HANDSHAKE_ACK_FROM_SERVER, (envelope) => {
      let _scope = _private.get(this)
      
      const serverOptions = envelope.data  // ✅ Get from envelope, don't store
      // ✅ Extract server ID from envelope.owner (sender's socket ID)
      const serverId = envelope.owner
      
      if (!serverId) {
        this.logger?.error('Server handshake response missing sender ID in envelope.owner')
        return
      }
      
      // ✅ Store server ID (now we know who we're talking to)
      _scope.serverId = serverId
      
      // ✅ Start ping now that handshake is complete and we know server ID
      this._startPing()
      
      // ✅ Emit CLIENT SERVER_JOINED with options (pass through to Node)
      this.emit(ClientEvent.SERVER_JOINED, { 
        serverId,
        serverOptions: serverOptions || {}
      })
    })
    
    // ============================================================================
    // SERVER LIFECYCLE EVENTS
    // ============================================================================
    this.onTick(ProtocolSystemEvent.SERVER_STOP, () => {
      let { serverId } = _private.get(this)
      
      this._stopPing()
      
      this.emit(ClientEvent.SERVER_LEFT, { serverId: serverId || 'unknown' })
    })
    
    // ============================================================================
    // RESURRECTION - Server requests fresh handshake after timeout
    // ============================================================================
    this.onTick(ProtocolSystemEvent.REQUEST_HANDSHAKE, (envelope) => {
      let _scope = _private.get(this)
      const { options } = _scope
      
      const config = this.getConfig()
      const logger = config.logger
      
      if (logger) {
        logger.info('[Client] Server requested fresh handshake (resurrection), resending with options')
      }
      
      // Resend handshake with full options
      this._sendSystemTick({
        event: ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT,
        data: options || {}
      })
    })
  }
  
  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  async connect (serverAddress, timeout) {
    let _scope = _private.get(this)
    _scope.serverAddress = serverAddress
    
    // Reset server info (will be set after handshake)
    _scope.serverId = null
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    
    try {
      // Issue connect (non-blocking - returns immediately)
      // ZeroMQ will connect in background and emit TRANSPORT_READY when ready
      await socket.connect(serverAddress)
      
      // Wait for handshake to complete (includes implicit transport ready wait)
      await new Promise((resolve, reject) => {
        // Use provided timeout, then config, then global default, finally 10s
        const config = this.getConfig()
        const handshakeMs = (timeout ?? config.CLIENT_HANDSHAKE_TIMEOUT ?? Globals.CLIENT_HANDSHAKE_TIMEOUT ?? 10000)
        
        const handshakeTimeout = setTimeout(() => {
          reject(new Error(`Handshake timeout: server at ${serverAddress} did not respond`))
        }, handshakeMs)
        
        // ✅ Wait for SERVER_JOINED (handshake complete) not READY (transport ready)
        this.once(ClientEvent.SERVER_JOINED, ({ serverId }) => {
          clearTimeout(handshakeTimeout)
          resolve(serverId)
        })
      })
    } catch (err) {
      throw err
    }
  }
  
  async disconnect () {
    let _scope = _private.get(this)
    
    // ✅ Mark that WE (client) are intentionally disconnecting
    _scope.closing = true
    
    this._stopPing()
    
    // Try to notify server
    try {
      // ✅ Use internal API to send system event (client stop)
      this._sendSystemTick({
        event: ProtocolSystemEvent.CLIENT_STOP,
        data: { clientId: this.getId() }
      })
      
      // ⏱️ Wait a tick to ensure message is delivered before disconnecting
      // This is important for transports that use async delivery (e.g., setImmediate)
      await new Promise(resolve => setImmediate(resolve))
    } catch (err) {
      this.debug && this.logger?.error('Error sending client stop: ', err)
    }
    
    // Note: Don't clear serverId here - TRANSPORT_CLOSED handler needs it

    // disconnect from transport and detach listeners
    await super.disconnect();
  }
  
  async close () {
    await this.disconnect()
    await super.close() // close underlying transport and cleanup
  }
  
  /**
   * Get server ID (if connected and handshake complete)
   * @returns {string|null} Server ID or null if not connected
   */
  getServerId () {
    let { serverId } = _private.get(this)
    return serverId
  }
  
  // ============================================================================
  // PING MECHANISM (Private)
  // ============================================================================
  
  _startPing () {
    let _scope = _private.get(this)
    
    // Don't start multiple ping intervals
    if (_scope.pingInterval) {
      return
    }
    
    const config = this.getConfig()
    const pingInterval = (config.PING_INTERVAL ?? config.pingInterval) || Globals.CLIENT_PING_INTERVAL || 10000
    
    _scope.pingInterval = setInterval(() => {
      // Only ping if client is fully online (transport ready + handshake complete)
      if (this.isOnline()) {
        const { serverId } = _private.get(this)
        
        // ✅ Send ping with explicit recipient using internal API
        this._sendSystemTick({
          to: serverId,
          event: ProtocolSystemEvent.CLIENT_PING,
          data: null
        })
      }
    }, pingInterval)
  }
  
  _stopPing () {
    let _scope = _private.get(this)
    
    if (_scope.pingInterval) {
      clearInterval(_scope.pingInterval)
      _scope.pingInterval = null
    }
  }
  
  _sendClientConnected () {
    // ✅ Check protocol/transport ready (not application ready - that comes after handshake)
    if (!super.isOnline()) {
      return
    }
    
    const { options } = _private.get(this)
    
    // ✅ Use internal API to send system event (handshake)
    // Server will respond with _system:handshake_ack_from_server (welcome message)
    this._sendSystemTick({
      event: ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT,  // '_system:handshake_init_from_client'
      data: options || {}
    })
  }
  
  // ============================================================================
  // READY CHECK
  // ============================================================================
  /**
   * Client is online (ready) when:
   * 1) Transport is online (can send/receive bytes) AND
   * 2) Handshake completed (server ID known, session established)
   * 
   * Note: Overrides Protocol.isOnline() to include application-level readiness
   *       For transport-only check, use super.isOnline()
   */
  isOnline () {
    const transportOnline = super.isOnline()
    const { serverId } = _private.get(this)
    const serverIdKnown = !!(serverId)
    return transportOnline && serverIdKnown
  }
}
