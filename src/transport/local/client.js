/**
 * Local Transport - Client Socket
 * 
 * Pure JavaScript client socket (no ZeroMQ dependency).
 * Implements the interface expected by Protocol layer.
 * 
 * Interface requirements:
 * - EventEmitter (emit TransportEvent.*)
 * - getId()
 * - isOnline()
 * - setLogger(logger)
 * - sendBuffer(buffer, recipient)
 * - close()
 * - getConfig()
 * - debug property
 * 
 * Events emitted:
 * - TransportEvent.READY
 * - TransportEvent.NOT_READY
 * - TransportEvent.MESSAGE
 * - TransportEvent.CLOSED
 * - TransportEvent.ERROR
 */

import { EventEmitter } from 'events'
import { TransportEvent } from '../events.js'
import { TransportError, TransportErrorCode } from '../errors.js'

// Global registry to connect clients to servers
const registry = new Map()  // address -> server socket

export function getLocalRegistry() {
  return registry
}

// ============================================================================
// LOCAL CLIENT SOCKET
// ============================================================================

export default class LocalClientSocket extends EventEmitter {
  constructor({ id, config } = {}) {
    super()
    
    // Generate ID if not provided
    this._id = id || `local-client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Configuration
    this._config = {
      DEBUG: false,
      ...config
    }
    
    // State
    this._online = false
    this._closed = false
    this._logger = null
    this._connectedServer = null
    this._serverAddress = null
    
    // Message queue (for async iteration if needed)
    this._messageQueue = []
    
    if (this._config.DEBUG) {
      console.log(`[LocalClientSocket] Created: ${this._id}`)
    }
  }

  // ========================================================================
  // PUBLIC API (Required by Protocol)
  // ========================================================================

  getId() {
    return this._id
  }

  isOnline() {
    return this._online
  }

  setOnline() {
    this._online = true
  }

  setOffline() {
    this._online = false
  }

  setLogger(logger) {
    this._logger = logger || console
  }

  getConfig() {
    return this._config
  }

  get debug() {
    return this._config.DEBUG
  }

  set debug(val) {
    this._config.DEBUG = !!val
  }

  get logger() {
    return this._logger || console
  }

  // ========================================================================
  // CONNECTION MANAGEMENT
  // ========================================================================

  async connect(address) {
    if (this._closed) {
      throw new TransportError({
        code: TransportErrorCode.CONNECTION_FAILED,
        message: 'Socket is closed',
        transportId: this._id
      })
    }

    if (this._online) {
      throw new TransportError({
        code: TransportErrorCode.ALREADY_CONNECTED,
        message: 'Already connected',
        transportId: this._id
      })
    }

    // Validate address
    if (!address || typeof address !== 'string') {
      throw new TransportError({
        code: TransportErrorCode.INVALID_ADDRESS,
        message: 'Invalid address',
        transportId: this._id,
        address
      })
    }

    // Find server in registry
    const server = registry.get(address)
    if (!server) {
      throw new TransportError({
        code: TransportErrorCode.CONNECTION_FAILED,
        message: `No server at address: ${address}`,
        transportId: this._id,
        address
      })
    }

    // Connect to server
    this._connectedServer = server
    this._serverAddress = address
    server._registerClient(this)

    this.setOnline()

    if (this._config.DEBUG) {
      this.logger.info(`[LocalClientSocket] ${this._id} connected to ${address}`)
    }

    // Emit READY event (async to mimic real connection)
    setImmediate(() => {
      this.emit(TransportEvent.READY)
    })
  }

  async disconnect() {
    if (!this._online) return

    // Notify server
    if (this._connectedServer) {
      this._connectedServer._unregisterClient(this._id)
    }

    this._connectedServer = null
    this._serverAddress = null
    this.setOffline()

    if (this._config.DEBUG) {
      this.logger.info(`[LocalClientSocket] ${this._id} disconnected`)
    }

    this.emit(TransportEvent.NOT_READY)
  }

  getAddress() {
    return this._serverAddress
  }

  // ========================================================================
  // MESSAGING
  // ========================================================================

  /**
   * Send buffer to server
   * Called by Protocol layer
   */
  sendBuffer(buffer, recipient = null) {
    if (this._closed) {
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Socket is closed',
        transportId: this._id
      })
    }

    if (!this._online || !this._connectedServer) {
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Not connected',
        transportId: this._id
      })
    }

    // Capture server reference before async operation
    const server = this._connectedServer
    
    // Send to server (instant delivery)
    setImmediate(() => {
      // Check if still connected (avoid race condition on disconnect)
      if (server && this._connectedServer === server) {
        server._receiveFromClient(this._id, buffer)
      }
    })
  }

  /**
   * Receive message from server
   * Called by server socket
   * @private
   */
  _receiveMessage(buffer) {
    if (this._closed) return

    // Emit MESSAGE event (Protocol listens to this)
    this.emit(TransportEvent.MESSAGE, {
      buffer,
      sender: this._connectedServer ? this._connectedServer.getId() : null
    })
  }

  // ========================================================================
  // LIFECYCLE
  // ========================================================================

  async close() {
    if (this._closed) return

    this._closed = true
    await this.disconnect()
    this._messageQueue = []

    if (this._config.DEBUG) {
      this.logger.info(`[LocalClientSocket] ${this._id} closed`)
    }

    this.emit(TransportEvent.CLOSED)
  }
}

