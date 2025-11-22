/**
 * Protocol - Thin orchestrator for message protocol handling
 * 
 * ARCHITECTURE: Protocol-First Design
 * - Single gateway between Socket and Application layers
 * - Delegates to specialized modules (Config, RequestTracker, HandlerExecutor, MessageDispatcher, Lifecycle)
 * - Provides clean public API for request/tick operations
 * 
 * Client/Server should NEVER access socket directly!
 */

import { EventEmitter } from 'events'
import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'
import { EnvelopeIdGenerator, Envelope, EnvelopType } from './envelope.js'
import { 
  ProtocolConfigDefaults, 
  ProtocolSystemEvent, 
  mergeProtocolConfig, 
  validateEventName 
} from './config.js'
import { ProtocolContext } from './protocol-context.js'
import { RequestTracker } from './request-tracker.js'
import { HandlerExecutor } from './handler-executor.js'
import { MessageDispatcher } from './message-dispatcher.js'
import { LifecycleManager, ProtocolEvent } from './lifecycle.js'

// Re-export for convenience
export { ProtocolEvent, ProtocolSystemEvent, ProtocolConfigDefaults }

let _private = new WeakMap()

export default class Protocol extends EventEmitter {
  constructor(socket, config = {}) {
    super()
    
    if (!socket) {
      throw new Error('Protocol requires a socket')
    }
    
    // Merge config (centralized in config module)
    const mergedConfig = mergeProtocolConfig(config)
    
    // Create protocol context (shared by all components)
    const context = new ProtocolContext(this, socket, mergedConfig)
    
    // Create ID generator
    const idGenerator = new EnvelopeIdGenerator(socket.getId())
    
    // Create components with simplified constructors using context
    const requestTracker = new RequestTracker(context)
    const handlerExecutor = new HandlerExecutor(context)
    const dispatcher = new MessageDispatcher(context, requestTracker, handlerExecutor)
    const lifecycle = new LifecycleManager(context, requestTracker, dispatcher, this)
    
    // Store private state
    let _scope = {
      context,
      socket,
      config: mergedConfig,
      idGenerator,
      requestTracker,
      handlerExecutor,
      dispatcher,
      lifecycle,
      closed: false
    }
    
    _private.set(this, _scope)
    
    // Attach transport event listeners
    lifecycle.attachSocketEventHandlers()
  }
  
  // ============================================================================
  // PUBLIC API - BASIC INFO
  // ============================================================================
  
  getId() {
    let { socket } = _private.get(this)
    return socket.getId()
  }
  
  getConfig() {
    let { config } = _private.get(this)
    return config
  }
  
  setLogger(logger) {
    let { socket } = _private.get(this)
    socket.setLogger(logger)
  }
  
  isOnline() {
    let { socket, closed } = _private.get(this)
    return socket.isOnline() && !closed
  }
  
  get debug() {
    let { config } = _private.get(this)
    return config.DEBUG
  }
  
  set debug(value) {
    let { config, socket } = _private.get(this)
    config.DEBUG = value
    socket.debug = value
  }
  
  // ============================================================================
  // REQUEST/RESPONSE - PUBLIC API
  // ============================================================================
  
  /**
   * Send request and wait for response
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID
   * @param {string} params.event - Event name (cannot start with '_system:')
   * @param {*} [params.data] - Request data
   * @param {number} [params.timeout] - Request timeout in ms
   * @returns {Promise<*>} Response data
   * @throws {ProtocolError} If validation fails or transport is offline
   */
  request({ to, event, data, timeout } = {}) {
    let { socket, requestTracker, idGenerator, config } = _private.get(this)
    
    // Validate event name (no system events from public API)
    try {
      validateEventName(event, false)
    } catch (err) {
      // Wrap validation error in ProtocolError
      return Promise.reject(new ProtocolError({
        code: ProtocolErrorCode.INVALID_EVENT,
        message: err.message,
        protocolId: this.getId(),
        context: { event }
      }))
    }
    
    // Check if transport is online
    if (!this.isOnline()) {
      return Promise.reject(new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send request: Protocol '${this.getId()}' is not ready`,
        protocolId: this.getId()
      }))
    }
    
    // Use config default if no timeout specified
    timeout = timeout || config.PROTOCOL_REQUEST_TIMEOUT
    
    // Generate unique envelope ID
    const id = idGenerator.next()
    
    return new Promise((resolve, reject) => {
      // Track request
      requestTracker.track(id, { resolve, reject, timeout })
      
      // Create and send envelope
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id,
        event,
        data,
        owner: this.getId(),
        recipient: to
      }, config.BUFFER_STRATEGY)
      
      socket.sendBuffer(buffer, to)
    })
  }
  
  // ============================================================================
  // TICK (fire-and-forget) - PUBLIC API
  // ============================================================================
  
  /**
   * Send tick (fire-and-forget message) - PUBLIC API
   * Validates event names and blocks system events to prevent spoofing
   * 
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID (optional for broadcast)
   * @param {string} params.event - Event name (cannot start with '_system:')
   * @param {*} [params.data] - Event data
   * @throws {ProtocolError} If event is a system event or transport is offline
   */
  tick({ to, event, data } = {}) {
    // ❌ BLOCK system events from public API
    if (event.startsWith('_system:')) {
      throw new ProtocolError({
        code: ProtocolErrorCode.INVALID_EVENT,
        message: `Cannot send system event '${event}'. System events are reserved for internal use only.`,
        protocolId: this.getId(),
        context: { event }
      })
    }
    
    // ✅ Validate event name
    validateEventName(event, false)
    
    // Check if transport is online
    if (!this.isOnline()) {
      throw new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send tick: Protocol '${this.getId()}' is not ready (transport offline)`,
        protocolId: this.getId()
      })
    }
    
    // Send via internal implementation
    this._doTick({ to, event, data })
  }
  
  // ============================================================================
  // INTERNAL API - For Client/Server subclasses ONLY
  // ============================================================================
  
  /**
   * Send system tick - INTERNAL USE ONLY
   * Used by Client/Server for handshake, ping, disconnect, etc.
   * 
   * @protected
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID
   * @param {string} params.event - System event name (must start with '_system:')
   * @param {*} [params.data] - Event data
   * @throws {ProtocolError} If transport is offline
   * @throws {Error} If event is not a system event
   */
  _sendSystemTick({ to, event, data } = {}) {
    // ✅ Assert this is actually a system event (internal validation)
    if (!event.startsWith('_system:')) {
      throw new Error(
        `_sendSystemTick() requires system event (starting with '_system:'), got: ${event}`
      )
    }
    
    // Check if transport is online
    if (!this.isOnline()) {
      throw new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send system tick: Protocol '${this.getId()}' is not ready (transport offline)`,
        protocolId: this.getId()
      })
    }
    
    // Send via internal implementation (bypass validation)
    this._doTick({ to, event, data })
  }
  
  /**
   * Actually send a tick (internal implementation)
   * @private
   */
  _doTick({ to, event, data } = {}) {
    let { socket, idGenerator, config } = _private.get(this)
    
    const id = idGenerator.next()
    const buffer = Envelope.createBuffer({
      type: EnvelopType.TICK,
      id,
      event,
      data,
      owner: this.getId()
    }, config.BUFFER_STRATEGY)
    
    socket.sendBuffer(buffer, to)
  }
  
  // ============================================================================
  // HANDLER REGISTRATION - PUBLIC API
  // ============================================================================
  
  /**
   * Register request handler
   * @param {string|RegExp} pattern - Event pattern to match
   * @param {Function} handler - Handler function (envelope, reply) or (envelope, reply, next)
   */
  onRequest(pattern, handler) {
    let { dispatcher } = _private.get(this)
    dispatcher.onRequest(pattern, handler)
  }
  
  /**
   * Unregister request handler
   * @param {string|RegExp} pattern - Event pattern
   * @param {Function} handler - Handler to remove
   */
  offRequest(pattern, handler) {
    let { dispatcher } = _private.get(this)
    dispatcher.offRequest(pattern, handler)
  }
  
  /**
   * Register tick handler
   * @param {string|RegExp} pattern - Event pattern to match
   * @param {Function} handler - Handler function (envelope)
   */
  onTick(pattern, handler) {
    let { dispatcher } = _private.get(this)
    dispatcher.onTick(pattern, handler)
  }
  
  /**
   * Unregister tick handler
   * @param {string|RegExp} pattern - Event pattern
   * @param {Function} [handler] - Handler to remove (optional - removes all if omitted)
   */
  offTick(pattern, handler) {
    let { dispatcher } = _private.get(this)
    dispatcher.offTick(pattern, handler)
  }
  
  // ============================================================================
  // PROTECTED API - For Client/Server subclasses
  // ============================================================================
  
  _getSocket() {
    let { socket } = _private.get(this)
    return socket
  }
  
  _getPrivateScope() {
    return _private.get(this)
  }
  
  /**
   * Detach protocol-managed transport listeners from the socket.
   * Safe to call multiple times.
   * @private
   */
  _detachSocketEventHandlers(socket) {
    let { lifecycle } = _private.get(this)
    lifecycle.detachSocketEventHandlers()
  }
  
  /**
   * Disconnect protocol from transport events without closing or rejecting pending.
   * - Idempotent: safe to call multiple times
   * - Does NOT set closed flag
   * - Does NOT reject pending requests
   * - Does NOT close underlying transport
   */
  async disconnect() {
    let { lifecycle } = _private.get(this)
    await lifecycle.disconnect()
  }
  
  /**
   * Unbind protocol from transport events without closing or rejecting pending.
   * - Idempotent: safe to call multiple times
   * - Does NOT set closed flag
   * - Does NOT reject pending requests
   * - Does NOT close underlying transport
   */
  async unbind() {
    let { lifecycle } = _private.get(this)
    await lifecycle.unbind()
  }
  
  /**
   * Close the protocol and cleanup resources.
   * - Idempotent
   * - Closes the underlying transport
   * - Rejects pending requests
   * - Removes all handlers
   * - Detaches listeners
   */
  async close() {
    let _scope = _private.get(this)
    const { lifecycle, closed } = _scope
    
    if (closed) return
    _scope.closed = true
    
    await lifecycle.close()
  }
}
