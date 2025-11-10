# Message-Based Peer Discovery ✅

## What Changed

We completely refactored Client and Server to use **message-based peer discovery** instead of transport events.

---

## Old Approach (Transport-Based)

**Problem:** Protocol emitted transport-specific events like `CONNECTION_ACCEPTED`

```javascript
// Server (OLD - BAD)
this.on(ProtocolEvent.CONNECTION_ACCEPTED, ({ connectionId }) => {
  // Create peer from transport event ❌
  const peer = new PeerInfo({ id: connectionId })
  clientPeers.set(connectionId, peer)
})
```

**Issues:**
- ❌ Protocol knows about "accepting connections" (ZMQ-specific)
- ❌ Peer discovery tied to transport layer
- ❌ Can't work with HTTP, NATS, or other transports
- ❌ No validation - any connection becomes a peer

---

## New Approach (Message-Based)

**Solution:** Discover peers through handshake messages!

```javascript
// Server (NEW - GOOD)
this.onTick(events.CLIENT_CONNECTED, ({ data, owner }) => {
  // Discover peer from message ✅
  if (!clientPeers.has(owner)) {
    const peer = new PeerInfo({ id: owner, options: data })
    clientPeers.set(owner, peer)
  }
  
  // Send welcome
  this.tick({ to: owner, event: events.CLIENT_CONNECTED })
})
```

**Benefits:**
- ✅ Transport-agnostic (works with ANY transport)
- ✅ Can validate client data before accepting
- ✅ Flexible handshake format
- ✅ Session establishment separate from connection

---

## Flow Comparison

### Old Flow (Transport-Based)

```
1. TCP connects
2. ZMQ Router emits 'accept'
3. Protocol emits CONNECTION_ACCEPTED  
4. Server creates peer ← WRONG LAYER!
5. Server sends welcome
6. Client receives welcome
```

❌ Peer created from transport event

### New Flow (Message-Based)

```
1. TCP connects
2. Transport emits READY
3. Client sends CLIENT_CONNECTED tick
4. Server receives tick → discovers peer ✅
5. Server validates, creates peer
6. Server sends CLIENT_CONNECTED tick back
7. Client receives welcome → starts ping
```

✅ Peer created from application message

---

## Client Changes

### Before:
```javascript
// Listen to protocol state events
this.on(ProtocolEvent.READY, () => {
  this._sendHandshake()
  this._startPing()  // Start immediately
})

this.on(ProtocolEvent.RECONNECTED, () => {
  this._sendHandshake()
  this._startPing()  // Start immediately
})
```

### After:
```javascript
// Transport ready → send handshake
this.on(ProtocolEvent.TRANSPORT_READY, () => {
  this._sendHandshake()  // Send, but don't start ping yet
})

// Wait for welcome → start session
this.onTick(events.CLIENT_CONNECTED, (data) => {
  this._startPing()  // Start ping AFTER welcome
  this.emit(events.CLIENT_READY)  // Session established ✅
})
```

**Key difference:** Ping starts AFTER handshake completes, not on transport ready!

---

## Server Changes

### Before:
```javascript
// Transport tells us about peers ❌
this.on(ProtocolEvent.CONNECTION_ACCEPTED, ({ connectionId }) => {
  const peer = new PeerInfo({ id: connectionId })
  clientPeers.set(connectionId, peer)
  
  // Send welcome
  this.tick({ to: connectionId, event: events.CLIENT_CONNECTED })
})
```

### After:
```javascript
// Messages tell us about peers ✅
this.onTick(events.CLIENT_CONNECTED, ({ data, owner }) => {
  if (!clientPeers.has(owner)) {
    // NEW PEER - Discovered via handshake
    const peer = new PeerInfo({ id: owner, options: data })
    clientPeers.set(owner, peer)
    this.emit(events.CLIENT_JOINED, { clientId: owner })
  } else {
    // EXISTING PEER - Reconnected
    peer.setState('HEALTHY')
  }
  
  // Send welcome (complete handshake)
  this.tick({ to: owner, event: events.CLIENT_CONNECTED })
})
```

**Key difference:** Server can now:
- Validate client data before accepting
- Store client metadata
- Distinguish new vs reconnecting clients

---

## New Events

### Client Events:
```javascript
events.TRANSPORT_READY    // Transport connected (can send bytes)
events.CLIENT_READY       // Handshake complete (can do business)
events.SERVER_DISCONNECTED // Server temporarily unavailable
events.SERVER_FAILED      // Server permanently dead
```

### Server Events:
```javascript
events.SERVER_READY       // Bound, ready to receive
events.SERVER_NOT_READY   // Unbound
events.SERVER_CLOSED      // Shut down
events.CLIENT_JOINED      // New client discovered
events.CLIENT_STOP        // Client gracefully stopped
events.CLIENT_GHOST       // Client timed out
```

---

## State Transitions

### Client States:
```
CONNECTING → (transport ready) 
  → CONNECTED → (send handshake)
    → (receive welcome) → HEALTHY ← Session established! ✅
      → (disconnect) → GHOST
        → (reconnect) → HEALTHY
      → (timeout) → FAILED
```

### Server Peer States:
```
(receive handshake) → CONNECTED → (send welcome) 
  → HEALTHY ← Peer active ✅
    → (receive ping) → HEALTHY
    → (timeout) → GHOST
    → (receive CLIENT_STOP) → STOPPED
```

---

## Handshake Data Example

### Client sends:
```javascript
this.tick({
  event: 'CLIENT_CONNECTED',
  data: {
    clientId: this.getId(),
    version: '1.0.0',
    capabilities: ['ping', 'request', 'tick'],
    metadata: { ... }  // Any app-specific data
  }
})
```

### Server validates:
```javascript
this.onTick('CLIENT_CONNECTED', ({ data, owner }) => {
  // Can validate before accepting!
  if (data.version !== '1.0.0') {
    // Reject old clients
    this.tick({ to: owner, event: 'ERROR', data: { message: 'Version mismatch' } })
    return
  }
  
  // Accept client
  const peer = new PeerInfo({ id: owner, options: data })
  clientPeers.set(owner, peer)
  
  // Send welcome
  this.tick({ to: owner, event: 'CLIENT_CONNECTED', data: { serverId: this.getId() } })
})
```

---

## Benefits Summary

✅ **Transport-Agnostic**
- Works with ZMQ, HTTP, Socket.IO, NATS, etc.
- No transport-specific assumptions

✅ **Flexible Handshake**
- Custom data format
- Version checking
- Capability negotiation
- Authentication (future)

✅ **Clear Separation**
- Transport = bytes
- Protocol = messages
- Application = peers

✅ **Better Control**
- Validate before accepting
- Reject incompatible clients
- Store client metadata
- Track new vs reconnecting

✅ **Testable**
- Easy to mock handshake
- No transport mocking needed
- Clear state transitions

---

## Migration Guide

### If you have existing Client code:

**Before:**
```javascript
client.on('protocol:ready', () => {
  // Client ready to use
})
```

**After:**
```javascript
client.on('client:ready', () => {
  // Client ready to use (after handshake)
})
```

### If you have existing Server code:

**Before:**
```javascript
server.on('client:connected', ({ clientId }) => {
  // Client connected
})
```

**After:**
```javascript
server.on('client:joined', ({ clientId }) => {
  // Client joined (after handshake)
})
```

---

## Summary

🎯 **Peer discovery moved from transport layer to application layer!**

- Transport emits READY → "can send bytes"
- Client sends handshake → "I want to connect"
- Server discovers peer → "you're accepted"
- Server sends welcome → "handshake complete"
- Client starts session → "ready for business"

This is how real protocols work (HTTP, WebSocket, SSH, etc.)!

**Connection ≠ Session. Handshake establishes session.** ✅

