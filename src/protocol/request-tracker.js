/**
 * Request Tracker
 * 
 * **What**: Manages pending outgoing requests, timeouts, and response matching
 * **Why**: Single responsibility for request/response state management
 * **Testability**: Can be unit tested with simple mocks (no socket dependencies)
 */

import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'

export class RequestTracker {
  constructor({ protocolId, config, debug, logger }) {
    this.protocolId = protocolId
    this.config = config
    this.debug = debug
    this.logger = logger
    this.requests = new Map() // requestId → { resolve, reject, timer, startTime }
  }
  
  /**
   * Track a new outgoing request
   * Creates timeout timer and stores resolve/reject handlers
   * 
   * @param {string} requestId - Unique request ID
   * @param {Object} handlers - Request handlers
   * @param {Function} handlers.resolve - Success callback
   * @param {Function} handlers.reject - Error callback
   * @param {number} [handlers.timeout] - Optional timeout override
   * @returns {string} requestId (for chaining)
   */
  track(requestId, { resolve, reject, timeout }) {
    const timeoutMs = timeout || this.config.PROTOCOL_REQUEST_TIMEOUT
    
    const timer = setTimeout(() => {
      this._handleTimeout(requestId, timeoutMs)
    }, timeoutMs)
    
    this.requests.set(requestId, { 
      resolve, 
      reject, 
      timer,
      startTime: Date.now()
    })
    
    this.debug && this.logger?.debug(
      `[RequestTracker] Tracking request ${requestId} (timeout: ${timeoutMs}ms)`
    )
    
    return requestId
  }
  
  /**
   * Match incoming response to pending request
   * Clears timeout and resolves/rejects the promise
   * 
   * @param {string} envelopeId - Response envelope ID
   * @param {*} data - Response data
   * @param {boolean} [isError=false] - Is this an error response?
   * @returns {boolean} true if matched, false if not found
   */
  match(envelopeId, data, isError = false) {
    const request = this.requests.get(envelopeId)
    
    if (!request) {
      this.debug && this.logger?.warn(
        `[RequestTracker] Response for unknown request: ${envelopeId} (probably timed out)`
      )
      return false
    }
    
    clearTimeout(request.timer)
    this.requests.delete(envelopeId)
    
    const duration = Date.now() - request.startTime
    this.debug && this.logger?.debug(
      `[RequestTracker] Matched response for ${envelopeId} (${duration}ms)`
    )
    
    isError ? request.reject(data) : request.resolve(data)
    return true
  }
  
  /**
   * Internal: Handle request timeout
   * Called when timeout timer fires
   * 
   * @private
   * @param {string} requestId - Request that timed out
   * @param {number} timeoutMs - Timeout duration
   */
  _handleTimeout(requestId, timeoutMs) {
    if (!this.requests.has(requestId)) return
    
    const request = this.requests.get(requestId)
    this.requests.delete(requestId)
    
    this.debug && this.logger?.warn(
      `[RequestTracker] Request ${requestId} timed out after ${timeoutMs}ms`
    )
    
    request.reject(new ProtocolError({
      code: ProtocolErrorCode.REQUEST_TIMEOUT,
      message: `Request ${requestId} timed out after ${timeoutMs}ms`,
      protocolId: this.protocolId,
      envelopeId: requestId,
      context: { timeout: timeoutMs }
    }))
  }
  
  /**
   * Reject all pending requests (used during close/disconnect)
   * Clears all timeout timers
   * 
   * @param {string} reason - Rejection reason
   */
  rejectAll(reason) {
    if (this.requests.size === 0) return
    
    this.debug && this.logger?.warn(
      `[RequestTracker] Rejecting ${this.requests.size} pending requests: ${reason}`
    )
    
    this.requests.forEach((request, id) => {
      clearTimeout(request.timer)
      request.reject(new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: reason,
        protocolId: this.protocolId,
        envelopeId: id
      }))
    })
    
    this.requests.clear()
  }
  
  /**
   * Get count of pending requests
   * Useful for monitoring and debugging
   * 
   * @returns {number} Number of pending requests
   */
  get pendingCount() {
    return this.requests.size
  }
  
  /**
   * Check if a specific request is pending
   * 
   * @param {string} requestId - Request ID to check
   * @returns {boolean} true if pending
   */
  hasPending(requestId) {
    return this.requests.has(requestId)
  }
}

