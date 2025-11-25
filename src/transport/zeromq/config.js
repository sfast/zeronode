/**
 * ZeroMQ Transport Configuration
 * 
 * Centralized configuration for ZeroMQ sockets with sensible defaults.
 * All values can be overridden when creating Router or Dealer instances.
 */

/**
 * Constant for infinite timeout (-1 means wait forever)
 * Note: Used by application layer (Client/Protocol) for handshake and request timeouts
 */
export const TIMEOUT_INFINITY = -1

/**
 * Default ZeroMQ socket configuration
 * 
 * These defaults are optimized for:
 * - Fast shutdown (ZMQ_LINGER: 0)
 * - Production workloads (HWM: 10,000)
 * - Reliable reconnection (RECONNECT_IVL: 100ms)
 * - Infinite timeouts (allow ZeroMQ to handle its own timing)
 */
export const ZMQConfigDefaults = {
  // ============================================================================
  // CONTEXT OPTIONS (ZeroMQ I/O threading)
  // ============================================================================
  
  /**
   * DEALER_IO_THREADS: Number of I/O threads for Dealer (client) sockets
   * 1 = single-threaded (recommended for most clients, handles <100K msg/s)
   * 2+ = multi-threaded (only needed for very high throughput)
   */
  DEALER_IO_THREADS: 1,
  
  /**
   * ROUTER_IO_THREADS: Number of I/O threads for Router (server) sockets
   * 1 = single-threaded (good for <10 clients)
   * 2 = dual-threaded (recommended for servers, handles multiple clients)
   * 4+ = high-throughput (>50 clients, >500K msg/s)
   */
  ROUTER_IO_THREADS: 2,
  
  // ============================================================================
  // LOGGING & DEBUGGING
  // ============================================================================
  
  /**
   * logger: Logger instance for socket operations
   * undefined = use console (default)
   * Provide winston/pino/bunyan instance for production
   */
  // logger: undefined,  // Optional - uses console by default
  
  /**
   * DEBUG: Enable debug mode (verbose logging)
   * false = normal logging (default)
   * true = verbose debug logs
   */
  DEBUG: false,
  
  // ============================================================================
  // COMMON SOCKET OPTIONS (applies to all socket types)
  // ============================================================================
  
  /**
   * ZMQ_LINGER: How long to keep unsent messages after close
   * 0 = discard immediately (fast shutdown, recommended for most cases)
   * -1 = wait forever (NOT recommended - can hang shutdown)
   * >0 = wait N milliseconds
   */
  ZMQ_LINGER: 0,
  
  /**
   * ZMQ_SNDHWM: Send High Water Mark (max queued outgoing messages)
   * Prevents memory exhaustion, blocks or drops when limit reached
   * Default: 10,000 messages (good for production)
   */
  ZMQ_SNDHWM: 10000,
  
  /**
   * ZMQ_RCVHWM: Receive High Water Mark (max queued incoming messages)
   * Prevents memory exhaustion
   * Default: 10,000 messages (good for production)
   */
  ZMQ_RCVHWM: 10000,
  
  /**
   * ZMQ_SNDTIMEO: Send timeout in milliseconds
   * -1 = infinite (default, ZeroMQ manages)
   * 0 = non-blocking (returns immediately)
   * >0 = timeout in ms
   */
  // ZMQ_SNDTIMEO: -1,  // Optional - undefined means ZeroMQ default
  
  /**
   * ZMQ_RCVTIMEO: Receive timeout in milliseconds
   * -1 = infinite (default, ZeroMQ manages)
   * 0 = non-blocking (returns immediately)
   * >0 = timeout in ms
   */
  // ZMQ_RCVTIMEO: -1,  // Optional - undefined means ZeroMQ default
  
  // ============================================================================
  // DEALER-SPECIFIC OPTIONS (client sockets)
  // ============================================================================
  
  /**
   * ZMQ_RECONNECT_IVL: Initial reconnection interval in milliseconds
   * How often ZeroMQ tries to reconnect after losing connection
   * Default: 100ms (fast reconnection)
   * -1 means no reconnection
   */
  ZMQ_RECONNECT_IVL: 100,
  
  /**
   * ZMQ_RECONNECT_IVL_MAX: Maximum reconnection interval (exponential backoff)
   * 0 = no exponential backoff (constant interval)
   * >0 = max interval in ms (e.g., 30000 = max 30 seconds)
   * Default: 0 (constant 100ms retry)
   */
  ZMQ_RECONNECT_IVL_MAX: 0,
  
  // ============================================================================
  // ROUTER-SPECIFIC OPTIONS (server sockets)
  // ============================================================================
  
  /**
   * ZMQ_ROUTER_MANDATORY: Fail if sending to unknown peer
   * false = silently drop messages to unknown peers (production default)
   * true = throw error when sending to unknown peer (debugging)
   */
  // ZMQ_ROUTER_MANDATORY: false,  // Optional - undefined means ZeroMQ default
  
  /**
   * ZMQ_ROUTER_HANDOVER: Take over identity from another router
   * Useful for high-availability setups with multiple routers
   * false = normal behavior (default)
   * true = allow identity handover
   */
  // ZMQ_ROUTER_HANDOVER: false,  // Optional - undefined means ZeroMQ default
}

/**
 * Merge user configuration with defaults
 * 
 * @param {Object} userConfig - User-provided configuration
 * @param {boolean} validate - Whether to validate the config (default: false)
 * @returns {Object} Merged configuration
 * @throws {Error} If validation is enabled and config is invalid
 * 
 * @example
 * const config = mergeConfig({
 *   ZMQ_LINGER: 5000,  // Override default
 *   ZMQ_SNDHWM: 50000  // Override default
 * })
 * // Result: { ZMQ_LINGER: 5000, ZMQ_SNDHWM: 50000, ZMQ_RCVHWM: 10000, ... }
 */
export function mergeConfig(userConfig = {}, validate = false) {
  const merged = {
    ...ZMQConfigDefaults,
    ...userConfig
  }
  
  // Optionally validate the merged config
  if (validate) {
    validateConfig(merged)
  }
  
  return merged
}

/**
 * Create dealer-specific configuration
 * Includes all common options plus dealer-specific defaults
 * 
 * @param {Object} userConfig - User-provided configuration
 * @returns {Object} Dealer configuration
 */
export function createDealerConfig(userConfig = {}) {
  return mergeConfig(userConfig)
}

/**
 * Create router-specific configuration
 * Includes all common options plus router-specific defaults
 * 
 * @param {Object} userConfig - User-provided configuration
 * @returns {Object} Router configuration
 */
export function createRouterConfig(userConfig = {}) {
  return mergeConfig(userConfig)
}

/**
 * Validate configuration values
 * Throws error if invalid configuration is provided
 * 
 * @param {Object} config - Configuration to validate
 * @throws {Error} If configuration is invalid
 */
export function validateConfig(config) {
  // Validate DEALER_IO_THREADS
  if (config.DEALER_IO_THREADS !== undefined) {
    if (!Number.isInteger(config.DEALER_IO_THREADS) || config.DEALER_IO_THREADS < 1 || config.DEALER_IO_THREADS > 16) {
      throw new Error(`Invalid DEALER_IO_THREADS: ${config.DEALER_IO_THREADS}. Must be integer between 1 and 16`)
    }
  }
  
  // Validate ROUTER_IO_THREADS
  if (config.ROUTER_IO_THREADS !== undefined) {
    if (!Number.isInteger(config.ROUTER_IO_THREADS) || config.ROUTER_IO_THREADS < 1 || config.ROUTER_IO_THREADS > 16) {
      throw new Error(`Invalid ROUTER_IO_THREADS: ${config.ROUTER_IO_THREADS}. Must be integer between 1 and 16`)
    }
  }
  
  // Validate DEBUG flag
  if (config.DEBUG !== undefined && typeof config.DEBUG !== 'boolean') {
    throw new Error(`Invalid DEBUG: ${config.DEBUG}. Must be boolean (true/false)`)
  }
  
  // Validate ZMQ_LINGER
  if (config.ZMQ_LINGER !== undefined) {
    if (typeof config.ZMQ_LINGER !== 'number' || config.ZMQ_LINGER < -1) {
      throw new Error(`Invalid ZMQ_LINGER: ${config.ZMQ_LINGER}. Must be -1 (infinite) or >= 0`)
    }
  }
  
  // Validate HWM values
  if (config.ZMQ_SNDHWM !== undefined && (typeof config.ZMQ_SNDHWM !== 'number' || config.ZMQ_SNDHWM < 1)) {
    throw new Error(`Invalid ZMQ_SNDHWM: ${config.ZMQ_SNDHWM}. Must be > 0`)
  }
  
  if (config.ZMQ_RCVHWM !== undefined && (typeof config.ZMQ_RCVHWM !== 'number' || config.ZMQ_RCVHWM < 1)) {
    throw new Error(`Invalid ZMQ_RCVHWM: ${config.ZMQ_RCVHWM}. Must be > 0`)
  }
  
  // Validate reconnection interval
  if (config.ZMQ_RECONNECT_IVL !== undefined && (typeof config.ZMQ_RECONNECT_IVL !== 'number' || config.ZMQ_RECONNECT_IVL < 1)) {
    throw new Error(`Invalid ZMQ_RECONNECT_IVL: ${config.ZMQ_RECONNECT_IVL}. Must be > 0`)
  }

  return true
}

export default {
  TIMEOUT_INFINITY,
  ZMQConfigDefaults,
  mergeConfig,
  createDealerConfig,
  createRouterConfig,
  validateConfig
}

