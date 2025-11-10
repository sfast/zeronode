/**
 * ZeroMQ Context Management - Simplified
 * 
 * Creates ZeroMQ contexts with specified I/O threads.
 * Contexts are cached and reused for efficiency.
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

/**
 * Terminate a context (use when shutting down)
 * 
 * @param {zmq.Context} context - Context to terminate
 */
export async function terminateContext (context) {
  if (!context) return

  try {
    // Remove from cache
    for (const [key, cachedContext] of contextCache.entries()) {
      if (cachedContext === context) {
        contextCache.delete(key)
        break
      }
    }

    // Close the context
    await context.close()
  } catch (err) {
    console.error('Error terminating ZeroMQ context:', err)
  }
}

export default {
  createContext,
  terminateContext
}
