/**
 * Local Transport - Server Socket
 * 
 * Pure JavaScript server socket (no ZeroMQ dependency).
 * Implements the interface expected by Protocol layer.
 * 
 * Interface requirements:
 * - EventEmitter (emit TransportEvent.*)
 * - getId()
 * - isOnline()
 * - setLogger(logger)
 * - sendBuffer(buffer, recipient)
 * - bind(address)
 * - unbind()
 * - close()
 * - getConfig()
 * - debug property
 * - getAllClientPeers() - for Protocol's client tracking
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
import { getLocalRegistry } from './client.js'

// ============================================================================
// LOCAL SERVER SOCKET
// ============================================================================

export default class LocalServerSocket extends EventEmitter {
  constructor({ id, config } = {}) {
    super()
    
    // Generate ID if not provided
    this._id = id || `local-server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Configuration
    this._config = {
      DEBUG: false,
      ...config
    }
    
    // State
    this._online = false
    this._closed = false
    this._logger = null
    this._boundAddress = null
    this._clients = new Map()  // clientId -> client socket
    
    if (this._config.DEBUG) {
      console.log(`[LocalServerSocket] Created: ${this._id}`)
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
  // BINDING
  // ========================================================================

  async bind(address) {
    if (this._closed) {
      throw new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Socket is closed',
        transportId: this._id
      })
    }

    if (this._online) {
      throw new TransportError({
        code: TransportErrorCode.ALREADY_BOUND,
        message: 'Already bound',
        transportId: this._id,
        address: this._boundAddress
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

    // Register in global registry
    const registry = getLocalRegistry()
    
    if (registry.has(address)) {
      throw new TransportError({
        code: TransportErrorCode.ALREADY_BOUND,
        message: `Address already bound: ${address}`,
        transportId: this._id,
        address
      })
    }

    registry.set(address, this)
    this._boundAddress = address
    this.setOnline()

    if (this._config.DEBUG) {
      this.logger.info(`[LocalServerSocket] ${this._id} bound to ${address}`)
    }

    // Emit READY event (async to mimic real binding)
    setImmediate(() => {
      this.emit(TransportEvent.READY)
    })
  }

  async unbind() {
    if (!this._online) return

    // Unregister from registry
    const registry = getLocalRegistry()
    registry.delete(this._boundAddress)

    if (this._config.DEBUG) {
      this.logger.info(`[LocalServerSocket] ${this._id} unbound from ${this._boundAddress}`)
    }

    this._boundAddress = null
    this._clients.clear()
    this.setOffline()

    this.emit(TransportEvent.NOT_READY)
  }

  getAddress() {
    return this._boundAddress
  }

  // ========================================================================
  // MESSAGING
  // ========================================================================

  /**
   * Send buffer to specific client
   * Called by Protocol layer
   * 
   * @param {Buffer} buffer - Message buffer
   * @param {string} recipient - Client ID to send to
   */
  sendBuffer(buffer, recipient) {
    if (this._closed) {
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Socket is closed',
        transportId: this._id
      })
    }

    if (!this._online) {
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Socket not bound',
        transportId: this._id
      })
    }

    if (!recipient) {
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Recipient required for server socket',
        transportId: this._id
      })
    }

    const client = this._clients.get(recipient)
    if (!client) {
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: `Client not found: ${recipient}`,
        transportId: this._id
      })
    }

    // Send to client (instant delivery)
    setImmediate(() => {
      client._receiveMessage(buffer)
    })
  }

  /**
   * Receive message from client
   * Called by client socket
   * @private
   */
  _receiveFromClient(clientId, buffer) {
    if (this._closed) return

    // Emit MESSAGE event (Protocol listens to this)
    this.emit(TransportEvent.MESSAGE, {
      buffer,
      sender: clientId
    })
  }

  // ========================================================================
  // CLIENT MANAGEMENT
  // ========================================================================

  /**
   * Register client connection
   * Called by client socket
   * @private
   */
  _registerClient(client) {
    this._clients.set(client.getId(), client)

    if (this._config.DEBUG) {
      this.logger.info(`[LocalServerSocket] Client registered: ${client.getId()}`)
    }
  }

  /**
   * Unregister client
   * Called by client socket
   * @private
   */
  _unregisterClient(clientId) {
    const removed = this._clients.delete(clientId)

    if (this._config.DEBUG && removed) {
      this.logger.info(`[LocalServerSocket] Client unregistered: ${clientId}`)
    }
  }

  /**
   * Get all connected clients
   * Required by Protocol layer for peer tracking
   */
  getAllClientPeers() {
    // Return mock peer info that Protocol expects
    return Array.from(this._clients.values()).map(client => ({
      getId: () => client.getId(),
      isOnline: () => client.isOnline(),
      getOptions: () => ({})  // Could be extended with actual options
    }))
  }

  // ========================================================================
  // LIFECYCLE
  // ========================================================================

  async close() {
    if (this._closed) return

    this._closed = true
    await this.unbind()

    if (this._config.DEBUG) {
      this.logger.info(`[LocalServerSocket] ${this._id} closed`)
    }

    this.emit(TransportEvent.CLOSED)
  }
}

