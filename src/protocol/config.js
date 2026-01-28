/**
 * Protocol Configuration & Validation
 * 
 * **What**: Pure configuration utilities and constants
 * **Why**: Zero dependencies, 100% testable, can be imported anywhere
 * **Exports**: Configuration defaults, events, validation functions
 */

import Globals from '../globals.js'

// ============================================================================
// CONFIGURATION DEFAULTS
// ============================================================================

/**
 * Default protocol-level timeouts and settings
 */
export const ProtocolConfigDefaults = {
  PROTOCOL_REQUEST_TIMEOUT: 10000,  // Request timeout in milliseconds (10 seconds)
  INFINITY: -1                       // Special value for infinite timeout
}

// ============================================================================
// PROTOCOL EVENTS (High-Level, Semantic)
// ============================================================================

/**
 * Protocol events emitted to application layer
 * These are high-level semantic events that abstract transport details
 */
export const ProtocolEvent = {
  // Transport state changes (simplified)
  TRANSPORT_READY: 'protocol:transport_ready',       // Transport can send/receive bytes
  TRANSPORT_NOT_READY: 'protocol:transport_not_ready', // Transport disconnected/unbound
  TRANSPORT_CLOSED: 'protocol:transport_closed',      // Transport permanently closed
  ERROR: 'protocol:error'                             // Protocol-surfaced transport/protocol error
}

// ============================================================================
// PROTOCOL SYSTEM EVENTS (Internal Message Contract)
// ============================================================================

/**
 * System events for internal protocol operations
 * These are internal protocol messages exchanged between client and server
 * for handshakes, pings, and lifecycle management. They use the '_system:' 
 * prefix to prevent user code from spoofing them.
 */
export const ProtocolSystemEvent = {
  // Handshake (explicit names)
  HANDSHAKE_INIT_FROM_CLIENT: '_system:handshake_init_from_client',  // Client → Server
  HANDSHAKE_ACK_FROM_SERVER: '_system:handshake_ack_from_server',    // Server → Client
  REQUEST_HANDSHAKE: '_system:request_handshake',        // Server → Client: Request fresh handshake (resurrection)
  CLIENT_PING: '_system:client_ping',            // Client → Server: Heartbeat
  CLIENT_STOP: '_system:client_stop',            // Client → Server: Graceful disconnect
  SERVER_STOP: '_system:server_stop'             // Server → Client: Server shutting down
}

// ============================================================================
// CONFIGURATION UTILITIES
// ============================================================================

/**
 * Merge user configuration with protocol defaults
 * Pure function - no side effects
 * 
 * @param {Object} [config={}] - User configuration
 * @returns {Object} Merged configuration
 * 
 * @example
 * const config = mergeProtocolConfig({ DEBUG: true })
 * // => { BUFFER_STRATEGY: 'msgpack', PROTOCOL_REQUEST_TIMEOUT: 10000, DEBUG: true }
 */
export function mergeProtocolConfig(config = {}) {
  return {
    ...config,  // ✅ Preserve all user config
    BUFFER_STRATEGY: config.BUFFER_STRATEGY ?? Globals.PROTOCOL_BUFFER_STRATEGY,
    PROTOCOL_REQUEST_TIMEOUT: config.PROTOCOL_REQUEST_TIMEOUT ?? Globals.PROTOCOL_REQUEST_TIMEOUT,
    DEBUG: config.DEBUG ?? false
  }
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate event name - prevent spoofing of system events
 * Pure function - throws on validation failure
 * 
 * @param {string} event - Event name to validate
 * @param {boolean} [isSystemEvent=false] - Is this a system event being sent internally?
 * @throws {Error} If client tries to send system event
 * @returns {boolean} true if valid
 * 
 * @example
 * validateEventName('user:login')              // ✅ OK
 * validateEventName('_system:ping')            // ❌ throws Error
 * validateEventName('_system:ping', true)      // ✅ OK (internal use)
 */
export function validateEventName(event, isSystemEvent = false) {
  const isSystemPrefix = event.startsWith('_system:')
  
  if (isSystemPrefix && !isSystemEvent) {
    throw new Error(`Cannot send system event: ${event}. System events are reserved.`)
  }
  
  return true
}

/**
 * Check if event is a system event
 * Pure function - no side effects
 * 
 * @param {string} event - Event name to check
 * @returns {boolean} true if system event
 * 
 * @example
 * isSystemEvent('_system:ping')     // true
 * isSystemEvent('user:login')       // false
 */
export function isSystemEvent(event) {
  return typeof event === 'string' && event.startsWith('_system:')
}

