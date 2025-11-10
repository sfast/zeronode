/**
 * Node Layer Errors
 * 
 * Node-specific errors for routing and orchestration.
 * These represent failures at the node orchestration layer.
 */

/**
 * Node error codes
 */
export const NodeErrorCode = {
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',               // Target node not found in routing table
  NO_NODES_MATCH_FILTER: 'NO_NODES_MATCH_FILTER', // Filter matched zero nodes
  ROUTING_FAILED: 'ROUTING_FAILED',               // Routing logic failed
  DUPLICATE_CONNECTION: 'DUPLICATE_CONNECTION',   // Already connected to this address
  SERVER_NOT_INITIALIZED: 'SERVER_NOT_INITIALIZED' // Server required but not created
}

/**
 * NodeError - Node orchestration error class
 * 
 * Represents errors that occur at the node orchestration layer.
 */
export class NodeError extends Error {
  /**
   * @param {Object} params
   * @param {string} params.code - Node error code
   * @param {string} params.message - Error message
   * @param {string} [params.nodeId] - Source/target node ID
   * @param {Error} [params.cause] - Original error
   * @param {Object} [params.context] - Additional context
   */
  constructor ({ code, message, nodeId, cause, context } = {}) {
    super(message || code)
    
    this.name = 'NodeError'
    this.code = code
    this.nodeId = nodeId
    this.cause = cause
    this.context = context || {}
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NodeError)
    }
  }
  
  toJSON () {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      nodeId: this.nodeId,
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
  NodeError,
  NodeErrorCode
}

