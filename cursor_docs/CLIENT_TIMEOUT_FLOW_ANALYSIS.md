# Client Timeout Flow Analysis

**Date**: November 17, 2025  
**Purpose**: Verify that `SERVER:CLIENT_TIMEOUT` fires correctly when clients stop pinging, disconnect, or fail

---

## 🎯 Question

**Will `SERVER:CLIENT_TIMEOUT` fire when:**
1. Client stops sending pings?
2. Client closes/disconnects?
3. Client fails/crashes?

---

## ✅ Answer: YES (with caveats)

The health check mechanism **WILL** fire `CLIENT_TIMEOUT` in all three scenarios, but with different timing behaviors.

---

## 📊 Complete Flow Analysis

### 1️⃣ **Client Handshake (Initialization)**

```javascript
// server.js lines 97-134
this.onTick(ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT, (envelope) => {
  let { clientPeers } = _private.get(this)
  const clientId = envelope.owner
  const clientOptions = envelope.data
  
  let peerInfo = clientPeers.get(clientId)
  
  if (!peerInfo) {
    // NEW CLIENT - Create peer info
    peerInfo = new PeerInfo({
      id: clientId,
      address: null,
      options: clientOptions
    })
    peerInfo.setState('CONNECTED')
    clientPeers.set(clientId, peerInfo)
    
    // ✅ EMIT CLIENT_JOINED
    this.emit(ServerEvent.CLIENT_JOINED, { 
      clientId,
      clientOptions
    })
  } else {
    // EXISTING CLIENT - Reconnected, update state
    peerInfo.setState('HEALTHY')
  }
  
  // Send handshake response
  this._sendSystemTick({
    to: clientId,
    event: ProtocolSystemEvent.HANDSHAKE_ACK_FROM_SERVER,
    data: options || {}
  })
})
```

**Key Point**: When a new client joins:
- ✅ `PeerInfo` is created with `lastSeen = Date.now()` (constructor, peer.js line 42)
- ✅ State is set to `CONNECTED`
- ✅ Client is added to `clientPeers` map
- ✅ Health check will start monitoring this client

---

### 2️⃣ **Client Ping Handler (Updates `lastSeen`)**

```javascript
// server.js lines 139-149
this.onTick(ProtocolSystemEvent.CLIENT_PING, (envelope) => {
  let { clientPeers } = _private.get(this)
  
  const clientId = envelope.owner
  const peerInfo = clientPeers.get(clientId)
  
  if (peerInfo) {
    peerInfo.updateLastSeen()  // ✅ Update timestamp to NOW
    peerInfo.setState('HEALTHY')  // ✅ Mark as healthy
  }
})
```

**Key Point**: Every time a client sends a ping:
- ✅ `lastSeen` is updated to `Date.now()`
- ✅ State is updated to `HEALTHY`
- ✅ This "resets" the timeout timer

**What happens if client STOPS sending pings?**
- ❌ `updateLastSeen()` is NOT called
- ❌ `lastSeen` timestamp becomes stale
- ✅ Health check will eventually detect this and fire `CLIENT_TIMEOUT`

---

### 3️⃣ **Health Check Mechanism**

#### Start Health Checks

```javascript
// server.js lines 240-255
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
    this._checkClientHealth(ghostThreshold)  // ✅ Runs periodically
  }, checkInterval)
}
```

**When it starts**: 
- ✅ On `ProtocolEvent.TRANSPORT_READY` (server.js line 72)
- ✅ Runs every `CLIENT_HEALTH_CHECK_INTERVAL` (default: 30 seconds)

---

#### Check Client Health

```javascript
// server.js lines 266-287
_checkClientHealth(ghostThreshold) {
  let { clientPeers } = _private.get(this)
  const now = Date.now()
  
  // ✅ Loop through ALL connected clients
  clientPeers.forEach((peerInfo, clientId) => {
    const timeSinceLastSeen = now - peerInfo.getLastSeen()
    
    // ⚠️ Client hasn't sent a ping in too long!
    if (timeSinceLastSeen > ghostThreshold) {
      const previousState = peerInfo.getState()
      peerInfo.setState('GHOST')
      
      // ✅ FIRE CLIENT_TIMEOUT (but only once per state change)
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

**Logic**:
```
timeSinceLastSeen = Date.now() - peer.lastSeen

if (timeSinceLastSeen > CLIENT_GHOST_TIMEOUT):
  if (state !== 'GHOST'):  // Only fire once
    setState('GHOST')
    emit CLIENT_TIMEOUT ✅
```

---

### 4️⃣ **PeerInfo `lastSeen` Tracking**

```javascript
// peer.js lines 42, 137-143
class PeerInfo {
  constructor() {
    this.lastSeen = Date.now()  // ✅ Initialize to NOW
    // ...
  }
  
  updateLastSeen(timestamp) {
    this.lastSeen = timestamp || Date.now()  // ✅ Update to NOW
  }
  
  getLastSeen() {
    return this.lastSeen  // ✅ Return timestamp
  }
}
```

**When `lastSeen` is updated**:
1. ✅ **Constructor** (when peer is created during handshake)
2. ✅ **Every CLIENT_PING** (via `peerInfo.updateLastSeen()`)

**When `lastSeen` is NOT updated**:
- ❌ Client sends no ping
- ❌ Client crashes
- ❌ Client disconnects silently
- ❌ Client calls `_stopPing()`

---

## 🔍 Scenario Analysis

### Scenario 1: **Client Stops Sending Pings (Process Freezes)**

```
t=0s      Client handshake completes
          ├─ peerInfo.lastSeen = 0s
          └─ peerInfo.setState('CONNECTED')

t=10s     Client sends CLIENT_PING ✅
          ├─ peerInfo.updateLastSeen() → lastSeen = 10s
          └─ peerInfo.setState('HEALTHY')

t=20s     Client sends CLIENT_PING ✅
          ├─ peerInfo.updateLastSeen() → lastSeen = 20s
          └─ peerInfo.setState('HEALTHY')

t=30s     🔴 CLIENT FREEZES / STOPS PINGING
          (no ping sent, lastSeen remains 20s)

t=30s     Health check runs
          ├─ timeSinceLastSeen = 30 - 20 = 10s
          └─ 10s < 60s ✅ OK

t=60s     Health check runs
          ├─ timeSinceLastSeen = 60 - 20 = 40s
          └─ 40s < 60s ✅ OK

t=90s     Health check runs
          ├─ timeSinceLastSeen = 90 - 20 = 70s
          └─ 70s > 60s ❌ TIMEOUT!
          ├─ peerInfo.setState('GHOST')
          └─ emit CLIENT_TIMEOUT ✅
```

**Result**: ✅ `CLIENT_TIMEOUT` **WILL FIRE** after `CLIENT_GHOST_TIMEOUT` elapses

**Timing**: 
```
Timeout detection = CLIENT_GHOST_TIMEOUT + up to CLIENT_HEALTH_CHECK_INTERVAL

Worst case with defaults:
= 60s + 30s = 90 seconds
```

---

### Scenario 2: **Client Gracefully Disconnects**

```
t=0s      Client connected, sending pings

t=10s     Client calls client.disconnect()
          ├─ client._stopPing() ❌ Stops pinging
          ├─ Sends CLIENT_STOP system event to server
          └─ Socket disconnects

Server receives CLIENT_STOP:
          ├─ peerInfo.setState('STOPPED')
          └─ emit CLIENT_LEFT ✅

Health check continues running:
t=30s     Health check runs
          ├─ peerInfo.state = 'STOPPED'
          ├─ timeSinceLastSeen = 30 - 10 = 20s
          └─ 20s < 60s ✅ OK (no timeout, already STOPPED)

t=60s     Health check runs
          ├─ timeSinceLastSeen = 60 - 10 = 50s
          └─ 50s < 60s ✅ OK

t=90s     Health check runs
          ├─ timeSinceLastSeen = 90 - 10 = 80s
          └─ 80s > 60s ❌ SHOULD TIMEOUT?
          ├─ previousState = 'STOPPED'
          ├─ setState('GHOST')
          └─ if (previousState !== 'GHOST') → TRUE
              emit CLIENT_TIMEOUT ✅
```

**Result**: ✅ `CLIENT_TIMEOUT` **WILL FIRE** even for gracefully disconnected clients!

**Issue**: This might be undesirable behavior. If a client gracefully disconnects and sends `CLIENT_STOP`, should we still fire `CLIENT_TIMEOUT` later?

**Recommendation**: The health check should skip clients in `STOPPED` or `FAILED` states.

---

### Scenario 3: **Client Crashes (No Graceful Disconnect)**

```
t=0s      Client connected, sending pings

t=10s     Client sends CLIENT_PING ✅
          └─ lastSeen = 10s

t=20s     🔴 CLIENT CRASHES (process killed)
          ├─ No CLIENT_STOP sent (crash)
          ├─ No more pings
          └─ Socket remains connected (OS hasn't detected failure yet)

t=30s     Health check runs
          ├─ timeSinceLastSeen = 30 - 10 = 20s
          └─ 20s < 60s ✅ OK

t=60s     Health check runs
          ├─ timeSinceLastSeen = 60 - 10 = 50s
          └─ 50s < 60s ✅ OK

t=90s     Health check runs
          ├─ timeSinceLastSeen = 90 - 10 = 80s
          └─ 80s > 60s ❌ TIMEOUT!
          ├─ peerInfo.setState('GHOST')
          └─ emit CLIENT_TIMEOUT ✅
```

**Result**: ✅ `CLIENT_TIMEOUT` **WILL FIRE** after timeout elapses

**This is the PRIMARY use case** - detecting crashed/frozen clients that can't send a graceful disconnect.

---

## ⚠️ Issues & Edge Cases

### Issue 1: **Graceful Disconnect Still Fires Timeout**

When a client gracefully disconnects (sends `CLIENT_STOP`), the peer state becomes `STOPPED`, but the health check still fires `CLIENT_TIMEOUT` later.

**Current Behavior**:
```javascript
if (timeSinceLastSeen > ghostThreshold) {
  const previousState = peerInfo.getState()
  peerInfo.setState('GHOST')
  
  if (previousState !== 'GHOST') {  // ⚠️ previousState could be 'STOPPED'
    this.emit(ServerEvent.CLIENT_TIMEOUT, ...)
  }
}
```

**Problem**: The check only prevents duplicate `CLIENT_TIMEOUT` events (when already `GHOST`), but doesn't skip clients in terminal states (`STOPPED`, `FAILED`).

**Recommendation**: Update health check to skip terminal states:

```javascript
_checkClientHealth(ghostThreshold) {
  let { clientPeers } = _private.get(this)
  const now = Date.now()
  
  clientPeers.forEach((peerInfo, clientId) => {
    const state = peerInfo.getState()
    
    // ✅ Skip clients in terminal states
    if (state === 'STOPPED' || state === 'FAILED' || state === 'GHOST') {
      return
    }
    
    const timeSinceLastSeen = now - peerInfo.getLastSeen()
    
    if (timeSinceLastSeen > ghostThreshold) {
      peerInfo.setState('GHOST')
      
      this.emit(ServerEvent.CLIENT_TIMEOUT, { 
        clientId, 
        lastSeen: peerInfo.getLastSeen(),
        timeSinceLastSeen 
      })
    }
  })
}
```

---

### Issue 2: **Clients Remain in `clientPeers` Map Forever**

Once a client is added to `clientPeers`, it's never removed. This means:
- ❌ Disconnected clients remain in memory
- ❌ Health check loops over dead clients forever
- ❌ Potential memory leak

**Recommendation**: Add cleanup logic:

```javascript
// Option 1: Remove on CLIENT_STOP
this.onTick(ProtocolSystemEvent.CLIENT_STOP, (envelope) => {
  let { clientPeers } = _private.get(this)
  const clientId = envelope.owner
  
  clientPeers.delete(clientId)  // ✅ Remove from map
  this.emit(ServerEvent.CLIENT_LEFT, { clientId })
})

// Option 2: Remove after timeout
_checkClientHealth(ghostThreshold) {
  // ... existing logic ...
  
  if (timeSinceLastSeen > ghostThreshold) {
    peerInfo.setState('GHOST')
    
    this.emit(ServerEvent.CLIENT_TIMEOUT, { 
      clientId, 
      lastSeen: peerInfo.getLastSeen(),
      timeSinceLastSeen 
    })
    
    // ✅ Optional: Remove after extended timeout
    if (timeSinceLastSeen > ghostThreshold * 2) {
      clientPeers.delete(clientId)
    }
  }
}
```

---

### Issue 3: **Very Short Timeouts are Unreliable**

As we discovered in testing, very short timeouts (< 1 second) are unreliable due to:
- JavaScript `setInterval` drift
- Event loop delays
- GC pauses
- System load

**Recommendation**: Document minimum recommended values:

```javascript
// ❌ Too aggressive (unreliable)
CLIENT_HEALTH_CHECK_INTERVAL: 50
CLIENT_GHOST_TIMEOUT: 200

// ✅ Minimum recommended (testing)
CLIENT_HEALTH_CHECK_INTERVAL: 1000   // 1 second
CLIENT_GHOST_TIMEOUT: 5000           // 5 seconds

// ✅ Production defaults (robust)
CLIENT_HEALTH_CHECK_INTERVAL: 30000  // 30 seconds
CLIENT_GHOST_TIMEOUT: 60000          // 60 seconds
```

---

## 🎯 Final Answer

### Will `CLIENT_TIMEOUT` Fire?

| Scenario | Will Fire? | When? | Notes |
|----------|-----------|-------|-------|
| **Client stops pinging** | ✅ YES | After `CLIENT_GHOST_TIMEOUT` | Primary use case |
| **Client crashes** | ✅ YES | After `CLIENT_GHOST_TIMEOUT` | Works correctly |
| **Client gracefully disconnects** | ⚠️ YES (bug) | After `CLIENT_GHOST_TIMEOUT` | Should be skipped |
| **Client sends `_stopPing()`** | ✅ YES | After `CLIENT_GHOST_TIMEOUT` | Works as designed |

---

## ✅ Verification

The health check mechanism **DOES** work correctly for detecting clients that stop pinging. The flow is:

1. ✅ Client sends pings → `lastSeen` updated
2. ✅ Client stops pinging → `lastSeen` becomes stale
3. ✅ Health check runs periodically → detects stale `lastSeen`
4. ✅ Timeout fires → `CLIENT_TIMEOUT` event emitted

**However**, there are two issues:
1. ⚠️ Gracefully disconnected clients also fire timeout (should be skipped)
2. ⚠️ Dead clients remain in `clientPeers` map forever (memory leak)

---

## 🔧 Recommended Fixes

### Fix 1: Skip Terminal States in Health Check

```javascript
_checkClientHealth(ghostThreshold) {
  let { clientPeers } = _private.get(this)
  const now = Date.now()
  
  clientPeers.forEach((peerInfo, clientId) => {
    const state = peerInfo.getState()
    
    // ✅ Skip clients that are already in a terminal state
    if (state === 'STOPPED' || state === 'FAILED' || state === 'GHOST') {
      return
    }
    
    const timeSinceLastSeen = now - peerInfo.getLastSeen()
    
    if (timeSinceLastSeen > ghostThreshold) {
      peerInfo.setState('GHOST')
      
      this.emit(ServerEvent.CLIENT_TIMEOUT, { 
        clientId, 
        lastSeen: peerInfo.getLastSeen(),
        timeSinceLastSeen 
      })
    }
  })
}
```

### Fix 2: Clean Up Disconnected Clients

```javascript
this.onTick(ProtocolSystemEvent.CLIENT_STOP, (envelope) => {
  let { clientPeers } = _private.get(this)
  
  const clientId = envelope.owner
  const peerInfo = clientPeers.get(clientId)
  
  if (peerInfo) {
    peerInfo.setState('STOPPED')
    
    // ✅ Remove from map after graceful disconnect
    clientPeers.delete(clientId)
  }
  
  this.emit(ServerEvent.CLIENT_LEFT, { clientId })
})
```

---

## 📊 Summary

**Current Status**: ✅ The health check mechanism **DOES** fire `CLIENT_TIMEOUT` when clients stop pinging.

**Confidence Level**: 🟢 **HIGH** - The code logic is correct and will detect inactive clients.

**Issues Found**: 
- ⚠️ Minor: Gracefully disconnected clients also timeout
- ⚠️ Minor: Memory leak (clients never removed from map)

**Recommendation**: Implement the two fixes above for production-ready behavior.

