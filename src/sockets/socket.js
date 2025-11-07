import { EventEmitter } from 'events'
import { TransportEvent } from '../transport-events.js'

// ============================================================================
// PRIVATE STORAGE
// ============================================================================

let _private = new WeakMap()

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function startMessageListener (socket) {
  try {
    for await (const frames of socket) {
      // Check if we should stop listening (graceful shutdown)
      let _scope = _private.get(this)
      if (_scope && _scope.shouldStopListening) {
        break
      }
      
      // Router sockets receive: [sender, '', buffer] (3 frames)
      // Dealer sockets receive: ['', buffer] (2 frames)
      
      let sender, buffer
      
      if (frames.length === 3) {
        // Router socket format
        [sender, , buffer] = frames
      } else if (frames.length === 2) {
        // Dealer socket format
        [, buffer] = frames
        sender = null
      } else {
        // Unexpected format
        this.logger?.warn(`Unexpected message format: ${frames.length} frames`)
        continue
      }
      
      // Pure transport: forward ALL messages to protocol layer
      this.emit(TransportEvent.MESSAGE, { buffer, sender })
    }
  } catch (err) {
    // Socket closed or error occurred
    // EAGAIN: Socket closed normally (expected)
    if (this.logger && err.code !== 'EAGAIN') {
      this.logger.error('Socket message listener error:', err)
    }
  }
}

function buildSocketEventHandler (eventName) {
  return (fd, endpoint) => {
    if (this.debugMode()) {
      this.logger.info(`Emitted '${eventName}' on socket '${this.getId()}'`)
    }
    this.emit(eventName, { fd, endpoint })
  }
}

// ============================================================================
// SOCKET CLASS
// ============================================================================

class Socket extends EventEmitter {
  constructor ({ socket, config } = {}) {
    super()

    config = config || {}
    
    // Validate: socket MUST have routingId set
    if (!socket.routingId) {
      throw new Error('Socket must have routingId set before calling super(). Set socket.routingId in subclass constructor.')
    }

    // Configure common ZeroMQ socket options BEFORE setting up
    this._configureCommonSocketOptions(socket, config)

    let _scope = {
      id: socket.routingId,
      socket,
      config,
      logger: null,
      online: false,
      isDebugMode: false,
      shouldStopListening: false
    }

    _private.set(this, _scope)

    // ** setting the logger as soon as possible
    this.setLogger(config.logger || console)

    this.debugMode(config.debug || false)

    startMessageListener.call(this, socket)
  }

  /**
   * Configure common ZeroMQ socket options (base class)
   * These options apply to ALL socket types (Dealer, Router, etc.)
   * Subclasses can add socket-specific options before calling super()
   */
  _configureCommonSocketOptions (socket, config) {
    // Linger: How long to keep unsent messages after close
    // 0 = discard immediately (fast shutdown)
    // -1 = wait forever (dangerous!)
    // >0 = wait N milliseconds
    const linger = config.ZMQ_LINGER !== undefined ? config.ZMQ_LINGER : 0
    socket.linger = linger

    // High Water Mark for sending: Max queued outgoing messages
    // Prevents memory exhaustion, blocks send when reached
    // Default: 10,000 (good balance for production)
    const sendHighWaterMark = config.ZMQ_SNDHWM || 10000
    socket.sendHighWaterMark = sendHighWaterMark

    // High Water Mark for receiving: Max queued incoming messages
    // Default: 10,000 (good balance for production)
    const receiveHighWaterMark = config.ZMQ_RCVHWM || 10000
    socket.receiveHighWaterMark = receiveHighWaterMark

    // Send timeout: Max time to wait for send operation
    // -1 = infinite, 0 = non-blocking, >0 = timeout in ms
    if (config.ZMQ_SNDTIMEO !== undefined) {
      socket.sendTimeout = config.ZMQ_SNDTIMEO
    }

    // Receive timeout: Max time to wait for receive operation
    // -1 = infinite, 0 = non-blocking, >0 = timeout in ms
    if (config.ZMQ_RCVTIMEO !== undefined) {
      socket.receiveTimeout = config.ZMQ_RCVTIMEO
    }
  }

  getId () {
    let { id } = _private.get(this)
    return id
  }

  setOnline () {
    let _scope = _private.get(this)
    _scope.online = Date.now()
  }

  setOffline () {
    let _scope = _private.get(this)
    _scope.online = false
  }

  isOnline () {
    let { online } = _private.get(this)
    return !!online
  }

  getConfig () {
    let { config } = _private.get(this)
    return config || {}
  }

  setLogger (logger) {
    this.logger = logger || console
  }

  debugMode (val) {
    let _scope = _private.get(this)
    if (val) {
      _scope.isDebugMode = !!val
    } else {
      return _scope.isDebugMode
    }
  }

  // Pure transport: send buffer without protocol awareness
  sendBuffer (buffer, recipient) {
    let { socket } = _private.get(this)
    
    if (this.isOnline()) {
      let msg = this.getSocketMsgFromBuffer(buffer, recipient)
      socket.send(msg)
      return true
    }

    throw new Error(`Sending failed as socket '${this.getId()}' is not online`)
  }

  // Default implementation (overridden in Router/Dealer)
  getSocketMsgFromBuffer (buffer, recipient) {
    throw new Error('getSocketMsgFromBuffer is not implemented in the base class. Subclasses must implement this method')
  }

  /**
   * Attach socket event listeners (base implementation)
   * Subclasses (Router/Dealer) should override to attach only relevant events
   * 
   * Base class attaches common events that apply to all socket types
   */
  attachTransportEventListeners () {
    let { socket } = _private.get(this)

    // Subscribe to common ZeroMQ socket events
    if (socket.events) {
      // Map ZeroMQ close → TransportEvent.CLOSED
      socket.events.on('close', buildSocketEventHandler.call(this, TransportEvent.CLOSED))
    }
  }

  detachTransportEventListeners () {
    let { socket } = _private.get(this)
    // Unsubscribe from all ZeroMQ socket events
    if (socket.events && typeof socket.events.removeAllListeners === 'function') {
      socket.events.removeAllListeners()
    }
  }

  /**
   * Stop the message listener gracefully before unbind/disconnect operations
   * Sets a flag that the async iterator checks on next iteration
   * This prevents EBUSY errors without closing the socket prematurely
   */
  stopMessageListener () {
    let _scope = _private.get(this)
    if (_scope) {
      _scope.shouldStopListening = true
    }
  }

  /**
   * Close the socket (base implementation)
   * - Sets offline state
   * - Detaches event listeners
   * - Closes native ZeroMQ socket (if not already closed)
   * 
   * Note: Router/Dealer should call stopMessageListener() first,
   * then do their cleanup (unbind/disconnect), then call super.close()
   */
  close () {
    this.setOffline()
    this.detachTransportEventListeners()
    
    let { socket } = _private.get(this)
    if (socket && !socket.closed) {
      socket.close()
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
export { Socket }
export { buildSocketEventHandler }

export default {
  Socket
}
