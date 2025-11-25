/**
 * Test Helpers & Utilities
 * 
 * **What**: Reusable functions and utilities for ZeroMQ transport tests
 * **Why**: DRY principle - avoid duplication across test files
 * **Usage**: Import specific helpers in your test files
 * 
 * Available Utilities:
 * - wait(): Promise-based delay
 * - waitForReady(): Wait for socket to emit READY event
 * - waitForEvent(): Generic event waiter with timeout
 * - createTestRouter(): Factory for test router instances
 * - createTestDealer(): Factory for test dealer instances
 * - getAvailablePort(): Get next available port for testing
 */

import { TransportEvent } from '../../events.js'

// ============================================================================
// TIMING UTILITIES
// ============================================================================

/**
 * Promise-based delay utility
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 * 
 * @example
 * await wait(100) // Wait 100ms
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// EVENT WAITERS
// ============================================================================

/**
 * Wait for socket to become ready (emit READY event)
 * @param {Socket} socket - The socket to wait for
 * @param {number} timeoutMs - Maximum time to wait (default: 5000ms)
 * @returns {Promise<void>}
 * @throws {Error} If socket doesn't become ready within timeout
 * 
 * @example
 * await dealer.connect(address)
 * await waitForReady(dealer) // Wait for connection
 */
export async function waitForReady(socket, timeoutMs = 5000) {
  // Already ready
  if (socket.isOnline()) return
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Socket did not become ready within ${timeoutMs}ms`))
    }, timeoutMs)
    
    socket.once(TransportEvent.READY, () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Wait for a specific event to be emitted
 * @param {EventEmitter} emitter - The event emitter
 * @param {string} eventName - Event to wait for
 * @param {number} timeoutMs - Maximum time to wait (default: 5000ms)
 * @returns {Promise<any>} Resolves with event data
 * @throws {Error} If event doesn't fire within timeout
 * 
 * @example
 * const data = await waitForEvent(dealer, TransportEvent.MESSAGE, 1000)
 */
export function waitForEvent(emitter, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Event '${eventName}' did not fire within ${timeoutMs}ms`))
    }, timeoutMs)
    
    emitter.once(eventName, (data) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

/**
 * Wait for socket to go offline (emit NOT_READY event)
 * @param {Socket} socket - The socket to wait for
 * @param {number} timeoutMs - Maximum time to wait (default: 5000ms)
 * @returns {Promise<void>}
 * @throws {Error} If socket doesn't go offline within timeout
 * 
 * @example
 * await router.close()
 * await waitForNotReady(dealer) // Wait for disconnect
 */
export async function waitForNotReady(socket, timeoutMs = 5000) {
  // Already offline
  if (!socket.isOnline()) return
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Socket did not go offline within ${timeoutMs}ms`))
    }, timeoutMs)
    
    socket.once(TransportEvent.NOT_READY, () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

// ============================================================================
// PORT MANAGEMENT
// ============================================================================

// Port counter for generating unique test ports
let portCounter = 7000

/**
 * Get next available port for testing
 * Increments internal counter to avoid port conflicts
 * @returns {number} Port number
 * 
 * @example
 * const port = getAvailablePort()
 * await router.bind(`tcp://127.0.0.1:${port}`)
 */
export function getAvailablePort() {
  return portCounter++
}

/**
 * Reset port counter (useful for test isolation)
 * @param {number} startPort - Starting port (default: 7000)
 * 
 * @example
 * beforeEach(() => {
 *   resetPortCounter()
 * })
 */
export function resetPortCounter(startPort = 7000) {
  portCounter = startPort
}

// ============================================================================
// SOCKET FACTORIES
// ============================================================================

/**
 * Create a test router with sensible defaults
 * @param {object} options - Router options
 * @param {string} options.id - Router ID (auto-generated if not provided)
 * @param {object} options.config - Router configuration
 * @returns {RouterSocket}
 * 
 * @example
 * const router = createTestRouter({ id: 'my-router' })
 * await router.bind('tcp://127.0.0.1:7000')
 */
export function createTestRouter({ id, config = {} } = {}) {
  const { Router: RouterSocket } = require('../index.js')
  
  return new RouterSocket({
    id: id || `test-router-${Date.now()}`,
    config: {
      DEBUG: false,
      ...config
    }
  })
}

/**
 * Create a test dealer with sensible defaults
 * @param {object} options - Dealer options
 * @param {string} options.id - Dealer ID (auto-generated if not provided)
 * @param {object} options.config - Dealer configuration
 * @returns {DealerSocket}
 * 
 * @example
 * const dealer = createTestDealer({
 *   config: { ZMQ_RECONNECT_IVL: 100 }
 * })
 * await dealer.connect('tcp://127.0.0.1:7000')
 */
export function createTestDealer({ id, config = {} } = {}) {
  const { Dealer: DealerSocket, TIMEOUT_INFINITY } = require('../index.js')
  
  return new DealerSocket({
    id: id || `test-dealer-${Date.now()}`,
    config: {
      DEBUG: false,
      RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,
      ...config
    }
  })
}

// ============================================================================
// EVENT TRACKING
// ============================================================================

/**
 * Create an event tracker for capturing event sequences
 * @param {EventEmitter} emitter - Event emitter to track
 * @param {string[]} eventNames - Events to track
 * @returns {object} Tracker with `events` array and `clear()` method
 * 
 * @example
 * const tracker = createEventTracker(dealer, [
 *   TransportEvent.READY,
 *   TransportEvent.NOT_READY
 * ])
 * 
 * // Later in test:
 * expect(tracker.events).to.deep.equal(['READY', 'NOT_READY', 'READY'])
 * tracker.clear()
 */
export function createEventTracker(emitter, eventNames) {
  const events = []
  const listeners = []
  
  for (const eventName of eventNames) {
    const listener = () => events.push(eventName)
    emitter.on(eventName, listener)
    listeners.push({ eventName, listener })
  }
  
  return {
    events,
    clear: () => {
      events.length = 0
    },
    destroy: () => {
      for (const { eventName, listener } of listeners) {
        emitter.removeListener(eventName, listener)
      }
    }
  }
}

// ============================================================================
// MESSAGE HELPERS
// ============================================================================

/**
 * Send a message and wait for response
 * @param {DealerSocket} dealer - Dealer to send from
 * @param {Buffer} message - Message to send
 * @param {number} timeoutMs - Response timeout (default: 1000ms)
 * @returns {Promise<Buffer>} Response buffer
 * @throws {Error} If no response within timeout
 * 
 * @example
 * const response = await sendAndWaitForResponse(
 *   dealer,
 *   Buffer.from('ping')
 * )
 */
export async function sendAndWaitForResponse(dealer, message, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`No response received within ${timeoutMs}ms`))
    }, timeoutMs)
    
    dealer.once(TransportEvent.MESSAGE, ({ buffer }) => {
      clearTimeout(timer)
      resolve(buffer)
    })
    
    dealer.sendBuffer(message)
  })
}

/**
 * Collect all messages received within a time window
 * @param {EventEmitter} socket - Socket to collect from
 * @param {number} durationMs - How long to collect (default: 500ms)
 * @returns {Promise<Buffer[]>} Array of received messages
 * 
 * @example
 * const messages = await collectMessages(dealer, 1000)
 * expect(messages).to.have.lengthOf(5)
 */
export async function collectMessages(socket, durationMs = 500) {
  const messages = []
  
  const listener = ({ buffer }) => {
    messages.push(buffer)
  }
  
  socket.on(TransportEvent.MESSAGE, listener)
  
  await wait(durationMs)
  
  socket.removeListener(TransportEvent.MESSAGE, listener)
  
  return messages
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

/**
 * Cleanup multiple sockets safely
 * @param {...Socket} sockets - Sockets to close
 * @returns {Promise<void>}
 * 
 * @example
 * afterEach(async () => {
 *   await cleanupSockets(dealer1, dealer2, router)
 * })
 */
export async function cleanupSockets(...sockets) {
  const closePromises = sockets
    .filter(socket => socket && typeof socket.close === 'function')
    .map(socket => {
      try {
        return socket.close()
      } catch (err) {
        console.warn('Error closing socket:', err.message)
        return Promise.resolve()
      }
    })
  
  await Promise.all(closePromises)
}

/**
 * Create a cleanup handler for test contexts
 * @returns {object} Cleanup handler with `add()` and `cleanup()` methods
 * 
 * @example
 * describe('My Tests', () => {
 *   const cleanup = createCleanupHandler()
 *   
 *   afterEach(() => cleanup.cleanup())
 *   
 *   it('test', async () => {
 *     const dealer = createTestDealer()
 *     cleanup.add(dealer)
 *     // ... test code ...
 *   })
 * })
 */
export function createCleanupHandler() {
  const resources = []
  
  return {
    add: (resource) => {
      resources.push(resource)
      return resource
    },
    cleanup: async () => {
      await cleanupSockets(...resources)
      resources.length = 0
    }
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Common test timeouts (in milliseconds)
 */
export const TestTimeouts = {
  SHORT: 1000,    // 1s - Fast operations
  MEDIUM: 3000,   // 3s - Standard operations
  LONG: 5000,     // 5s - Reconnection tests
  STRESS: 10000   // 10s - High-throughput tests
}

/**
 * Common test addresses
 */
export const TestAddresses = {
  getLocal: (port) => `tcp://127.0.0.1:${port}`,
  getIPC: (name) => `ipc:///tmp/zeronode-test-${name}.ipc`
}

