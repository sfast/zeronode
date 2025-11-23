/**
 * Local Transport Implementation
 * 
 * Pure JavaScript in-memory transport for zeronode.
 * No ZeroMQ dependency - completely standalone.
 * 
 * Usage:
 *   import { Transport } from './src/transport/transport.js'
 *   import { LocalTransport } from './src/transport/local/local-transport.js'
 *   
 *   Transport.register('local', LocalTransport)
 *   const node = new Node({ bind: 'local://server1', transport: 'local' })
 */

import LocalClientSocket from './client.js'
import LocalServerSocket from './server.js'

export const LocalTransport = {
  /**
   * Create client socket
   * Implements Transport factory interface
   */
  createClientSocket({ id, config } = {}) {
    return new LocalClientSocket({ id, config })
  },

  /**
   * Create server socket
   * Implements Transport factory interface
   */
  createServerSocket({ id, config } = {}) {
    return new LocalServerSocket({ id, config })
  }
}

export default LocalTransport
