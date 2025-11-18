/**
 * Client - Application layer for client-side communication
 * 
 * ARCHITECTURE: Protocol-First Design
 * - Extends Protocol (inherits request/response, tick, handler management)
 * - Uses DealerSocket for transport (passed to Protocol)
 * - ONLY listens to ProtocolEvent (NEVER SocketEvent)
 * - Manages server peer state
 * - Implements ping mechanism
 * - Handles application-level events
 */

import Globals from '../globals.js'
import PeerInfo from './peer.js'
import Protocol, { ProtocolEvent, ProtocolSystemEvent } from './protocol.js'
import { Transport } from '../transport/transport.js'

// ============================================================================
// CLIENT EVENTS (Public API)
// ============================================================================
export const ClientEvent = {
  READY: 'client:ready',               // Handshake complete, client can send requests
  DISCONNECTED: 'client:disconnected', // Server disconnected
  FAILED: 'client:failed',             // Connection permanently failed
  STOPPED: 'client:stopped',           // Client explicitly stopped
  ERROR: 'client:error'                // Client-level error (transport/protocol failure)
}

/**
 * Event Flow Map (Client)
 * 
 * Transport Layer (via Protocol → ProtocolEvent)
 * ┌────────────────────────────┬──────────────────────────────────────────────┐
 * │ Listened (Inbound)        │ Action                                      │
 * ├────────────────────────────┼──────────────────────────────────────────────┤
 * │ TRANSPORT_READY           │ Send handshake (_system:handshake_init_from_client) │
 * │ TRANSPORT_NOT_READY       │ Mark ghost, stop ping, emit DISCONNECTED     │
 * │ TRANSPORT_CLOSED          │ Stop ping, emit FAILED                       │
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
 * │ client:ready              │ After handshake response; ping starts        │
 * │ client:disconnected       │ Transport not ready                          │
 * │ client:failed             │ Transport closed permanently                  │
 * │ client:stopped            │ Client closed/stopped                        │
 * │ client:error              │ Transport/protocol error surfaced by Client  │
 * └────────────────────────────┴──────────────────────────────────────────────┘
 * 
 * Handshake Sequence
 * 1) TRANSPORT_READY →
 * 2) send _system:handshake_init_from_client →
 * 3) receive _system:handshake_ack_from_server (welcome) →
 * 4) set serverPeerInfo (id/options), start ping →
 * 5) emit client:ready
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
      serverPeerInfo: null,
      pingInterval: null,
      options  // ✅ Store node options for handshake
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
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('CONNECTED')
      }
      
      // Send handshake tick to server (recipient unknown at this point)
      this._sendClientConnected()
    })
    
    // Transport disconnected - stop ping, mark peer as ghost
    this.on(ProtocolEvent.TRANSPORT_NOT_READY, () => {
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('GHOST')
      }
      
      this._stopPing()
      
      // Emit application event
      this.emit(ClientEvent.DISCONNECTED, { serverId: 'server' })
    })
    
    // Transport permanently closed - reject all, mark failed
    this.on(ProtocolEvent.TRANSPORT_CLOSED, () => {
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('FAILED')
      }
      
      this._stopPing()
      
      // Emit application event
      this.emit(ClientEvent.FAILED, { serverId: 'server' })
    })
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers () {
    // ============================================================================
    // HANDSHAKE RESPONSE - Server welcomes client
    // ============================================================================
    // New explicit name
    this.onTick(ProtocolSystemEvent.HANDSHAKE_ACK_FROM_SERVER, (envelope) => {
      let { serverPeerInfo } = _private.get(this)
      
      const data = envelope.data      
      // ✅ Extract server ID from envelope.owner (sender's socket ID)
      const serverId = envelope.owner
      
      if (!serverId) {
        this.logger?.error('Server handshake response missing sender ID in envelope.owner')
        return
      }
      
      if (serverPeerInfo) {
        // ✅ Store server ID (now we know who we're talking to)
        serverPeerInfo.setId(serverId)
        serverPeerInfo.setState('HEALTHY')  
        
        // ✅ Store server options from handshake response
        if (data && typeof data === 'object') {
          serverPeerInfo.setOptions(data)
        }
      }
      
      // ✅ Start ping now that handshake is complete and we know server ID
      this._startPing()
      
      // ✅ Emit CLIENT READY - handshake complete, session established
      this.emit(ClientEvent.READY, { 
        serverId,
        serverOptions: data
      })
    })
    
    // ============================================================================
    // SERVER LIFECYCLE EVENTS
    // ============================================================================
    this.onTick(ProtocolSystemEvent.SERVER_STOP, () => {
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('STOPPED')
      }
      
      this._stopPing()
      
      this.emit(ClientEvent.STOPPED)
    })
  }
  
  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  async connect (serverAddress, timeout) {
    let _scope = _private.get(this)
    _scope.serverAddress = serverAddress
    
    // Create server peer info (ID unknown until handshake completes)
    _scope.serverPeerInfo = new PeerInfo({ 
      id: null,  // ✅ Will be set after handshake response
      options: {}
    })
    _scope.serverPeerInfo.setState('CONNECTING')
    
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
          _scope.serverPeerInfo.setState('FAILED')
          reject(new Error(`Handshake timeout: server at ${serverAddress} did not respond`))
        }, handshakeMs)
        
        this.once(ClientEvent.READY, ({ serverId }) => {
          clearTimeout(handshakeTimeout)
          resolve(serverId)
        })
      })
    } catch (err) {
      _scope.serverPeerInfo.setState('FAILED')
      throw err
    }
  }
  
  async disconnect () {
    let { serverPeerInfo } = _private.get(this)
    
    this._stopPing()
    
    // Try to notify server
    try {
      // ✅ Use internal API to send system event (client stop)
      this._sendSystemTick({
        event: ProtocolSystemEvent.CLIENT_STOP,
        data: { clientId: this.getId() }
      })
    } catch (err) {
      this.debug && this.logger?.error('Error sending client stop: ', err)
    }
    

    // disconnect from transport and detach listeners
    await super.disconnect();
    
    // do we need this ?? 
    // if (serverPeerInfo) {
    //   serverPeerInfo.setState('STOPPED')
    // }
  }
  
  async close () {
    await this.disconnect()
    await super.close() // close underlying transport and cleanup
  }
  
  getServerPeerInfo () {
    let { serverPeerInfo } = _private.get(this)
    return serverPeerInfo
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
      if (this.isReady()) {
        const { serverPeerInfo } = _private.get(this)
        const serverId = serverPeerInfo?.getId()
        
        if (!serverId) {
          this.debug && this.logger?.warn('Cannot send ping: server ID unknown')
          return
        }
        
        // ✅ Send ping with explicit recipient using internal API
        this._sendSystemTick({
          to: serverId,  // ✅ Now we know server ID!
          event: ProtocolSystemEvent.CLIENT_PING,
          // No data needed for ping, we have timestamp in each envelope
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
   * Client is ready when:
   * 1) Transport is online AND
   * 2) Handshake completed (server ID known)
   */
  isReady () {
    const transportOnline = this.isOnline()
    const { serverPeerInfo } = _private.get(this)
    const serverIdKnown = !!(serverPeerInfo && serverPeerInfo.getId())
    return transportOnline && serverIdKnown
  }
}
