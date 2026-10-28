/**
 * Message Dispatcher
 * 
 * **What**: Routes incoming messages to appropriate handlers (request/tick/response)
 * **Why**: Single responsibility for message routing and handler registry
 * **Clean separation**: Message routing ↔ Handler execution
 */

import { PatternEmitter } from '@sfast/pattern-emitter-ts'
import { Envelope, EnvelopType } from './envelope.js'
import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'
import { ProtocolEvent } from './lifecycle.js'

export class MessageDispatcher {
  constructor(context, requestTracker, handlerExecutor) {
    this.ctx = context
    this.requestTracker = requestTracker
    this.handlerExecutor = handlerExecutor
    
    // Handler registries (PatternEmitter for pattern matching)
    this.requestEmitter = new PatternEmitter()
    this.tickEmitter = new PatternEmitter()
  }
  
  /**
   * Dispatch incoming message based on envelope type
   * Routes to appropriate handler: REQUEST → handlers, TICK → handlers, RESPONSE → tracker
   * 
   * @param {Buffer} buffer - Raw message buffer
   * @param {string} sender - Sender ID (optional, for router)
   */
  dispatch(buffer, sender) {
    // Never let a malformed buffer or a handler failure escape: the caller is the
    // transport's receive loop, and an exception there stops all further receives.
    let envelope
    let type
    try {
      // Create envelope (lazy parsing - only reads type initially)
      envelope = new Envelope(buffer)
      type = envelope.type
    } catch (err) {
      this._reportError(ProtocolErrorCode.INVALID_ENVELOPE, `Malformed incoming message: ${err?.message ?? err}`, err)
      return
    }
    
    try {
      switch (type) {
        case EnvelopType.REQUEST:
          this._handleRequest(envelope)
          break
        
        case EnvelopType.TICK:
          this._handleTick(envelope)
          break
        
        case EnvelopType.RESPONSE:
          this._handleResponse(envelope, false)
          break
        
        case EnvelopType.ERROR:
          this._handleResponse(envelope, true)
          break
        
        default:
          this.ctx.debug && this.ctx.logger?.warn(
            `[MessageDispatcher] Unknown envelope type: ${type}`
          )
      }
    } catch (err) {
      this._reportError(ProtocolErrorCode.HANDLER_ERROR, `Failed to dispatch incoming message: ${err?.message ?? err}`, err)
    }
  }
  
  /**
   * Handle incoming request
   * Looks up matching handlers and delegates to executor
   * 
   * @private
   * @param {Envelope} envelope - Request envelope
   */
  _handleRequest(envelope) {
    const handlers = this.requestEmitter.getMatchingListeners(envelope.event)
    
    this.ctx.debug && this.ctx.logger?.debug(
      `[MessageDispatcher] Request '${envelope.event}' matched ${handlers.length} handler(s)`
    )
    
    this.handlerExecutor.execute(envelope, handlers)
  }
  
  /**
   * Handle incoming tick (fire-and-forget)
   * Direct emission - no response expected
   * 
   * @private
   * @param {Envelope} envelope - Tick envelope
   */
  _handleTick(envelope) {
    this.ctx.debug && this.ctx.logger?.debug(
      `[MessageDispatcher] Tick '${envelope.event}' received`
    )
    
    // Fire and forget - call each handler in isolation so one failing handler
    // neither skips the others nor escapes into the receive loop.
    // Handler signature: (envelope)
    // Note: getMatchingListeners returns original functions, so a string
    // listener registered with tickEmitter.once() would not be removed here.
    // onTick() only uses .on(), so no such listener exists.
    const handlers = this.tickEmitter.getMatchingListeners(envelope.event)

    for (const handler of handlers) {
      try {
        const result = handler.call(this.tickEmitter, envelope)
        if (result && typeof result.then === 'function') {
          result.then(null, (err) => this._reportTickHandlerError(envelope, err))
        }
      } catch (err) {
        this._reportTickHandlerError(envelope, err)
      }
    }
  }

  /**
   * @private
   */
  _reportTickHandlerError(envelope, err) {
    this._reportError(
      ProtocolErrorCode.HANDLER_ERROR,
      `Tick handler for '${envelope.event}' failed: ${err?.message ?? err}`,
      err,
      { event: envelope.event, owner: envelope.owner },
      envelope.id
    )
  }

  /**
   * Surface an incoming-message failure as ProtocolEvent.ERROR
   * @private
   */
  _reportError(code, message, cause, context, envelopeId) {
    const error = new ProtocolError({
      code,
      message,
      protocolId: this.ctx.protocolId,
      envelopeId,
      cause: cause instanceof Error ? cause : undefined,
      context
    })

    this.ctx.debug && this.ctx.logger?.error(`[MessageDispatcher] ${message}`)

    try {
      this.ctx.protocol?.emit?.(ProtocolEvent.ERROR, error)
    } catch (emitErr) {
      // A throwing error listener must not break the receive path either
      this.ctx.logger?.error(`[MessageDispatcher] Error listener failed: ${emitErr.message}`)
    }
  }
  
  /**
   * Handle incoming response/error
   * Matches to pending request in tracker
   * 
   * @private
   * @param {Envelope} envelope - Response envelope
   * @param {boolean} isError - Is this an error response?
   */
  _handleResponse(envelope, isError) {
    const matched = this.requestTracker.match(envelope.id, envelope.data, isError)
    
    if (!matched) {
      this.ctx.debug && this.ctx.logger?.warn(
        `[MessageDispatcher] Response ${envelope.id} could not be matched (probably timed out)`
      )
    }
  }
  
  // ============================================================================
  // HANDLER REGISTRATION API
  // ============================================================================
  
  /**
   * Register request handler
   * Supports string patterns, RegExp, and wildcards
   * 
   * @param {string|RegExp} pattern - Event pattern to match
   * @param {Function} handler - Handler function (envelope, reply) or (envelope, reply, next)
   */
  onRequest(pattern, handler) {
    this.requestEmitter.on(pattern, handler)
    
    this.ctx.debug && this.ctx.logger?.debug(
      `[MessageDispatcher] Registered request handler for pattern: ${pattern}`
    )
  }
  
  /**
   * Unregister request handler
   * 
   * @param {string|RegExp} pattern - Event pattern
   * @param {Function} handler - Handler to remove
   */
  offRequest(pattern, handler) {
    this.requestEmitter.off(pattern, handler)
    
    this.ctx.debug && this.ctx.logger?.debug(
      `[MessageDispatcher] Unregistered request handler for pattern: ${pattern}`
    )
  }
  
  /**
   * Register tick handler
   * Supports string patterns, RegExp, and wildcards
   * 
   * @param {string|RegExp} pattern - Event pattern to match
   * @param {Function} handler - Handler function (envelope)
   */
  onTick(pattern, handler) {
    this.tickEmitter.on(pattern, handler)
    
    this.ctx.debug && this.ctx.logger?.debug(
      `[MessageDispatcher] Registered tick handler for pattern: ${pattern}`
    )
  }
  
  /**
   * Unregister tick handler
   * If no handler provided, removes all handlers for pattern
   * 
   * @param {string|RegExp} pattern - Event pattern
   * @param {Function} [handler] - Handler to remove (optional)
   */
  offTick(pattern, handler) {
    if (handler) {
      this.tickEmitter.off(pattern, handler)
    } else {
      this.tickEmitter.removeAllListeners(pattern)
    }
    
    this.ctx.debug && this.ctx.logger?.debug(
      `[MessageDispatcher] Unregistered tick handler(s) for pattern: ${pattern}`
    )
  }
  
  /**
   * Get matching request handlers for an event
   * Useful for testing/debugging
   * 
   * @param {string} event - Event name
   * @returns {Function[]} Matching handlers
   */
  getRequestHandlers(event) {
    return this.requestEmitter.getMatchingListeners(event)
  }
  
  /**
   * Get matching tick handlers for an event
   * Useful for testing/debugging
   * 
   * @param {string} event - Event name
   * @returns {Function[]} Matching handlers
   */
  getTickHandlers(event) {
    return this.tickEmitter.getMatchingListeners(event)
  }
  
  /**
   * Remove all handlers (used during cleanup)
   * Clears both request and tick handlers
   */
  removeAllHandlers() {
    this.requestEmitter.removeAllListeners()
    this.tickEmitter.removeAllListeners()
    
    this.ctx.debug && this.ctx.logger?.debug('[MessageDispatcher] Removed all handlers')
  }
}

