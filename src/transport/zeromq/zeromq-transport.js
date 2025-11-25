/**
 * ZeroMQ Transport Implementation
 * 
 * Provides ZeroMQ-based transport sockets (Router/Dealer)
 * for the ZeroNode protocol layer.
 */

import { Router, Dealer } from './index.js'

/**
 * ZeroMQ Transport Implementation
 * 
 * Factory for creating ZeroMQ-based client (Dealer) and server (Router) sockets.
 */
export class ZeroMQTransport {
  /**
   * Create a ZeroMQ client socket (Dealer)
   * 
   * @param {Object} config - Socket configuration
   * @param {string} config.id - Socket ID
   * @param {Object} config.config - Socket configuration options
   * @returns {Dealer} ZeroMQ Dealer socket
   */
  static createClientSocket({ id, config } = {}) {
    return new Dealer({ id, config })
  }
  
  /**
   * Create a ZeroMQ server socket (Router)
   * 
   * @param {Object} config - Socket configuration
   * @param {string} config.id - Socket ID
   * @param {Object} config.config - Socket configuration options
   * @returns {Router} ZeroMQ Router socket
   */
  static createServerSocket({ id, config } = {}) {
    return new Router({ id, config })
  }
}

