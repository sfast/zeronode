/**
 * Transport Layer - Public API
 * 
 * Exports:
 * - Transport factory and registry
 * - Transport events
 * - Transport errors
 * - ZeroMQ transport (auto-registered as default)
 */

// Core transport abstraction
import { Transport } from './transport.js'

// Auto-register ZeroMQ transport as default
import { ZeroMQTransport } from './zeromq/zeromq-transport.js'
Transport.register('zeromq', ZeroMQTransport)
Transport.setDefault('zeromq')

// Export Transport after registration
export { Transport }

// Transport events and errors
export { TransportEvent } from './events.js'
export { TransportError, TransportErrorCode } from './errors.js'

// Re-export ZeroMQ components for advanced users
export { Router, Dealer } from './zeromq/index.js'
export {
  TIMEOUT_INFINITY,
  ZMQConfigDefaults,
  mergeConfig,
  createDealerConfig,
  createRouterConfig,
  validateConfig
} from './zeromq/config.js'

