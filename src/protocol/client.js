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
import { Dealer as DealerSocket } from '../transport/zeromq/index.js'

// ============================================================================
// CLIENT EVENTS (Public API)
// ============================================================================
export const ClientEvent = {
  READY: 'client:ready',               // Handshake complete, client can send requests
  DISCONNECTED: 'client:disconnected', // Server disconnected
  FAILED: 'client:failed',             // Connection permanently failed
  STOPPED: 'client:stopped'            // Client explicitly stopped
}

let _private = new WeakMap()

export default class Client extends Protocol {
  constructor ({ id, options, config } = {}) {
    config = config || {}
    options = options || {}
    
    // Create DealerSocket (transport layer)
    const socket = new DealerSocket({ id, config })
    
    // Pass socket to Protocol
    super(socket)
    
    let _scope = {
      routerAddress: null,
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
    // ============================================================================
    // MANUAL HANDSHAKE APPROACH
    // 
    // Transport ready → Send handshake → Wait for welcome → Start session
    // ============================================================================
    
    // Transport can send/receive bytes - send handshake
    this.on(ProtocolEvent.TRANSPORT_READY, () => {
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('CONNECTING')  // ✅ Still connecting (handshake pending)
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
      this.emit(ClientEvent.FAILED, { 
        serverId: 'server'
      })
    })
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers () {
    // ============================================================================
    // HANDSHAKE RESPONSE - Server welcomes client
    // ============================================================================
    this.onTick(ProtocolSystemEvent.CLIENT_CONNECTED, (envelope) => {
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
        serverPeerInfo.setState('READY')  // ✅ Application ready!
        
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
        serverData: data
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
  
  async connect (routerAddress, timeout) {
    let _scope = _private.get(this)
    _scope.routerAddress = routerAddress
    
    // Create server peer info (ID unknown until handshake completes)
    _scope.serverPeerInfo = new PeerInfo({ 
      id: null,  // ✅ Will be set after handshake response
      options: {}
    })
    _scope.serverPeerInfo.setState('CONNECTING')
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    
    try {
      // Connect transport
      await socket.connect(routerAddress, timeout)
      
      // Wait for handshake to complete (CLIENT_READY event)
      await new Promise((resolve, reject) => {
        const handshakeTimeout = setTimeout(() => {
          _scope.serverPeerInfo.setState('FAILED')
          reject(new Error(`Handshake timeout: server at ${routerAddress} did not respond`))
        }, timeout || 10000)
        
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
    
    // Notify server
    if (this.isReady()) {
      try {
        // ✅ Use internal API to send system event (client stop)
        this._sendSystemTick({
          event: ProtocolSystemEvent.CLIENT_STOP,
          data: { clientId: this.getId() }
        })
      } catch (err) {
        // Ignore if offline
      }
    }
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    await socket.disconnect()
    
    if (serverPeerInfo) {
      serverPeerInfo.setState('STOPPED')
    }
  }
  
  async close () {
    await this.disconnect()
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    await socket.close()
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
    const pingInterval = config.PING_INTERVAL || Globals.PING_INTERVAL || 10000
    
    _scope.pingInterval = setInterval(() => {
      if (this.isReady()) {
        const { serverPeerInfo } = _private.get(this)
        const serverId = serverPeerInfo?.getId()
        
        if (!serverId) {
          this.logger?.warn('Cannot send ping: server ID unknown')
          return
        }
        
        // ✅ Send ping with explicit recipient using internal API
        this._sendSystemTick({
          to: serverId,  // ✅ Now we know server ID!
          event: ProtocolSystemEvent.CLIENT_PING,
          data: { 
            timestamp: Date.now()
            // ❌ Removed: clientId (redundant with envelope.owner)
          }
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
    // ✅ Check transport ready (not application ready - that comes after handshake)
    const socket = this._getSocket()
    if (!socket.isOnline()) {
      return
    }
    
    const { options } = _private.get(this)
    
    // ✅ Use internal API to send system event (handshake)
    // Server will respond with _system:client_connected (welcome message)
    this._sendSystemTick({
      event: ProtocolSystemEvent.CLIENT_CONNECTED,  // '_system:client_connected'
      data: options || {}
    })
  }
  
  // ============================================================================
  // APPLICATION READY CHECK
  // ============================================================================
  
  /**
   * Override Protocol.isReady() to check application-level readiness
   * Application is ready when:
   * 1. Transport is online (socket connected)
   * 2. Server ID is known (handshake completed)
   */
  isReady () {
    // Check transport ready
    const transportReady = super.isReady()
    
    // Check server ID known
    const { serverPeerInfo } = _private.get(this)
    const serverIdKnown = serverPeerInfo && serverPeerInfo.getId()
    
    return transportReady && !!serverIdKnown
  }
}
