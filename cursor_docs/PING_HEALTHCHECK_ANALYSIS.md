# Ping & Health Check Mechanism Analysis

**Date**: November 17, 2025  
**ZeroNode Version**: 2.0.1

---

## 📋 Executive Summary

ZeroNode implements a **bi-directional health monitoring system** where:
- **Clients** send periodic **pings** to the server
- **Server** runs periodic **health checks** to detect inactive clients
- **No connection/reconnection timeouts** at the Protocol/Client/Server layer (all handled by ZeroMQ transport)

---

## 1️⃣ Client Ping Mechanism

### Purpose
Send periodic heartbeat messages to inform the server that the client is alive and connected.

### Implementation
**File**: `src/protocol/client.js`

```javascript
// Lines 305-344
_startPing() {
  let _scope = _private.get(this)
  
  // Don't start multiple ping intervals
  if (_scope.pingInterval) {
    return
  }
  
  const config = this.getConfig()
  const pingInterval = (config.PING_INTERVAL ?? config.pingInterval) || 
                       Globals.CLIENT_PING_INTERVAL || 10000
  
  _scope.pingInterval = setInterval(() => {
    if (this.isReady()) {
      const { serverPeerInfo } = _private.get(this)
      const serverId = serverPeerInfo?.getId()
      
      if (!serverId) {
        this.debug && this.logger?.warn('Cannot send ping: server ID unknown')
        return
      }
      
      // ✅ Send ping with explicit recipient using internal API
      this._sendSystemTick({
        to: serverId,  // ✅ Now we know server ID!
        event: ProtocolSystemEvent.CLIENT_PING,
        // No data needed for ping, we have timestamp in each envelope
        data: null
      })
    }
  }, pingInterval)
}

_stopPing() {
  let _scope = _private.get(this)
  
  if (_scope.pingInterval) {
    clearInterval(_scope.pingInterval)
    _scope.pingInterval = null
  }
}
```

### Lifecycle

```
Client Connection Flow:
┌─────────────────────────────────────────────────────────────┐
│ 1. client.connect(serverAddress)                          │
│    ↓                                                        │
│ 2. Transport connects (Dealer → Router)                    │
│    ↓                                                        │
│ 3. TRANSPORT_READY event                                   │
│    ↓                                                        │
│ 4. Send _system:handshake_init_from_client                │
│    ↓                                                        │
│ 5. Receive _system:handshake_ack_from_server              │
│    ↓                                                        │
│ 6. ✅ _startPing() [STARTS HERE]                          │
│    ↓                                                        │
│ 7. Emit ClientEvent.READY                                  │
└─────────────────────────────────────────────────────────────┘

Ping Interval Behavior:
┌────────────────────────────────────────────────────────────┐
│ Every CLIENT_PING_INTERVAL (default: 10 seconds)          │
│   ↓                                                         │
│   if (client.isReady())                                    │
│     ↓                                                       │
│     Send _system:CLIENT_PING to serverId                  │
│       ↓                                                     │
│       Server receives ping                                 │
│       Server updates peerInfo.lastSeen                     │
│       Server sets peer state to HEALTHY                    │
└────────────────────────────────────────────────────────────┘

Ping Stops When:
┌────────────────────────────────────────────────────────────┐
│ • client.disconnect() called                               │
│ • ClientEvent.DISCONNECTED (transport not ready)           │
│ • ClientEvent.FAILED (transport closed)                    │
│ • ClientEvent.STOPPED (explicit stop)                      │
└────────────────────────────────────────────────────────────┘
```

### Configuration

```javascript
// globals.js
CLIENT_PING_INTERVAL: 10000  // 10 seconds

// Usage in Client constructor
const client = new Client({
  id: 'my-client',
  config: {
    PING_INTERVAL: 5000  // Override: ping every 5s
    // OR
    pingInterval: 5000   // Alternative camelCase format (backward compat)
  }
})
```

---

## 2️⃣ Server Health Check Mechanism

### Purpose
Periodically check all connected clients for inactivity. Mark clients as **GHOST** if they haven't sent a ping within the `CLIENT_GHOST_TIMEOUT`.

### Implementation
**File**: `src/protocol/server.js`

```javascript
// Lines 240-264
_startHealthChecks() {
  let _scope = _private.get(this)
  
  // Don't start multiple health check intervals
  if (_scope.healthCheckInterval) {
    return
  }
  
  const config = this.getConfig()
  const checkInterval = (config.CLIENT_HEALTH_CHECK_INTERVAL ?? 
                         config.clientHealthCheckInterval) || 
                         Globals.CLIENT_HEALTH_CHECK_INTERVAL || 30000
  const ghostThreshold = (config.CLIENT_GHOST_TIMEOUT ?? 
                          config.clientGhostTimeout) || 
                          Globals.CLIENT_GHOST_TIMEOUT || 60000
  
  _scope.healthCheckInterval = setInterval(() => {
    this._checkClientHealth(ghostThreshold)
  }, checkInterval)
}

_stopHealthChecks() {
  let _scope = _private.get(this)
  
  if (_scope.healthCheckInterval) {
    clearInterval(_scope.healthCheckInterval)
    _scope.healthCheckInterval = null
  }
}

// Lines 266-287
_checkClientHealth(ghostThreshold) {
  let { clientPeers } = _private.get(this)
  const now = Date.now()
  
  clientPeers.forEach((peerInfo, clientId) => {
    const timeSinceLastSeen = now - peerInfo.getLastSeen()
    
    if (timeSinceLastSeen > ghostThreshold) {
      const previousState = peerInfo.getState()
      peerInfo.setState('GHOST')
      
      // Emit event if state changed
      if (previousState !== 'GHOST') {
        this.emit(ServerEvent.CLIENT_TIMEOUT, { 
          clientId, 
          lastSeen: peerInfo.getLastSeen(),
          timeSinceLastSeen 
        })
      }
    }
  })
}
```

### Client Ping Handler

```javascript
// Lines 139-149
this.onTick(ProtocolSystemEvent.CLIENT_PING, (envelope) => {
  let { clientPeers } = _private.get(this)
  
  const clientId = envelope.owner
  const peerInfo = clientPeers.get(clientId)
  
  if (peerInfo) {
    peerInfo.updateLastSeen()  // ✅ Update timestamp
    peerInfo.setState('HEALTHY')  // ✅ Restore health
  }
})
```

### Lifecycle

```
Server Health Check Flow:
┌─────────────────────────────────────────────────────────────┐
│ 1. server.bind(address)                                     │
│    ↓                                                         │
│ 2. Transport binds (Router ready)                           │
│    ↓                                                         │
│ 3. TRANSPORT_READY event                                    │
│    ↓                                                         │
│ 4. ✅ _startHealthChecks() [STARTS HERE]                   │
│    ↓                                                         │
│ 5. Emit ServerEvent.READY                                   │
└─────────────────────────────────────────────────────────────┘

Health Check Interval Behavior:
┌────────────────────────────────────────────────────────────┐
│ Every CLIENT_HEALTH_CHECK_INTERVAL (default: 30 seconds)  │
│   ↓                                                         │
│   For each client in clientPeers:                          │
│     ↓                                                       │
│     timeSinceLastSeen = now - peer.lastSeen                │
│     ↓                                                       │
│     if (timeSinceLastSeen > CLIENT_GHOST_TIMEOUT):         │
│       ↓                                                     │
│       peer.setState('GHOST')                               │
│       emit ServerEvent.CLIENT_TIMEOUT                      │
└────────────────────────────────────────────────────────────┘

Health Checks Stop When:
┌────────────────────────────────────────────────────────────┐
│ • server.unbind() called                                    │
│ • ServerEvent.NOT_READY (transport not ready)              │
│ • ServerEvent.CLOSED (transport closed)                    │
└────────────────────────────────────────────────────────────┘
```

### Configuration

```javascript
// globals.js
CLIENT_HEALTH_CHECK_INTERVAL: 30000,  // Check every 30 seconds
CLIENT_GHOST_TIMEOUT: 60000           // Mark as ghost after 60s

// Usage in Server constructor
const server = new Server({
  id: 'my-server',
  config: {
    CLIENT_HEALTH_CHECK_INTERVAL: 10000,  // Check every 10s
    CLIENT_GHOST_TIMEOUT: 20000,          // Ghost after 20s
    // OR alternative camelCase format (backward compat)
    clientHealthCheckInterval: 10000,
    clientGhostTimeout: 20000
  }
})
```

---

## 3️⃣ Peer State Tracking

### PeerInfo States
**File**: `src/protocol/peer.js`

```javascript
export const PeerState = {
  IDLE: 'IDLE',             // Initial state, not yet active
  CONNECTING: 'CONNECTING', // Connection in progress
  CONNECTED: 'CONNECTED',   // Transport connected
  HEALTHY: 'HEALTHY',       // Active and sending pings
  GHOST: 'GHOST',           // Inactive, missed pings
  FAILED: 'FAILED',         // Connection permanently failed
  STOPPED: 'STOPPED'        // Explicitly stopped
}
```

### lastSeen Tracking

```javascript
// Lines 42, 137-148
class PeerInfo {
  constructor() {
    this.lastSeen = Date.now()  // ✅ Initialize on creation
    // ...
  }
  
  updateLastSeen(timestamp) {
    this.lastSeen = timestamp || Date.now()
  }
  
  getLastSeen() {
    return this.lastSeen
  }
  
  ping(timestamp) {
    this.lastPing = timestamp || Date.now()
    this.lastSeen = this.lastPing  // ✅ Update last seen on ping
    this.missedPings = 0
    
    // Successful ping → restore to healthy state
    if (this.state === 'GHOST') {
      this.setState('HEALTHY')
    }
  }
}
```

### State Transitions (Client-Side)

```
Client Peer State (serverPeerInfo):
┌──────────┐
│   IDLE   │ (after constructor, before handshake)
└────┬─────┘
     │ Handshake complete
     ▼
┌──────────┐
│ HEALTHY  │ (handshake ACK received, ping started)
└────┬─────┘
     │ Transport NOT_READY
     ▼
┌──────────┐
│  GHOST   │ (disconnected, pings stopped)
└────┬─────┘
     │ Transport CLOSED
     ▼
┌──────────┐
│  FAILED  │ (permanent failure)
└──────────┘
     OR
     │ Client explicitly stops
     ▼
┌──────────┐
│ STOPPED  │ (graceful shutdown)
└──────────┘
```

### State Transitions (Server-Side)

```
Server Peer State (clientPeerInfo):
┌──────────┐
│   IDLE   │ (client created in map, before handshake complete)
└────┬─────┘
     │ Handshake complete
     ▼
┌──────────┐
│ CONNECTED│ (handshake done, waiting for first ping)
└────┬─────┘
     │ First CLIENT_PING received
     ▼
┌──────────┐
│ HEALTHY  │ (actively sending pings)
└────┬─────┘
     │ No ping for > CLIENT_GHOST_TIMEOUT
     ▼
┌──────────┐
│  GHOST   │ (health check detected inactivity)
└────┬─────┘
     │ CLIENT_PING received
     ▼
┌──────────┐
│ HEALTHY  │ (client recovered)
└────┬─────┘
     OR
     │ CLIENT_STOP received
     ▼
┌──────────┐
│ STOPPED  │ (graceful client disconnect)
└──────────┘
```

---

## 4️⃣ Connection & Reconnection Timeouts

### ❌ NO Application-Level Timeouts in Protocol/Client/Server

**Important**: The Protocol, Client, and Server layers **DO NOT** implement their own connection or reconnection timeouts. This is **intentional** and follows the **separation of concerns**:

- **Transport Layer** (ZeroMQ) handles:
  - Initial connection attempts
  - Automatic reconnection
  - Connection timeouts
  - Reconnection timeouts

- **Protocol/Client/Server Layer** handles:
  - Application-level handshake
  - Health monitoring (pings/health checks)
  - Peer state management
  - Event propagation

### Transport-Level Timeouts

**File**: `src/transport/zeromq/config.js`

```javascript
export const ZMQConfigDefaults = {
  // ZeroMQ Native Reconnection
  ZMQ_RECONNECT_IVL: 100,          // Retry every 100ms
  ZMQ_RECONNECT_IVL_MAX: 0,        // No exponential backoff
  
  // Application-Level Timeouts (Transport Layer)
  CONNECTION_TIMEOUT: -1,          // Infinite (wait forever for initial connection)
  RECONNECTION_TIMEOUT: -1,        // Infinite (never give up on reconnection)
  INFINITY: -1,                    // Constant for infinite timeout
}
```

### How Transport Timeouts Work

```
Initial Connection (Dealer.connect):
┌────────────────────────────────────────────────────────────┐
│ await dealer.connect('tcp://server:5000')                 │
│   ↓                                                         │
│   Start CONNECTION_TIMEOUT timer                           │
│   ↓                                                         │
│   ZeroMQ attempts connection (ZMQ_RECONNECT_IVL)          │
│   ↓                                                         │
│   if (connected): ✅ Emit TransportEvent.READY            │
│   if (timeout):   ❌ Throw CONNECTION_TIMEOUT error        │
└────────────────────────────────────────────────────────────┘

Reconnection (Automatic by ZeroMQ):
┌────────────────────────────────────────────────────────────┐
│ Connection lost                                            │
│   ↓                                                         │
│   Emit TransportEvent.NOT_READY                            │
│   ↓                                                         │
│   Start RECONNECTION_TIMEOUT timer (if not -1)            │
│   ↓                                                         │
│   ZeroMQ auto-reconnects (ZMQ_RECONNECT_IVL)              │
│   ↓                                                         │
│   if (reconnected): ✅ Emit TransportEvent.READY          │
│   if (timeout):     ❌ Emit TransportEvent.CLOSED          │
└────────────────────────────────────────────────────────────┘
```

### Why No Timeouts at Protocol Layer?

**Design Principle**: **Separation of Concerns**

1. **Transport Layer** (Dealer/Router):
   - ✅ Knows about sockets, connections, network
   - ✅ Handles physical connectivity
   - ✅ Manages ZeroMQ-specific behavior

2. **Protocol Layer**:
   - ❌ Doesn't know about sockets directly
   - ❌ Doesn't manage connections
   - ✅ Relies on TransportEvent.READY / NOT_READY / CLOSED
   - ✅ Implements application-level logic (handshake, pings)

3. **Client/Server Layer**:
   - ❌ Doesn't know about transport implementation
   - ✅ Listens to ProtocolEvent (never TransportEvent)
   - ✅ Manages application-level peer state
   - ✅ Implements health monitoring (pings/health checks)

---

## 5️⃣ Complete Event Flow

### Client → Server Ping Flow

```
                CLIENT                           SERVER
                ──────                           ──────
                                                
1. Handshake Complete                           
   _startPing()                                 
                                                
2. Every 10s (CLIENT_PING_INTERVAL)             
   ↓                                            
   Send _system:CLIENT_PING ─────────────────→  Receive CLIENT_PING
                                                 ↓
                                                 peerInfo.updateLastSeen()
                                                 peerInfo.setState('HEALTHY')
                                                
3. Every 30s (CLIENT_HEALTH_CHECK_INTERVAL)     
                                                 ↓
                                                 _checkClientHealth()
                                                 ↓
                                                 timeSinceLastSeen = now - lastSeen
                                                 ↓
                                                 if (> 60s):
                                                   setState('GHOST')
                                                   emit CLIENT_TIMEOUT
```

### Client Disconnect Flow

```
                CLIENT                           SERVER
                ──────                           ──────
                
1. client.disconnect()                          
   ↓                                            
   _stopPing()  ❌ Stop sending pings          
   ↓                                            
   Send _system:CLIENT_STOP ─────────────────→  Receive CLIENT_STOP
   ↓                                             ↓
   await socket.disconnect()                     peerInfo.setState('STOPPED')
   ↓                                             emit CLIENT_LEFT
   emit DISCONNECTED                             
                                                
2. No pings for 60s                              
                                                 ↓
                                                 Health check runs
                                                 ↓
                                                 timeSinceLastSeen > 60s
                                                 ↓
                                                 setState('GHOST')
                                                 emit CLIENT_TIMEOUT ⚠️
```

### Connection Lost (Automatic Reconnection)

```
                CLIENT                           SERVER
                ──────                           ──────
                
1. Network failure / Router crash               
   ↓                                            
   TransportEvent.NOT_READY                     
   ↓                                            
   ProtocolEvent.TRANSPORT_NOT_READY            
   ↓                                            
   ClientEvent.DISCONNECTED                     
   ↓                                            
   _stopPing() ❌                               
   serverPeerInfo.setState('GHOST')             
                                                
2. ZeroMQ auto-reconnects...                    
   (Transport keeps trying)                     
                                                
3. No pings received                             
                                                 ↓
                                                 Health check runs
                                                 ↓
                                                 timeSinceLastSeen > 60s
                                                 ↓
                                                 setState('GHOST')
                                                 emit CLIENT_TIMEOUT ⚠️
                                                
4. Connection restored                          
   ↓                                            
   TransportEvent.READY                         
   ↓                                            
   Send _system:handshake_init ───────────────→  Receive handshake
   ↓                                             ↓
   Receive handshake_ack ←────────────────────  Send handshake_ack
   ↓                                             ↓
   _startPing() ✅ Resume pings                 peerInfo already exists
   ↓                                             ↓
   Send CLIENT_PING ──────────────────────────→  updateLastSeen()
                                                 setState('HEALTHY') ✅
                                                 (Ghost recovered!)
```

---

## 6️⃣ Configuration Summary

### Default Values

```javascript
// From globals.js
export default {
  // Protocol request timeout
  PROTOCOL_REQUEST_TIMEOUT: 10000,   // 10 seconds
  
  // Client ping interval
  CLIENT_PING_INTERVAL: 10000,       // 10 seconds
  
  // Server health check interval
  CLIENT_HEALTH_CHECK_INTERVAL: 30000,  // 30 seconds
  
  // Client considered GHOST after 60s without ping
  CLIENT_GHOST_TIMEOUT: 60000        // 60 seconds
}

// From transport/zeromq/config.js
export const ZMQConfigDefaults = {
  // Transport-level timeouts
  CONNECTION_TIMEOUT: -1,          // Infinite
  RECONNECTION_TIMEOUT: -1,        // Infinite
  
  // ZeroMQ reconnection
  ZMQ_RECONNECT_IVL: 100,          // 100ms
  ZMQ_RECONNECT_IVL_MAX: 0,        // No backoff
}
```

### Recommended Configurations

#### Production Client (Resilient)

```javascript
const client = new Client({
  id: 'prod-client',
  config: {
    // Client pings every 5s (faster health reporting)
    PING_INTERVAL: 5000,
    
    // Protocol request timeout (10s default is fine)
    PROTOCOL_REQUEST_TIMEOUT: 10000,
    
    // Transport config (passed through to Dealer)
    CONNECTION_TIMEOUT: -1,         // Wait forever for initial
    RECONNECTION_TIMEOUT: -1,       // Never give up
    ZMQ_RECONNECT_IVL: 100,         // Fast reconnection
    ZMQ_RECONNECT_IVL_MAX: 0,       // No backoff
  }
})
```

#### Production Server (High Availability)

```javascript
const server = new Server({
  id: 'prod-server',
  config: {
    // Check health every 10s (faster detection)
    CLIENT_HEALTH_CHECK_INTERVAL: 10000,
    
    // Mark as ghost after 30s (3 missed pings at 10s interval)
    CLIENT_GHOST_TIMEOUT: 30000,
    
    // Protocol request timeout
    PROTOCOL_REQUEST_TIMEOUT: 10000,
  }
})
```

#### Test Environment (Fast Timeouts)

```javascript
// Client
const client = new Client({
  config: {
    PING_INTERVAL: 100,              // Ping every 100ms
    PROTOCOL_REQUEST_TIMEOUT: 1000,  // 1s timeout
  }
})

// Server
const server = new Server({
  config: {
    CLIENT_HEALTH_CHECK_INTERVAL: 50,  // Check every 50ms
    CLIENT_GHOST_TIMEOUT: 200,         // Ghost after 200ms
  }
})
```

---

## 7️⃣ Key Insights

### ✅ What Works Well

1. **Separation of Concerns**
   - Transport handles connectivity
   - Protocol handles messaging
   - Client/Server handle application logic
   - Ping/health checks are application-level features

2. **Automatic Recovery**
   - Clients automatically resume pings after reconnection
   - Server automatically restores GHOST clients to HEALTHY on ping
   - No manual intervention needed

3. **Configurable Timing**
   - All intervals and timeouts are configurable
   - Default values work well for production
   - Easy to tune for specific needs

4. **Clear Event Model**
   - `ClientEvent.READY` → client is fully connected and ready
   - `ClientEvent.DISCONNECTED` → transport lost, will reconnect
   - `ClientEvent.FAILED` → transport permanently closed
   - `ServerEvent.CLIENT_TIMEOUT` → client went silent (GHOST)
   - `ServerEvent.CLIENT_LEFT` → client gracefully disconnected

### ⚠️ Edge Cases to Consider

1. **Client stops sending pings but transport stays connected**
   - Example: Client process freezes, OS doesn't close socket
   - Server health check will correctly detect and mark as GHOST ✅

2. **Client reconnects but server still has old peer**
   - Server reuses existing peerInfo on handshake
   - First ping after reconnect restores to HEALTHY ✅

3. **Very short timeouts in production**
   - Risk: False positives from network jitter
   - Recommendation: CLIENT_GHOST_TIMEOUT >= 3 × CLIENT_PING_INTERVAL

4. **Client sends pings but server health check too slow**
   - Risk: Unnecessary GHOST state
   - Recommendation: CLIENT_HEALTH_CHECK_INTERVAL < CLIENT_GHOST_TIMEOUT

### 📊 Timing Relationships

```
Recommended Ratios:
─────────────────────────────────────────────────────────

CLIENT_PING_INTERVAL (10s)
  ↓ 3x multiplier
CLIENT_HEALTH_CHECK_INTERVAL (30s)
  ↓ 2x multiplier
CLIENT_GHOST_TIMEOUT (60s)

This ensures:
✅ Server checks health 3x per ghost timeout window
✅ At most 2 health checks can miss before ghost
✅ Tolerates network jitter and timing skew
```

---

## 8️⃣ Testing Recommendations

### Unit Tests

```javascript
// Client ping tests
describe('Client Ping Mechanism', () => {
  it('should start ping after handshake complete')
  it('should stop ping on disconnect')
  it('should not send ping if not ready')
  it('should use configured PING_INTERVAL')
  it('should not start multiple ping intervals')
})

// Server health check tests
describe('Server Health Check Mechanism', () => {
  it('should start health checks when transport ready')
  it('should stop health checks on unbind')
  it('should mark client as GHOST after timeout')
  it('should emit CLIENT_TIMEOUT only once per state change')
  it('should restore GHOST client to HEALTHY on ping')
  it('should use configured intervals and timeouts')
})
```

### Integration Tests

```javascript
describe('Ping & Health Check Integration', () => {
  it('should maintain HEALTHY state with regular pings')
  it('should mark client as GHOST when pings stop')
  it('should recover from GHOST to HEALTHY when pings resume')
  it('should handle client reconnection correctly')
  it('should handle multiple clients independently')
})
```

---

## 9️⃣ Future Improvements

### Potential Enhancements

1. **Adaptive Ping Interval**
   - Increase ping frequency under high load
   - Decrease under low load to save bandwidth

2. **Ping Response (Pong)**
   - Optional two-way ping/pong for RTT measurement
   - Helps detect network latency issues

3. **Health Check Strategies**
   - `AGGRESSIVE`: Mark as GHOST after 1 missed ping
   - `NORMAL`: Current behavior (default)
   - `LENIENT`: Multiple missed pings before GHOST

4. **Metrics & Observability**
   - Track ping success rate
   - Measure RTT (if pong implemented)
   - Count GHOST occurrences
   - Monitor health check performance

---

## 🎯 Conclusion

The ZeroNode ping and health check mechanism is:
- ✅ **Well-architected** - Clear separation between transport and application layers
- ✅ **Robust** - Automatic recovery from transient failures
- ✅ **Configurable** - Easy to tune for different environments
- ✅ **Testable** - Clear interfaces and predictable behavior
- ✅ **Production-ready** - Handles edge cases and provides clear events

No changes needed for basic functionality. Focus future work on observability and metrics.

