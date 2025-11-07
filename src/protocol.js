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

import { ZeronodeError, ErrorCodes } from './errors.js'
import { EnvelopeIdGenerator, Envelope } from './envelope.js'
import { EnvelopType, Timeouts } from './sockets/enum.js'
import { TransportEvent } from './transport-events.js'

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
// BUFFER STRATEGY (Envelope Buffer Allocation)
// ============================================================================

/**
 * Buffer allocation strategy for envelope creation
 * 
 * EXACT (default):
 *   - Allocates exact buffer size needed
 *   - Zero memory waste
 *   - More GC pressure (varied sizes)
 * 
 * POWER_OF_2:
 *   - Allocates power-of-2 bucket sizes (64, 128, 256, 512, ...)
 *   - CPU cache-friendly (aligned allocations)
 *   - Ready for buffer pooling (if lifecycle can be tracked)
 *   - ~25% memory overhead on average
 */
export const BufferStrategy = {
  EXACT: null,              // Default: exact allocation (no strategy)
  POWER_OF_2: 'power-of-2'  // Power-of-2 bucket sizes
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
    timeout = timeout || this.getConfig().REQUEST_TIMEOUT || Timeouts.REQUEST_TIMEOUT
    
    // Check if protocol is ready to send
    if (!this.isReady()) {
      let err = new Error(`Cannot send request: Protocol '${this.getId()}' is not ready`)
      return Promise.reject(new ZeronodeError({ 
        socketId: this.getId(), 
        error: err, 
        code: ErrorCodes.SOCKET_ISNOT_ONLINE 
      }))
    }
    
    let { idGenerator } = _private.get(this)
    const id = idGenerator.next()
    
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        if (requests.has(id)) {
          requests.delete(id)
          let requestTimeoutError = new Error(`Request envelope '${id}' timed out on socket '${this.getId()}'`)
          reject(new ZeronodeError({ 
            socketId: this.getId(), 
            envelopId: id, 
            error: requestTimeoutError, 
            code: ErrorCodes.REQUEST_TIMEOUTED 
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
  // TICK (fire-and-forget)
  // ============================================================================
  
  tick ({ to, event, data } = {}) {
    let { socket } = _private.get(this)
    
    // Allow system events from internal code (Client/Server)
    // System events are those starting with '_system:'
    const isSystemEvent = event.startsWith('_system:')
    validateEventName(event, isSystemEvent)
    
    // Check if transport is online (not application-level ready)
    // Application-level ready (isReady) may have additional requirements (e.g., handshake)
    if (!socket.isOnline()) {
      let err = new Error(`Cannot send tick: Socket '${this.getId()}' is not online`)
      throw new ZeronodeError({ 
        socketId: this.getId(), 
        error: err, 
        code: ErrorCodes.SOCKET_ISNOT_ONLINE 
      })
    }
    
    let { idGenerator, config } = _private.get(this)
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
      socket.logger?.info(`Protocol '${this.getId()}': Transport ready`)
      this.emit(ProtocolEvent.TRANSPORT_READY)
    })
    
    // Transport disconnected - pass through
    socket.on(TransportEvent.NOT_READY, () => {
      socket.logger?.warn(`Protocol '${this.getId()}': Transport not ready`)
      this.emit(ProtocolEvent.TRANSPORT_NOT_READY)
    })
    
    // Transport permanently closed - reject pending requests
    socket.on(TransportEvent.CLOSED, () => {
      socket.logger?.error(`Protocol '${this.getId()}': Transport closed`)
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
      request.reject(new ZeronodeError({
        socketId: socket.getId(),
        envelopId: id,
        error: new Error(reason),
        code: ErrorCodes.REQUEST_TIMEOUTED
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
    let { socket, tickEmitter } = _private.get(this)
    
    // Use Envelope for zero-copy reading (all fields lazy including data)
    const envelope = new Envelope(buffer)
    
    // Validate: Prevent spoofing of system events
    // System events (_system:*) should only come from trusted sources
    if (envelope.tag.startsWith('_system:')) {
      // Log security warning
      socket.logger?.warn(
        `[Protocol Security] Received system event '${envelope.tag}' from ${envelope.owner}. ` +
        `System events should only be sent internally. Potential spoofing attempt.`
      )
      // Still process it, but logged for monitoring
      // In production, you might want to reject it entirely
    }
    
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
