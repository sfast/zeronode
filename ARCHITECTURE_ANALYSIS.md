# Architecture Analysis: Protocol, Client, Server

## Critical Issues Found

### 🔴 CRITICAL: Client can only connect to ONE server

**Current Design:**
```javascript
// Client.js
let _scope = {
  routerAddress: null,      // Single address
  serverPeerInfo: null,     // Single server
  pingInterval: null
}
```

**Problem:**
- User asked: "can one client connect to multiple servers?"
- **Answer: NO** - Current architecture supports ONE Client → ONE Server only
- `serverPeerInfo` is singular, not a Map
- Can't track multiple servers

**Impact:** 
- Not scalable for multi-server architectures
- Can't implement service discovery, load balancing, or failover

**Solution Options:**
1. Keep current design (simple, clear use case)
2. Refactor to support multiple servers (breaking change)

---

### 🟡 ISSUE: Protocol.peers vs Server.clientPeers Duplication

**Current State:**
- `Protocol` tracks peers in `peers` Map (basic: id, firstSeen, lastSeen)
- `Server` tracks clients in `clientPeers` Map (rich: PeerInfo with state machine)

**Problem:**
- Duplication of peer tracking
- Two sources of truth
- Protocol.peers never cleaned up → **Memory leak!**

**Impact:**
- Over time, Protocol.peers grows unbounded
- Server.clientPeers correctly manages lifecycle

**Solution:**
- Remove Protocol.peers entirely
- Let Server manage its own clientPeers
- Protocol should only emit PEER_CONNECTED/PEER_DISCONNECTED events

---

### 🟡 ISSUE: PEER_DISCONNECTED event is never emitted

**Current Code:**
```javascript
// Protocol._attachSocketEventHandlers()
if (socketType === 'router') {
  socket.on(SocketEvent.ACCEPT, ({ fd, endpoint }) => {
    this._handlePeerConnected(fd, endpoint)
  })
  // ❌ NO listener for per-peer disconnect!
}
```

**Problem:**
- Protocol emits `ProtocolEvent.PEER_DISCONNECTED` in theory
- But ZeroMQ Router **does NOT emit per-peer disconnect events**
- Server listens for PEER_DISCONNECTED but it **never fires**
- Server relies on health checks for GHOST detection instead

**Impact:**
- Misleading API - event exists but never fires
- Server can't detect immediate disconnections
- Relies entirely on timeout-based health checks

**Solution:**
1. Remove PEER_DISCONNECTED event (it's not supported by ZeroMQ Router)
2. Document that Server must use health checks for disconnect detection
3. OR: Implement application-level disconnect detection (CLIENT_STOP tick)

---

### 🟡 ISSUE: No Broadcast Support (or unclear)

**Server.setOptions() tries to broadcast:**
```javascript
setOptions (options, notify = true) {
  super.setOptions(options)
  
  if (notify && this.isReady()) {
    // ❌ No 'to' field - how does this work?
    this.tick({ 
      event: events.OPTIONS_SYNC, 
      data: { serverId: this.getId(), options }, 
      mainEvent: true 
    })
  }
}
```

**Protocol.tick() signature:**
```javascript
tick ({ to, event, data, mainEvent = false } = {}) {
  // ...
  socket.sendBuffer(buffer, to)  // What if 'to' is undefined?
}
```

**Problem:**
- If `to` is undefined, what happens?
- ZeroMQ Router needs explicit recipient
- Does `socket.sendBuffer(buffer, undefined)` broadcast? (Unlikely!)

**Impact:**
- OPTIONS_SYNC broadcast probably doesn't work
- Need explicit broadcast implementation

**Solution:**
- Implement explicit `broadcast()` method in Server
- Loop through all clientPeers and send individually
- OR: Add broadcast flag to tick() and handle in Protocol

---

### 🟠 ISSUE: Multiple connect() calls not guarded

**Client.connect():**
```javascript
async connect (routerAddress, timeout) {
  let _scope = _private.get(this)
  _scope.routerAddress = routerAddress  // ❌ No check if already connected
  
  _scope.serverPeerInfo = new PeerInfo({ 
    id: 'server',
    options: {}
  })
  // ...
}
```

**Problem:**
- No check if already connected
- Calling connect() twice creates new serverPeerInfo
- Old ping interval not stopped
- Resource leak

**Impact:**
- Memory leaks if misused
- Confusing state

**Solution:**
```javascript
async connect (routerAddress, timeout) {
  if (this.isReady()) {
    throw new Error('Client already connected. Call disconnect() first.')
  }
  // ...
}
```

---

### 🟠 ISSUE: Server.unbind() broadcast unclear

**Server.unbind():**
```javascript
async unbind () {
  if (this.isReady()) {
    try {
      this.tick({
        event: events.SERVER_STOP,
        data: { serverId: this.getId() },
        mainEvent: true
        // ❌ No 'to' field - broadcast?
      })
    } catch (err) {
      // Ignore if offline
    }
  }
}
```

**Problem:**
- Same as OPTIONS_SYNC - no explicit broadcast
- Should loop through clientPeers

**Solution:**
```javascript
async unbind () {
  let { clientPeers } = _private.get(this)
  
  // Notify each client individually
  for (const [clientId] of clientPeers) {
    try {
      this.tick({
        to: clientId,  // ✅ Explicit recipient
        event: events.SERVER_STOP,
        data: { serverId: this.getId() },
        mainEvent: true
      })
    } catch (err) {
      // Ignore individual failures
    }
  }
  
  await this._getSocket().unbind()
}
```

---

### 🟠 ISSUE: Peer creation in two places

**Protocol._handlePeerConnected:**
```javascript
_handlePeerConnected (peerId, endpoint) {
  if (!peers.has(peerId)) {
    peers.set(peerId, { id: peerId, firstSeen: Date.now(), ... })  // Create peer
  }
}
```

**Protocol._handleIncomingMessage:**
```javascript
_handleIncomingMessage (buffer, sender) {
  // Track peer on message (Router only)
  if (sender && !peers.has(sender)) {
    peers.set(sender, { id: sender, firstSeen: Date.now(), ... })  // ❌ Also creates peer!
  }
}
```

**Problem:**
- Duplication
- Two different creation paths
- First path has endpoint, second doesn't

**Solution:**
- Remove peer tracking from Protocol entirely
- Let Server manage clientPeers

---

### 🟢 GOOD: Things that work well

1. **Request/response tracking** ✅
   - Individual timeouts
   - Clean rejection on failure
   - Survives reconnection

2. **Event translation** ✅
   - Clear SocketEvent → ProtocolEvent mapping
   - Good separation of concerns

3. **Ping mechanism** ✅
   - Automatic heartbeat
   - Stops on disconnect

4. **Health checks** ✅
   - GHOST detection
   - Configurable thresholds

5. **State management** ✅
   - PeerInfo with explicit states
   - Clean transitions

6. **Reconnection handling** ✅
   - Pending requests survive
   - Clean failure handling

---

## Summary of Recommendations

### Priority 1 (Critical):
1. **Decide on multi-server support**
   - Keep ONE Client → ONE Server (simpler)
   - OR: Refactor for multiple servers (complex)

2. **Fix broadcast in Server**
   - Implement explicit loop through clientPeers
   - Remove ambiguous tick() without `to`

3. **Remove Protocol.peers duplication**
   - Let Server manage its own clientPeers
   - Protocol only emits events

### Priority 2 (Important):
4. **Remove PEER_DISCONNECTED event**
   - Not supported by ZeroMQ Router
   - Document health check approach

5. **Guard against multiple connect()**
   - Check isReady() before connecting

6. **Add cleanup for GHOST clients**
   - Remove from clientPeers after threshold

### Priority 3 (Nice to have):
7. **Add getState() to Client/Server**
   - Expose connection state clearly

8. **Better error messages**
   - Include more context

9. **Metrics/observability**
   - Track message counts, latency, etc.

---

## Questions for User

1. **Multi-server support:** Should ONE Client connect to multiple servers? Or keep simple?
2. **Broadcast:** Should we implement explicit broadcast() method?
3. **GHOST cleanup:** Should Server auto-remove GHOST clients after threshold?
4. **PEER_DISCONNECTED:** Remove this event entirely? It never fires for Router.

