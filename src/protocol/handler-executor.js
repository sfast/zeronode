/**
 * Handler Executor
 * 
 * **What**: Executes request handlers (single handler fast path + middleware chains)
 * **Why**: Isolates complex middleware logic, optimized for performance
 * **Performance**: Fast path for single handler (90% of cases), full middleware for multi-handler
 */

import { Envelope, EnvelopType } from './envelope.js'

export class HandlerExecutor {
  constructor(context) {
    this.ctx = context
  }
  
  /**
   * Execute handlers for incoming request
   * Routes to fast path (single handler) or middleware chain (multiple handlers)
   * 
   * @param {Envelope} envelope - Incoming request envelope
   * @param {Function[]} handlers - Matching handlers
   */
  execute(envelope, handlers) {
    if (handlers.length === 0) {
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
   * Fast path: Execute single handler
   * No middleware overhead - optimized for performance
   * 
   * @private
   * @param {Function} handler - Handler function
   * @param {Envelope} envelope - Request envelope
   */
  _executeSingleHandler(handler, envelope) {
    let replyCalled = false
    
    // Create reply functions
    const reply = (responseData) => {
      if (replyCalled) return
      replyCalled = true
      this._sendResponse(envelope, responseData)
    }
    
    reply.error = (error) => {
      if (replyCalled) return
      replyCalled = true
      this._sendErrorResponse(envelope, error)
    }
    
    try {
      const result = handler(envelope, reply)
      
      // Handle return values
      if (result !== undefined && !replyCalled) {
        Promise.resolve(result)
          .then((responseData) => {
            if (!replyCalled) {
              replyCalled = true
              this._sendResponse(envelope, responseData)
            }
          })
          .catch((err) => {
            if (!replyCalled) {
              replyCalled = true
              this._sendErrorResponse(envelope, err)
            }
          })
      }
    } catch (err) {
      if (!replyCalled) {
        replyCalled = true
        this._sendErrorResponse(envelope, err)
      }
    }
  }
  
  /**
   * Middleware chain: Execute multiple handlers with next()
   * Supports 2-param (auto-continue), 3-param (manual next), and 4-param (error handlers)
   * 
   * @private
   * @param {Function[]} handlers - Array of middleware handlers
   * @param {Envelope} envelope - Request envelope
   */
  _executeMiddlewareChain(handlers, envelope) {
    let currentIndex = -1
    let replyCalled = false
    
    // Create reply functions
    const reply = (responseData) => {
      if (replyCalled) {
        this.ctx.debug && this.ctx.logger?.warn('[HandlerExecutor] Reply already called, ignoring duplicate')
        return
      }
      replyCalled = true
      this._sendResponse(envelope, responseData)
    }
    
    reply.error = (error) => {
      if (replyCalled) {
        this.ctx.debug && this.ctx.logger?.warn('[HandlerExecutor] Reply already called, ignoring duplicate')
        return
      }
      replyCalled = true
      this._sendErrorResponse(envelope, error)
    }
    
    // Error handler lookup
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
    
    // Execute current handler
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
        this.ctx.debug && this.ctx.logger?.debug('[Middleware] Handler executed', {
          arity,
          resultType: result === undefined ? 'undefined' : (result && result.then ? 'Promise' : typeof result),
          replyCalled,
          handlerIndex: currentIndex,
          totalHandlers: handlers.length
        })
        
        // Handle return values
        if (result !== undefined && !replyCalled) {
          // Check if it's a promise
          if (result && typeof result.then === 'function') {
            Promise.resolve(result)
              .then((responseData) => {
                if (!replyCalled) {
                  // If async function returned undefined and it's a 2-param handler,
                  // continue to next handler instead of sending undefined response
                  if (responseData === undefined && arity !== 3) {
                    this.ctx.debug && this.ctx.logger?.debug('[Middleware] Async 2-param handler returned undefined, auto-continuing')
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
   * Send success response
   * 
   * @private
   * @param {Envelope} envelope - Request envelope
   * @param {*} data - Response data
   */
  _sendResponse(envelope, data) {
    const buffer = Envelope.createBuffer({
      type: EnvelopType.RESPONSE,
      id: envelope.id,
      data,
      owner: this.ctx.socket.getId(),
      recipient: envelope.owner
    }, this.ctx.config.BUFFER_STRATEGY)
    
    this.ctx.socket.sendBuffer(buffer, envelope.owner)
  }
  
  /**
   * Send error response
   * 
   * @private
   * @param {Envelope} envelope - Request envelope
   * @param {Error|string|Object} error - Error to send
   */
  _sendErrorResponse(envelope, error) {
    const errorData = typeof error === 'object' && error !== null
      ? {
          message: error.message || 'Handler error',
          code: error.code || 'HANDLER_ERROR',
          stack: this.ctx.config.DEBUG ? error.stack : undefined
        }
      : { message: String(error), code: 'HANDLER_ERROR' }
    
    const buffer = Envelope.createBuffer({
      type: EnvelopType.ERROR,
      id: envelope.id,
      data: errorData,
      owner: this.ctx.socket.getId(),
      recipient: envelope.owner
    }, this.ctx.config.BUFFER_STRATEGY)
    
    this.ctx.socket.sendBuffer(buffer, envelope.owner)
  }
}

