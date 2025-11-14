/**
 * PeerInfo - Metadata about a remote peer (client or server)
 * 
 * Manages:
 * - Peer identity (id, address, options)
 * - Connection state (explicit state machine)
 * - Heartbeat tracking (last ping, missed pings)
 */

// ============================================================================
// PEER STATE ENUM (Explicit State Machine)
// ============================================================================

export const PeerState = {
  IDLE: 'IDLE',               // Initial state 
  CONNECTING: 'CONNECTING',   // Connecting to server
  CONNECTED: 'CONNECTED',     // Just connected (initial state)
  HEALTHY: 'HEALTHY',         // Receiving regular pings
  GHOST: 'GHOST',             // Missed ping(s) - warning state
  FAILED: 'FAILED',           // Too many missed pings - considered dead
  STOPPED: 'STOPPED'          // Graceful shutdown (client sent disconnect)
}

// ============================================================================
// PEER INFO CLASS
// ============================================================================

export default class PeerInfo {
  constructor ({ id, address, options, role } = {}) {
    // Identity
    this.id = id
    this.address = address
    this.options = options || {}
    this.role = role // 'server' or 'client' (optional, for debugging)
    
    // State management
    this.state = PeerState.IDLE
    this.connectedAt = null
    this.lastStateChange = Date.now()
    
    // Heartbeat tracking
    this.lastSeen = Date.now()  // ✅ Track last activity
    this.lastPing = null
    this.missedPings = 0
  }
  
  // ============================================================================
  // STATE QUERIES
  // ============================================================================
  
  isConnected () {
    return this.state === PeerState.CONNECTED
  }
  
  isHealthy () {
    return this.state === PeerState.HEALTHY
  }
  
  isGhost () {
    return this.state === PeerState.GHOST
  }
  
  isFailed () {
    return this.state === PeerState.FAILED
  }
  
  isStopped () {
    return this.state === PeerState.STOPPED
  }
  
  isOnline () {
    return (
      this.state === PeerState.CONNECTED ||
      this.state === PeerState.HEALTHY ||
      this.state === PeerState.GHOST
    )
  }
  
  // ============================================================================
  // STATE TRANSITIONS
  // ============================================================================
  
  transition (newState, reason = '') {
    const oldState = this.state
    this.state = newState
    this.lastStateChange = Date.now()
    
    // Record the first time we become CONNECTED
    if (newState === PeerState.CONNECTED && this.connectedAt == null) {
      this.connectedAt = this.lastStateChange
    }
    
    // Could add logging here if needed
    // console.log(`Peer ${this.id}: ${oldState} → ${newState} ${reason ? `(${reason})` : ''}`)
  }
  
  // Convenience method: Set state directly (used by Client/Server)
  setState (newState) {
    this.transition(newState)
  }
  
  getState () {
    return this.state
  }
  
  setOnline () {
    this.transition(PeerState.HEALTHY, 'setOnline')
    this.missedPings = 0
  }
  
  setOffline () {
    // Offline is either FAILED or STOPPED (caller decides)
    if (this.state !== PeerState.STOPPED) {
      this.transition(PeerState.FAILED, 'setOffline')
    }
  }
  
  markGhost () {
    this.transition(PeerState.GHOST, 'missed ping')
    this.missedPings++
  }
  
  markFailed () {
    this.transition(PeerState.FAILED, 'too many missed pings')
    this.missedPings = 0
  }
  
  markStopped () {
    this.transition(PeerState.STOPPED, 'graceful shutdown')
    this.missedPings = 0
  }
  
  // ============================================================================
  // HEARTBEAT
  // ============================================================================
  
  updateLastSeen (timestamp) {
    this.lastSeen = timestamp || Date.now()
  }
  
  getLastSeen () {
    return this.lastSeen
  }
  
  ping (timestamp) {
    this.lastPing = timestamp || Date.now()
    this.lastSeen = this.lastPing  // ✅ Update last seen on ping
    this.missedPings = 0
    
    // Successful ping → restore to healthy state
    if (this.state === PeerState.GHOST || this.state === PeerState.CONNECTED) {
      this.transition(PeerState.HEALTHY, 'ping received')
    }
  }
  
  // ============================================================================
  // IDENTITY GETTERS/SETTERS
  // ============================================================================
  
  getId () {
    return this.id
  }
  
  setId (newId) {
    this.id = newId
  }
  
  getAddress () {
    return this.address
  }
  
  setAddress (address) {
    this.address = address
  }
  
  getOptions () {
    return this.options
  }
  
  setOptions (options) {
    this.options = options
  }
  
  mergeOptions (options) {
    this.options = Object.assign({}, this.options, options)
    return this.options
  }
  
  // ============================================================================
  // SERIALIZATION
  // ============================================================================
  
  toJSON () {
    return {
      id: this.id,
      address: this.address,
      options: this.options,
      role: this.role,
      state: this.state,
      online: this.isOnline(),
      // Legacy fields for backward compatibility
      ghost: this.isGhost(),
      fail: this.isFailed(),
      stop: this.isStopped(),
      // Additional metadata
      connectedAt: this.connectedAt,
      lastPing: this.lastPing,
      missedPings: this.missedPings
    }
  }
}

