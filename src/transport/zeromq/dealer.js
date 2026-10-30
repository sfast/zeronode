// Reviewed: 16 Nov 2025 by @avar 

/**
 * DealerSocket - Thin wrapper around ZeroMQ Dealer
 * Handles: connect/disconnect
 * 
 * Uses 1 I/O thread by default (sufficient for most client use cases)
 */
import * as zmq from 'zeromq'

import { TransportError, TransportErrorCode } from '../errors.js'
import { Socket } from './socket.js'
import { TransportEvent } from '../events.js'
import { createContext } from './context.js'
import { mergeConfig, DealerHeartbeatDefaults } from './config.js'

let _private = new WeakMap()

export default class DealerSocket extends Socket {
  constructor ({ id, config } = {}) {
    // Merge user config with defaults and validate (before using it)
    config = mergeConfig(config, true)

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
      routerAddress: null,
      eventsAttached: false,
      // Set by disconnect() before it reports NOT_READY, cleared by connect():
      // close() after disconnect() must not report it again, and monitor
      // events still queued from the old link are ignored
      disconnected: false,
      // [type, handler] added to socket.events (removed one by one: the
      // zeromq.js observer has off() but no removeAllListeners())
      monitorHandlers: []
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
    socket.reconnectMaxInterval = config.ZMQ_RECONNECT_IVL_MAX

    // ZMTP heartbeats (on by default): a server that stops answering while
    // TCP stays up is reported NOT_READY instead of never. Set before connect().
    const interval = config.ZMQ_HEARTBEAT_IVL ?? DealerHeartbeatDefaults.ZMQ_HEARTBEAT_IVL
    if (interval > 0) {
      socket.heartbeatInterval = interval
      socket.heartbeatTimeout = config.ZMQ_HEARTBEAT_TIMEOUT ??
        (config.ZMQ_HEARTBEAT_IVL === undefined ? DealerHeartbeatDefaults.ZMQ_HEARTBEAT_TIMEOUT : 3 * interval)
      if (config.ZMQ_HEARTBEAT_TTL !== undefined) {
        socket.heartbeatTimeToLive = config.ZMQ_HEARTBEAT_TTL
      }
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
        code: TransportErrorCode.INVALID_ADDRESS,
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
  
  /**
   * Connect to router with automatic reconnection (handled by ZeroMQ)
   * 
   * ZeroMQ connect() is non-blocking - returns immediately.
   * Actual connection happens asynchronously in background.
   * Listen to READY event to know when connected.
   * 
   * @param {string} routerAddress - Address to connect to (e.g., 'tcp://127.0.0.1:5000')
   * @returns {Promise<void>} Resolves immediately after issuing connect
   * @throws {TransportError} If already connected
   */
  async connect (routerAddress) {
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

    this.setAddress(routerAddress)
    _scope.disconnected = false

    // Attach listeners BEFORE connecting (events fire asynchronously)
    this.attachSocketEventListeners()

    // Non-blocking connect - ZeroMQ handles connection/reconnection
    socket.connect(this.getAddress())
  }

  /**
   * Disconnect from router (application-level cleanup)
   * 
   * Order is critical:
   * 1. Disconnect from ZeroMQ router
   * 2. Emit NOT_READY explicitly (ZeroMQ may not fire native 'disconnect')
   * 3. Detach event listeners
   * 4. Set offline state
   */
  async disconnect () {
    let _scope = _private.get(this)
    let { socket, routerAddress } = _scope

    // Latched before anything is emitted: a listener that runs close() (or
    // disconnect() again) from NOT_READY sees it already reported
    const alreadyDisconnected = _scope.disconnected
    _scope.disconnected = true

    try {
      // 1. Disconnect from current endpoint (idempotent)
      if (routerAddress) {
        socket.disconnect(routerAddress)
      }
    } catch (err) {
      this.debug && this.logger?.warn(`Error disconnecting from router: ${err.message}`)
      // ignore disconnect errors; socket may already be disconnected
    }

    // 2. Mark offline
    this.setOffline()

    // 3. Explicitly emit NOT_READY, once per explicit disconnect
    // (ZeroMQ doesn't reliably fire native 'disconnect' event on manual disconnect)
    if (!alreadyDisconnected) {
      this.emit(TransportEvent.NOT_READY, { address: routerAddress })
    }

    // 4. Wait a tick for event to propagate
    await new Promise(resolve => setImmediate(resolve))

    // 5. Now safe to detach socket event listeners
    this.detachSocketEventListeners()
    _scope.eventsAttached = false
  }



  /**
   * Attach Dealer-specific socket event listeners
   * Maps native ZeroMQ events → TransportEvents
   * 
   * ZeroMQ handles reconnection automatically, we just listen to state changes:
   * - connect: Link established (initial or after reconnect)
   * - disconnect: Link lost (ZeroMQ will auto-retry per config)
   */
  attachSocketEventListeners () {
    let { socket } = _private.get(this)
    let _scope = _private.get(this)

    if (_scope.eventsAttached) return

    if (socket.events) {
      _scope.eventsAttached = true
      const on = (type, handler) => {
        socket.events.on(type, handler)
        _scope.monitorHandlers.push([type, handler])
      }

      // zeromq.js passes one event object: { type, address[, interval] }.
      // Events still queued after an explicit disconnect() are ignored.

      // Map ZeroMQ connect → TransportEvent.READY
      on('connect', ({ address }) => {
        if (_scope.disconnected) return
        this.setOnline()
        this.debug && this.logger.info(`Emitted '${TransportEvent.READY}' on socket '${this.getId()}'`)
        this.emit(TransportEvent.READY, { address })
      })
      
      // Map ZeroMQ disconnect → TransportEvent.NOT_READY
      on('disconnect', ({ address }) => {
        if (_scope.disconnected) return
        this.setOffline()
        this.debug && this.logger.info(`Emitted '${TransportEvent.NOT_READY}' on socket '${this.getId()}'`)
        // Note: ZeroMQ auto-retries per reconnectInterval/reconnectMaxInterval
        this.emit(TransportEvent.NOT_READY, { address })
      })

      on('connect:retry', ({ address, interval }) => {
        if (_scope.disconnected) return
        this.debug && this.logger.info(`Emitted '${TransportEvent.RECONNECT_RETRY}' on socket '${this.getId()}'`)
        this.emit(TransportEvent.RECONNECT_RETRY, { address, interval })
      })
    }
  }

  /**
   * Remove the monitor handlers this dealer added (a reused dealer would
   * otherwise add another set on every connect())
   */
  detachSocketEventListeners () {
    const _scope = _private.get(this)
    const { socket } = _scope
    const handlers = _scope.monitorHandlers.splice(0)
    if (socket && !socket.closed && socket.events && typeof socket.events.off === 'function') {
      for (const [type, handler] of handlers) socket.events.off(type, handler)
    }
    super.detachSocketEventListeners()
  }

  // ZeroMQ Dealer-specific: message format (no routing info needed)
  // Dealer sends directly to connected Router
  getSocketMsgFromBuffer (buffer, recipient) {
    return buffer
  }

  /**
 * Close the dealer socket
 * Teardown sequence:
 * 1. Disconnect from router (application-level)
 * 2. Close socket (transport-level via super.close())
 */
  async close () {
    await this.disconnect()
    super.close(true)
  }

}
