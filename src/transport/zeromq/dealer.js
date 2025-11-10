/**
 * DealerSocket - Thin wrapper around ZeroMQ Dealer
 * Handles: connect/disconnect with automatic reconnection
 * 
 * Uses 1 I/O thread by default (sufficient for most client use cases)
 */
import * as zmq from 'zeromq'

import { TransportError, TransportErrorCode } from '../errors.js'
import { Socket } from './socket.js'
import { TransportEvent } from '../events.js'
import { createContext } from './context.js'
import { mergeConfig, TIMEOUT_INFINITY } from './config.js'

let _private = new WeakMap()

let DealerStateType = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting'
}

export default class DealerSocket extends Socket {
  constructor ({ id, config } = {}) {
    // Merge user config with defaults (before using it)
    config = mergeConfig(config)

    // Create context with configured I/O threads for dealers (clients)
    const context = createContext(config.DEALER_IO_THREADS)

    let socket = new zmq.Dealer({ context })
    
    // Set ZeroMQ socket identity (routingId) - REQUIRED by Socket base class
    // Generate unique ID if not provided
    socket.routingId = id || `dealer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Configure Dealer-specific socket options BEFORE calling super
    DealerSocket._configureDealerOptions(socket, config)

    // Super will configure common options (linger, HWM, timeouts)
    super({ socket, config })

    let _scope = {
      socket,
      state: DealerStateType.DISCONNECTED,
      routerAddress: null,
      reconnectionTimeout: null,
      connectionTimeout: null
    }

    _private.set(this, _scope)
  }

  /**
   * Configure Dealer-specific ZeroMQ socket options (static method)
   * Common options (linger, HWM, timeouts) are configured by base Socket class
   * Static so it can be called before super() in constructor
   * Config is already merged with defaults
   */
  static _configureDealerOptions (socket, config) {
    // Reconnection interval: How often ZeroMQ attempts to reconnect
    socket.reconnectInterval = config.ZMQ_RECONNECT_IVL

    // Reconnection interval max: Maximum reconnection interval (exponential backoff)
    if (config.ZMQ_RECONNECT_IVL_MAX > 0) {
      socket.reconnectMaxInterval = config.ZMQ_RECONNECT_IVL_MAX
    }
  }

  getAddress () {
    let { routerAddress } = _private.get(this)
    return routerAddress
  }

  setAddress (routerAddress) {
    let _scope = _private.get(this)
    
    // Validate address format
    if (typeof routerAddress !== 'string' || !routerAddress.length) {
      throw new TransportError({
        code: TransportErrorCode.ADDRESS_REQUIRED,
        message: 'Router address must be a non-empty string',
        transportId: this.getId()
      })
    }
    
    // Basic validation: should start with protocol (tcp://, ipc://, inproc://)
    if (!/^(tcp|ipc|inproc):\/\/.+/.test(routerAddress)) {
      throw new TransportError({
        code: TransportErrorCode.INVALID_ADDRESS,
        message: `Invalid router address format: ${routerAddress}. Expected format: tcp://host:port, ipc://path, or inproc://name`,
        transportId: this.getId(),
        address: routerAddress
      })
    }
    
    _scope.routerAddress = routerAddress
  }
  
  getState () {
    let { state } = _private.get(this)
    return state
  }

  setOnline () {
    let _scope = _private.get(this)
    super.setOnline()
    _scope.state = DealerStateType.CONNECTED
  }

  /**
   * Connect to router with automatic reconnection
   * Professional implementation:
   * - Validates not already connected
   * - Sets up event listeners for connection lifecycle
   * - Handles connection timeout
   * - Automatic reconnection on disconnect
   * - Reconnection timeout with failure handling
   * 
   * @param {string} routerAddress - Address to connect to (e.g., 'tcp://127.0.0.1:5000')
   * @param {number} timeout - Connection timeout in ms (default: from config or 30000)
   * @returns {Promise<void>} Resolves when connected
   * @throws {TransportError} If already connected or connection fails
   */
  async connect (routerAddress, timeout) {
    let _scope = _private.get(this)
    let { socket } = _scope

    // Validate: Can't connect if already online
    if (this.isOnline()) {
      throw new TransportError({ 
        code: TransportErrorCode.ALREADY_CONNECTED,
        message: `Dealer '${this.getId()}' is already connected to '${this.getAddress()}'`,
        transportId: this.getId(),
        address: this.getAddress()
      })
    }

    // Set address
    if (routerAddress) {
      this.setAddress(routerAddress)
    }

    // Validate: Must have address
    if (!this.getAddress()) {
      throw new TransportError({ 
        code: TransportErrorCode.ADDRESS_REQUIRED,
        message: 'Router address is required',
        transportId: this.getId()
      })
    }

    // Get timeouts from config (already has defaults from mergeConfig)
    const cfg = this.getConfig()
    timeout = timeout || cfg.CONNECTION_TIMEOUT
    const reconnectionTimeout = cfg.RECONNECTION_TIMEOUT

    // Setup connection lifecycle handlers
    this._setupConnectionHandlers(reconnectionTimeout)
    
    // Attach listeners BEFORE connecting (CONNECT event fires during socket.connect())
    this.attachSocketEventListeners()

    // Connect with timeout
    return new Promise((resolve, reject) => {
      // Connection success handler
      // Note: setOnline() is now called in attachSocketEventListeners before event fires
      const onConnect = () => {
        this._clearConnectionTimeout()
        resolve()
      }

      // Connection timeout handler
      if (timeout !== TIMEOUT_INFINITY) {
        _scope.connectionTimeout = setTimeout(() => {
          this.removeListener(TransportEvent.READY, onConnect)
          reject(new TransportError({ 
            code: TransportErrorCode.CONNECTION_TIMEOUT,
            message: `Connection timeout to ${this.getAddress()}`,
            transportId: this.getId(),
            address: this.getAddress()
          }))
          this.disconnect()
        }, timeout)
      }

      // Start connection
      this.once(TransportEvent.READY, onConnect)
      socket.connect(this.getAddress())
    })
  }

  /**
   * Setup connection lifecycle handlers (private helper)
   * Handles: disconnect detection, reconnection, reconnection failure
   */
  _setupConnectionHandlers (reconnectionTimeout) {
    let _scope = _private.get(this)

    // Handler: Connection lost (disconnect)
    const onDisconnect = () => {
      this.setOffline()
      _scope.state = DealerStateType.RECONNECTING

      // Start reconnection timeout
      if (reconnectionTimeout !== TIMEOUT_INFINITY) {
        _scope.reconnectionTimeout = setTimeout(() => {
          this.removeListener(TransportEvent.READY, onReconnect)
          this.emit(TransportEvent.CLOSED)  // Reconnection failed - transport is dead
          this.disconnect()
        }, reconnectionTimeout)
      }

      // Wait for reconnection
      this.once(TransportEvent.READY, onReconnect)
    }

    // Handler: Reconnection successful
    const onReconnect = (info) => {
      this._clearReconnectionTimeout()
      this.setOnline()
      // Transport back online - emit READY again
      // (Protocol will handle session restoration)
      // Re-attach disconnect handler for future disconnects
      this.once(TransportEvent.NOT_READY, onDisconnect)
    }

    // Initial disconnect handler
    this.once(TransportEvent.NOT_READY, onDisconnect)
  }

  /**
   * Clear connection timeout (private helper)
   */
  _clearConnectionTimeout () {
    let _scope = _private.get(this)
    if (_scope.connectionTimeout) {
      clearTimeout(_scope.connectionTimeout)
      _scope.connectionTimeout = null
    }
  }

  /**
   * Clear reconnection timeout (private helper)
   */
  _clearReconnectionTimeout () {
    let _scope = _private.get(this)
    if (_scope.reconnectionTimeout) {
      clearTimeout(_scope.reconnectionTimeout)
      _scope.reconnectionTimeout = null
    }
  }

  /**
   * Disconnect from router (application-level cleanup)
   * 
   * Order is critical:
   * 1. Stop message listener (prevents EBUSY during disconnect)
   * 2. Clear timeouts
   * 3. Disconnect from ZeroMQ router
   * 4. Remove event listeners
   * 5. Set offline state
   */
  async disconnect () {
    let _scope = _private.get(this)
    let { socket, routerAddress, state } = _scope

    // 1. Stop message listener FIRST (sets flag to break async iterator)
    this.stopMessageListener()

    // 2. Wait a tick for the iterator to see the flag and stop
    await new Promise(resolve => setImmediate(resolve))

    // 3. Clear all timeouts
    this._clearConnectionTimeout()
    this._clearReconnectionTimeout()

    // 4. Remove all event listeners BEFORE disconnect to prevent duplicate CLOSED events
    this.removeAllListeners()
    this.detachSocketEventListeners()

    // 5. Disconnect from router if not already disconnected (listener stopped, no EBUSY)
    if (state !== DealerStateType.DISCONNECTED && routerAddress) {
      socket.disconnect(routerAddress)
      _scope.state = DealerStateType.DISCONNECTED
    }

    // 6. Update state
    this.setOffline()
  }

  /**
   * Close the dealer socket
   * Teardown sequence:
   * 1. Disconnect from router (application-level)
   * 2. Close socket (transport-level via super.close())
   */
  async close () {
    await this.disconnect()
    super.close()
  }

  /**
   * Attach Dealer-specific socket event listeners
   * Only listens to events relevant for Dealer (client) sockets
   */
  attachSocketEventListeners () {
    let { socket } = _private.get(this)
    
    if (socket.events) {
      // Map ZeroMQ connect → TransportEvent.READY
      socket.events.on('connect', (fd, endpoint) => {
        this.setOnline()
        this.debug && this.logger.info(`Emitted '${TransportEvent.READY}' on socket '${this.getId()}'`)
        this.emit(TransportEvent.READY, { fd, endpoint })
      })
      
      // Map ZeroMQ disconnect → TransportEvent.NOT_READY
      socket.events.on('disconnect', (fd, endpoint) => {
        this.setOffline()
        this.debug && this.logger.info(`Emitted '${TransportEvent.NOT_READY}' on socket '${this.getId()}'`)
        this.emit(TransportEvent.NOT_READY, { fd, endpoint })
      })
    }
  }

  // ZeroMQ Dealer-specific: message format (no routing info needed)
  // Dealer sends directly to connected Router
  getSocketMsgFromBuffer (buffer, recipient) {
    return buffer
  }
}
