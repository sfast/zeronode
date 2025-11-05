/**
 * Centralized port allocation for test isolation
 * 
 * Each test file gets a unique port range to prevent conflicts
 * when tests run in parallel or close together.
 */

export const TEST_PORTS = {
  // oneToOne.js - Range: 4000-4009
  ONE_TO_ONE_BASE: 4000,
  ONE_TO_ONE_FAILURES: 4000,
  ONE_TO_ONE_SUCCESS: 4001,
  ONE_TO_ONE_RECONNECT: 4002,
  ONE_TO_ONE_INFO: 4003,
  
  // metrics.js - Range: 4100-4109
  METRICS: 4100,
  
  // manyToOne.js - Range: 4200-4209
  MANY_TO_ONE: 4200,
  
  // manyToMany.js - Range: 4300-4329 (needs 20+ ports)
  MANY_TO_MANY_BASE: 4300,
  MANY_TO_MANY_CENTER: 4320,
  
  // client-server.js
  CLIENT_SERVER: 5001,
  
  // router-edge-cases.test.js
  ROUTER_EDGE_1: 3060,
  ROUTER_EDGE_2: 3063,
  ROUTER_EDGE_3: 3065,
  
  // client-errors.test.js (mock/unused port)
  CLIENT_ERRORS_MOCK: 9999
}

/**
 * Generate a range of port addresses
 * @param {number} base - Starting port number
 * @param {number} count - Number of ports needed
 * @returns {string[]} Array of tcp addresses
 */
export function getPortRange(base, count) {
  return Array.from({ length: count }, (_, i) => `tcp://127.0.0.1:${base + i}`)
}

/**
 * Get a single TCP address
 * @param {number} port - Port number
 * @returns {string} TCP address
 */
export function getAddress(port) {
  return `tcp://127.0.0.1:${port}`
}

/**
 * Add a small delay for port release (helps with cleanup)
 * @param {number} ms - Milliseconds to wait (default: 50ms)
 * @returns {Promise<void>}
 */
export async function waitForPortRelease(ms = 500) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

