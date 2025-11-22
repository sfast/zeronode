/**
 * Lifecycle Manager
 * 
 * **What**: Manages protocol lifecycle - event translation, cleanup, and resource management
 * **Why**: Centralizes all lifecycle concerns (attach/detach listeners, cleanup, close)
 * **Clean separation**: Event translation ↔ Business logic
 */

import { TransportEvent } from '../transport/events.js'
import { ProtocolError, ProtocolErrorCode } from './protocol-errors.js'

export const ProtocolEvent = {
  // Transport state changes (simplified)
  TRANSPORT_READY: 'protocol:transport_ready',       // Transport can send/receive bytes
  TRANSPORT_NOT_READY: 'protocol:transport_not_ready', // Transport disconnected/unbound
  TRANSPORT_CLOSED: 'protocol:transport_closed',      // Transport permanently closed
  ERROR: 'protocol:error'                             // Protocol-surfaced transport/protocol error
}

export class LifecycleManager {
  constructor(context, requestTracker, dispatcher, protocolEmitter) {
    this.ctx = context
    this.requestTracker = requestTracker
    this.dispatcher = dispatcher
    this.protocolEmitter = protocolEmitter
    this.closed = false
    
    // Bind handlers to preserve 'this' context
    this._onMessage = this._onMessage.bind(this)
    this._onReady = this._onReady.bind(this)
    this._onNotReady = this._onNotReady.bind(this)
    this._onClosed = this._onClosed.bind(this)
    this._onError = this._onError.bind(this)
  }
  
  // ============================================================================
  // SOCKET EVENT HANDLERS → PROTOCOL EVENT TRANSLATION
  // ============================================================================
  
  /**
   * Attach transport event listeners
   * Translates TransportEvent → ProtocolEvent
   */
  attachSocketEventHandlers() {
    // ============================================================================
    // SIMPLIFIED EVENT TRANSLATION
    // 
    // Protocol just passes through 4 transport events - no state management!
    // 
    // TransportEvent (4 events):     ProtocolEvent (pass-through):
    // - READY                     →  TRANSPORT_READY
    // - NOT_READY                 →  TRANSPORT_NOT_READY  
    // - MESSAGE                   →  handled below (dispatch to handlers)
    // - CLOSED                    →  TRANSPORT_CLOSED + cleanup
    // 
    // Client/Server handle:
    // - Handshake logic (when to send CLIENT_CONNECTED, etc.)
    // - Peer management (tracking connected peers)
    // - Session state (HEALTHY, GHOST, etc.)
    // 
    // Protocol only handles:
    // - Request/response matching (via RequestTracker)
    // - Tick/request handler execution (via MessageDispatcher)
    // - Message parsing (via Envelope)
    // ============================================================================
    
    this.ctx.socket.on(TransportEvent.MESSAGE, this._onMessage)
    this.ctx.socket.on(TransportEvent.READY, this._onReady)
    this.ctx.socket.on(TransportEvent.NOT_READY, this._onNotReady)
    this.ctx.socket.on(TransportEvent.CLOSED, this._onClosed)
    this.ctx.socket.on(TransportEvent.ERROR, this._onError)
  }
  
  /**
   * Detach transport event listeners
   * Safe to call multiple times (idempotent)
   */
  detachSocketEventHandlers() {
    if (!this.ctx.socket || typeof this.ctx.socket.removeAllListeners !== 'function') return
    
    try {
      this.ctx.socket.removeAllListeners(TransportEvent.MESSAGE)
      this.ctx.socket.removeAllListeners(TransportEvent.READY)
      this.ctx.socket.removeAllListeners(TransportEvent.NOT_READY)
      this.ctx.socket.removeAllListeners(TransportEvent.CLOSED)
      this.ctx.socket.removeAllListeners(TransportEvent.ERROR)
      
      this.ctx.debug && this.ctx.logger?.debug('[Lifecycle] Detached socket event handlers')
    } catch (err) {
      this.ctx.debug && this.ctx.logger?.error('[Lifecycle] Failed to detach socket event listeners', err)
    }
  }
  
  // ============================================================================
  // EVENT HANDLERS (Private)
  // ============================================================================
  
  /**
   * Handle incoming message from transport
   * @private
   */
  _onMessage({ buffer, sender }) {
    // Dispatch to MessageDispatcher for routing
    this.dispatcher.dispatch(buffer, sender)
  }
  
  /**
   * Handle transport ready (can send/receive)
   * @private
   */
  _onReady() {
    this.ctx.debug && this.ctx.logger?.info(`[Lifecycle] Transport ready (${this.ctx.protocolId})`)
    this.protocolEmitter.emit(ProtocolEvent.TRANSPORT_READY)
  }
  
  /**
   * Handle transport not ready (disconnected/unbound)
   * @private
   */
  _onNotReady() {
    this.ctx.debug && this.ctx.logger?.warn(`[Lifecycle] Transport not ready (${this.ctx.protocolId})`)
    this.protocolEmitter.emit(ProtocolEvent.TRANSPORT_NOT_READY)
  }
  
  /**
   * Handle transport permanently closed
   * Reject pending requests, cleanup handlers, and emit event
   * @private
   */
  _onClosed() {
    this.ctx.debug && this.ctx.logger?.error(`[Lifecycle] Transport closed (${this.ctx.protocolId})`)
    
    // Reject all pending requests
    this.requestTracker.rejectAll('Transport closed')
    
    // Remove all handlers (request/tick)
    this.dispatcher.removeAllHandlers()
    
    // Emit protocol event
    this.protocolEmitter.emit(ProtocolEvent.TRANSPORT_CLOSED)
    
    // Auto-detach handlers on unexpected close
    this.detachSocketEventHandlers()
  }
  
  /**
   * Handle transport error
   * Surface as protocol-level error
   * @private
   */
  _onError(err) {
    this.ctx.debug && this.ctx.logger?.error(`[Lifecycle] Transport error (${this.ctx.protocolId})`, err)
    this.protocolEmitter.emit(ProtocolEvent.ERROR, err)
  }
  
  // ============================================================================
  // CLEANUP API
  // ============================================================================
  
  /**
   * Disconnect protocol from transport events without closing or rejecting pending.
   * - Idempotent: safe to call multiple times
   * - Does NOT set closed flag
   * - Does NOT reject pending requests
   * - Does NOT close underlying transport
   */
  async disconnect() {
    await this.ctx.socket.disconnect()
  }
  
  /**
   * Unbind protocol from transport events without closing or rejecting pending.
   * - Idempotent: safe to call multiple times
   * - Does NOT set closed flag
   * - Does NOT reject pending requests
   * - Does NOT close underlying transport
   */
  async unbind() {
    // Keep socket event handlers attached so further transport events (e.g., CLOSED)
    // still propagate through Protocol to consumers. Just unbind transport here.
    await this.ctx.socket.unbind()
  }
  
  /**
   * Close the protocol and cleanup resources.
   * - Idempotent
   * - Closes the underlying transport (which triggers CLOSED event → full cleanup)
   * - CLOSED event handler will: reject pending requests, remove handlers, detach listeners
   * 
   * Note: This always closes the transport. Use disconnect() or unbind() if you want
   * to keep the transport alive but stop the protocol.
   */
  async close() {
    if (this.closed) return
    this.closed = true
    
    // Close the transport - this will trigger CLOSED event which does full cleanup
    if (this.ctx.socket && typeof this.ctx.socket.close === 'function') {
      try {
        await this.ctx.socket.close()
      } catch (err) {
        this.ctx.debug && this.ctx.logger?.error('[Lifecycle] Failed to close transport', err)
      }
    }
    
    this.ctx.debug && this.ctx.logger?.debug('[Lifecycle] Protocol closed')
  }
}

