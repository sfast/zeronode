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

import { events } from './enum'
import Globals from './globals'
import PeerInfo from './peer'
import { ZeronodeError, ErrorCodes } from './errors'
import Protocol, { ProtocolEvent } from './protocol'
import { Dealer as DealerSocket } from './sockets'

let _private = new WeakMap()

export default class Client extends Protocol {
  constructor ({ id, config } = {}) {
    config = config || {}
    
    // Create DealerSocket (transport layer)
    const socket = new DealerSocket({ id, config })
    
    // Pass socket to Protocol
    super(socket)
    
    let _scope = {
      routerAddress: null,
      serverPeerInfo: null,
      pingInterval: null
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
      
      // Emit transport ready event (low-level, for debugging)
      this.emit(events.TRANSPORT_READY)
    })
    
    // Transport disconnected - stop ping, mark peer as ghost
    this.on(ProtocolEvent.TRANSPORT_NOT_READY, () => {
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('GHOST')
      }
      
      this._stopPing()
      
      // Emit application event
      this.emit(events.SERVER_DISCONNECTED, { serverId: 'server' })
    })
    
    // Transport permanently closed - reject all, mark failed
    this.on(ProtocolEvent.TRANSPORT_CLOSED, () => {
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('FAILED')
      }
      
      this._stopPing()
      
      // Emit application event
      this.emit(events.SERVER_FAILED, { 
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
    this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
      let { serverPeerInfo } = _private.get(this)
      
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
      }
      
      // ✅ Start ping now that handshake is complete and we know server ID
      this._startPing()
      
      // ✅ Emit CLIENT READY - handshake complete, session established
      this.emit(events.CLIENT_READY, { 
        serverId,
        serverData: data
      })
    })
    
    // ============================================================================
    // SERVER LIFECYCLE EVENTS
    // ============================================================================
    this.onTick(events.SERVER_STOP, () => {
      let { serverPeerInfo } = _private.get(this)
      
      if (serverPeerInfo) {
        serverPeerInfo.setState('STOPPED')
      }
      
      this._stopPing()
      
      this.emit(events.SERVER_STOP)
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
      await socket.connect(routerAddress, timeout)
      // Transport is online, but application NOT ready until handshake completes
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
        this.tick({
          event: events.CLIENT_STOP,
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
        
        // ✅ Send ping with explicit recipient
        this.tick({
          to: serverId,  // ✅ Now we know server ID!
          event: events.CLIENT_PING,
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
    
    // Send handshake to server (recipient unknown at this point)
    this.tick({
      event: events.CLIENT_CONNECTED,
      data: {
        timestamp: Date.now()
      }
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
