/**
 * TransportEvent - Minimal Transport Interface
 * 
 * This defines the MINIMAL event contract that ANY transport must implement.
 * Protocol depends ONLY on these 4 events - nothing transport-specific!
 * 
 * Philosophy:
 * - Transport = Physical connection (bytes over wire)
 * - Protocol = Logical session (handshake, ping, request/response)
 * - Application = Business logic (Client/Server)
 * 
 * Implementations:
 * - ZMQ Socket (DEALER/ROUTER)
 * - Socket.IO
 * - HTTP Client/Server
 * - WebSocket
 * - NATS
 * - Redis pub/sub
 * - etc.
 * 
 * Any transport that emits these 4 events can work with Protocol!
 */

export const TransportEvent = {
  // ============================================================================
  // Connection State (2 events)
  // ============================================================================
  
  /**
   * READY - Transport can send/receive bytes
   * 
   * Client: TCP connected to server
   * Server: Bound to port, can accept connections
   * 
   * This does NOT mean "ready for business logic" - just "ready for bytes"
   * Protocol will handle handshake logic on top of this
   */
  READY: 'transport:ready',
  
  /**
   * NOT_READY - Transport cannot send/receive
   * 
   * Client: Disconnected (might reconnect automatically)
   * Server: Unbound
   * 
   * Transport may try to reconnect automatically (ZMQ does this)
   * Protocol will handle session restoration if READY fires again
   */
  NOT_READY: 'transport:not_ready',
  
  // ============================================================================
  // Data (1 event)
  // ============================================================================
  
  /**
   * MESSAGE - Received bytes from remote
   * 
   * Payload: { buffer: Buffer, sender?: string }
   * 
   * - buffer: Raw bytes received
   * - sender: Optional sender ID (Router has this, Dealer doesn't)
   * 
   * Protocol parses the buffer to determine message type
   */
  MESSAGE: 'transport:message',
  
  // ============================================================================
  // Lifecycle (1 event)
  // ============================================================================
  
  /**
   * CLOSED - Transport permanently shut down
   * 
   * No more reconnection attempts, transport is dead
   * Protocol will clean up and reject pending requests
   */
  CLOSED: 'transport:closed',
  
  /**
   * ERROR - Transport-level error surfaced by the transport implementation
   * 
   * Payload: TransportError instance (see src/transport/errors.js)
   * Use for observability; protocol may still continue operating depending on error.
   */
  ERROR: 'transport:error',
  
  /**
   * RECONNECT_RETRY - Transport is retrying connection (optional, for observability)
   * 
   * Only emitted by transports that auto-reconnect (e.g., ZeroMQ dealer)
   * Payload: { fd, endpoint } or similar transport-specific details
   * 
   * Not required for core protocol functionality, but useful for logging/debugging
   */
  RECONNECT_RETRY: 'transport:reconnect_retry'
}

/**
 * Transport Interface (for reference)
 * 
 * Any transport implementation should provide:
 * 
 * class MyTransport extends EventEmitter {
 *   // Required methods:
 *   sendBuffer(buffer, recipient?)           // Send raw buffer
 *   getId()                                   // Get transport ID
 *   getConfig()                               // Get configuration
 *   isOnline()                                // Check if online
 *   close()                                   // Close transport
 *   
 *   // Required events (emit using TransportEvent):
 *   - CONNECT / LISTEN (when ready)
 *   - DISCONNECT (when lost connection)
 *   - message ({ buffer, sender? })
 *   
 *   // Optional events:
 *   - RECONNECT, RECONNECT_FAILURE, ACCEPT, etc.
 * }
 */

