# Transport & Protocol Simplification ✅

## What Changed

We simplified the architecture to have truly minimal, generic layers:

---

## 1. TransportEvent - Down to 4 Events

**Before (transport-specific):**
```javascript
CONNECT, DISCONNECT, RECONNECT, RECONNECT_FAILURE, // Client events
LISTEN, ACCEPT,                                      // Server events  
BIND_ERROR, ACCEPT_ERROR, CLOSE_ERROR,              // Error events
CONNECT_DELAY, CONNECT_RETRY,                        // Observability
CLOSE                                                // Shutdown
```
❌ 13 events, transport-specific assumptions

**After (generic):**
```javascript
READY        // Transport can send/receive bytes
NOT_READY    // Transport disconnected/unbound  
MESSAGE      // Received bytes { buffer, sender? }
CLOSED       // Transport permanently shut down
```
✅ 4 events, works with ANY transport!

---

## 2. Protocol - Simplified to Pass-Through

**Before:**
- Managed connection state (`wasReady`, `connectionState`)
- Tracked peers (`peers` Map)
- Handled `ACCEPT` events
- Complex state transitions
- Emitted `READY`, `DISCONNECTED`, `RECONNECTED`, `FAILED`, `CONNECTION_ACCEPTED`

**After:**
- Just passes through transport events
- NO state management
- NO peer tracking
- Simply translates:
  - `TransportEvent.READY` → `ProtocolEvent.TRANSPORT_READY`
  - `TransportEvent.NOT_READY` → `ProtocolEvent.TRANSPORT_NOT_READY`
  - `TransportEvent.CLOSED` → `ProtocolEvent.TRANSPORT_CLOSED`

---

## 3. Client/Server - Handle Handshakes Manually (Option 2)

**Responsibility:**
- Listen to `ProtocolEvent.TRANSPORT_READY`
- Send handshake tick (e.g., `CLIENT_CONNECTED`)
- Manage peer discovery through messages
- Track peer state (`CONNECTED`, `HEALTHY`, `GHOST`, etc.)

**Example Flow:**

```javascript
// Client
this.on(ProtocolEvent.TRANSPORT_READY, () => {
  // Send handshake
  this.tick({
    event: 'CLIENT_CONNECTED',
    data: { 
      clientId: this.getId(),
      version: '1.0' 
    }
  })
})

this.onTick('WELCOME', ({ data }) => {
  // Server responded - we're connected!
  serverPeer.setState('HEALTHY')
  this.emit('client:ready')  // Now ready for business
})

// Server
this.onTick('CLIENT_CONNECTED', ({ data, owner }) => {
  // Discover client through message
  const peer = new PeerInfo({ id: owner, ...data })
  clientPeers.set(owner, peer)
  
  // Send welcome
  this.tick({ to: owner, event: 'WELCOME', data: { ... } })
})
```

---

## Architecture Layers (Simplified)

```
┌─────────────────────────────────────────┐
│ Application (Client/Server)             │
│ - Business logic                        │
│ - Handshake management                  │
│ - Peer discovery via messages           │
│ - Peer state tracking                   │
└──────────┬──────────────────────────────┘
           │ listens to ProtocolEvent.TRANSPORT_READY
           │
┌──────────▼──────────────────────────────┐
│ Protocol (Generic Messaging)            │
│ - Request/response matching             │
│ - Handler execution                     │
│ - Message parsing                       │
│ - Pass-through transport events         │
└──────────┬──────────────────────────────┘
           │ listens to TransportEvent (4 events)
           │
┌──────────▼──────────────────────────────┐
│ Transport (Bytes over wire)             │
│ - ZMQ Dealer/Router                     │
│ - Socket.IO                             │
│ - HTTP Client/Server                    │
│ - NATS                                  │
│ - Redis pub/sub                         │
│ - etc.                                  │
└─────────────────────────────────────────┘
```

---

## Benefits

### ✅ Transport-Agnostic
Protocol works with ANY transport that emits 4 events:
- ZeroMQ ✅
- Socket.IO ✅ (future)
- HTTP ✅ (future)
- WebSocket ✅ (future)
- NATS ✅ (future)

### ✅ Clean Separation
- Transport = Physical connection
- Protocol = Message semantics
- Application = Business logic

### ✅ Flexible Handshakes
Applications control:
- When to send handshake
- What data to include
- How to validate/reject
- Custom handshake formats

### ✅ No Assumptions
- Protocol doesn't know about "client" vs "server"
- Protocol doesn't track peers
- Transport doesn't know about peers
- Peer discovery happens via messages

---

## Event Mapping

### ZeroMQ Events → TransportEvent

**Dealer (client):**
```javascript
ZMQ 'connect'    → TransportEvent.READY
ZMQ 'disconnect' → TransportEvent.NOT_READY
ZMQ 'close'      → TransportEvent.CLOSED
```

**Router (server):**
```javascript
ZMQ 'listen'     → TransportEvent.READY
ZMQ 'close'      → TransportEvent.CLOSED
```

**Removed ZMQ-specific events:**
- `accept` - Peer discovery now via messages
- `connect:delay`, `connect:retry` - Observability only
- `bind:error`, `accept:error`, `close:error` - Internal handling

---

## What's Next?

1. **Update Client/Server** to use new `ProtocolEvent.TRANSPORT_READY`
2. **Implement manual handshake** in Client/Server
3. **Remove old event handlers** (`READY`, `DISCONNECTED`, `RECONNECTED`, `FAILED`)
4. **Test the new flow** with benchmark

---

## Philosophy

**Old:** Transport tells Protocol about peers → Protocol tells Application

**New:** Transport tells Protocol "ready for bytes" → Application discovers peers via messages

This is how real protocols work:
- HTTP: TCP connects → HTTP sends `GET /` → Server responds
- WebSocket: TCP connects → WebSocket handshake → Data frames
- SSH: TCP connects → SSH key exchange → Auth → Shell

**Connection ≠ Session. Handshake establishes session.**

🎯 **Result: Clean, extensible, transport-agnostic architecture!**

