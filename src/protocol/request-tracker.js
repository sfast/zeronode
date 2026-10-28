/**
 * Request Tracker
 * 
 * **What**: Manages pending outgoing requests, timeouts, and response matching
 * **Why**: Single responsibility for request/response state management
 * **Testability**: Can be unit tested with simple mocks (no socket dependencies)
 */

import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'

export class RequestTracker {
  constructor(context) {
    this.ctx = context
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
   * @param {string} [handlers.to] - Recipient (lets rejectForPeer find it)
   * @returns {string} requestId (for chaining)
   */
  track(requestId, { resolve, reject, timeout, to }) {
    const timeoutMs = timeout || this.ctx.config.PROTOCOL_REQUEST_TIMEOUT
    
    const timer = setTimeout(() => {
      this._handleTimeout(requestId, timeoutMs)
    }, timeoutMs)
    
    this.requests.set(requestId, { 
      resolve, 
      reject, 
      timer,
      to,
      sendSettled: false,   // outcome of the transport send not known yet
      peerLeftError: null,  // peer left while the send was unsettled
      startTime: Date.now()
    })
    
    this.ctx.debug && this.ctx.logger?.debug(
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
      this.ctx.debug && this.ctx.logger?.warn(
        `[RequestTracker] Response for unknown request: ${envelopeId} (probably timed out)`
      )
      return false
    }
    
    clearTimeout(request.timer)
    this.requests.delete(envelopeId)
    
    const duration = Date.now() - request.startTime
    this.ctx.debug && this.ctx.logger?.debug(
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
    
    this.ctx.debug && this.ctx.logger?.warn(
      `[RequestTracker] Request ${requestId} timed out after ${timeoutMs}ms`
    )
    
    request.reject(new ProtocolError({
      code: ProtocolErrorCode.REQUEST_TIMEOUT,
      message: `Request ${requestId} timed out after ${timeoutMs}ms`,
      protocolId: this.ctx.protocolId,
      envelopeId: requestId,
      context: { timeout: timeoutMs }
    }))
  }
  
  /**
   * Fail one pending request (e.g. its send failed)
   * Clears its timer and rejects it with `error`
   * 
   * @param {string} requestId - Request to fail
   * @param {Error} error - Rejection error
   * @returns {boolean} true if it was pending
   */
  fail(requestId, error) {
    const request = this.requests.get(requestId)
    if (!request) return false
    
    clearTimeout(request.timer)
    this.requests.delete(requestId)
    request.reject(error)
    return true
  }
  
  /**
   * The transport accepted the request's message (queued for the peer).
   * If the peer left in the meantime, reject with that now.
   * 
   * @param {string} requestId
   */
  markSent(requestId) {
    const request = this.requests.get(requestId)
    if (!request) return
    
    request.sendSettled = true
    if (request.peerLeftError) {
      this.fail(requestId, request.peerLeftError)
    }
  }
  
  /**
   * Reject the pending requests sent to one peer (it left or is unreachable).
   * A request whose own send has not settled yet is left to its send outcome:
   * refused → it fails as "not delivered"; accepted → it fails with this error.
   * That keeps "not delivered" (safe to send elsewhere) distinguishable from
   * "may have been delivered".
   * 
   * @param {string} peerId - Recipient whose requests to reject
   * @param {Object} params
   * @param {string} params.code - ProtocolErrorCode for the rejection
   * @param {string} params.message - Rejection message
   * @returns {number} Number of requests rejected
   */
  rejectForPeer(peerId, { code, message }) {
    let count = 0
    
    this.requests.forEach((request, id) => {
      if (request.to !== peerId) return
      const error = new ProtocolError({
        code,
        message,
        protocolId: this.ctx.protocolId,
        envelopeId: id,
        context: { peerId }
      })
      count++
      
      if (!request.sendSettled) {
        request.peerLeftError = error
        return
      }
      
      clearTimeout(request.timer)
      this.requests.delete(id)
      request.reject(error)
    })
    
    if (count > 0) {
      this.ctx.debug && this.ctx.logger?.warn(
        `[RequestTracker] Rejected ${count} pending request(s) to '${peerId}': ${message}`
      )
    }
    
    return count
  }
  
  /**
   * Reject all pending requests (used during close/disconnect)
   * Clears all timeout timers
   * 
   * @param {string} reason - Rejection reason
   * @param {string} [code] - ProtocolErrorCode (default REQUEST_TIMEOUT, as before)
   */
  rejectAll(reason, code = ProtocolErrorCode.REQUEST_TIMEOUT) {
    if (this.requests.size === 0) return
    
    this.ctx.debug && this.ctx.logger?.warn(
      `[RequestTracker] Rejecting ${this.requests.size} pending requests: ${reason}`
    )
    
    this.requests.forEach((request, id) => {
      clearTimeout(request.timer)
      request.reject(new ProtocolError({
        code,
        message: reason,
        protocolId: this.ctx.protocolId,
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

