/**
 * Protocol - Message protocol handler (request/response, tick)
 * 
 * ARCHITECTURE: Protocol-First Design
 * - Single gateway between Socket and Application layers
 * - Translates low-level SocketEvent → high-level ProtocolEvent
 * - Handles all request/response tracking
 * - Manages connection state
 * 
 * Client/Server should NEVER access socket directly!
 */

import { PatternEmitter } from '@sfast/pattern-emitter-ts'
import { EventEmitter } from 'events'

import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'
import { EnvelopeIdGenerator, Envelope, BufferStrategy, EnvelopType } from './envelope.js'
import { TransportEvent } from '../transport/events.js'
import Globals from '../globals.js'

// ============================================================================
// PROTOCOL CONFIGURATION DEFAULTS
// ============================================================================

/**
 * Default protocol-level timeouts and settings
 */
export const ProtocolConfigDefaults = {
  REQUEST_TIMEOUT: 10000,  // Request timeout in milliseconds (10 seconds)
  INFINITY: -1             // Special value for infinite timeout
}

// ============================================================================
// PROTOCOL EVENTS (High-Level, Semantic)
// ============================================================================

export const ProtocolEvent = {
  // Transport state changes (simplified)
  TRANSPORT_READY: 'protocol:transport_ready',       // Transport can send/receive bytes
  TRANSPORT_NOT_READY: 'protocol:transport_not_ready', // Transport disconnected/unbound
  TRANSPORT_CLOSED: 'protocol:transport_closed',      // Transport permanently closed
  ERROR: 'protocol:error'                             // Protocol-surfaced transport/protocol error
}

// ============================================================================
// PROTOCOL SYSTEM EVENTS (Internal Message Contract)
// ============================================================================
// These are internal protocol messages exchanged between client and server
// for handshakes, pings, and lifecycle management. They use the '_system:' 
// prefix to prevent user code from spoofing them.

export const ProtocolSystemEvent = {
  // Handshake (explicit names)
  HANDSHAKE_INIT_FROM_CLIENT: '_system:handshake_init_from_client',  // Client → Server
  HANDSHAKE_ACK_FROM_SERVER: '_system:handshake_ack_from_server',    // Server → Client
  CLIENT_PING: '_system:client_ping',            // Client → Server: Heartbeat
  CLIENT_STOP: '_system:client_stop',            // Client → Server: Graceful disconnect
  SERVER_STOP: '_system:server_stop'             // Server → Client: Server shutting down
}

// ============================================================================
// PROTOCOL VALIDATION
// ============================================================================

/**
 * Validate event name - prevent spoofing of system events
 * @param {string} event - Event name
 * @param {boolean} isSystemEvent - Is this a system event being sent internally?
 * @throws {Error} If client tries to send system event
 * @returns {boolean} true if valid
 */
function validateEventName (event, isSystemEvent = false) {
  const isSystemPrefix = event.startsWith('_system:')
  
  if (isSystemPrefix && !isSystemEvent) {
    throw new Error(`Cannot send system event: ${event}. System events are reserved.`)
  }
  
  return true
}

let _private = new WeakMap()

export default class Protocol extends EventEmitter {
  constructor (socket, config = {}) {
    super()
    
    if (!socket) {
      throw new Error('Protocol requires a socket')
    }
    
    // Simple config merge: defaults → constructor overrides
    const mergedConfig = {
      BUFFER_STRATEGY: Globals.PROTOCOL_BUFFER_STRATEGY,
      PROTOCOL_REQUEST_TIMEOUT: Globals.PROTOCOL_REQUEST_TIMEOUT,
      DEBUG: false,
      ...(config || {})
    }

    let _scope = {
      socket,                    // PRIVATE - never expose!
      // Request tracking: id → { resolve, reject, timer }
      // NOTE: IDs are globally unique (include owner hash), but we only track
      // by ID here because:
      // - Client: Only sees its own requests (no collision possible)
      // - Server: Doesn't need to track requests (stateless request/response)
      // If server needs tracking (e.g. rate limiting), use (owner, id) tuple
      requests: new Map(),
      // Envelope ID generator (manages counter state)
      idGenerator: new EnvelopeIdGenerator(socket.getId()),
      // Handler storage - Both Client and Server need this
      requestEmitter: new PatternEmitter(),
      tickEmitter: new PatternEmitter(),
      // Protocol configuration (simple merged)
      config: mergedConfig,
      // Closed flag for idempotent teardown and API gating
      closed: false
      // NO state tracking - just pass through transport events
      // NO peer tracking - that's Server/Client responsibility!
    }
    
    _private.set(this, _scope)
    
    // Translate socket events to protocol events
    this._attachSocketEventHandlers(socket)
  }
  
  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  getId () {
    let { socket } = _private.get(this)
    return socket.getId()
  }
  
  getConfig () {
    let { config } = _private.get(this)
    return config
  }

  setLogger (logger) {
    let { socket } = _private.get(this)
    socket.setLogger(logger)
  }

  isOnline () {
    let { socket, closed } = _private.get(this)
    return socket.isOnline() && !closed
  }

  // ============================================================================
  // REQUEST/RESPONSE
  // ============================================================================
  
  request ({ to, event, data, timeout } = {}) {
    let { socket, requests, config } = _private.get(this)
    // we merged defaults in constructor
    timeout = timeout || config.PROTOCOL_REQUEST_TIMEOUT
    
    // Check if transport is online
    if (!this.isOnline()) {
      return Promise.reject(new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send request: Protocol '${this.getId()}' is not ready`,
        protocolId: this.getId()
      }))
    }
    
    let { idGenerator } = _private.get(this)
    const id = idGenerator.next()
    
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        if (requests.has(id)) {
          requests.delete(id)
          reject(new ProtocolError({
            code: ProtocolErrorCode.REQUEST_TIMEOUT,
            message: `Request envelope '${id}' timed out on protocol '${this.getId()}'`,
            protocolId: this.getId(),
            envelopeId: id,
            context: { event, timeout }
          }))
        }
      }, timeout)
      
      requests.set(id, { resolve, reject, timeout: timer })
      
      // Create envelope buffer and send (errors automatically caught by promise rejection)
      let { config } = _private.get(this)
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
  tick ({ to, event, data } = {}) {
    let { socket } = _private.get(this)
    
    // ❌ BLOCK system events from public API
    // System events (_system:*) are reserved for internal use (handshake, ping, etc.)
    if (event.startsWith('_system:')) {
      throw new ProtocolError({
        code: ProtocolErrorCode.INVALID_EVENT,
        message: `Cannot send system event '${event}'. System events are reserved for internal use only.`,
        protocolId: this.getId(),
        context: { event }
      })
    }
    
    // ✅ Validate event name (no _system: prefix from public API)
    validateEventName(event, false)
    
    // Check if transport is online
    if (!socket.isOnline()) {
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
   * This method bypasses public API validation and is intended ONLY for
   * internal protocol operations. Do not expose this to user code.
   * 
   * @protected
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID
   * @param {string} params.event - System event name (must start with '_system:')
   * @param {*} [params.data] - Event data
   * @throws {ProtocolError} If transport is offline
   * @throws {Error} If event is not a system event
   */
  _sendSystemTick ({ to, event, data } = {}) {
    let { socket } = _private.get(this)
    
    // ✅ Assert this is actually a system event (internal validation)
    if (!event.startsWith('_system:')) {
      throw new Error(
        `_sendSystemTick() requires system event (starting with '_system:'), got: ${event}`
      )
    }
    
    // Check if transport is online
    if (!socket.isOnline()) {
      throw new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send system tick: Protocol '${this.getId()}' is not ready (transport offline)`,
        protocolId: this.getId()
      })
    }
    
    // Send via internal implementation (bypass validation)
    this._doTick({ to, event, data })
  }
  
  // ============================================================================
  // PRIVATE IMPLEMENTATION
  // ============================================================================
  
  /**
   * Actually send a tick (internal implementation)
   * @private
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID
   * @param {string} params.event - Event name (already validated)
   * @param {*} [params.data] - Event data
   */
  _doTick ({ to, event, data } = {}) {
    let { socket, idGenerator, config } = _private.get(this)
    
    const buffer = Envelope.createBuffer({
      type: EnvelopType.TICK,
      id: idGenerator.next(),
      event,
      data,
      owner: this.getId(),
      recipient: to
    }, config.BUFFER_STRATEGY)
    
    socket.sendBuffer(buffer, to)
  }
  
  // ============================================================================
  // HANDLER REGISTRATION
  // ============================================================================
  
  onRequest (pattern, handler) {
    let { requestEmitter } = _private.get(this)
    requestEmitter.on(pattern, handler)
  }
  
  offRequest (pattern, handler) {
    let { requestEmitter } = _private.get(this)
    requestEmitter.off(pattern, handler)
  }
  
  onTick (pattern, handler) {
    let { tickEmitter } = _private.get(this)
    tickEmitter.on(pattern, handler)
  }
  
  offTick (pattern, handler) {
    let { tickEmitter } = _private.get(this)
    if (handler) {
      tickEmitter.off(pattern, handler)
    } else {
      tickEmitter.removeAllListeners(pattern)
    }
  }
  
  // ============================================================================
  // SOCKET EVENT HANDLERS → PROTOCOL EVENT TRANSLATION
  // ============================================================================
  
  _attachSocketEventHandlers (socket) {
    // ============================================================================
    // SIMPLIFIED EVENT TRANSLATION
    // 
    // Protocol just passes through 4 transport events - no state management!
    // 
    // TransportEvent (4 events):     ProtocolEvent (pass-through):
    // - READY                     →  TRANSPORT_READY
    // - NOT_READY                 →  TRANSPORT_NOT_READY  
    // - MESSAGE                   →  handled below (fast path dispatch)
    // - CLOSED                    →  TRANSPORT_CLOSED
    // 
    // Client/Server handle:
    // - Handshake logic (when to send CLIENT_CONNECTED, etc.)
    // - Peer management (tracking connected peers)
    // - Session state (HEALTHY, GHOST, etc.)
    // 
    // Protocol only handles:
    // - Request/response matching
    // - Tick/request handler execution
    // - Message parsing
    // ============================================================================
    
    // dispatch incoming messages to protocol handlers
    socket.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
      this._handleIncomingMessage(buffer, sender)
    })
    
    // Transport can send/receive - pass through
    socket.on(TransportEvent.READY, () => {
      if (process.env.NODE_ENV !== 'test') {
        this.debug && socket.logger?.info(`Protocol '${this.getId()}': Transport ready`)
      }
      this.emit(ProtocolEvent.TRANSPORT_READY)
    })
    
    // Transport disconnected - pass through
    socket.on(TransportEvent.NOT_READY, () => {
      this.debug && socket.logger?.warn(`Protocol '${this.getId()}': Transport not ready`)
      this.emit(ProtocolEvent.TRANSPORT_NOT_READY)
    })
    
    // Transport permanently closed - reject pending requests
    socket.on(TransportEvent.CLOSED, () => {
      this.debug && socket.logger?.error(`Protocol '${this.getId()}': Transport closed`)
      
      this._rejectPendingRequests('Transport closed')
      this.emit(ProtocolEvent.TRANSPORT_CLOSED)
    })

    // Transport error - surface as protocol-level error
    socket.on(TransportEvent.ERROR, (err) => {
      this.debug && socket.logger?.error(`Protocol '${this.getId()}': Transport error`, err)
      this.emit(ProtocolEvent.ERROR, err)
    })
  }
  
  // ============================================================================
  // UTILITY (Private)
  // ============================================================================
  
  _rejectPendingRequests (reason) {
    let { requests, socket } = _private.get(this)
    
    if (requests.size === 0) return
    
    this.debug && socket.logger?.warn(`[Protocol] Rejecting ${requests.size} pending requests: ${reason}`)
    
    requests.forEach((request, id) => {
      clearTimeout(request.timeout)
      request.reject(new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: reason,
        protocolId: socket.getId(),
        envelopeId: id
      }))
    })
    
    requests.clear()
  }
  
  // ============================================================================
  // MESSAGE HANDLING (Private)
  // ============================================================================
  
  _handleIncomingMessage (buffer, sender) {
    // Protocol is peer-agnostic - just handle the message
    // Create envelope to read type (lazy - only reads first byte)
    const envelope = new Envelope(buffer)
    const type = envelope.type
    
    switch (type) {
      case EnvelopType.REQUEST:
        this._handleRequest(buffer)
        break
                
      case EnvelopType.TICK:
        this._handleTick(buffer)
        break
      case EnvelopType.RESPONSE:
      case EnvelopType.ERROR:
        this._handleResponse(buffer, type)
        break
    }
  }
  
  _handleResponse (buffer, type) {
    let { socket, requests } = _private.get(this)
    
    // Use Envelope for zero-copy reading
    const envelope = new Envelope(buffer)
    
    const request = requests.get(envelope.id)
    if (!request) {
       this.debug && socket.logger?.warn(`[Protocol] Response ${envelope.id} probably timed out`)
       return
    }
    
    clearTimeout(request.timeout)
    requests.delete(envelope.id)
    
    // Deserialize response data (lazy - only if data exists)
    const data = envelope.data
    
    type === EnvelopType.ERROR ? request.reject(data) : request.resolve(data)
  }
  
  _handleRequest (buffer) {
    let { socket, requestEmitter, config } = _private.get(this)
    
    // Use Envelope for zero-copy reading (all fields lazy including data)
    const envelope = new Envelope(buffer)
    
    // Get matching handlers
    const handlers = requestEmitter.getMatchingListeners(envelope.event)
    
    if (handlers.length === 0) {
      // No handler - send error response
      this._sendErrorResponse(envelope, `No handler for request: ${envelope.event}`)
      return
    }
    
    // ============================================================================
    // PERFORMANCE OPTIMIZATION: Fast path for single handler (90% of requests)
    // ============================================================================
    if (handlers.length === 1) {
      this._executeSingleHandler(handlers[0], envelope)
      return
    }
    
    // ============================================================================
    // MIDDLEWARE CHAIN: Multiple handlers (10% of requests)
    // ============================================================================
    this._executeMiddlewareChain(handlers, envelope)
  }
  
  /**
   * Execute single handler (fast path - no middleware overhead)
   * @private
   */
  _executeSingleHandler (handler, envelope) {
    let { socket, config } = _private.get(this)
    let replyCalled = false
    
    // Reply function
    const reply = (responseData) => {
      if (replyCalled) return
      replyCalled = true
      
      const responseBuffer = Envelope.createBuffer({
        type: EnvelopType.RESPONSE,
        id: envelope.id,
        data: responseData,
        owner: socket.getId(),
        recipient: envelope.owner
      }, config.BUFFER_STRATEGY)
      socket.sendBuffer(responseBuffer, envelope.owner)
    }
    
    // Reply error function
    reply.error = (error) => {
      if (replyCalled) return
      replyCalled = true
      
      const errorData = typeof error === 'object' && error !== null
        ? {
            message: error.message || 'Handler error',
            code: error.code || 'HANDLER_ERROR',
            stack: config.DEBUG ? error.stack : undefined
          }
        : { message: String(error), code: 'HANDLER_ERROR' }
      
      const errorBuffer = Envelope.createBuffer({
        type: EnvelopType.ERROR,
        id: envelope.id,
        data: errorData,
        owner: socket.getId(),
        recipient: envelope.owner
      }, config.BUFFER_STRATEGY)
      socket.sendBuffer(errorBuffer, envelope.owner)
    }
    
    try {
      const result = handler(envelope, reply)
      
      if (result !== undefined && !replyCalled) {
        Promise.resolve(result)
          .then((responseData) => reply(responseData))
          .catch((err) => reply.error(err))
      }
    } catch (err) {
      reply.error(err)
    }
  }
  
  /**
   * Execute middleware chain (inline, closure-based - zero allocation overhead)
   * @private
   */
  _executeMiddlewareChain (handlers, envelope) {
    let { socket, config } = _private.get(this)
    let currentIndex = -1
    let replyCalled = false
    
    // Reply function
    const reply = (responseData) => {
      if (replyCalled) {
        this.debug && socket.logger?.warn('[Protocol] Reply already called, ignoring duplicate')
        return
      }
      replyCalled = true
      
      const responseBuffer = Envelope.createBuffer({
        type: EnvelopType.RESPONSE,
        id: envelope.id,
        data: responseData,
        owner: socket.getId(),
        recipient: envelope.owner
      }, config.BUFFER_STRATEGY)
      socket.sendBuffer(responseBuffer, envelope.owner)
    }
    
    // Reply error function
    reply.error = (error) => {
      if (replyCalled) {
        this.debug && socket.logger?.warn('[Protocol] Reply already called, ignoring duplicate')
        return
      }
      replyCalled = true
      
      const errorData = typeof error === 'object' && error !== null
        ? {
            message: error.message || 'Handler error',
            code: error.code || 'HANDLER_ERROR',
            stack: config.DEBUG ? error.stack : undefined
          }
        : { message: String(error), code: 'HANDLER_ERROR' }
      
      const errorBuffer = Envelope.createBuffer({
        type: EnvelopType.ERROR,
        id: envelope.id,
        data: errorData,
        owner: socket.getId(),
        recipient: envelope.owner
      }, config.BUFFER_STRATEGY)
      socket.sendBuffer(errorBuffer, envelope.owner)
    }
    
    // Handle error - find error handler or send error response
    const handleError = (error) => {
      if (replyCalled) return
      
      // Find next error handler (4 params)
      for (let i = currentIndex + 1; i < handlers.length; i++) {
        if (handlers[i].length === 4) {
          currentIndex = i
          try {
            handlers[i](error, envelope, reply, next)
          } catch (err) {
            reply.error(err)
          }
          return
        }
      }
      
      // No error handler found - send error response
      reply.error(error)
    }
    
    // Execute handler
    const executeHandler = (handler) => {
      try {
        const arity = handler.length
        
        // Skip error handlers (only called via next(error))
        if (arity === 4) {
          next()
          return
        }
        
        let result
        
        if (arity === 3) {
          // Manual control: (envelope, reply, next)
          result = handler(envelope, reply, next)
        } else {
          // Auto-continue: (envelope, reply)
          result = handler(envelope, reply)
        }
        
        // Debug log for async handlers
        this.debug && socket.logger?.debug('[Middleware] Handler executed', {
          arity,
          resultType: result === undefined ? 'undefined' : (result && result.then ? 'Promise' : typeof result),
          replyCalled,
          handlerIndex: currentIndex,
          totalHandlers: handlers.length
        })
        
        
        // Handle return values
        // Special case: If result is a Promise and handler is 2-param (auto-continue),
        // we need to check if the promise resolves to undefined (meaning no response)
        if (result !== undefined && !replyCalled) {
          // Check if it's a promise
          if (result && typeof result.then === 'function') {
            Promise.resolve(result)
              .then((responseData) => {
                if (!replyCalled) {
                  // If async function returned undefined and it's a 2-param handler,
                  // continue to next handler instead of sending undefined response
                  if (responseData === undefined && arity !== 3) {
                    this.debug && socket.logger?.debug('[Middleware] Async 2-param handler returned undefined, auto-continuing')
                    setImmediate(next)
                  } else {
                    // Send the response data
                    reply(responseData)
                  }
                }
              })
              .catch((err) => handleError(err))
          } else {
            // Synchronous return value - send immediately
            reply(result)
          }
        } else if (arity !== 3 && !replyCalled) {
          // Auto-continue for 2-param handlers that returned undefined
          setImmediate(next)
        }
        // For 3-param handlers, wait for explicit next() call
        
      } catch (err) {
        handleError(err)
      }
    }
    
    // Next function
    const next = (error) => {
      if (replyCalled) return
      
      if (error) {
        handleError(error)
        return
      }
      
      currentIndex++
      
      if (currentIndex >= handlers.length) {
        if (!replyCalled) {
          reply.error(new Error('No handler sent a response'))
        }
        return
      }
      
      executeHandler(handlers[currentIndex])
    }
    
    // Start the chain
    next()
  }
  
  /**
   * Helper: Send error response
   * @private
   */
  _sendErrorResponse (envelope, message) {
    let { socket, config } = _private.get(this)
    
    const errorBuffer = Envelope.createBuffer({
      type: EnvelopType.ERROR,
      id: envelope.id,
      data: { message, code: 'NO_HANDLER' },
      owner: socket.getId(),
      recipient: envelope.owner
    }, config.BUFFER_STRATEGY)
    socket.sendBuffer(errorBuffer, envelope.owner)
  }
  
  _handleTick (buffer) {
    let { tickEmitter } = _private.get(this)
    
    // Use Envelope for zero-copy reading (all fields lazy including data)
    const envelope = new Envelope(buffer)
    
    // ✅ NO SECURITY WARNING NEEDED
    // System events are now architecturally prevented from public API (tick())
    // If we receive a system event, it's from legitimate internal sources:
    // 1. Our own Client/Server using _sendSystemTick() (trusted)
    // 2. Remote Client/Server handshake (legitimate protocol operation)
    // Users cannot send system events through public API - it throws INVALID_EVENT
    
    // Execute tick handler (fire-and-forget)
    // Handler signature: (envelope)
    // - envelope: full envelope object with envelope.data, envelope.event, etc.
    tickEmitter.emit(envelope.event, envelope)
  }
  
  // ============================================================================
  // PROTECTED API (for subclasses Client/Server)
  // ============================================================================
  
  _getSocket () {
    let { socket } = _private.get(this)
    return socket
  }
  
  _getPrivateScope () {
    return _private.get(this)
  }

  /**
   * Detach protocol-managed transport listeners from the socket.
   * Safe to call multiple times.
   * @private
   */
  _detachSocketEventHandlers (socket) {
    if (!socket || typeof socket.removeAllListeners !== 'function') return
    try {
      socket.removeAllListeners(TransportEvent.MESSAGE)
      socket.removeAllListeners(TransportEvent.READY)
      socket.removeAllListeners(TransportEvent.NOT_READY)
      socket.removeAllListeners(TransportEvent.CLOSED)
      socket.removeAllListeners(TransportEvent.ERROR)
    } catch {
      this.debug && socket.logger?.error('[Protocol] Failed to detach transport event listeners')
    }
  }

  /**
   * Disconnect protocol from transport events without closing or rejecting pending.
   * - Idempotent: safe to call multiple times
   * - Does NOT set closed flag
   * - Does NOT reject pending requests
   * - Does NOT close underlying transport
   */
  async disconnect () {
    let { socket } = _private.get(this)
    await socket.disconnect();
  }

  /**
   * Unbind protocol from transport events without closing or rejecting pending.
   * - Idempotent: safe to call multiple times
   * - Does NOT set closed flag
   * - Does NOT reject pending requests
   * - Does NOT close underlying transport
   */

  async unbind () {
    let { socket } = _private.get(this)
    // Keep socket event handlers attached so further transport events (e.g., CLOSED)
    // still propagate through Protocol to consumers. Just unbind transport here.
    await socket.unbind();
  }

  /**
   * Close the protocol and cleanup resources.
   * - Idempotent
   * - Detaches protocol-attached socket listeners
   * - Rejects and clears pending requests
   * - Optionally closes the underlying transport
   * 
   * @param {boolean} [closeTransport=false] - Whether to close the socket
   */
  async close (closeTransport = false) {
    let _scope = _private.get(this)
    const { socket, closed } = _scope
    
    if (closed) return
    _scope.closed = true
    
    // Reject all in-flight requests
    this._rejectPendingRequests('Protocol closed')
    
    // Optionally close transport
    if (closeTransport && socket && typeof socket.close === 'function') {
      try {
        await socket.close()
      } catch {
        this.debug && socket.logger?.error('[Protocol] Failed to close transport')
      }
    }
    
    // Detach protocol-managed transport listeners after close to allow CLOSED to propagate
    this._detachSocketEventHandlers(socket)
  }
}
