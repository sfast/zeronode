/**
 * RouterSocket - Thin wrapper around ZeroMQ Router
 * Handles: bind/unbind, message routing format
 * 
 * Uses 2 I/O threads by default (good for servers handling multiple clients)
 */
import * as zmq from 'zeromq'

import { ZeronodeError, ErrorCodes } from '../errors.js'
import { Socket, buildSocketEventHandler } from './socket.js'
import { TransportEvent } from '../transport-events.js'
import { getContextForSocket } from './context.js'

let _private = new WeakMap()

export default class RouterSocket extends Socket {
  constructor ({ id, config } = {}) {
    config = config || {}

    // Get appropriate context for server (2 I/O threads by default)
    // Can override with config.ioThreads if needed
    const context = getContextForSocket({
      socketType: 'router',
      role: 'server',
      expectedClients: config.expectedClients,
      ioThreads: config.ioThreads
    })

    let socket = new zmq.Router({ context })
    
    // Set ZeroMQ socket identity (routingId) - REQUIRED by Socket base class
    // Generate unique ID if not provided
    socket.routingId = id || `router-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Configure Router-specific socket options BEFORE calling super
    RouterSocket._configureRouterOptions(socket, config)

    // Super will configure common options (linger, HWM, timeouts)
    super({ socket, config })

    let _scope = {
      socket,
      bindAddress: null
    }

    _private.set(this, _scope)
  }

  /**
   * Configure Router-specific ZeroMQ socket options (static method)
   * Common options (linger, HWM, timeouts) are configured by base Socket class
   * Static so it can be called before super() in constructor
   */
  static _configureRouterOptions (socket, config) {
    // Router mandatory: Fail if sending to unknown peer (default: false)
    // false = silently drop messages to unknown peers (production)
    // true = throw error when sending to unknown peer (debugging)
    if (config.ZMQ_ROUTER_MANDATORY !== undefined) {
      socket.mandatory = config.ZMQ_ROUTER_MANDATORY
    }

    // Router handover: Take over identity from another router (advanced)
    // Useful for high-availability setups with multiple routers
    if (config.ZMQ_ROUTER_HANDOVER !== undefined) {
      socket.handover = config.ZMQ_ROUTER_HANDOVER
    }
  }

  getAddress () {
    let { bindAddress } = _private.get(this)
    return bindAddress
  }

  setAddress (bindAddress) {
    let _scope = _private.get(this)

    // Validate address format
    if (typeof bindAddress !== 'string' || !bindAddress.length) {
      throw new Error('Bind address must be a non-empty string')
    }
    
    // Basic validation: should start with protocol (tcp://, ipc://, inproc://)
    if (!/^(tcp|ipc|inproc):\/\/.+/.test(bindAddress)) {
      throw new Error(`Invalid bind address format: ${bindAddress}. Expected format: tcp://host:port, ipc://path, or inproc://name`)
    }

    _scope.bindAddress = bindAddress
  }

  /**
   * Bind to address
   * Professional implementation:
   * - Validates not already bound
   * - Attaches event listeners
   * - Binds to ZeroMQ address
   * - Sets online state
   * 
   * @param {string} bindAddress - Address to bind to (e.g., 'tcp://127.0.0.1:5000')
   * @returns {Promise<string>} Success message
   * @throws {ZeronodeError} If already bound or bind fails
   */
  async bind (bindAddress) {
    let _scope = _private.get(this)
    let { socket } = _scope

    // Validate: Can't bind if already online
    if (this.isOnline()) {
      let err = new Error(`Router '${this.getId()}' is already bound to '${this.getAddress()}'`)
      throw new ZeronodeError({ 
        socketId: this.getId(), 
        code: ErrorCodes.ALREADY_BINDED, 
        error: err 
      })
    }

    // Set address
    if (bindAddress) {
      this.setAddress(bindAddress)
    }

    // Validate: Must have address
    if (!this.getAddress()) {
      let err = new Error('Bind address is required')
      throw new ZeronodeError({ 
        socketId: this.getId(), 
        code: ErrorCodes.BIND_FAILED, 
        error: err 
      })
    }

    // Bind sequence: attach listeners BEFORE bind to catch 'listening' event
    try {
      this.attachTransportEventListeners()  // ✅ Attach BEFORE bind
      await socket.bind(this.getAddress())
      this.setOnline()
      
      return `Router '${this.getId()}' bound to '${this.getAddress()}'`
    } catch (err) {
      // Cleanup on failure
      this.detachTransportEventListeners()
      this.setOffline()
      throw new ZeronodeError({
        socketId: this.getId(),
        code: ErrorCodes.BIND_FAILED,
        error: err
      })
    }
  }

  /**
   * Unbind from address (application-level cleanup)
   * 
   * Order is critical:
   * 1. Stop message listener (prevents EBUSY during unbind)
   * 2. Unbind from ZeroMQ address
   * 3. Detach event listeners
   * 4. Set offline state
   */
  async unbind () {
    let _scope = _private.get(this)
    let { socket, bindAddress } = _scope

    // Only unbind if we're actually bound
    if (!this.isOnline() || !bindAddress) {
      return
    }

    // 1. Stop message listener FIRST (sets flag to break async iterator)
    this.stopMessageListener()
    
    // 2. Wait a tick for the iterator to see the flag and stop
    await new Promise(resolve => setImmediate(resolve))
    
    // 3. Now safe to unbind (listener stopped, no EBUSY)
    await socket.unbind(bindAddress)
    
    // 4. Detach event listeners
    this.detachTransportEventListeners()
    
    // 5. Update state
    this.setOffline()
  }

  /**
   * Close the router socket
   * Teardown sequence:
   * 1. Unbind from address (application-level)
   * 2. Close socket (transport-level via super.close())
   */
  async close () {
    await this.unbind()
    super.close()
  }

  /**
   * Attach Router-specific socket event listeners
   * Only listens to events relevant for Router (server) sockets
   */
  attachTransportEventListeners () {
    // First attach common events
    super.attachTransportEventListeners()
    
    let { socket } = _private.get(this)
    
    if (socket.events) {
      // Map ZeroMQ listening → TransportEvent.READY
      // NOTE: ZeroMQ event is ZMQ_EVENT_LISTENING (not ZMQ_EVENT_LISTEN)
      socket.events.on('listening', buildSocketEventHandler.call(this, TransportEvent.READY))
    }
  }

  // ZeroMQ Router-specific: message format for routing
  // Router needs [recipient identity, delimiter, payload]
  getSocketMsgFromBuffer (buffer, recipient) {
    return [recipient || '', '', buffer]
  }
}


