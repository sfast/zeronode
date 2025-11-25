# Professional Handshake Flow Analysis & Implementation 🔍

## Problem Statement

**Current Issue:**
1. ❌ Client doesn't know server ID until handshake completes
2. ❌ Client might send messages before knowing recipient ID
3. ❌ Client marks itself "ready" too early (on TRANSPORT_READY)
4. ❌ Ping starts before handshake completes

**What Should Happen:**
1. ✅ Transport ready ≠ Application ready
2. ✅ Client learns server ID from handshake response
3. ✅ Client is "ready" ONLY after handshake completes
4. ✅ All messages should have explicit owner/recipient IDs

---

## Current Flow (Incorrect)

### Client Side
```
1. connect() → DealerSocket.connect()
   ↓
2. ZMQ 'connect' event
   ↓
3. Socket emits TransportEvent.READY
   ↓
4. Protocol emits ProtocolEvent.TRANSPORT_READY
   ↓
5. Client handler:
   - serverPeerInfo.setState('CONNECTED')
   - ❌ Sends handshake (doesn't know server ID yet!)
   - ❌ Emits TRANSPORT_READY (too early!)
   ↓
6. Receives CLIENT_CONNECTED response
   - serverPeerInfo.setState('HEALTHY')
   - ❌ Starts ping (should start here, but state says HEALTHY not READY)
   - Emits CLIENT_READY
```

**Problems:**
- Client sends handshake with `recipient: undefined` (doesn't know server)
- Client emits TRANSPORT_READY before handshake
- State transitions are confusing

---

### Server Side
```
1. bind() → RouterSocket.bind()
   ↓
2. ZMQ 'listen' event
   ↓
3. Socket emits TransportEvent.READY
   ↓
4. Protocol emits ProtocolEvent.TRANSPORT_READY
   ↓
5. Server handler:
   - ✅ Starts health checks
   - ✅ Emits SERVER_READY
   ↓
6. Receives CLIENT_CONNECTED (handshake)
   - Extracts clientId from envelope.owner
   - Creates PeerInfo(clientId)
   - ✅ Sends response with serverId
   ↓
7. Receives CLIENT_PING
   - Updates lastSeen
```

**Server is correct! ✅**

---

## Proposed Flow (Professional)

### State Definitions

**Transport States (Socket Layer):**
- `OFFLINE` - Not connected/bound
- `ONLINE` - Connected/bound (can send bytes)
- `CLOSED` - Permanently closed

**Application States (Client/Server Layer):**
- `DISCONNECTED` - Not connected
- `CONNECTING` - Transport online, handshake in progress
- `READY` - Handshake complete, application can operate
- `STOPPED` - Gracefully stopped

**Key Insight:**
- `Transport ONLINE` ≠ `Application READY`
- Application is READY only after handshake completes

---

## Professional Client Flow

### Phase 1: Transport Connection
```javascript
// client.js - connect()
async connect(routerAddress, timeout) {
  _scope.serverPeerInfo = new PeerInfo({ 
    id: null,  // ✅ Don't know server ID yet!
    options: {}
  })
  _scope.serverPeerInfo.setState('CONNECTING')
  
  const socket = this._getSocket()
  await socket.connect(routerAddress, timeout)
  // ← Socket is ONLINE, but application NOT ready yet
}
```

### Phase 2: Transport Ready Handler
```javascript
// client.js - TRANSPORT_READY handler
this.on(ProtocolEvent.TRANSPORT_READY, () => {
  let { serverPeerInfo } = _private.get(this)
  
  // ❌ DON'T emit CLIENT_READY yet!
  // ❌ DON'T start ping yet!
  
  if (serverPeerInfo) {
    serverPeerInfo.setState('CONNECTING')  // Still connecting!
  }
  
  // ✅ Send handshake (no recipient ID known yet)
  this._sendClientConnected()
  
  // ✅ Emit low-level event (for debugging)
  this.emit(events.TRANSPORT_READY)
})
```

### Phase 3: Handshake Response Handler
```javascript
// client.js - CLIENT_CONNECTED response handler
this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
  let { serverPeerInfo } = _private.get(this)
  
  // ✅ Extract server ID from envelope.owner (sender)
  const serverId = envelope.owner
  
  if (!serverId) {
    throw new Error('Server did not provide ID in handshake')
  }
  
  if (serverPeerInfo) {
    // ✅ NOW we know server ID!
    serverPeerInfo.setId(serverId)
    serverPeerInfo.setState('READY')  // ✅ Application ready!
  }
  
  // ✅ Start ping (NOW we can send to specific server)
  this._startPing()
  
  // ✅ Emit high-level ready event
  this.emit(events.CLIENT_READY, { 
    serverId,
    data 
  })
})
```

---

## Professional Server Flow

### Phase 1: Transport Bind
```javascript
// server.js - bind()
async bind(bindAddress) {
  _scope.bindAddress = bindAddress
  
  const socket = this._getSocket()
  await socket.bind(bindAddress)
  // ← Socket is ONLINE, ready to accept messages
}
```

### Phase 2: Transport Ready Handler
```javascript
// server.js - TRANSPORT_READY handler
this.on(ProtocolEvent.TRANSPORT_READY, () => {
  // ✅ Server is immediately ready (no handshake needed)
  this._startHealthChecks()
  this.emit(events.SERVER_READY, { 
    serverId: this.getId() 
  })
})
```

### Phase 3: Client Handshake Handler
```javascript
// server.js - CLIENT_CONNECTED handler
this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
  let { clientPeers } = _private.get(this)
  
  // ✅ Extract client ID from envelope.owner (sender)
  const clientId = envelope.owner
  
  let peerInfo = clientPeers.get(clientId)
  
  if (!peerInfo) {
    // NEW CLIENT
    peerInfo = new PeerInfo({ 
      id: clientId,
      options: data
    })
    peerInfo.setState('CONNECTED')
    clientPeers.set(clientId, peerInfo)
    
    this.emit(events.CLIENT_JOINED, { clientId, data })
  } else {
    // RECONNECTED CLIENT
    peerInfo.setState('CONNECTED')
  }
  
  // ✅ Send handshake response with server ID
  this.tick({
    to: clientId,        // ✅ Explicit recipient
    event: events.CLIENT_CONNECTED,
    data: {
      serverId: this.getId()  // ✅ Server provides its ID
    }
  })
})
```

---

## Protocol Layer: Owner/Recipient Handling

### Current Implementation Review

```javascript
// protocol.js - tick()
tick({ to, event, data } = {}) {
  validateEventName(event, false)
  
  const id = generateEnvelopeId()
  const buffer = serializeEnvelope({
    type: EnvelopType.TICK,
    id,
    tag: event,
    data,
    owner: this.getId(),     // ✅ Always from socket ID
    recipient: to || ''      // ✅ Explicit or empty
  })
  
  this._sendBuffer(buffer, to)
}
```

**Current behavior:**
- ✅ `owner` always set to `this.getId()` (socket.routingId)
- ✅ `recipient` can be explicit (`to`) or empty

**Issue:**
- Client doesn't know server ID initially
- Handshake message has `recipient: ''` (acceptable)
- But client should store server ID after handshake

---

## Message Format Analysis

### Handshake Request (Client → Server)
```javascript
{
  type: TICK,
  owner: 'client-abc123',     // ✅ Client's socket.routingId
  recipient: '',               // ⚠️  Don't know server ID yet
  tag: '_system:client_connected',
  data: {
    clientId: 'client-abc123', // ❓ Redundant?
    timestamp: 1699999999
  }
}
```

**ZMQ Routing:**
- Dealer → Router: ZMQ handles routing automatically
- Router receives message with sender identity in frame
- `recipient: ''` is OK for initial handshake

---

### Handshake Response (Server → Client)
```javascript
{
  type: TICK,
  owner: 'server-xyz789',     // ✅ Server's socket.routingId
  recipient: 'client-abc123',  // ✅ Explicit target
  tag: '_system:client_connected',
  data: {
    serverId: 'server-xyz789'  // ❓ Redundant with envelope.owner?
  }
}
```

**Question:** Should `serverId` be in `data` or just use `envelope.owner`?

**Answer:** Use `envelope.owner`! It's the authoritative source.

---

### Ping Message (Client → Server)
```javascript
{
  type: TICK,
  owner: 'client-abc123',     // ✅ Client ID
  recipient: 'server-xyz789',  // ✅ Now we know server ID!
  tag: '_system:client_ping',
  data: {
    timestamp: 1699999999
  }
}
```

**After handshake:**
- Client knows server ID
- Can send targeted messages
- Recipient is explicit

---

## Implementation Changes Needed

### 1. PeerInfo - Add `updateLastSeen()`

```javascript
// peer.js
class PeerInfo {
  constructor(...) {
    // ...
    this.lastSeen = Date.now()  // ✅ Track last seen
  }
  
  updateLastSeen(timestamp) {
    this.lastSeen = timestamp || Date.now()
  }
  
  getLastSeen() {
    return this.lastSeen
  }
}
```

---

### 2. Client - Extract Server ID from Handshake

```javascript
// client.js

// Update connect() to not assume ready
async connect(routerAddress, timeout) {
  let _scope = _private.get(this)
  _scope.routerAddress = routerAddress
  
  // Create server peer (ID unknown yet)
  _scope.serverPeerInfo = new PeerInfo({ 
    id: null,  // ✅ Will be set after handshake
    options: {}
  })
  _scope.serverPeerInfo.setState('CONNECTING')
  
  const socket = this._getSocket()
  
  try {
    await socket.connect(routerAddress, timeout)
    // Transport is online, but application NOT ready yet
    // Will become ready after handshake completes
  } catch (err) {
    _scope.serverPeerInfo.setState('FAILED')
    throw err
  }
}

// Update TRANSPORT_READY handler
this.on(ProtocolEvent.TRANSPORT_READY, () => {
  let { serverPeerInfo } = _private.get(this)
  
  if (serverPeerInfo) {
    serverPeerInfo.setState('CONNECTING')  // ✅ Still connecting
  }
  
  // Send handshake (recipient unknown)
  this._sendClientConnected()
  
  // Emit transport event (low-level)
  this.emit(events.TRANSPORT_READY)
})

// Update handshake response handler
this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
  let { serverPeerInfo } = _private.get(this)
  
  // ✅ Extract server ID from envelope.owner (sender)
  const serverId = envelope.owner
  
  if (!serverId) {
    this.logger?.error('Server handshake missing sender ID')
    return
  }
  
  if (serverPeerInfo) {
    // ✅ Store server ID
    serverPeerInfo.setId(serverId)
    serverPeerInfo.setState('READY')  // ✅ NOW ready!
  }
  
  // ✅ Start ping (now we know who to ping)
  this._startPing()
  
  // ✅ Emit application ready event
  this.emit(events.CLIENT_READY, { 
    serverId,
    serverData: data
  })
})
```

---

### 3. Client - Update Ping to Use Server ID

```javascript
// client.js - _startPing()
_startPing() {
  let _scope = _private.get(this)
  
  if (_scope.pingInterval) {
    return
  }
  
  const config = this.getConfig()
  const pingInterval = config.PING_INTERVAL || Globals.PING_INTERVAL || 10000
  
  _scope.pingInterval = setInterval(() => {
    if (this.isReady()) {
      const { serverPeerInfo } = _private.get(this)
      const serverId = serverPeerInfo?.getId()
      
      if (!serverId) {
        this.logger?.warn('Cannot ping: server ID unknown')
        return
      }
      
      // ✅ Send ping with explicit recipient
      this.tick({
        to: serverId,  // ✅ Now we know server ID!
        event: events.CLIENT_PING,
        data: { 
          timestamp: Date.now() 
        }
      })
    }
  }, pingInterval)
}
```

---

### 4. Server - Remove Redundant serverId from Data

```javascript
// server.js - CLIENT_CONNECTED handler
this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
  let { clientPeers } = _private.get(this)
  
  const clientId = envelope.owner
  
  let peerInfo = clientPeers.get(clientId)
  
  if (!peerInfo) {
    peerInfo = new PeerInfo({ 
      id: clientId,
      options: data
    })
    peerInfo.setState('CONNECTED')
    clientPeers.set(clientId, peerInfo)
    
    this.emit(events.CLIENT_JOINED, { clientId, data })
  } else {
    peerInfo.setState('CONNECTED')
  }
  
  // ✅ Send handshake response
  // Note: serverId is in envelope.owner automatically
  this.tick({
    to: clientId,
    event: events.CLIENT_CONNECTED,
    data: {
      // ❌ Remove: serverId (redundant with envelope.owner)
      timestamp: Date.now()
    }
  })
})
```

---

### 5. Server - Update Ping Handler

```javascript
// server.js - CLIENT_PING handler
this.onTick(events.CLIENT_PING, (data, envelope) => {
  let { clientPeers } = _private.get(this)
  
  const clientId = envelope.owner  // ✅ Extract from envelope
  const peerInfo = clientPeers.get(clientId)
  
  if (peerInfo) {
    peerInfo.updateLastSeen()      // ✅ Update timestamp
    peerInfo.setState('HEALTHY')    // ✅ Mark as healthy
  } else {
    // Unknown client - might be a ghost or very old
    this.logger?.warn(`Received ping from unknown client: ${clientId}`)
  }
})
```

---

## Complete Flow Diagram

```
CLIENT                          SERVER
  |                               |
  | DealerSocket.connect()        |
  |---------------------------    |
  | (ZMQ establishes TCP)         |
  |                               |
  | TransportEvent.READY          |
  |-------------------------->    |
  |                               |
  | State: CONNECTING             |
  |                               | RouterSocket.bind()
  |                               |------------------------
  |                               | (ZMQ binds to port)
  |                               |
  |                               | TransportEvent.READY
  |                               |<-----------------------
  |                               |
  |                               | State: READY
  |                               | Start health checks
  |                               |
  | Send CLIENT_CONNECTED         |
  | {                             |
  |   owner: 'client-123'         |
  |   recipient: ''               | ← Don't know server yet
  |   tag: _system:client_connected
  | }                             |
  |------------------------------>|
  |                               |
  |                               | Receive CLIENT_CONNECTED
  |                               | clientId = envelope.owner
  |                               | Create PeerInfo('client-123')
  |                               | State: CONNECTED
  |                               |
  |                               | Send CLIENT_CONNECTED (ACK)
  |                               | {
  |                               |   owner: 'server-xyz'
  |                               |   recipient: 'client-123'
  |                               |   tag: _system:client_connected
  |                               | }
  |<------------------------------|
  |                               |
  | Receive CLIENT_CONNECTED      |
  | serverId = envelope.owner     | ← Extract server ID!
  | serverPeerInfo.setId(serverId)|
  | State: READY                  |
  | Start ping interval           |
  | Emit CLIENT_READY             |
  |                               |
  |============================== HANDSHAKE COMPLETE ======================|
  |                               |
  | Send CLIENT_PING (every 10s)  |
  | {                             |
  |   owner: 'client-123'         |
  |   recipient: 'server-xyz'     | ← Now we know server!
  |   tag: _system:client_ping    |
  | }                             |
  |------------------------------>|
  |                               |
  |                               | Receive CLIENT_PING
  |                               | clientId = envelope.owner
  |                               | peerInfo.updateLastSeen()
  |                               | peerInfo.setState('HEALTHY')
  |                               |
  |                               | Health check (every 30s)
  |                               | If no ping > 60s → GHOST
```

---

## isReady() Implementation

```javascript
// protocol.js
isReady() {
  const socket = this._getSocket()
  return socket.isOnline()  // ✅ Transport ready
}
```

**For Client, need application-level ready:**

```javascript
// client.js
isReady() {
  // ✅ Application ready = Transport ready + Server ID known
  const transportReady = super.isReady()  // Check socket online
  const { serverPeerInfo } = _private.get(this)
  const serverIdKnown = serverPeerInfo && serverPeerInfo.getId()
  
  return transportReady && serverIdKnown
}
```

---

## Summary of Changes

### Must Fix:
1. ✅ Add `PeerInfo.updateLastSeen()` method
2. ✅ Client extracts server ID from `envelope.owner` in handshake response
3. ✅ Client doesn't start ping until handshake completes
4. ✅ Client `isReady()` checks if server ID is known
5. ✅ Client sends ping with explicit `to: serverId`

### Should Fix:
6. ✅ Remove redundant `serverId` from server handshake response data
7. ✅ Remove redundant `clientId` from client ping data
8. ✅ Use `envelope.owner` as source of truth for IDs

### Nice to Have:
9. ⚠️ Add validation that `envelope.owner` matches sender's ZMQ routing frame
10. ⚠️ Add timeout for handshake completion
11. ⚠️ Add retry logic for handshake if no response

---

## Implementation Priority

**Phase 1 (Critical):**
1. Add `PeerInfo.updateLastSeen()`
2. Client extracts server ID from handshake
3. Client waits for handshake before starting ping

**Phase 2 (Cleanup):**
4. Remove redundant data from messages
5. Override `isReady()` in Client

**Phase 3 (Polish):**
6. Add handshake timeout
7. Add ID validation

---

## Testing Strategy

```javascript
// Test: Client should not be ready until handshake
const client = new Client({ id: 'test-client' })
await client.connect('tcp://127.0.0.1:5555')

// After connect, transport is ready but application is NOT
expect(client._getSocket().isOnline()).to.be.true
expect(client.isReady()).to.be.false  // ✅ Not ready yet!

// Wait for handshake
await new Promise(resolve => {
  client.once(events.CLIENT_READY, resolve)
})

// NOW application is ready
expect(client.isReady()).to.be.true  // ✅ Ready!
expect(client.getServerPeerInfo().getId()).to.not.be.null  // ✅ Has server ID
```

---

## Conclusion

**Architecture Grade: B → A**

With these changes:
- ✅ Clean separation: Transport ready vs Application ready
- ✅ Explicit handshake protocol
- ✅ IDs properly discovered and tracked
- ✅ No redundant data in messages
- ✅ Professional state management

**Ready to implement?**

