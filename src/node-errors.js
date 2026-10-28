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
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',                   // Target node not found in routing table
  NO_NODES_MATCH_FILTER: 'NO_NODES_MATCH_FILTER',     // Filter matched zero nodes
  INVALID_ADDRESS: 'INVALID_ADDRESS',                 // Invalid or missing address
  PREDICATE_NOT_ROUTABLE: 'PREDICATE_NOT_ROUTABLE',   // Predicate filters cannot be forwarded to router
  CONNECT_CANCELLED: 'CONNECT_CANCELLED',             // connect() was cancelled by disconnect()/close() mid-handshake
  PROXY_HOP_LIMIT: 'PROXY_HOP_LIMIT',                 // Proxy path reached Globals.PROXY_MAX_HOPS
  PROXY_DEADLINE_EXCEEDED: 'PROXY_DEADLINE_EXCEEDED'  // No time budget left to forward a proxy request
}

/**
 * Marks a routing miss this node produced itself while searching routers for
 * a proxied message (nothing was delivered). Never set from a peer's reply.
 * @private
 */
// Symbol.for (global registry) on purpose: several zeronode copies may run in
// one process (nested node_modules) and must recognise each other's markers.
// The cross-process guarantee comes from Router: only its serializer puts a
// miss marker on the wire.
export const kProxyMiss = Symbol.for('zeronode.proxyMiss')

/**
 * The routing data a Router attaches to its own miss replies. Only this key
 * is serialized into an error reply's `routing` field, so an error thrown by
 * a request handler can never be taken for a routing miss.
 * @private
 */
export const kProxyReplyRouting = Symbol.for('zeronode.proxyReplyRouting')

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

/**
 * Assert that address is valid
 * @param {string} address - Address to validate
 * @throws {NodeError} If address is invalid
 */
export function assertValidAddress (address) {
  if (!address || typeof address !== 'string') {
    throw new NodeError({
      code: NodeErrorCode.INVALID_ADDRESS,
      message: `Invalid address: ${address}`,
      context: { address }
    })
  }
}

export default {
  NodeError,
  NodeErrorCode,
  assertValidAddress
}

