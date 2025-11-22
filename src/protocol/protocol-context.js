/**
 * Protocol Context
 * 
 * **What**: Shared context object that provides access to protocol-level resources
 * **Why**: Eliminates repetitive parameter passing and simplifies component constructors
 * **Pattern**: Context Pattern - centralized access to shared resources
 * 
 * Instead of passing (socket, config, debug, logger, protocolId) to every component,
 * we create a single context object that components can access.
 * 
 * Benefits:
 * - Simpler constructors (1 param instead of 5+)
 * - Easier to extend (add properties to context, not every constructor)
 * - Better testability (mock one context object)
 * - Clear ownership (context belongs to protocol)
 */

export class ProtocolContext {
  constructor(protocol, socket, config) {
    // Core references
    this._protocol = protocol
    this._socket = socket
    this._config = config
    
    // Cached properties (for performance and convenience)
    this._logger = socket.logger
    this._protocolId = socket.getId()
    
    // Make config properties directly accessible
    Object.defineProperty(this, 'config', {
      get: () => this._config,
      enumerable: true
    })
    
    Object.defineProperty(this, 'logger', {
      get: () => this._logger,
      enumerable: true
    })
    
    Object.defineProperty(this, 'debug', {
      get: () => this._config.DEBUG,
      enumerable: true
    })
    
    Object.defineProperty(this, 'protocolId', {
      get: () => this._protocolId,
      enumerable: true
    })
    
    Object.defineProperty(this, 'socket', {
      get: () => this._socket,
      enumerable: true
    })
    
    Object.defineProperty(this, 'protocol', {
      get: () => this._protocol,
      enumerable: true
    })
  }
  
  /**
   * Get protocol ID
   * Convenience method for common operation
   */
  getId() {
    return this._protocolId
  }
  
  /**
   * Check if transport is online
   * Convenience method for common operation
   */
  isOnline() {
    return this._socket.isOnline()
  }
  
  /**
   * Update logger (propagates to all components using this context)
   */
  setLogger(logger) {
    this._logger = logger
    this._socket.setLogger(logger)
  }
}

