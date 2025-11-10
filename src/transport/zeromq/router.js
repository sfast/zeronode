/**
 * RouterSocket - Thin wrapper around ZeroMQ Router
 * Handles: bind/unbind, message routing format
 * 
 * Uses 2 I/O threads by default (good for servers handling multiple clients)
 */
import * as zmq from 'zeromq'

import { TransportError, TransportErrorCode } from '../errors.js'
import { Socket } from './socket.js'
import { TransportEvent } from '../events.js'
import { createContext } from './context.js'
import { mergeConfig } from './config.js'

let _private = new WeakMap()

export default class RouterSocket extends Socket {
  constructor ({ id, config } = {}) {
    // Merge user config with defaults and validate (before using it)
    config = mergeConfig(config, true)

    // Create context with configured I/O threads for routers (servers)
    const context = createContext(config.ROUTER_IO_THREADS)

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
   * Config is already merged with defaults
   */
  static _configureRouterOptions (socket, config) {
    // Router mandatory: Fail if sending to unknown peer
    // Optional - only set if explicitly provided by user
    if (config.ZMQ_ROUTER_MANDATORY !== undefined) {
      socket.mandatory = config.ZMQ_ROUTER_MANDATORY
    }

    // Router handover: Take over identity from another router (advanced)
    // Optional - only set if explicitly provided by user
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
      throw new TransportError({
        code: TransportErrorCode.ADDRESS_REQUIRED,
        message: 'Bind address must be a non-empty string',
        transportId: this.getId()
      })
    }
    
    // Basic validation: should start with protocol (tcp://, ipc://, inproc://)
    if (!/^(tcp|ipc|inproc):\/\/.+/.test(bindAddress)) {
      throw new TransportError({
        code: TransportErrorCode.INVALID_ADDRESS,
        message: `Invalid bind address format: ${bindAddress}. Expected format: tcp://host:port, ipc://path, or inproc://name`,
        transportId: this.getId(),
        address: bindAddress
      })
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
   * @throws {TransportError} If already bound or bind fails
   */
  async bind (bindAddress) {
    let _scope = _private.get(this)
    let { socket } = _scope

    // Validate: Can't bind if already online
    if (this.isOnline()) {
      throw new TransportError({ 
        code: TransportErrorCode.ALREADY_BOUND,
        message: `Router '${this.getId()}' is already bound to '${this.getAddress()}'`,
        transportId: this.getId(),
        address: this.getAddress()
      })
    }

    // Set address
    if (bindAddress) {
      this.setAddress(bindAddress)
    }

    // Validate: Must have address
    if (!this.getAddress()) {
      throw new TransportError({ 
        code: TransportErrorCode.ADDRESS_REQUIRED,
        message: 'Bind address is required',
        transportId: this.getId()
      })
    }

    // Bind sequence: attach listeners BEFORE bind to catch events
    try {
      this.attachSocketEventListeners()  // ✅ Attach BEFORE bind
     
      await socket.bind(this.getAddress())  // Bind to address
      
      // ✅ Get actual bound address (important when using port 0)
      // ZeroMQ lastEndpoint returns the actual address after binding
      const actualAddress = socket.lastEndpoint
      if (actualAddress && actualAddress !== this.getAddress()) {
        _scope.bindAddress = actualAddress
      }
      
      // ✅ Set online immediately after successful bind
      // ZMQ bind() promise already waits for the operation to complete
      this.setOnline()
      
      // ✅ Emit READY event to notify Protocol layer
      this.emit(TransportEvent.READY, { address: this.getAddress() })
      
      return `Router '${this.getId()}' bound to '${this.getAddress()}'`
    } catch (err) {
      // Cleanup on failure
      this.detachSocketEventListeners()
      this.setOffline()
      throw new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: `Failed to bind to ${this.getAddress()}`,
        transportId: this.getId(),
        address: this.getAddress(),
        cause: err
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
    try {
      await socket.unbind(bindAddress)
    } catch (err) {
      // Ignore "No such endpoint" errors (already unbound)
      if (err.code !== 'ENOENT') {
        const transportError = new TransportError({
          code: TransportErrorCode.UNBIND_FAILED,
          message: `Failed to unbind from ${bindAddress}`,
          transportId: this.getId(),
          address: bindAddress,
          cause: err
        })
        this.emit('error', transportError)
        return
      }
    }
    
    // 4. Detach event listeners
    this.detachSocketEventListeners()
    
    // 5. Set offline and clear bind address
    this.setOffline()
    _scope.bindAddress = null
  }

  /**
   * Close the router socket
   * Teardown sequence:
   * 1. Unbind from address (application-level)
   * 2. Emit CLOSED event
   * 3. Close socket (transport-level via super.close())
   */
  async close () {
    await this.unbind()
    
    // Emit TransportEvent.CLOSED when explicitly closed
    // (Unlike Dealer, Router doesn't have reconnection noise)
    super.close(true)
    this.emit(TransportEvent.CLOSED)
  }

  /**
   * Attach Router-specific socket event listeners
   * Only listens to events relevant for Router (server) sockets
   */
  attachSocketEventListeners () {
    let { socket } = _private.get(this)
    
    if (socket.events) {
      // Map ZeroMQ listening → TransportEvent.READY
      socket.events.on('listening', (fd, endpoint) => {
        this.setOnline()
        this.debug && this.logger.info(`Emitted '${TransportEvent.READY}' on socket '${this.getId()}'`)
        this.emit(TransportEvent.READY, { fd, endpoint })
      })
    }
  }

  // ZeroMQ Router-specific: message format for routing
  // Router needs [recipient identity, delimiter, payload]
  getSocketMsgFromBuffer (buffer, recipient) {
    return [recipient || '', '', buffer]
  }
}


