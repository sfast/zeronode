# Protocol-First Architecture (Theoretical Design)

## 🎯 Core Principle
**Client and Server should ONLY interact with Protocol, never directly with Socket.**

---

## 📊 Current vs. Ideal Architecture

### Current Issues
```javascript
// ❌ Client/Server might still access socket events
client.on(SocketEvent.DISCONNECT, ...) // BAD

// ❌ Client/Server might access socket directly
this.getSocket().sendBuffer(...) // BAD
```

### Ideal Architecture
```javascript
// ✅ Client/Server only listen to Protocol events
client.on(ProtocolEvent.CONNECTION_LOST, ...) // GOOD

// ✅ Client/Server only use Protocol methods
this.request({ to, event, data }) // GOOD
```

---

## 🏗️ Layer Responsibilities

### 1️⃣ Socket Layer (Pure Transport)
**What it does:**
- Raw ZeroMQ socket operations (connect/bind/send/receive)
- Emits `SocketEvent` (low-level: CONNECT, DISCONNECT, LISTEN, etc.)
- Message I/O (buffer in, buffer out)
- Connection state (online/offline)

**What it DOES NOT do:**
- Protocol logic
- Request/response tracking
- Envelope parsing
- Application logic

**Events Emitted:**
- `SocketEvent.CONNECT`
- `SocketEvent.DISCONNECT`
- `SocketEvent.RECONNECT`
- `SocketEvent.LISTEN`
- `SocketEvent.ACCEPT`
- `message` (raw buffer)

---

### 2️⃣ Protocol Layer (Message Protocol)
**What it does:**
- **Request/Response Tracking**: Map request IDs to promises
- **Handler Management**: onRequest/onTick pattern matching
- **Envelope Management**: Serialize/parse envelopes
- **Socket Lifecycle Translation**: Convert SocketEvent → ProtocolEvent
- **Connection State Management**: Track protocol-level connection state
- **Automatic Response Handling**: Send responses for requests
- **Request Timeout Management**: Reject requests after timeout
- **Peer Tracking**: Map socket IDs to peer identities

**What it DOES NOT do:**
- Application-specific logic (ping, health checks, etc.)
- Business logic
- Peer state machines (that's PeerInfo)

**Events Emitted (High-Level):**
```javascript
ProtocolEvent.READY              // Ready to send/receive
ProtocolEvent.CONNECTION_LOST    // Connection temporarily lost
ProtocolEvent.CONNECTION_RESTORED // Connection restored
ProtocolEvent.CONNECTION_FAILED  // Connection definitively failed
ProtocolEvent.PEER_CONNECTED     // New peer connected (Router only)
ProtocolEvent.PEER_DISCONNECTED  // Peer disconnected (Router only)
```

**Methods Exposed:**
```javascript
// Sending
protocol.request({ to, event, data, timeout })
protocol.tick({ to, event, data })

// Handler registration
protocol.onRequest(pattern, handler)
protocol.offRequest(pattern, handler)
protocol.onTick(pattern, handler)
protocol.offTick(pattern, handler)

// State
protocol.isReady()
protocol.getId()
protocol.getOptions()
protocol.getConfig()
```

---

### 3️⃣ Client Layer (Application - Dealer Side)
**What it does:**
- Connect to a server
- Manage server peer info (PeerInfo)
- Application-specific events (ping, OPTIONS_SYNC, etc.)
- **ONLY** listens to `ProtocolEvent`
- **ONLY** uses `Protocol` methods

**What it DOES NOT do:**
- Access socket directly
- Listen to SocketEvent
- Handle envelopes
- Track requests

**Events Listened (from Protocol):**
```javascript
ProtocolEvent.READY              → Start ping
ProtocolEvent.CONNECTION_LOST    → Stop ping, mark server as GHOST
ProtocolEvent.CONNECTION_RESTORED → Resume ping, mark server as HEALTHY
ProtocolEvent.CONNECTION_FAILED  → Mark server as FAILED
```

**Application Events (Incoming Ticks/Requests):**
```javascript
CLIENT_CONNECTED  // Server acknowledges connection
SERVER_STOP       // Server is shutting down
OPTIONS_SYNC      // Server sends options
```

---

### 4️⃣ Server Layer (Application - Router Side)
**What it does:**
- Bind and accept clients
- Manage multiple client peer infos
- Client health checks (heartbeat)
- Application-specific events
- **ONLY** listens to `ProtocolEvent`
- **ONLY** uses `Protocol` methods

**What it DOES NOT do:**
- Access socket directly
- Listen to SocketEvent
- Handle envelopes
- Track requests

**Events Listened (from Protocol):**
```javascript
ProtocolEvent.READY              → Ready to accept clients
ProtocolEvent.PEER_CONNECTED     → New client connected, send CLIENT_CONNECTED
ProtocolEvent.PEER_DISCONNECTED  → Client disconnected, cleanup
```

**Application Events (Incoming Ticks/Requests):**
```javascript
CLIENT_PING      // Client heartbeat
CLIENT_STOP      // Client is disconnecting
OPTIONS_SYNC     // Client sends options
```

---

## 🔄 Protocol Implementation Changes

### Current Protocol Issues
```javascript
// ❌ Protocol emits too many low-level events
this.emit(SocketEvent.DISCONNECT) // Too low-level!

// ❌ Protocol exposes socket
getSocket() { return this._socket } // Shouldn't expose!

// ❌ Client/Server can bypass Protocol
this.getSocket().sendBuffer(...) // Bad!
```

### Ideal Protocol Implementation

#### **1. Private Socket (No Direct Access)**
```javascript
class Protocol extends EventEmitter {
  constructor(socket, options) {
    super()
    
    // ✅ Socket is PRIVATE - never exposed
    let _private = new WeakMap()
    _private.set(this, {
      socket,
      options,
      requests: new Map(),        // Request tracking
      requestEmitter: new PatternEmitter(),
      tickEmitter: new PatternEmitter(),
      connectionState: 'DISCONNECTED',
      peers: new Map()           // For Router: track connected peers
    })
    
    // ✅ Protocol translates socket events to high-level events
    this._attachSocketEventHandlers(socket)
    
    // ✅ Protocol listens to socket messages
    socket.on('message', ({ buffer }) => {
      this._handleIncomingMessage(buffer)
    })
  }
  
  // ❌ REMOVED: getSocket() - should NOT expose socket
  // ❌ REMOVED: sendBuffer() - internal only
}
```

#### **2. High-Level Event Translation**
```javascript
_attachSocketEventHandlers(socket) {
  // Dealer: CONNECT → READY
  socket.on(SocketEvent.CONNECT, () => {
    this._setState('CONNECTED')
    this.emit(ProtocolEvent.READY)
  })
  
  // Router: LISTEN → READY
  socket.on(SocketEvent.LISTEN, () => {
    this._setState('CONNECTED')
    this.emit(ProtocolEvent.READY)
  })
  
  // Router: ACCEPT → PEER_CONNECTED
  socket.on(SocketEvent.ACCEPT, ({ fd, endpoint }) => {
    this.emit(ProtocolEvent.PEER_CONNECTED, { peerId: fd, endpoint })
  })
  
  // Dealer: DISCONNECT → CONNECTION_LOST
  socket.on(SocketEvent.DISCONNECT, () => {
    this._setState('DISCONNECTED')
    this.emit(ProtocolEvent.CONNECTION_LOST)
  })
  
  // Dealer: RECONNECT → CONNECTION_RESTORED
  socket.on(SocketEvent.RECONNECT, () => {
    this._setState('CONNECTED')
    this.emit(ProtocolEvent.CONNECTION_RESTORED)
  })
  
  // Dealer: RECONNECT_FAILURE → CONNECTION_FAILED
  socket.on(SocketEvent.RECONNECT_FAILURE, () => {
    this._setState('FAILED')
    this._rejectPendingRequests('Connection failed')
    this.emit(ProtocolEvent.CONNECTION_FAILED)
  })
}
```

#### **3. Peer Tracking (for Router)**
```javascript
_handleIncomingMessage(buffer, sender) {
  let { peers } = _private.get(this)
  
  // Track peer on first message (Router only)
  if (sender && !peers.has(sender)) {
    peers.set(sender, {
      id: sender,
      firstSeen: Date.now(),
      lastSeen: Date.now()
    })
  }
  
  // Update last seen
  if (sender && peers.has(sender)) {
    peers.get(sender).lastSeen = Date.now()
  }
  
  // Parse envelope and dispatch
  const type = readEnvelopeType(buffer)
  // ... rest of handling
}

// Public API to get peer info
getPeers() {
  let { peers } = _private.get(this)
  return Array.from(peers.values())
}

getPeer(peerId) {
  let { peers } = _private.get(this)
  return peers.get(peerId)
}
```

#### **4. Connection State Management**
```javascript
// ✅ Public API for state
isReady() {
  let { connectionState } = _private.get(this)
  return connectionState === 'CONNECTED'
}

getConnectionState() {
  let { connectionState } = _private.get(this)
  return connectionState // 'DISCONNECTED', 'CONNECTED', 'RECONNECTING', 'FAILED'
}

// ❌ Private: setState
_setState(state) {
  let _scope = _private.get(this)
  _scope.connectionState = state
}
```

---

## 🎨 Client Implementation Changes

### Current Client Issues
```javascript
// ❌ Client accesses socket events
this.getSocket().on(SocketEvent.DISCONNECT, ...)

// ❌ Client calls socket methods
this.getSocket().connect(address)
```

### Ideal Client Implementation

```javascript
class Client extends Protocol {
  constructor({ id, routerAddress, options, config }) {
    // Create dealer socket
    const socket = new DealerSocket({ id, config })
    
    // Pass to Protocol
    super(socket, options)
    
    let _private = new WeakMap()
    _private.set(this, {
      routerAddress,
      serverPeerInfo: new PeerInfo({ id: 'server' }),
      pingInterval: null
    })
    
    // ✅ ONLY listen to Protocol events
    this._attachProtocolEventHandlers()
    
    // ✅ ONLY listen to application events (via Protocol)
    this._attachApplicationEventHandlers()
  }
  
  // ============================================================================
  // PROTOCOL EVENT HANDLERS (High-Level)
  // ============================================================================
  
  _attachProtocolEventHandlers() {
    // ✅ Connection ready
    this.on(ProtocolEvent.READY, () => {
      let { serverPeerInfo } = _private.get(this)
      serverPeerInfo.setState('CONNECTED')
      this._startPing()
    })
    
    // ✅ Connection lost (might reconnect)
    this.on(ProtocolEvent.CONNECTION_LOST, () => {
      let { serverPeerInfo } = _private.get(this)
      serverPeerInfo.setState('GHOST')
      this._stopPing()
    })
    
    // ✅ Connection restored
    this.on(ProtocolEvent.CONNECTION_RESTORED, () => {
      let { serverPeerInfo } = _private.get(this)
      serverPeerInfo.setState('HEALTHY')
      this._startPing()
    })
    
    // ✅ Connection failed (definitive)
    this.on(ProtocolEvent.CONNECTION_FAILED, () => {
      let { serverPeerInfo } = _private.get(this)
      serverPeerInfo.setState('FAILED')
      this._stopPing()
    })
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers() {
    // ✅ Server acknowledges connection
    this.onTick('CLIENT_CONNECTED', (data) => {
      let { serverPeerInfo } = _private.get(this)
      serverPeerInfo.setState('HEALTHY')
      this.emit('connected', data)
    })
    
    // ✅ Server is stopping
    this.onTick('SERVER_STOP', () => {
      let { serverPeerInfo } = _private.get(this)
      serverPeerInfo.setState('STOPPED')
      this._stopPing()
    })
    
    // ✅ Server sends options
    this.onTick('OPTIONS_SYNC', (data) => {
      this.setOptions(data)
    })
  }
  
  // ============================================================================
  // PUBLIC API (Uses Protocol Only)
  // ============================================================================
  
  async connect() {
    let { routerAddress } = _private.get(this)
    let { socket } = this._getPrivateScope() // Internal helper
    
    // ✅ Use socket's connect (but wrap it in Protocol context)
    await socket.connect(routerAddress)
    
    // Protocol will emit ProtocolEvent.READY when connected
  }
  
  async disconnect() {
    this._stopPing()
    
    let { socket } = this._getPrivateScope()
    await socket.disconnect()
  }
  
  // ✅ Ping uses Protocol.tick()
  _startPing() {
    let _scope = _private.get(this)
    if (_scope.pingInterval) return
    
    const config = this.getConfig()
    const pingInterval = config.PING_INTERVAL || 10000
    
    _scope.pingInterval = setInterval(() => {
      // ✅ Use Protocol method
      this.tick({
        event: 'CLIENT_PING',
        data: { timestamp: Date.now() }
      })
    }, pingInterval)
  }
  
  _stopPing() {
    let _scope = _private.get(this)
    if (_scope.pingInterval) {
      clearInterval(_scope.pingInterval)
      _scope.pingInterval = null
    }
  }
  
  getServerPeerInfo() {
    let { serverPeerInfo } = _private.get(this)
    return serverPeerInfo
  }
}
```

---

## 🎨 Server Implementation Changes

### Ideal Server Implementation

```javascript
class Server extends Protocol {
  constructor({ id, bindAddress, options, config }) {
    // Create router socket
    const socket = new RouterSocket({ id, config })
    
    // Pass to Protocol
    super(socket, options)
    
    let _private = new WeakMap()
    _private.set(this, {
      bindAddress,
      clientPeers: new Map(),
      healthCheckInterval: null
    })
    
    // ✅ ONLY listen to Protocol events
    this._attachProtocolEventHandlers()
    
    // ✅ ONLY listen to application events
    this._attachApplicationEventHandlers()
  }
  
  // ============================================================================
  // PROTOCOL EVENT HANDLERS (High-Level)
  // ============================================================================
  
  _attachProtocolEventHandlers() {
    // ✅ Server ready to accept clients
    this.on(ProtocolEvent.READY, () => {
      this._startHealthChecks()
    })
    
    // ✅ New client connected
    this.on(ProtocolEvent.PEER_CONNECTED, ({ peerId, endpoint }) => {
      let { clientPeers } = _private.get(this)
      
      // Create PeerInfo for new client
      const peerInfo = new PeerInfo({ id: peerId })
      peerInfo.setState('CONNECTED')
      clientPeers.set(peerId, peerInfo)
      
      // Notify client
      this.tick({
        to: peerId,
        event: 'CLIENT_CONNECTED',
        data: {
          serverId: this.getId(),
          serverOptions: this.getOptions()
        }
      })
    })
    
    // ✅ Client disconnected
    this.on(ProtocolEvent.PEER_DISCONNECTED, ({ peerId }) => {
      let { clientPeers } = _private.get(this)
      
      const peerInfo = clientPeers.get(peerId)
      if (peerInfo) {
        peerInfo.setState('STOPPED')
      }
    })
  }
  
  // ============================================================================
  // APPLICATION EVENT HANDLERS
  // ============================================================================
  
  _attachApplicationEventHandlers() {
    // ✅ Client sends ping (heartbeat)
    this.onTick('CLIENT_PING', (data, envelope) => {
      let { clientPeers } = _private.get(this)
      
      const clientId = envelope.owner
      const peerInfo = clientPeers.get(clientId)
      
      if (peerInfo) {
        peerInfo.updateLastSeen()
        peerInfo.setState('HEALTHY')
      }
    })
    
    // ✅ Client is stopping
    this.onTick('CLIENT_STOP', (data, envelope) => {
      let { clientPeers } = _private.get(this)
      
      const clientId = envelope.owner
      const peerInfo = clientPeers.get(clientId)
      
      if (peerInfo) {
        peerInfo.setState('STOPPED')
      }
    })
  }
  
  // ============================================================================
  // PUBLIC API (Uses Protocol Only)
  // ============================================================================
  
  async bind() {
    let { bindAddress } = _private.get(this)
    let { socket } = this._getPrivateScope()
    
    await socket.bind(bindAddress)
    
    // Protocol will emit ProtocolEvent.READY when bound
  }
  
  async unbind() {
    this._stopHealthChecks()
    
    let { socket } = this._getPrivateScope()
    await socket.unbind()
  }
  
  _startHealthChecks() {
    let _scope = _private.get(this)
    if (_scope.healthCheckInterval) return
    
    const config = this.getConfig()
    const checkInterval = config.HEALTH_CHECK_INTERVAL || 30000
    const ghostThreshold = config.GHOST_THRESHOLD || 60000
    
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
  
  _checkClientHealth(ghostThreshold) {
    let { clientPeers } = _private.get(this)
    const now = Date.now()
    
    clientPeers.forEach((peerInfo, clientId) => {
      const timeSinceLastSeen = now - peerInfo.getLastSeen()
      
      if (timeSinceLastSeen > ghostThreshold) {
        peerInfo.setState('GHOST')
      }
    })
  }
  
  getClientPeerInfo(clientId) {
    let { clientPeers } = _private.get(this)
    return clientPeers.get(clientId)
  }
  
  getAllClientPeers() {
    let { clientPeers } = _private.get(this)
    return Array.from(clientPeers.values())
  }
}
```

---

## 🎯 Key Architectural Benefits

### 1. **Separation of Concerns**
- Socket = Transport only
- Protocol = Message protocol only
- Client/Server = Application logic only

### 2. **Encapsulation**
- Socket is PRIVATE in Protocol
- Client/Server CANNOT access socket directly
- All interactions go through Protocol API

### 3. **Event Abstraction**
- SocketEvent = Low-level (CONNECT, DISCONNECT)
- ProtocolEvent = High-level (READY, CONNECTION_LOST)
- Client/Server only see high-level events

### 4. **Request Mapping**
- Protocol maintains request ID → Promise mapping
- Protocol handles timeouts automatically
- Client/Server just call `request()` and get a Promise

### 5. **Peer Management**
- Protocol tracks basic peer info (ID, last seen)
- Client/Server manage PeerInfo with state machines
- Clear responsibility split

---

## 📋 Migration Checklist

### Protocol Changes
- [ ] Make socket PRIVATE (no getSocket())
- [ ] Translate all SocketEvent → ProtocolEvent
- [ ] Add PEER_CONNECTED/PEER_DISCONNECTED events (Router)
- [ ] Add peer tracking (Router)
- [ ] Add connection state management
- [ ] Remove any public socket access

### Client Changes
- [ ] Remove all SocketEvent listeners
- [ ] Use ONLY ProtocolEvent
- [ ] Remove socket.connect() calls (use Protocol)
- [ ] Use Protocol.request()/tick() only
- [ ] Update ping to use Protocol events

### Server Changes
- [ ] Remove all SocketEvent listeners
- [ ] Use ONLY ProtocolEvent (especially PEER_CONNECTED)
- [ ] Remove socket.bind() exposure
- [ ] Use Protocol.request()/tick() only
- [ ] Update health checks to use Protocol events

---

## 🚀 Example Usage (After Changes)

### Client Example
```javascript
const client = new Client({
  id: 'my-client',
  routerAddress: 'tcp://127.0.0.1:5000',
  config: {
    PING_INTERVAL: 10000,
    CONNECTION_TIMEOUT: 5000
  }
})

// ✅ Listen to Protocol events
client.on(ProtocolEvent.READY, () => {
  console.log('Connected to server!')
})

client.on(ProtocolEvent.CONNECTION_LOST, () => {
  console.log('Lost connection, auto-reconnecting...')
})

// ✅ Use Protocol methods
await client.connect()

const result = await client.request({
  event: 'getUserData',
  data: { userId: 123 }
})
```

### Server Example
```javascript
const server = new Server({
  id: 'my-server',
  bindAddress: 'tcp://*:5000',
  config: {
    HEALTH_CHECK_INTERVAL: 30000
  }
})

// ✅ Listen to Protocol events
server.on(ProtocolEvent.PEER_CONNECTED, ({ peerId }) => {
  console.log(`New client: ${peerId}`)
})

// ✅ Register handlers
server.onRequest('getUserData', async (data) => {
  return { name: 'John', id: data.userId }
})

await server.bind()
```

---

## 📊 Comparison Table

| Aspect | Current | Ideal |
|--------|---------|-------|
| **Socket Access** | `getSocket()` exposed | Private, no access |
| **Events** | Mix of SocketEvent & ProtocolEvent | Only ProtocolEvent |
| **Request Tracking** | In Protocol ✅ | In Protocol ✅ |
| **Peer Tracking** | In Client/Server | In Protocol (basic) + PeerInfo (state) |
| **Connection State** | In Socket | In Protocol |
| **Event Translation** | Partial | Complete (all SocketEvent → ProtocolEvent) |
| **Encapsulation** | Weak | Strong |

---

## 🎓 Summary

**Golden Rule:** 
> Client and Server should treat Protocol as a **black box**. They don't need to know about sockets, envelopes, or connection mechanics. They just send/receive messages and react to high-level events.

**Benefits:**
- ✅ Clean separation of concerns
- ✅ Easier to test (mock Protocol)
- ✅ Easier to swap transport (just change Protocol's socket)
- ✅ Simpler Client/Server code
- ✅ Professional architecture

