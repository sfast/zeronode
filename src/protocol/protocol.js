/**
 * Protocol - Message protocol handler (request/response, tick)
 * 
 * ARCHITECTURE: Protocol-First Design
 * - Single gateway between Socket and Application layers
 * - Translates low-level SocketEvent → high-level ProtocolEvent
 * - Handles all request/response tracking
 * - Manages connection state
 * 
 * Client/Server should NEVER access socket directly!
 */

import { PatternEmitter } from '@sfast/pattern-emitter-ts'
import { EventEmitter } from 'events'

import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'
import { EnvelopeIdGenerator, Envelope, BufferStrategy, EnvelopType } from './envelope.js'
import { TransportEvent } from '../transport/events.js'

// ============================================================================
// PROTOCOL CONFIGURATION DEFAULTS
// ============================================================================

/**
 * Default protocol-level timeouts and settings
 */
export const ProtocolConfigDefaults = {
  REQUEST_TIMEOUT: 10000,  // Request timeout in milliseconds (10 seconds)
  INFINITY: -1             // Special value for infinite timeout
}

// ============================================================================
// PROTOCOL EVENTS (High-Level, Semantic)
// ============================================================================

export const ProtocolEvent = {
  // Transport state changes (simplified)
  TRANSPORT_READY: 'protocol:transport_ready',       // Transport can send/receive bytes
  TRANSPORT_NOT_READY: 'protocol:transport_not_ready', // Transport disconnected/unbound
  TRANSPORT_CLOSED: 'protocol:transport_closed'      // Transport permanently closed
}

// ============================================================================
// PROTOCOL SYSTEM EVENTS (Internal Message Contract)
// ============================================================================
// These are internal protocol messages exchanged between client and server
// for handshakes, pings, and lifecycle management. They use the '_system:' 
// prefix to prevent user code from spoofing them.

export const ProtocolSystemEvent = {
  CLIENT_CONNECTED: '_system:client_connected',  // Client → Server: Handshake request
  CLIENT_PING: '_system:client_ping',            // Client → Server: Heartbeat
  CLIENT_STOP: '_system:client_stop',            // Client → Server: Graceful disconnect
  SERVER_STOP: '_system:server_stop'             // Server → Client: Server shutting down
}

// ============================================================================
// PROTOCOL VALIDATION
// ============================================================================

/**
 * Validate event name - prevent spoofing of system events
 * @param {string} event - Event name
 * @param {boolean} isSystemEvent - Is this a system event being sent internally?
 * @throws {Error} If client tries to send system event
 * @returns {boolean} true if valid
 */
function validateEventName (event, isSystemEvent = false) {
  const isSystemPrefix = event.startsWith('_system:')
  
  if (isSystemPrefix && !isSystemEvent) {
    throw new Error(`Cannot send system event: ${event}. System events are reserved.`)
  }
  
  return true
}

let _private = new WeakMap()

export default class Protocol extends EventEmitter {
  constructor (socket, config = {}) {
    super()
    
    if (!socket) {
      throw new Error('Protocol requires a socket')
    }
    
    let _scope = {
      socket,                    // PRIVATE - never expose!
      // Request tracking: id → { resolve, reject, timer }
      // NOTE: IDs are globally unique (include owner hash), but we only track
      // by ID here because:
      // - Client: Only sees its own requests (no collision possible)
      // - Server: Doesn't need to track requests (stateless request/response)
      // If server needs tracking (e.g. rate limiting), use (owner, id) tuple
      requests: new Map(),
      // Envelope ID generator (manages counter state)
      idGenerator: new EnvelopeIdGenerator(socket.getId()),
      // Handler storage - Both Client and Server need this
      requestEmitter: new PatternEmitter(),
      tickEmitter: new PatternEmitter(),
      // Protocol configuration
      config: {
        // Buffer allocation strategy (default: EXACT)
        BUFFER_STRATEGY: config.BUFFER_STRATEGY !== undefined 
          ? config.BUFFER_STRATEGY 
          : BufferStrategy.EXACT
      }
      // NO state tracking - just pass through transport events
      // NO peer tracking - that's Server/Client responsibility!
    }
    
    _private.set(this, _scope)
    
    // Listen to socket messages
    socket.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
      this._handleIncomingMessage(buffer, sender)
    })
    
    // Translate socket events to protocol events
    this._attachSocketEventHandlers(socket)
  }
  
  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  getId () {
    let { socket } = _private.get(this)
    return socket.getId()
  }
  
  getConfig () {
    let { socket } = _private.get(this)
    return socket.getConfig()
  }

  setLogger (logger) {
    let { socket } = _private.get(this)
    socket.setLogger(logger)
  }

  debugMode (val) {
    let { socket } = _private.get(this)
    return socket.debugMode(val)
  }

  isOnline () {
    let { socket } = _private.get(this)
    return socket.isOnline()
  }

  // Protocol is ready when socket is online
  isReady () {
    return this.isOnline()
  }
  
  // ============================================================================
  // REQUEST/RESPONSE
  // ============================================================================
  
  request ({ to, event, data, timeout } = {}) {
    let { socket, requests } = _private.get(this)
    timeout = timeout || this.getConfig().REQUEST_TIMEOUT || ProtocolConfigDefaults.REQUEST_TIMEOUT
    
    // Check if protocol is ready to send
    if (!this.isReady()) {
      return Promise.reject(new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send request: Protocol '${this.getId()}' is not ready`,
        protocolId: this.getId()
      }))
    }
    
    let { idGenerator } = _private.get(this)
    const id = idGenerator.next()
    
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        if (requests.has(id)) {
          requests.delete(id)
          reject(new ProtocolError({
            code: ProtocolErrorCode.REQUEST_TIMEOUT,
            message: `Request envelope '${id}' timed out on protocol '${this.getId()}'`,
            protocolId: this.getId(),
            envelopeId: id,
            context: { event, timeout }
          }))
        }
      }, timeout)
      
      requests.set(id, { resolve, reject, timeout: timer })
      
      // Create envelope buffer and send (errors automatically caught by promise rejection)
      let { config } = _private.get(this)
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id,
        tag: event,
        data,
        owner: this.getId(),
        recipient: to
      }, config.BUFFER_STRATEGY)
      
      socket.sendBuffer(buffer, to)
    })
  }
  
  // ============================================================================
  // TICK (fire-and-forget) - PUBLIC API
  // ============================================================================
  
  /**
   * Send tick (fire-and-forget message) - PUBLIC API
   * Validates event names and blocks system events to prevent spoofing
   * 
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID (optional for broadcast)
   * @param {string} params.event - Event name (cannot start with '_system:')
   * @param {*} [params.data] - Event data
   * @throws {ProtocolError} If event is a system event or transport is offline
   */
  tick ({ to, event, data } = {}) {
    let { socket } = _private.get(this)
    
    // ❌ BLOCK system events from public API
    // System events (_system:*) are reserved for internal use (handshake, ping, etc.)
    if (event.startsWith('_system:')) {
      throw new ProtocolError({
        code: ProtocolErrorCode.INVALID_EVENT,
        message: `Cannot send system event '${event}'. System events are reserved for internal use only.`,
        protocolId: this.getId(),
        context: { event }
      })
    }
    
    // ✅ Validate event name (no _system: prefix from public API)
    validateEventName(event, false)
    
    // Check if transport is online
    if (!socket.isOnline()) {
      throw new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send tick: Protocol '${this.getId()}' is not ready (transport offline)`,
        protocolId: this.getId()
      })
    }
    
    // Send via internal implementation
    this._doTick({ to, event, data })
  }
  
  // ============================================================================
  // INTERNAL API - For Client/Server subclasses ONLY
  // ============================================================================
  
  /**
   * Send system tick - INTERNAL USE ONLY
   * Used by Client/Server for handshake, ping, disconnect, etc.
   * 
   * This method bypasses public API validation and is intended ONLY for
   * internal protocol operations. Do not expose this to user code.
   * 
   * @protected
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID
   * @param {string} params.event - System event name (must start with '_system:')
   * @param {*} [params.data] - Event data
   * @throws {ProtocolError} If transport is offline
   * @throws {Error} If event is not a system event
   */
  _sendSystemTick ({ to, event, data } = {}) {
    let { socket } = _private.get(this)
    
    // ✅ Assert this is actually a system event (internal validation)
    if (!event.startsWith('_system:')) {
      throw new Error(
        `_sendSystemTick() requires system event (starting with '_system:'), got: ${event}`
      )
    }
    
    // Check if transport is online
    if (!socket.isOnline()) {
      throw new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: `Cannot send system tick: Protocol '${this.getId()}' is not ready (transport offline)`,
        protocolId: this.getId()
      })
    }
    
    // Send via internal implementation (bypass validation)
    this._doTick({ to, event, data })
  }
  
  // ============================================================================
  // PRIVATE IMPLEMENTATION
  // ============================================================================
  
  /**
   * Actually send a tick (internal implementation)
   * @private
   * @param {Object} params
   * @param {string} [params.to] - Recipient ID
   * @param {string} params.event - Event name (already validated)
   * @param {*} [params.data] - Event data
   */
  _doTick ({ to, event, data } = {}) {
    let { socket, idGenerator, config } = _private.get(this)
    
    const buffer = Envelope.createBuffer({
      type: EnvelopType.TICK,
      id: idGenerator.next(),
      tag: event,
      data,
      owner: this.getId(),
      recipient: to
    }, config.BUFFER_STRATEGY)
    
    socket.sendBuffer(buffer, to)
  }
  
  // ============================================================================
  // HANDLER REGISTRATION
  // ============================================================================
  
  onRequest (pattern, handler) {
    let { requestEmitter } = _private.get(this)
    requestEmitter.on(pattern, handler)
  }
  
  offRequest (pattern, handler) {
    let { requestEmitter } = _private.get(this)
    requestEmitter.off(pattern, handler)
  }
  
  onTick (pattern, handler) {
    let { tickEmitter } = _private.get(this)
    tickEmitter.on(pattern, handler)
  }
  
  offTick (pattern, handler) {
    let { tickEmitter } = _private.get(this)
    tickEmitter.off(pattern, handler)
  }
  
  // ============================================================================
  // SOCKET EVENT HANDLERS → PROTOCOL EVENT TRANSLATION
  // ============================================================================
  
  _attachSocketEventHandlers (socket) {
    // ============================================================================
    // SIMPLIFIED EVENT TRANSLATION
    // 
    // Protocol just passes through 4 transport events - no state management!
    // 
    // TransportEvent (4 events):     ProtocolEvent (pass-through):
    // - READY                     →  TRANSPORT_READY
    // - NOT_READY                 →  TRANSPORT_NOT_READY  
    // - MESSAGE                   →  (handled separately)
    // - CLOSED                    →  TRANSPORT_CLOSED
    // 
    // Client/Server handle:
    // - Handshake logic (when to send CLIENT_CONNECTED, etc.)
    // - Peer management (tracking connected peers)
    // - Session state (HEALTHY, GHOST, etc.)
    // 
    // Protocol only handles:
    // - Request/response matching
    // - Tick/request handler execution
    // - Message parsing
    // ============================================================================
    
    // Transport can send/receive - pass through
    socket.on(TransportEvent.READY, () => {
      if (process.env.NODE_ENV !== 'test') {
        socket.logger?.info(`Protocol '${this.getId()}': Transport ready`)
      }
      this.emit(ProtocolEvent.TRANSPORT_READY)
    })
    
    // Transport disconnected - pass through
    socket.on(TransportEvent.NOT_READY, () => {
      socket.logger?.warn(`Protocol '${this.getId()}': Transport not ready`)
      this.emit(ProtocolEvent.TRANSPORT_NOT_READY)
    })
    
    // Transport permanently closed - reject pending requests
    socket.on(TransportEvent.CLOSED, () => {
      if (process.env.NODE_ENV !== 'test') {
        socket.logger?.error(`Protocol '${this.getId()}': Transport closed`)
      }
      this._rejectPendingRequests('Transport closed')
      this.emit(ProtocolEvent.TRANSPORT_CLOSED)
    })
  }
  
  // ============================================================================
  // UTILITY (Private)
  // ============================================================================
  
  _rejectPendingRequests (reason) {
    let { requests, socket } = _private.get(this)
    
    if (requests.size === 0) return
    
    socket.logger?.warn(`[Protocol] Rejecting ${requests.size} pending requests: ${reason}`)
    
    requests.forEach((request, id) => {
      clearTimeout(request.timeout)
      request.reject(new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: reason,
        protocolId: socket.getId(),
        envelopeId: id
      }))
    })
    
    requests.clear()
  }
  
  // ============================================================================
  // MESSAGE HANDLING (Private)
  // ============================================================================
  
  _handleIncomingMessage (buffer, sender) {
    // Protocol is peer-agnostic - just handle the message
    // Create envelope to read type (lazy - only reads first byte)
    const envelope = new Envelope(buffer)
    const type = envelope.type
    
    switch (type) {
      case EnvelopType.REQUEST:
        this._handleRequest(buffer)
        break
                
      case EnvelopType.TICK:
        this._handleTick(buffer)
        break
      case EnvelopType.RESPONSE:
      case EnvelopType.ERROR:
        this._handleResponse(buffer, type)
        break
    }
  }
  
  _handleResponse (buffer, type) {
    let { socket, requests } = _private.get(this)
    
    // Use Envelope for zero-copy reading
    const envelope = new Envelope(buffer)
    
    const request = requests.get(envelope.id)
    if (!request) {
      return socket.logger?.warn(`[Protocol] Response ${envelope.id} probably timed out`)
    }
    
    clearTimeout(request.timeout)
    requests.delete(envelope.id)
    
    // Deserialize response data (lazy - only if data exists)
    const data = envelope.data
    
    type === EnvelopType.ERROR ? request.reject(data) : request.resolve(data)
  }
  
  _handleRequest (buffer) {
    let { socket, requestEmitter, config } = _private.get(this)
    
    // Use Envelope for zero-copy reading (all fields lazy including data)
    const envelope = new Envelope(buffer)
    
    // Execute handler and send response
    const handlers = requestEmitter.getMatchingListeners(envelope.tag)
    
    if (handlers.length === 0) {
      // No handler - send error response
      const errorBuffer = Envelope.createBuffer({
        type: EnvelopType.ERROR,
        id: envelope.id,
        data: { message: `No handler for request: ${envelope.tag}` },
        owner: socket.getId(),
        recipient: envelope.owner
      }, config.BUFFER_STRATEGY)
      socket.sendBuffer(errorBuffer, envelope.owner)
      return
    }
    
    // Call handler (assume first handler)
    const handler = handlers[0]
    
    try {
      const result = handler(envelope.data, envelope)  // Lazy: data deserialized only if accessed
      
      // Handle async/sync responses
      Promise.resolve(result).then((responseData) => {
        const responseBuffer = Envelope.createBuffer({
          type: EnvelopType.RESPONSE,
          id: envelope.id,
          data: responseData,
          owner: socket.getId(),
          recipient: envelope.owner
        }, config.BUFFER_STRATEGY)
        socket.sendBuffer(responseBuffer, envelope.owner)
      }).catch((err) => {
        const errorBuffer = Envelope.createBuffer({
          type: EnvelopType.ERROR,
          id: envelope.id,
          data: { message: err.message || 'Handler error' },
          owner: socket.getId(),
          recipient: envelope.owner
        }, config.BUFFER_STRATEGY)
        socket.sendBuffer(errorBuffer, envelope.owner)
      })
    } catch (err) {
      // Sync error
      const errorBuffer = Envelope.createBuffer({
        type: EnvelopType.ERROR,
        id: envelope.id,
        data: { message: err.message || 'Handler error' },
        owner: socket.getId(),
        recipient: envelope.owner
      }, config.BUFFER_STRATEGY)
      socket.sendBuffer(errorBuffer, envelope.owner)
    }
  }
  
  _handleTick (buffer) {
    let { tickEmitter } = _private.get(this)
    
    // Use Envelope for zero-copy reading (all fields lazy including data)
    const envelope = new Envelope(buffer)
    
    // ✅ NO SECURITY WARNING NEEDED
    // System events are now architecturally prevented from public API (tick())
    // If we receive a system event, it's from legitimate internal sources:
    // 1. Our own Client/Server using _sendSystemTick() (trusted)
    // 2. Remote Client/Server handshake (legitimate protocol operation)
    // Users cannot send system events through public API - it throws INVALID_EVENT
    
    // Execute tick handler (fire-and-forget)
    // envelope.data is lazily deserialized only if handler accesses it
    tickEmitter.emit(envelope.tag, envelope.data, envelope)
  }
  
  // ============================================================================
  // PROTECTED API (for subclasses Client/Server)
  // ============================================================================
  
  _getSocket () {
    let { socket } = _private.get(this)
    return socket
  }
  
  _getPrivateScope () {
    return _private.get(this)
  }
}
