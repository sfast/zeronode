import { EventEmitter } from 'events'
import { TransportEvent } from '../events.js'
import { TransportError, TransportErrorCode } from '../errors.js'
import { mergeConfig } from './config.js'

// ============================================================================
// PRIVATE STORAGE
// ============================================================================

let _private = new WeakMap()

// ============================================================================
// SOCKET CLASS
// ============================================================================

class Socket extends EventEmitter {
  constructor ({ socket, config } = {}) {
    super()

    // Merge user config with defaults
    config = mergeConfig(config)
    
    // Validate: socket MUST have routingId set
    if (!socket.routingId) {
      // maybe this is another transport error ?
      throw new Error('Socket must have routingId set before calling super(). Set socket.routingId in subclass constructor.')
    }

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

    this.debug = !!(config.DEBUG || false)

    // Configure common ZeroMQ socket options BEFORE setting up
    this._configureCommonSocketOptions()

    // ** setting the logger as soon as possible
    this.setLogger(config.logger || console)

    this.startMessageListener()
  }

  /**
   * Configure common ZeroMQ socket options (base class)
   * These options apply to ALL socket types (Dealer, Router, etc.)
   * Subclasses can add socket-specific options before calling super()
   * Config is already merged with defaults by constructor
   */
  _configureCommonSocketOptions () {
    let { socket, config } = _private.get(this)
    // Linger: How long to keep unsent messages after close
    socket.linger = config.ZMQ_LINGER

    // High Water Mark for sending: Max queued outgoing messages
    socket.sendHighWaterMark = config.ZMQ_SNDHWM

    // High Water Mark for receiving: Max queued incoming messages
    socket.receiveHighWaterMark = config.ZMQ_RCVHWM

    // Send timeout (optional - only set if explicitly provided)
    if (config.ZMQ_SNDTIMEO !== undefined) {
      socket.sendTimeout = config.ZMQ_SNDTIMEO
    }

    // Receive timeout (optional - only set if explicitly provided)
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

  get debug () {
    let _scope = _private.get(this)
    return _scope.isDebugMode
  }

  set debug (val) {
    let _scope = _private.get(this)
    _scope.isDebugMode = !!val
  }

  /**
   * Start listening for incoming messages (background async task)
   * Processes ZeroMQ frames and emits TransportEvent.MESSAGE
   * @private
   */
  async startMessageListener () {
    try {
      let { socket } = _private.get(this)

      for await (const frames of socket) {
        // Check if we should stop listening (graceful shutdown)
        // Note: Must check _private on each iteration, not cache it
        let { shouldStopListening } = _private.get(this)
        if (shouldStopListening) {
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
          // Unexpected message format - emit error but continue processing
          const transportError = new TransportError({
            code: TransportErrorCode.RECEIVE_FAILED,
            message: `Unexpected message format: received ${frames.length} frames, expected 2 (Dealer) or 3 (Router)`,
            transportId: this.getId(),
            context: { frameCount: frames.length, expectedFormats: ['Dealer: 2 frames', 'Router: 3 frames'] }
          })
          this.emit(TransportEvent.ERROR, transportError)
          
          // Skip this malformed message and continue
          continue
        }
        
        // Pure transport: forward ALL messages to protocol layer
        this.emit(TransportEvent.MESSAGE, { buffer, sender })
      }
    } catch (err) {
      // Socket closed or error occurred
      // EAGAIN: Socket closed normally (expected during shutdown)
      if (err.code === 'EAGAIN') {
        this.debugMode() && this.logger?.warn(`Socket message listener error: ${err.message} - EAGAIN expected during shutdown`) 
        return  // Normal closure, nothing to report
      }
      
      // Unexpected error - emit transport error event
      const transportError = new TransportError({
        code: TransportErrorCode.RECEIVE_FAILED,
        message: `Socket message listener error: ${err.message}`,
        transportId: this.getId(),
        cause: err
      })
      
      this.emit(TransportEvent.ERROR, transportError)
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

  // Pure transport: send buffer without protocol awareness
  sendBuffer (buffer, recipient) {
    let { socket } = _private.get(this)
    
    if (!this.isOnline()) {
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: `Cannot send - transport '${this.getId()}' is offline`,
        transportId: this.getId()
      })
    }
    
    try {
      let msg = this.getSocketMsgFromBuffer(buffer, recipient)
      socket.send(msg)
      return true
    } catch (err) {
      // Wrap any ZMQ send errors (HWM reached, socket error, etc.)
      throw new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: `Failed to send on transport '${this.getId()}': ${err.message}`,
        transportId: this.getId(),
        cause: err
      })
    }
  }

  // Default implementation (overridden in Router/Dealer)
  getSocketMsgFromBuffer (buffer, recipient) {
    throw new Error('getSocketMsgFromBuffer is not implemented in the base class. Subclasses must implement this method')
  }

  // Note: No base attachSocketEventListeners() method
  // Each subclass (Dealer/Router) implements its own event attachment

  detachSocketEventListeners () {
    let { socket } = _private.get(this)
    
    // Unsubscribe from all ZeroMQ socket events
    if (socket && !socket.closed && socket.events && typeof socket.events.removeAllListeners === 'function') {
        socket.events.removeAllListeners()
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
  close (closeSocket = false) {
    try {
      this.stopMessageListener()
      this.setOffline()
      this.detachSocketEventListeners()
     
      
      let { socket } = _private.get(this)
      if (socket && !socket.closed && closeSocket) {
        socket.close()
      }

      this.debug && this.logger?.info(`Emitted '${TransportEvent.CLOSED}' on socket '${this.getId()}'`)
      this.emit(TransportEvent.CLOSED)
    } catch (err) {
      // Emit transport error if listener cleanup fails during close
      const transportError = new TransportError({
        code: TransportErrorCode.CLOSE_FAILED,
        message: `Failed to close socket: ${err.message}`,
        transportId: this.getId(),
        cause: err
      })

      this.emit(TransportEvent.ERROR, transportError)
    }

  }
}

// ============================================================================
// EXPORTS
// ============================================================================
export { Socket }

export default {
  Socket
}
