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

import Globals from '../globals.js'
import PeerInfo from './peer.js'
import Protocol, { ProtocolEvent, ProtocolSystemEvent } from './protocol.js'
import { Router as RouterSocket } from '../transport/zeromq/index.js'

// ============================================================================
// SERVER EVENTS
// ============================================================================
export const ServerEvent = {
  READY: 'server:ready',               // Server is ready to accept clients
  NOT_READY: 'server:not_ready',       // Server transport not ready
  CLOSED: 'server:closed',             // Server closed
  CLIENT_JOINED: 'server:client_joined',   // New client connected & authenticated
  CLIENT_LEFT: 'server:client_left',       // Client disconnected
  CLIENT_TIMEOUT: 'server:client_timeout'  // Client timed out (ghost)
}

let _private = new WeakMap()

export default class Server extends Protocol {
  constructor ({ id, options, config } = {}) {
    config = config || {}
    options = options || {}

    // Create RouterSocket (transport layer)
    const socket = new RouterSocket({ id, config })
    
    // Pass socket to Protocol
    super(socket)

    let _scope = {
      bindAddress: null,
      clientPeers: new Map(),      // clientId → PeerInfo
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
    this.onTick(ProtocolSystemEvent.CLIENT_CONNECTED, (data, envelope) => {
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
        this.emit(ServerEvent.CLIENT_JOINED, { 
          clientId,
          data
        })
      } else {
        // EXISTING CLIENT - Reconnected, update state
        peerInfo.setState('HEALTHY')
      }
      
      // Send welcome response (complete handshake) with server options
      // Note: serverId is automatically in envelope.owner
      const { options } = _private.get(this)
      
      // ✅ Use internal API to send system event (handshake response)
      this._sendSystemTick({
        to: clientId,
        event: ProtocolSystemEvent.CLIENT_CONNECTED,  // '_system:client_connected'
        data: options || {}
      })
    })
    
    // ============================================================================
    // HEARTBEAT - Client ping
    // ============================================================================
    this.onTick(ProtocolSystemEvent.CLIENT_PING, (data, envelope) => {
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
    this.onTick(ProtocolSystemEvent.CLIENT_STOP, (data, envelope) => {
      let { clientPeers } = _private.get(this)
      
      const clientId = envelope.owner
      const peerInfo = clientPeers.get(clientId)
      
      if (peerInfo) {
        peerInfo.setState('STOPPED')
    }
      
      this.emit(ServerEvent.CLIENT_LEFT, { clientId })
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
    
    // Notify all clients
    if (this.isReady()) {
        try {
          this.tick({
            event: ProtocolSystemEvent.SERVER_STOP,
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
  
  getAddress () {
    const socket = this._getSocket()
    return socket.getAddress()
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
          this.emit(ServerEvent.CLIENT_TIMEOUT, { 
            clientId, 
            lastSeen: peerInfo.getLastSeen(),
            timeSinceLastSeen 
          })
        }
      }
    })
  }
}
