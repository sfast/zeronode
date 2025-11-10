/**
 * Test Utilities & Timing Constants
 * 
 * Centralized timing constants to prevent flaky tests.
 * All timing values are generous to ensure reliability on CI/CD and slower machines.
 */

// ============================================================================
// TIMING CONSTANTS (in milliseconds)
// ============================================================================

export const TIMING = {
  // Connection & Handshake
  BIND_READY: 300,              // Time to wait after bind() for socket to be ready
  CONNECT_READY: 400,           // Time to wait after connect() for handshake to complete
  PEER_REGISTRATION: 500,       // Time to wait for server to register client as peer
  RECONNECT_ATTEMPT: 800,       // Time between reconnection attempts
  
  // Message & Communication
  MESSAGE_DELIVERY: 150,        // Time for message to be delivered
  TICK_PROPAGATION: 200,        // Time for tick to propagate through layers
  REQUEST_RESPONSE: 300,        // Time for request/response round trip
  
  // Cleanup & Teardown
  DISCONNECT_COMPLETE: 200,     // Time for disconnect to complete
  PORT_RELEASE: 400,            // Time for OS to release port after unbind/close
  SOCKET_CLOSE: 150,            // Time for socket to close cleanly
  LISTENER_CLEANUP: 100,        // Time for event listeners to detach
  
  // ZeroMQ Specific
  ZMQ_LINGER: 100,              // ZMQ linger period
  ZMQ_RECONNECT_IVL: 100,       // ZMQ reconnection interval
  ZMQ_HANDSHAKE: 200,           // ZMQ protocol handshake time
  
  // Test Coordination
  BEFORE_EACH_SETUP: 300,       // Time to wait in beforeEach after setup
  AFTER_EACH_CLEANUP: 400,      // Time to wait in afterEach for cleanup
  BETWEEN_TESTS: 100,           // Small delay between test operations
  
  // Integration Tests
  INTEGRATION_SETUP: 500,       // Time for full integration test setup
  INTEGRATION_TEARDOWN: 600,    // Time for full integration test teardown
  
  // Timing Assertions
  TIMEOUT_SHORT: 1000,          // Short timeout for operations that should be fast
  TIMEOUT_MEDIUM: 3000,         // Medium timeout for normal async operations
  TIMEOUT_LONG: 5000,           // Long timeout for complex operations
  
  // Edge Cases
  RACE_CONDITION_BUFFER: 50,    // Extra buffer to prevent race conditions
  ASYNC_PROPAGATION: 100        // Time for async operations to propagate
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Wait for specified milliseconds
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Wait for an event to be emitted with timeout
 * @param {EventEmitter} emitter - Event emitter to listen to
 * @param {string} event - Event name to wait for
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<any>} - Resolves with event data or rejects on timeout
 */
export function waitForEvent(emitter, event, timeout = TIMING.TIMEOUT_MEDIUM) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(event, handler)
      reject(new Error(`Timeout waiting for event '${event}' after ${timeout}ms`))
    }, timeout)
    
    const handler = (data) => {
      clearTimeout(timer)
      resolve(data)
    }
    
    emitter.once(event, handler)
  })
}

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise<void>}
 */
export async function waitForCondition(condition, timeout = TIMING.TIMEOUT_MEDIUM, interval = 50) {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return
    }
    await wait(interval)
  }
  
  throw new Error(`Timeout: condition not met after ${timeout}ms`)
}

/**
 * Wait for connection to be established
 * Includes handshake and peer registration
 */
export async function waitForConnection() {
  await wait(TIMING.CONNECT_READY + TIMING.PEER_REGISTRATION)
}

/**
 * Wait for proper cleanup after test
 * Ensures ports are released and sockets are closed
 */
export async function waitForCleanup() {
  await wait(TIMING.DISCONNECT_COMPLETE + TIMING.PORT_RELEASE)
}

/**
 * Retry an async operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<any>}
 */
export async function retryWithBackoff(operation, maxRetries = 3, baseDelay = 100) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (err) {
      if (attempt === maxRetries - 1) {
        throw err
      }
      const delay = baseDelay * Math.pow(2, attempt)
      await wait(delay)
    }
  }
}

/**
 * Create a promise that rejects after timeout
 * Useful for racing against operations that should complete quickly
 * @param {number} ms - Timeout in milliseconds
 * @param {string} message - Error message
 * @returns {Promise<never>}
 */
export function timeout(ms, message = `Operation timed out after ${ms}ms`) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms)
  })
}

/**
 * Race a promise against a timeout
 * @param {Promise} promise - Promise to race
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise<any>}
 */
export function withTimeout(promise, ms, message) {
  return Promise.race([promise, timeout(ms, message)])
}

// ============================================================================
// PORT MANAGEMENT
// ============================================================================

let basePort = 8000

/**
 * Get a set of unique ports for a test
 * @param {number} count - Number of ports needed
 * @returns {number[]} Array of port numbers
 */
export function getUniquePorts(count = 3) {
  const ports = []
  for (let i = 0; i < count; i++) {
    ports.push(basePort++)
  }
  return ports
}

/**
 * Get a unique port for a test
 * @returns {number} Port number
 */
export function getUniquePort() {
  return basePort++
}

/**
 * Reset port allocation (useful for test isolation)
 */
export function resetPortAllocation(startPort = 8000) {
  basePort = startPort
}

// ============================================================================
// ASSERTIONS
// ============================================================================

/**
 * Assert that an operation completes within expected time
 * @param {Function} operation - Async operation to time
 * @param {number} maxTime - Maximum expected time in milliseconds
 * @param {string} operationName - Name of operation for error message
 */
export async function assertTimely(operation, maxTime, operationName = 'Operation') {
  const startTime = Date.now()
  await operation()
  const duration = Date.now() - startTime
  
  if (duration > maxTime) {
    throw new Error(`${operationName} took ${duration}ms, expected < ${maxTime}ms`)
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  TIMING,
  wait,
  waitForEvent,
  waitForCondition,
  waitForConnection,
  waitForCleanup,
  retryWithBackoff,
  timeout,
  withTimeout,
  getUniquePorts,
  getUniquePort,
  resetPortAllocation,
  assertTimely
}

