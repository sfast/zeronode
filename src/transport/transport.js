/**
 * Transport Abstraction Layer
 * 
 * Provides a factory pattern for creating transport sockets.
 * Allows pluggable transport implementations (ZeroMQ, TCP, WebSocket, etc.)
 * 
 * Usage:
 *   // Use default transport
 *   const socket = Transport.createClientSocket({ id, config })
 * 
 *   // Register custom transport
 *   Transport.register('mytransport', MyTransportImpl)
 *   Transport.setDefault('mytransport')
 */

/**
 * Transport factory and registry
 * 
 * Manages transport implementations and provides factory methods
 * for creating client and server sockets.
 */
export class Transport {
  static registry = new Map()
  static defaultTransport = 'zeromq'
  
  /**
   * Register a transport implementation
   * 
   * @param {string} name - Transport name (e.g., 'zeromq', 'tcp', 'websocket')
   * @param {Object} transportImpl - Transport implementation with createClientSocket/createServerSocket
   * 
   * @example
   * Transport.register('mytransport', {
   *   createClientSocket: (config) => new MyClientSocket(config),
   *   createServerSocket: (config) => new MyServerSocket(config)
   * })
   */
  static register(name, transportImpl) {
    if (!name || typeof name !== 'string') {
      throw new Error('Transport name must be a non-empty string')
    }
    
    if (!transportImpl) {
      throw new Error('Transport implementation is required')
    }
    
    if (typeof transportImpl.createClientSocket !== 'function') {
      throw new Error('Transport implementation must have createClientSocket method')
    }
    
    if (typeof transportImpl.createServerSocket !== 'function') {
      throw new Error('Transport implementation must have createServerSocket method')
    }
    
    this.registry.set(name, transportImpl)
  }
  
  /**
   * Set the default transport for all new socket creations
   * 
   * @param {string} name - Transport name (must be registered)
   * 
   * @example
   * Transport.setDefault('zeromq')
   */
  static setDefault(name) {
    if (!this.registry.has(name)) {
      throw new Error(`Transport '${name}' is not registered. Available: ${Array.from(this.registry.keys()).join(', ')}`)
    }
    
    this.defaultTransport = name
  }
  
  /**
   * Get a specific transport implementation
   * 
   * @param {string} name - Transport name
   * @returns {Object} Transport implementation
   * 
   * @example
   * const zmqTransport = Transport.use('zeromq')
   */
  static use(name) {
    const transport = this.registry.get(name)
    if (!transport) {
      throw new Error(`Transport '${name}' is not registered. Available: ${Array.from(this.registry.keys()).join(', ')}`)
    }
    return transport
  }
  
  /**
   * Create a client socket using the default transport
   * 
   * @param {Object} config - Socket configuration
   * @returns {IClientSocket} Client socket instance
   * 
   * @example
   * const socket = Transport.createClientSocket({ id: 'client1', config: {...} })
   */
  static createClientSocket(config) {
    const impl = this.registry.get(this.defaultTransport)
    
    if (!impl) {
      throw new Error(`Default transport '${this.defaultTransport}' is not registered`)
    }
    
    return impl.createClientSocket(config)
  }
  
  /**
   * Create a server socket using the default transport
   * 
   * @param {Object} config - Socket configuration
   * @returns {IServerSocket} Server socket instance
   * 
   * @example
   * const socket = Transport.createServerSocket({ id: 'server1', config: {...} })
   */
  static createServerSocket(config) {
    const impl = this.registry.get(this.defaultTransport)
    
    if (!impl) {
      throw new Error(`Default transport '${this.defaultTransport}' is not registered`)
    }
    
    return impl.createServerSocket(config)
  }
  
  /**
   * Get list of registered transport names
   * 
   * @returns {string[]} Array of transport names
   */
  static getRegistered() {
    return Array.from(this.registry.keys())
  }
  
  /**
   * Get the current default transport name
   * 
   * @returns {string} Default transport name
   */
  static getDefault() {
    return this.defaultTransport
  }
}

