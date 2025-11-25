# Client-Server Peer Tracking & Message Flow Analysis 🔍

## Overview

This document analyzes how Client and Server handle transport events, manage peer information, track IDs, and coordinate ping/heartbeat mechanisms.

---

## 1. Transport Event Listening

### Client (DealerSocket)

**Client listens to `ProtocolEvent` (HIGH-LEVEL), NOT `TransportEvent`:**

```javascript
// ❌ Client NEVER listens to TransportEvent.READY directly
// ✅ Client listens to ProtocolEvent.TRANSPORT_READY

this.on(ProtocolEvent.TRANSPORT_READY, () => {
  // 1. Update server peer state: CONNECTING → CONNECTED
  if (serverPeerInfo) {
    serverPeerInfo.setState('CONNECTED')
  }
  
  // 2. Send handshake to server
  this._sendClientConnected()  // Sends _system:client_connected tick
  
  // 3. Emit application event
  this.emit(events.TRANSPORT_READY)
})
```

**Flow:**
```
ZMQ Dealer 'connect' event
  ↓
Socket emits TransportEvent.READY
  ↓
Protocol listens and emits ProtocolEvent.TRANSPORT_READY
  ↓
Client listens and:
  - Updates serverPeerInfo state
  - Sends handshake
  - Emits CLIENT event
```

---

### Server (RouterSocket)

**Server listens to `ProtocolEvent` (HIGH-LEVEL), NOT `TransportEvent`:**

```javascript
// ❌ Server NEVER listens to TransportEvent.READY directly
// ✅ Server listens to ProtocolEvent.TRANSPORT_READY

this.on(ProtocolEvent.TRANSPORT_READY, () => {
  // 1. Start health checks
  this._startHealthChecks()
  
  // 2. Emit application event
  this.emit(events.SERVER_READY, { serverId: this.getId() })
})
```

**Flow:**
```
ZMQ Router 'listen' event
  ↓
Socket emits TransportEvent.READY
  ↓
Protocol listens and emits ProtocolEvent.TRANSPORT_READY
  ↓
Server listens and:
  - Starts health checks
  - Emits SERVER_READY event
```

---

## 2. Peer Discovery & Tracking

### Client → Server Peer Tracking

**Client tracks 1 peer: the server**

```javascript
// Client creates PeerInfo on connect()
_scope.serverPeerInfo = new PeerInfo({ 
  id: 'server',  // ⚠️ Generic ID! Not from ZMQ routingId
  options: {}
})
```

**Issue Identified: ❌**
- Client uses hardcoded `'server'` as server ID
- NOT using actual server's ZMQ `routingId`
- Server cannot be uniquely identified

**State Transitions:**
1. `CONNECTING` → `CONNECTED` (on TRANSPORT_READY)
2. `CONNECTED` → `HEALTHY` (after handshake completes)
3. `HEALTHY` → `GHOST` (on TRANSPORT_NOT_READY)
4. `GHOST` → `FAILED` (on TRANSPORT_CLOSED)

---

### Server → Client Peer Tracking

**Server tracks N peers: multiple clients**

```javascript
// Server discovers clients from incoming messages!
this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
  const clientId = envelope.owner  // ✅ Extract from message!
  
  let peerInfo = clientPeers.get(clientId)
  
  if (!peerInfo) {
    // NEW CLIENT - create PeerInfo
    peerInfo = new PeerInfo({ 
      id: clientId,  // ✅ Uses client's ZMQ routingId!
      options: data
    })
    clientPeers.set(clientId, peerInfo)
  }
})
```

**Correct! ✅**
- Server extracts `clientId` from `envelope.owner`
- This comes from ZMQ `routingId`
- Clients are uniquely identified

**State Transitions:**
1. `CONNECTED` (on first message)
2. `HEALTHY` (on ping received)
3. `GHOST` (on missed ping timeout)
4. `STOPPED` (on explicit CLIENT_STOP message)

---

## 3. Message Format & ID Tracking

### Envelope Structure

```javascript
{
  type: EnvelopType.TICK,        // Message type
  id: 'abc123...',               // Message ID (unique)
  owner: 'client-xyz',           // ✅ SENDER's ZMQ routingId
  recipient: 'server-123',       // ✅ RECIPIENT's ZMQ routingId
  tag: '_system:client_ping',    // Event name
  data: { timestamp: 123456 }    // Payload
}
```

**How IDs are populated:**

#### Owner (Sender ID)
```javascript
// Protocol.js - tick()
const buffer = serializeEnvelope({
  owner: this.getId(),  // ← Gets from socket.getId()
  // ...
})

// socket.getId() returns socket.routingId
getId() {
  let { id } = _private.get(this)
  return id  // ← Comes from socket.routingId in constructor
}
```

**✅ Client sends its ZMQ `routingId` as `owner`**

#### Recipient (Target ID)
```javascript
// Client sending to server
this.tick({
  to: undefined,  // ← No recipient (broadcast to server)
  event: events.CLIENT_PING,
  data: { ... }
})

// Server sending to specific client
this.tick({
  to: clientId,  // ← Explicit target client
  event: events.CLIENT_CONNECTED,
  data: { ... }
})
```

**✅ Server uses client's `routingId` to send targeted messages**

---

## 4. Handshake Flow (Message-Based Peer Discovery)

### Step-by-Step

```
1. Client connects (DealerSocket.connect)
   ↓
2. ZMQ emits 'connect' event
   ↓
3. Socket emits TransportEvent.READY
   ↓
4. Protocol emits ProtocolEvent.TRANSPORT_READY
   ↓
5. Client handler:
   - serverPeerInfo.setState('CONNECTED')
   - Sends tick: _system:client_connected
   ↓
6. Server receives message
   - Extracts clientId from envelope.owner
   - Creates PeerInfo for new client
   - clientPeers.set(clientId, peerInfo)
   - Sends welcome tick: _system:client_connected (response)
   ↓
7. Client receives welcome
   - serverPeerInfo.setState('HEALTHY')
   - Starts ping interval
   - Emits CLIENT_READY
   ↓
8. Handshake complete! ✅
```

**Key Insight:**
- ✅ Peer discovery is **message-based**, not transport-event-based
- ✅ Server learns client ID from `envelope.owner`
- ✅ Client starts ping AFTER handshake completes

---

## 5. Ping/Heartbeat Mechanism

### Client → Server Ping

**Started:** After handshake completes (CLIENT_CONNECTED response received)

```javascript
_startPing() {
  const pingInterval = config.PING_INTERVAL || 10000  // Default: 10s
  
  _scope.pingInterval = setInterval(() => {
    if (this.isReady()) {
      this.tick({
        event: events.CLIENT_PING,  // '_system:client_ping'
        data: { 
          clientId: this.getId(),    // ✅ Includes own ID
          timestamp: Date.now() 
        }
      })
    }
  }, pingInterval)
}
```

**Message Format:**
```javascript
{
  type: TICK,
  owner: 'client-xyz',           // ✅ Client's ZMQ routingId
  recipient: '',                  // Empty (server is implicit)
  tag: '_system:client_ping',
  data: { 
    clientId: 'client-xyz',       // ✅ Redundant but explicit
    timestamp: 1699999999 
  }
}
```

---

### Server → Health Checks

**Started:** When server becomes ready (TRANSPORT_READY)

```javascript
_startHealthChecks() {
  const checkInterval = config.HEALTH_CHECK_INTERVAL || 30000  // Default: 30s
  const ghostThreshold = config.GHOST_THRESHOLD || 60000      // Default: 60s
  
  _scope.healthCheckInterval = setInterval(() => {
    this._checkClientHealth(ghostThreshold)
  }, checkInterval)
}

_checkClientHealth(ghostThreshold) {
  const now = Date.now()
  
  clientPeers.forEach((peerInfo, clientId) => {
    const timeSinceLastSeen = now - peerInfo.getLastSeen()
    
    if (timeSinceLastSeen > ghostThreshold) {
      peerInfo.setState('GHOST')
      this.emit(events.CLIENT_GHOST, { clientId, timeSinceLastSeen })
    }
  })
}
```

**On Ping Received:**
```javascript
this.onTick(events.CLIENT_PING, (data, envelope) => {
  const clientId = envelope.owner  // ✅ Extract from envelope
  const peerInfo = clientPeers.get(clientId)
  
  if (peerInfo) {
    peerInfo.updateLastSeen()   // ✅ Update last seen timestamp
    peerInfo.setState('HEALTHY')  // ✅ Mark as healthy
  }
})
```

**Strategy:**
- **Client pings** → Server monitors
- Server checks health every 30s
- If no ping for 60s → mark as GHOST
- Passive monitoring (no ACK required)

---

## 6. PeerInfo State Machine

```
         CONNECTING
             ↓
         CONNECTED ←─────┐
             ↓           │
          HEALTHY ──────┤  (ping received)
             ↓           │
           GHOST ────────┘
             ↓
          FAILED
             
          STOPPED (graceful)
```

**States:**
- `CONNECTED` - Just connected (initial)
- `HEALTHY` - Receiving regular pings
- `GHOST` - Missed ping(s) - warning state
- `FAILED` - Connection definitively lost
- `STOPPED` - Graceful shutdown

**Methods:**
```javascript
// Update state
peerInfo.setState('HEALTHY')

// Update last seen (for health checks)
peerInfo.updateLastSeen()  // ❌ MISSING! Should be added

// Query state
peerInfo.isHealthy()
peerInfo.isGhost()
peerInfo.isOnline()
```

---

## 7. Critical Issues Found

### Issue 1: Client Uses Generic Server ID ❌

**Problem:**
```javascript
// client.js
_scope.serverPeerInfo = new PeerInfo({ 
  id: 'server',  // ❌ Hardcoded generic ID
  options: {}
})
```

**Should be:**
```javascript
// Client should extract server ID from handshake response
this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
  const serverId = envelope.owner  // ✅ Server's actual ID
  _scope.serverPeerInfo.setId(serverId)
})
```

---

### Issue 2: PeerInfo Missing `updateLastSeen()` Method ❌

**Problem:**
```javascript
// server.js
peerInfo.updateLastSeen()  // ❌ Method doesn't exist!
```

**peer.js has:**
```javascript
// Only has lastPing, but no updateLastSeen()
ping(timestamp) {
  this.lastPing = timestamp || Date.now()
  // ...
}

getLastSeen() {
  return this.lastPing || this.connectedAt  // ❓ Should return what?
}
```

**Should add:**
```javascript
// peer.js
updateLastSeen(timestamp) {
  this.lastSeen = timestamp || Date.now()
}

getLastSeen() {
  return this.lastSeen || this.connectedAt
}
```

---

### Issue 3: Redundant Client ID in Ping Data ⚠️

**Current:**
```javascript
// Client sends:
{
  owner: 'client-xyz',  // ← Already in envelope
  data: { 
    clientId: 'client-xyz'  // ← Redundant!
  }
}
```

**Can simplify:**
```javascript
// Server already has it from envelope.owner
const clientId = envelope.owner  // ✅ No need for data.clientId
```

---

### Issue 4: Server Doesn't Send Its ID in Response ❌

**Current:**
```javascript
// server.js - handshake response
this.tick({
  to: clientId,
  event: events.CLIENT_CONNECTED,
  data: {
    serverId: this.getId()  // ✅ Sends ID in data
  }
})
```

**Actually correct! ✅** Server DOES send its ID in `data.serverId`

**But Client doesn't use it:**
```javascript
// client.js - handshake response handler
this.onTick(events.CLIENT_CONNECTED, (data) => {
  // ❌ Doesn't extract data.serverId!
  // Should: _scope.serverPeerInfo.setId(data.serverId)
})
```

---

## 8. Message ID Tracking

### How are ZMQ routingIds used?

#### DealerSocket (Client)
```javascript
// dealer.js constructor
socket.routingId = id || `dealer-${Date.now()}-${Math.random()...}`

// Socket.js constructor
_scope.id = socket.routingId  // ✅ Uses ZMQ routingId
```

**Client ID flow:**
```
DealerSocket constructor
  ↓ sets
socket.routingId = 'client-abc123'
  ↓ passed to
Socket constructor
  ↓ stores as
_scope.id = 'client-abc123'
  ↓ used in
Protocol.tick() → owner: this.getId()
  ↓ sent as
envelope.owner = 'client-abc123'
  ↓ received by Server
Server extracts clientId from envelope.owner
```

#### RouterSocket (Server)
```javascript
// router.js constructor
socket.routingId = id || `router-${Date.now()}-${Math.random()...}`
```

**Server ID flow:**
```
RouterSocket constructor
  ↓ sets
socket.routingId = 'server-xyz789'
  ↓ passed to
Socket constructor
  ↓ stores as
_scope.id = 'server-xyz789'
  ↓ used in
Protocol.tick() → owner: this.getId()
  ↓ sent as
envelope.owner = 'server-xyz789'
  ↓ should be received by Client
Client should extract serverId from envelope.owner
```

---

## 9. Complete Message Flow Example

### Example: Client Ping

```
CLIENT                     PROTOCOL                    SERVER
  |                           |                           |
  | tick({                    |                           |
  |   event: CLIENT_PING      |                           |
  | })                        |                           |
  |                           |                           |
  |------ serializeEnvelope --|                           |
  |                           |                           |
  |       {                   |                           |
  |         type: TICK        |                           |
  |         owner: client-123 | ← Client's ZMQ routingId  |
  |         tag: _system:client_ping                      |
  |       }                   |                           |
  |                           |                           |
  |-------- sendBuffer -------|                           |
  |                           |                           |
  |                           |--- ZMQ Router.send ------>|
  |                           |                           |
  |                           |   [client-123, '', buffer]|
  |                           |   ↑ ZMQ routing frame     |
  |                           |                           |
  |                           |<----- onMessage ----------|
  |                           |                           |
  |                           |   { buffer, sender: 'client-123' }
  |                           |          ↑ from ZMQ frame |
  |                           |                           |
  |                           |--- parseTickEnvelope -----|
  |                           |                           |
  |                           |   envelope.owner = 'client-123'
  |                           |                           |
  |                           |---- tickEmitter.emit ---->|
  |                           |                           |
  |                           |                 onTick(CLIENT_PING)
  |                           |                           |
  |                           |                 const clientId = envelope.owner
  |                           |                 peerInfo = clientPeers.get(clientId)
  |                           |                 peerInfo.updateLastSeen()
  |                           |                 peerInfo.setState('HEALTHY')
```

**Key Points:**
1. ✅ Client ID is in `envelope.owner` (from `socket.routingId`)
2. ✅ ZMQ Router extracts sender from routing frame
3. ✅ Server uses `envelope.owner` to identify client
4. ✅ PeerInfo is updated by `clientId`

---

## 10. Architecture Summary

### Layering (Bottom to Top)

```
┌─────────────────────────────────────────────────────┐
│  APPLICATION LAYER (Client / Server)               │
│  - Manages peer info                                │
│  - Starts ping / health checks                      │
│  - Listens to ProtocolEvent (HIGH-LEVEL)          │
└─────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────┐
│  PROTOCOL LAYER (Protocol)                          │
│  - Translates TransportEvent → ProtocolEvent        │
│  - Handles request/response                         │
│  - Manages envelope serialization                   │
│  - Listens to TransportEvent                        │
└─────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────┐
│  TRANSPORT LAYER (Socket / Router / Dealer)         │
│  - Translates ZMQ events → TransportEvent           │
│  - Manages ZMQ socket lifecycle                     │
│  - Emits TransportEvent.MESSAGE with sender ID      │
└─────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────┐
│  ZMQ LAYER (zeromq native)                          │
│  - Raw socket operations                            │
│  - Routing frames [identity, delimiter, payload]    │
└─────────────────────────────────────────────────────┘
```

---

## 11. Recommendations

### Fix 1: Client Should Extract Server ID
```javascript
// client.js
this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
  let { serverPeerInfo } = _private.get(this)
  
  // ✅ Extract server ID from envelope OR data
  const serverId = envelope.owner || data.serverId
  
  if (serverPeerInfo) {
    serverPeerInfo.setId(serverId)  // ✅ Update with actual ID
    serverPeerInfo.setState('HEALTHY')
  }
  
  this._startPing()
  this.emit(events.CLIENT_READY, data)
})
```

### Fix 2: Add `updateLastSeen()` to PeerInfo
```javascript
// peer.js
updateLastSeen(timestamp) {
  this.lastSeen = timestamp || Date.now()
}

getLastSeen() {
  return this.lastSeen || this.connectedAt
}
```

### Fix 3: Remove Redundant `clientId` from Ping Data
```javascript
// client.js - _startPing()
this.tick({
  event: events.CLIENT_PING,
  data: { 
    // ❌ Remove: clientId: this.getId()  (already in envelope.owner)
    timestamp: Date.now() 
  }
})

// server.js - CLIENT_PING handler
this.onTick(events.CLIENT_PING, (data, envelope) => {
  const clientId = envelope.owner  // ✅ Use envelope, not data
  // ...
})
```

---

## Conclusion

**✅ What's Working Well:**
1. Message-based peer discovery (clean design)
2. Server correctly extracts client IDs from `envelope.owner`
3. Ping/heartbeat mechanism is well-structured
4. PeerInfo state machine is clear

**❌ What Needs Fixing:**
1. Client doesn't extract server ID from handshake response
2. `PeerInfo.updateLastSeen()` method is missing
3. Redundant client ID in ping data
4. Need better documentation of ID flow

**Architecture Grade: A-**
- Solid foundation, minor fixes needed
- Clear separation of concerns
- Type-safe peer tracking

