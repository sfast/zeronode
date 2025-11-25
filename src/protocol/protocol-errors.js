/**
 * Protocol Layer Errors
 * 
 * Protocol-specific errors that are independent of transport implementation.
 * These errors represent protocol-level failures in request/response semantics.
 */

/**
 * Protocol error codes
 * These represent failures at the protocol layer (request/response, timeouts, etc.)
 */
export const ProtocolErrorCode = {
  NOT_READY: 'PROTOCOL_NOT_READY',           // Protocol not ready to send (transport not available)
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',        // Request timed out waiting for response
  INVALID_ENVELOPE: 'INVALID_ENVELOPE',      // Malformed or invalid envelope
  INVALID_RESPONSE: 'INVALID_RESPONSE',      // Response doesn't match any pending request
  INVALID_EVENT: 'INVALID_EVENT',            // Invalid event name (e.g., system event from public API)
  HANDLER_ERROR: 'HANDLER_ERROR'             // Handler threw an error
}

/**
 * ProtocolError - Protocol-level error class
 * 
 * Represents errors that occur at the protocol layer, independent of transport.
 * Contains protocol-specific context like envelope IDs and protocol IDs.
 */
export class ProtocolError extends Error {
  /**
   * @param {Object} params
   * @param {string} params.code - Protocol error code (from ProtocolErrorCode)
   * @param {string} params.message - Error message
   * @param {string} [params.protocolId] - Protocol instance ID
   * @param {bigint} [params.envelopeId] - Envelope ID that caused the error
   * @param {Error} [params.cause] - Original error that caused this error
   * @param {Object} [params.context] - Additional context (envelope data, etc.)
   */
  constructor ({ code, message, protocolId, envelopeId, cause, context } = {}) {
    super(message || code)
    
    this.name = 'ProtocolError'
    this.code = code
    this.protocolId = protocolId
    this.envelopeId = envelopeId
    this.cause = cause
    this.context = context || {}
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProtocolError)
    }
  }
  
  /**
   * Convert to plain object for serialization
   */
  toJSON () {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      protocolId: this.protocolId,
      envelopeId: this.envelopeId ? String(this.envelopeId) : undefined,
      cause: this.cause ? {
        message: this.cause.message,
        stack: this.cause.stack
      } : undefined,
      context: this.context,
      stack: this.stack
    }
  }
}

export default {
  ProtocolError,
  ProtocolErrorCode
}

