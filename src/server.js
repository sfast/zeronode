/**
 * Server - Application layer for server-side communication
 * 
 * ARCHITECTURE: Protocol-First Design
 * - Extends Protocol (inherits request/response, tick, handler management)
 * - Uses RouterSocket for transport (passed to Protocol)
 * - ONLY listens to ProtocolEvent (NEVER SocketEvent)
 * - Manages multiple client peers
 * - Implements health check mechanism
 * - Handles application-level events
 */

import { events } from './enum'
import Globals from './globals'
import PeerInfo from './peer'
import Protocol, { ProtocolEvent } from './protocol'
import { Router as RouterSocket } from './sockets'

let _private = new WeakMap()

export default class Server extends Protocol {
  constructor ({ id, config } = {}) {
    config = config || {}

    // Create RouterSocket (transport layer)
    const socket = new RouterSocket({ id, config })
    
    // Pass socket to Protocol
    super(socket)

    let _scope = {
      bindAddress: null,
      clientPeers: new Map(),      // clientId → PeerInfo
      healthCheckInterval: null
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
      this.emit(events.SERVER_READY, { serverId: this.getId() })
    })

    // Transport disconnected - stop health checks
    this.on(ProtocolEvent.TRANSPORT_NOT_READY, () => {
      this._stopHealthChecks()
      this.emit(events.SERVER_NOT_READY)
    })

    // Transport permanently closed - cleanup
    this.on(ProtocolEvent.TRANSPORT_CLOSED, () => {
      this._stopHealthChecks()
      this.emit(events.SERVER_CLOSED)
    })
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers () {
    // ============================================================================
    // HANDSHAKE - Client discovery via messages
    // ============================================================================
    this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
      let { clientPeers } = _private.get(this)
      
      const clientId = envelope.owner
      let peerInfo = clientPeers.get(clientId)
      
      if (!peerInfo) {
        // NEW CLIENT - Discover peer from handshake message
        peerInfo = new PeerInfo({ 
          id: clientId,
          options: data  // Store any client metadata
        })
        peerInfo.setState('CONNECTED')
        clientPeers.set(clientId, peerInfo)
        
        // Emit peer joined event
        this.emit(events.CLIENT_JOINED, { 
          clientId,
          data
        })
      } else {
        // EXISTING CLIENT - Reconnected, update state
        peerInfo.setState('HEALTHY')
      }
      
      // Send welcome response (complete handshake)
      // Note: serverId is automatically in envelope.owner
      this.tick({
        to: clientId,
        event: events.CLIENT_CONNECTED,
        data: {
          timestamp: Date.now()
          // ❌ Removed: serverId (redundant with envelope.owner)
        }
      })
    })
    
    // ============================================================================
    // HEARTBEAT - Client ping
    // ============================================================================
    this.onTick(events.CLIENT_PING, (data, envelope) => {
      let { clientPeers } = _private.get(this)
      
      const clientId = envelope.owner
      const peerInfo = clientPeers.get(clientId)
      
      if (peerInfo) {
        peerInfo.updateLastSeen()
        peerInfo.setState('HEALTHY')
      }
    })
    
    // ============================================================================
    // CLIENT LIFECYCLE
    // ============================================================================
    this.onTick(events.CLIENT_STOP, (data, envelope) => {
      let { clientPeers } = _private.get(this)
      
      const clientId = envelope.owner
      const peerInfo = clientPeers.get(clientId)
      
      if (peerInfo) {
        peerInfo.setState('STOPPED')
    }
      
      this.emit(events.CLIENT_STOP, { clientId })
    })
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  async bind (bindAddress) {
      let _scope = _private.get(this)
    _scope.bindAddress = bindAddress
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    
    await socket.bind(bindAddress)
    // Protocol will emit ProtocolEvent.READY when bound
  }
  
  async unbind () {
    this._stopHealthChecks()
    
    // Notify all clients
    if (this.isReady()) {
        try {
          this.tick({
            event: events.SERVER_STOP,
            data: { serverId: this.getId() }
          })
    } catch (err) {
        // Ignore if offline
      }
    }
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    await socket.unbind()
  }
  
  async close () {
    await this.unbind()
    
    // ✅ Use Protocol's socket (via protected method)
    const socket = this._getSocket()
    await socket.close()
  }
  
  getClientPeerInfo (clientId) {
    let { clientPeers } = _private.get(this)
    return clientPeers.get(clientId)
  }
  
  getAllClientPeers () {
    let { clientPeers } = _private.get(this)
    return Array.from(clientPeers.values())
  }
  
  getConnectedClientCount () {
    return this.getAllClientPeers().filter(peer => 
      peer.getState() === 'CONNECTED' || peer.getState() === 'HEALTHY'
    ).length
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
    const checkInterval = config.HEALTH_CHECK_INTERVAL || Globals.HEALTH_CHECK_INTERVAL || 30000
    const ghostThreshold = config.GHOST_THRESHOLD || Globals.CLIENT_TIMEOUT || 60000
    
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
    let { clientPeers } = _private.get(this)
    const now = Date.now()
    
    clientPeers.forEach((peerInfo, clientId) => {
      const timeSinceLastSeen = now - peerInfo.getLastSeen()
      
      if (timeSinceLastSeen > ghostThreshold) {
        const previousState = peerInfo.getState()
        peerInfo.setState('GHOST')
        
        // Emit event if state changed
        if (previousState !== 'GHOST') {
          this.emit(events.CLIENT_GHOST, { 
            clientId, 
            lastSeen: peerInfo.getLastSeen(),
            timeSinceLastSeen 
          })
        }
      }
    })
  }
}
