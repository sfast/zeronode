/**
 * ZeroMQ Context Management - Simplified
 * 
 * Creates ZeroMQ contexts with specified I/O threads.
 * Contexts are cached and reused for efficiency.
 * 
 * Note: In ZeroMQ v6, contexts are auto-managed by the library.
 * No explicit termination is needed - contexts are cleaned up automatically
 * when they go out of scope and all sockets are closed.
 */

import * as zmq from 'zeromq'

/**
 * Context cache to avoid creating duplicate contexts
 * Key: ioThreads count
 * Value: ZeroMQ Context instance
 */
const contextCache = new Map()

/**
 * Create or get cached ZeroMQ context with specified I/O threads
 * 
 * @param {number} ioThreads - Number of I/O threads (1-16)
 * @returns {zmq.Context} ZeroMQ context
 */
export function createContext (ioThreads) {
  // Return cached context if exists
  if (contextCache.has(ioThreads)) {
    return contextCache.get(ioThreads)
  }

  // Create new context
  const context = new zmq.Context({
    ioThreads,
    maxSockets: 1024
  })

  // Cache for reuse
  contextCache.set(ioThreads, context)

  return context
}

export default {
  createContext
}
