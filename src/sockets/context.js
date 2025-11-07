/**
 * ZeroMQ Context Management
 * 
 * ZeroMQ contexts manage I/O threads and socket resources.
 * All sockets in the same process should share a context.
 * 
 * Threading Model:
 * - 1 I/O thread:  Good for <10 sockets, <100K msg/s
 * - 2 I/O threads: Good for 10-50 sockets, 100-500K msg/s (servers)
 * - 4 I/O threads: Good for >50 sockets, >500K msg/s (rare)
 * + 1 reaper thread (always present, cleans up closed sockets)
 * 
 * Rule of thumb: 1 I/O thread per gigabit/sec of data
 */

import * as zmq from 'zeromq'

/**
 * Context cache to ensure singleton behavior per configuration
 * Key: ioThreads count
 * Value: ZeroMQ Context instance
 */
const contextCache = new Map()

/**
 * Get or create a ZeroMQ context with specified I/O threads
 * 
 * @param {number} ioThreads - Number of I/O threads (default: 1)
 * @returns {zmq.Context} Shared ZeroMQ context
 * 
 * @example
 * // Client (Dealer) - 1 thread is usually enough
 * const context = getContext(1)
 * 
 * // Server (Router) - 2 threads for better concurrency
 * const context = getContext(2)
 * 
 * // High-throughput server - 4 threads
 * const context = getContext(4)
 */
export function getContext (ioThreads = 1) {
  // Validate input
  if (!Number.isInteger(ioThreads) || ioThreads < 1 || ioThreads > 16) {
    throw new Error(`Invalid ioThreads: ${ioThreads}. Must be integer between 1 and 16.`)
  }

  // Return cached context if exists
  if (contextCache.has(ioThreads)) {
    return contextCache.get(ioThreads)
  }

  // Create new context
  const context = new zmq.Context({
    ioThreads,
    maxSockets: 1024  // Default max sockets per context
  })

  // Cache for reuse
  contextCache.set(ioThreads, context)

  return context
}

/**
 * Default context for general use (1 I/O thread)
 * Good for: clients, low-throughput services
 */
export const defaultContext = getContext(1)

/**
 * Server context (2 I/O threads)
 * Good for: servers handling multiple clients, routers
 * 
 * Why 2 threads for servers?
 * - Router typically handles multiple client connections
 * - Better concurrency for parallel client requests
 * - Allows one thread per direction (send/receive)
 * - Still lightweight (only 3 total threads: 2 I/O + 1 reaper)
 */
export const serverContext = getContext(2)

/**
 * Client context (1 I/O thread)
 * Good for: clients, dealers, single connections
 * 
 * Why 1 thread for clients?
 * - Dealer typically connects to 1-2 servers
 * - Lower resource usage
 * - 1 thread can easily handle 100K+ msg/s
 * - Sufficient for most client use cases
 */
export const clientContext = defaultContext

/**
 * Get context based on socket type and expected load
 * 
 * @param {Object} options
 * @param {string} options.socketType - 'router' or 'dealer'
 * @param {string} options.role - 'server' or 'client'
 * @param {number} options.expectedClients - Expected number of concurrent clients (for routers)
 * @param {number} options.ioThreads - Override with explicit I/O thread count
 * @returns {zmq.Context}
 * 
 * @example
 * // Server router with many clients
 * const ctx = getContextForSocket({ socketType: 'router', role: 'server' })
 * 
 * // Client dealer
 * const ctx = getContextForSocket({ socketType: 'dealer', role: 'client' })
 * 
 * // High-load server
 * const ctx = getContextForSocket({ socketType: 'router', expectedClients: 100 })
 */
export function getContextForSocket ({ 
  socketType, 
  role, 
  expectedClients = 0, 
  ioThreads 
} = {}) {
  // Explicit override
  if (ioThreads !== undefined) {
    return getContext(ioThreads)
  }

  // Router (server) logic
  if (socketType === 'router' || role === 'server') {
    // High load: 4 threads
    if (expectedClients > 50) {
      return getContext(4)
    }
    // Medium load: 2 threads (default for servers)
    return serverContext
  }

  // Dealer (client) logic
  if (socketType === 'dealer' || role === 'client') {
    return clientContext
  }

  // Default: 1 thread
  return defaultContext
}

/**
 * Terminate a context (use with caution!)
 * Only call this when shutting down the entire application
 * 
 * @param {zmq.Context} context - Context to terminate
 */
export async function terminateContext (context) {
  if (!context) return

  try {
    // Find and remove from cache
    for (const [key, cachedContext] of contextCache.entries()) {
      if (cachedContext === context) {
        contextCache.delete(key)
        break
      }
    }

    // Terminate the context
    // This will close all sockets using this context
    await context.close()
  } catch (err) {
    console.error('Error terminating ZeroMQ context:', err)
  }
}

/**
 * Get context statistics (useful for debugging)
 * 
 * @returns {Object} Context statistics
 */
export function getContextStats () {
  const stats = []
  
  for (const [ioThreads, context] of contextCache.entries()) {
    stats.push({
      ioThreads,
      totalThreads: ioThreads + 1, // +1 for reaper thread
      context
    })
  }

  return {
    activeContexts: contextCache.size,
    contexts: stats,
    recommendation: contextCache.size > 3 
      ? 'WARNING: Multiple contexts detected. Consider consolidating to 1-2 contexts.'
      : 'OK'
  }
}

