/**
 * Transport Layer Errors
 * 
 * Transport-specific errors that are independent of implementation.
 * These errors represent failures at the transport layer (connection, binding, sending).
 * 
 * Design:
 * - Transport-agnostic (works with ZeroMQ, NATS, WebSocket, HTTP, etc.)
 * - String error codes (more maintainable than numeric)
 * - Rich context (transportId, address, cause)
 * - Serializable (toJSON for logging/debugging)
 */

/**
 * Transport error codes
 * These represent failures at the transport layer (network, sockets, connections)
 */
export const TransportErrorCode = {
  // Connection errors (client/dealer)
  CONNECTION_TIMEOUT: 'TRANSPORT_CONNECTION_TIMEOUT',     // Connection attempt timed out
  ALREADY_CONNECTED: 'TRANSPORT_ALREADY_CONNECTED',       // Already connected to this address
  
  // Binding errors (server/router)
  BIND_FAILED: 'TRANSPORT_BIND_FAILED',                   // Failed to bind to address
  ALREADY_BOUND: 'TRANSPORT_ALREADY_BOUND',               // Already bound to an address
  UNBIND_FAILED: 'TRANSPORT_UNBIND_FAILED',               // Failed to unbind
  
  // Send/Receive errors
  SEND_FAILED: 'TRANSPORT_SEND_FAILED',                   // Failed to send message (offline, HWM, error)
  RECEIVE_FAILED: 'TRANSPORT_RECEIVE_FAILED',             // Failed to receive message (socket error, iterator error)
  
  // Address errors
  INVALID_ADDRESS: 'TRANSPORT_INVALID_ADDRESS',           // Invalid address format
  ADDRESS_REQUIRED: 'TRANSPORT_ADDRESS_REQUIRED',         // Address not provided
  
  // Lifecycle errors
  CLOSE_FAILED: 'TRANSPORT_CLOSE_FAILED'                  // Failed to close cleanly
}

/**
 * TransportError - Transport-level error class
 * 
 * Represents errors that occur at the transport layer.
 * Transport-agnostic - works with any transport implementation (ZeroMQ, NATS, WebSocket, etc.)
 * 
 * @example
 * throw new TransportError({
 *   code: TransportErrorCode.SEND_FAILED,
 *   message: 'Cannot send - transport is offline',
 *   transportId: 'dealer-123',
 *   address: 'tcp://127.0.0.1:5000',
 *   cause: originalError
 * })
 */
export class TransportError extends Error {
  /**
   * @param {Object} params
   * @param {string} params.code - Transport error code (from TransportErrorCode)
   * @param {string} params.message - Human-readable error message
   * @param {string} [params.transportId] - Transport/socket ID
   * @param {string} [params.address] - Address involved in the error
   * @param {Error} [params.cause] - Original error that caused this error (for chaining)
   * @param {Object} [params.context] - Additional context data
   */
  constructor ({ code, message, transportId, address, cause, context } = {}) {
    super(message || code)
    
    this.name = 'TransportError'
    this.code = code
    this.transportId = transportId
    this.address = address
    this.cause = cause
    this.context = context || {}
    
    // Capture stack trace (Node.js specific)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransportError)
    }
  }
  
  /**
   * Convert to plain object for serialization
   * Useful for logging, debugging, and error transmission
   * 
   * @returns {Object} Plain object representation
   */
  toJSON () {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      transportId: this.transportId,
      address: this.address,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        code: this.cause.code,
        stack: this.cause.stack
      } : undefined,
      context: this.context,
      stack: this.stack
    }
  }
  
  /**
   * Check if this error is of a specific code
   * 
   * @param {string} code - Error code to check
   * @returns {boolean}
   */
  isCode (code) {
    return this.code === code
  }
  
  /**
   * Check if this is a connection-related error
   * 
   * @returns {boolean}
   */
  isConnectionError () {
    return this.code === TransportErrorCode.CONNECTION_TIMEOUT ||
           this.code === TransportErrorCode.ALREADY_CONNECTED
  }
  
  /**
   * Check if this is a binding-related error
   * 
   * @returns {boolean}
   */
  isBindError () {
    return this.code === TransportErrorCode.BIND_FAILED ||
           this.code === TransportErrorCode.ALREADY_BOUND ||
           this.code === TransportErrorCode.UNBIND_FAILED
  }
  
  /**
   * Check if this is a send-related error
   * 
   * @returns {boolean}
   */
  isSendError () {
    return this.code === TransportErrorCode.SEND_FAILED
  }
}

export default {
  TransportError,
  TransportErrorCode
}
