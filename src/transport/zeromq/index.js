/**
 * ZeroMQ Transport Implementation
 * 
 * Public API exports only - internal implementation details are not exported.
 */

export { default as Router } from './router.js'
export { default as Dealer } from './dealer.js'

// Export configuration utilities for users who want to customize
export { 
  TIMEOUT_INFINITY,
  ZMQConfigDefaults,
  mergeConfig,
  createDealerConfig,
  createRouterConfig,
  validateConfig
} from './config.js'

// Internal modules (socket.js, context.js) are NOT exported
// They are implementation details of the ZeroMQ transport
