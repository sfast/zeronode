# Responsibilities Analysis - Protocol, Client, Server

## 🎯 Overview

In our Protocol-First architecture, each layer has **clear, distinct responsibilities**:

- **Protocol** = Message protocol & socket event translation
- **Client** = Application logic (client-side)
- **Server** = Application logic (server-side)

---

## 📋 Protocol Responsibilities

### **Core Responsibility:** Single Gateway between Socket and Application

### **What Protocol Does:**

#### 1. **Request/Response Management** ✅
```javascript
// Tracks all pending requests
requests: new Map()  // id → { resolve, reject, timer }

// Sends requests and returns Promise
request({ to, event, data, timeout }) {
  const id = generateEnvelopeId()
  return new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject, timeout: timer })
    socket.sendBuffer(serializeEnvelope(...), to)
  })
}

// Handles responses automatically
_handleResponse(buffer, type) {
  const { id, data } = parseResponseEnvelope(buffer)
  const request = requests.get(id)
  clearTimeout(request.timeout)
  requests.delete(id)
  request.resolve(data)  // or reject(data)
}
```

**Result:** Client/Server just call `request()` and get a Promise - no manual tracking needed!

---

#### 2. **Handler Management** ✅
```javascript
// Pattern-based handler registration
requestEmitter: new PatternEmitter()
tickEmitter: new PatternEmitter()

// Public API for registering handlers
onRequest(pattern, handler, mainEvent)
offRequest(pattern, handler)
onTick(pattern, handler, mainEvent)
offTick(pattern, handler)

// Automatic handler execution
_handleRequest(buffer) {
  const envelope = parseEnvelope(buffer)
  const handlers = requestEmitter.listeners(envelope.tag)
  
  if (handlers.length === 0) {
    // Auto-send error response
  }
  
  const handler = handlers[0]
  const result = handler(envelope.data, envelope)
  
  // Auto-send response
  Promise.resolve(result).then((responseData) => {
    socket.sendBuffer(serializeEnvelope(...))
  })
}
```

**Result:** Client/Server just register handlers - Protocol handles execution and response sending!

---

#### 3. **Socket Event Translation** ✅
```javascript
// Translates low-level → high-level events
_attachSocketEventHandlers(socket) {
  // CONNECT → READY
  socket.on(SocketEvent.CONNECT, () => {
    this._handleConnectionReady('CONNECT')
  })
  
  // LISTEN → READY
  socket.on(SocketEvent.LISTEN, () => {
    this._handleConnectionReady('LISTEN')
  })
  
  // DISCONNECT → CONNECTION_LOST
  socket.on(SocketEvent.DISCONNECT, () => {
    this._handleConnectionLost()
  })
  
  // RECONNECT → CONNECTION_RESTORED
  socket.on(SocketEvent.RECONNECT, (info) => {
    this._handleConnectionRestored(info)
  })
  
  // RECONNECT_FAILURE → CONNECTION_FAILED
  socket.on(SocketEvent.RECONNECT_FAILURE, () => {
    this._handleConnectionFailed('Reconnection timeout')
  })
  
  // ACCEPT → PEER_CONNECTED (Router only)
  socket.on(SocketEvent.ACCEPT, ({ fd, endpoint }) => {
    this._handlePeerConnected(fd, endpoint)
  })
}
```

**Result:** Client/Server only see high-level `ProtocolEvent`, never low-level `SocketEvent`!

---

#### 4. **Connection State Management** ✅
```javascript
// Internal state tracking
connectionState: 'DISCONNECTED' | 'CONNECTED' | 'RECONNECTING' | 'FAILED'

// Public API
isOnline()      // Socket is online
isConnected()   // Protocol connection established
isReady()       // Both online AND connected
getConnectionState()  // Current state

// State transitions
_handleConnectionReady()     // → CONNECTED
_handleConnectionLost()      // → RECONNECTING
_handleConnectionRestored()  // → CONNECTED
_handleConnectionFailed()    // → FAILED, reject pending requests
```

**Result:** Accurate connection state tracking, automatic request rejection on failure!

---

#### 5. **Peer Tracking (Router)** ✅
```javascript
// Basic peer metadata
peers: new Map()  // peerId → { id, firstSeen, lastSeen, endpoint }

// Track on first message
_handleIncomingMessage(buffer, sender) {
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
}

// Public API
getPeers()        // All peers
getPeer(peerId)   // Specific peer
hasPeer(peerId)   // Check existence
```

**Result:** Basic peer tracking in Protocol, advanced state management in Server!

---

#### 6. **Socket Encapsulation** ✅
```javascript
// Socket is PRIVATE
let _scope = {
  socket,  // ← Stored in WeakMap, never exposed
  // ...
}
_private.set(this, _scope)

// ❌ REMOVED: Public getSocket()
// getSocket() { return this._socket }  // BAD!

// ✅ ADDED: Protected _getSocket() for subclasses only
_getSocket() {
  let { socket } = _private.get(this)
  return socket
}
```

**Result:** Client/Server can't bypass Protocol to access Socket directly!

---

### **What Protocol Does NOT Do:**

❌ Business logic (ping, health checks)
❌ Peer state management (HEALTHY, GHOST, FAILED)
❌ Application-specific events
❌ Direct socket manipulation (that's for subclasses via `_getSocket()`)

---

### **Protocol Public API:**

```javascript
// Identity & Configuration
getId()
getOptions()
getConfig()
setOptions(options)
setLogger(logger)
debug  // getter/setter for debug mode

// State
isOnline()       // Socket online?
isConnected()    // Protocol connected?
isReady()        // Ready to send?
getConnectionState()

// Messaging
request({ to, event, data, timeout })
tick({ to, event, data })

// Handlers
onRequest(pattern, handler, mainEvent)
offRequest(pattern, handler)
onTick(pattern, handler, mainEvent)
offTick(pattern, handler)

// Peer Tracking (Router)
getPeers()
getPeer(peerId)
hasPeer(peerId)

// Protected (for subclasses)
_getSocket()
_getPrivateScope()
```

---

## 📋 Client Responsibilities

### **Core Responsibility:** Application logic for client-side communication

### **What Client Does:**

#### 1. **Server Peer Management** ✅
```javascript
let _scope = {
  serverPeerInfo: null,  // PeerInfo instance
  // ...
}

// Create peer on connect
async connect(routerAddress) {
  _scope.serverPeerInfo = new PeerInfo({ 
    id: 'server',
    options: {}
  })
  _scope.serverPeerInfo.setState('CONNECTING')
  
  const socket = this._getSocket()
  await socket.connect(routerAddress)
}

// Update peer state based on Protocol events
this.on(ProtocolEvent.READY, () => {
  serverPeerInfo.setState('CONNECTED')
})

this.on(ProtocolEvent.CONNECTION_LOST, () => {
  serverPeerInfo.setState('GHOST')
})

this.on(ProtocolEvent.CONNECTION_RESTORED, () => {
  serverPeerInfo.setState('HEALTHY')
})

this.on(ProtocolEvent.CONNECTION_FAILED, () => {
  serverPeerInfo.setState('FAILED')
})
```

**Result:** Client tracks server state using PeerInfo state machine!

---

#### 2. **Ping Mechanism** ✅
```javascript
// Start ping on connection
_startPing() {
  const pingInterval = config.PING_INTERVAL || 10000
  
  _scope.pingInterval = setInterval(() => {
    if (this.isReady()) {
      this.tick({
        event: events.CLIENT_PING,
        data: { 
          clientId: this.getId(),
          timestamp: Date.now() 
        },
        mainEvent: true
      })
    }
  }, pingInterval)
}

// Stop ping on disconnection
_stopPing() {
  if (_scope.pingInterval) {
    clearInterval(_scope.pingInterval)
    _scope.pingInterval = null
  }
}
```

**Result:** Client keeps connection alive with automatic pings!

---

#### 3. **Application Event Handling** ✅
```javascript
_attachApplicationEventHandlers() {
  // Server acknowledges connection
  this.onTick(events.CLIENT_CONNECTED, (data) => {
    serverPeerInfo.setState('HEALTHY')
    serverPeerInfo.setOptions(data.serverOptions || {})
    this.emit(events.CLIENT_CONNECTED, data)
  })
  
  // Server is stopping
  this.onTick(events.SERVER_STOP, () => {
    serverPeerInfo.setState('STOPPED')
    this._stopPing()
    this.emit(events.SERVER_STOP)
  })
  
  // Server sends options
  this.onTick(events.OPTIONS_SYNC, (data) => {
    if (data && data.options) {
      serverPeerInfo.setOptions(data.options)
    }
    this.emit(events.OPTIONS_SYNC, data)
  })
}
```

**Result:** Client handles application-specific messages!

---

#### 4. **Connection Management** ✅
```javascript
async connect(routerAddress, timeout) {
  // Create peer
  _scope.serverPeerInfo = new PeerInfo({ id: 'server' })
  _scope.serverPeerInfo.setState('CONNECTING')
  
  // Use Protocol's socket
  const socket = this._getSocket()
  await socket.connect(routerAddress, timeout)
  
  // Protocol emits ProtocolEvent.READY when connected
}

async disconnect() {
  this._stopPing()
  
  // Notify server
  if (this.isReady()) {
    this.tick({
      event: events.CLIENT_STOP,
      data: { clientId: this.getId() },
      mainEvent: true
    })
  }
  
  const socket = this._getSocket()
  await socket.disconnect()
  
  serverPeerInfo.setState('STOPPED')
}

async close() {
  await this.disconnect()
  const socket = this._getSocket()
  await socket.close()
}
```

**Result:** Clean connection/disconnection with proper cleanup!

---

### **What Client Does NOT Do:**

❌ Direct socket access (uses `_getSocket()` only when needed)
❌ Listen to SocketEvent (only ProtocolEvent)
❌ Request/response tracking (Protocol does this)
❌ Envelope serialization/parsing (Protocol does this)

---

### **Client Public API:**

```javascript
// Connection
async connect(routerAddress, timeout)
async disconnect()
async close()

// Peer Management
getServerPeerInfo()

// Configuration
setOptions(options, notify = true)

// Inherited from Protocol:
// - request({ to, event, data })
// - tick({ to, event, data })
// - onRequest(pattern, handler)
// - onTick(pattern, handler)
// - getId(), getOptions(), getConfig(), etc.
```

---

## 📋 Server Responsibilities

### **Core Responsibility:** Application logic for server-side communication

### **What Server Does:**

#### 1. **Multiple Client Peer Management** ✅
```javascript
let _scope = {
  clientPeers: new Map(),  // clientId → PeerInfo
  // ...
}

// Create peer on connection
this.on(ProtocolEvent.PEER_CONNECTED, ({ peerId, endpoint }) => {
  const peerInfo = new PeerInfo({ id: peerId, options: {} })
  peerInfo.setState('CONNECTED')
  clientPeers.set(peerId, peerInfo)
  
  // Welcome the client
  this.tick({
    to: peerId,
    event: events.CLIENT_CONNECTED,
    data: {
      serverId: this.getId(),
      serverOptions: this.getOptions()
    },
    mainEvent: true
  })
  
  this.emit(events.CLIENT_CONNECTED, { clientId: peerId, endpoint })
})

// Update peer on disconnection
this.on(ProtocolEvent.PEER_DISCONNECTED, ({ peerId }) => {
  const peerInfo = clientPeers.get(peerId)
  if (peerInfo) {
    peerInfo.setState('STOPPED')
  }
  this.emit(events.CLIENT_DISCONNECTED, { clientId: peerId })
})
```

**Result:** Server tracks all connected clients!

---

#### 2. **Health Check Mechanism** ✅
```javascript
// Start health checks when ready
this.on(ProtocolEvent.READY, () => {
  this._startHealthChecks()
})

_startHealthChecks() {
  const checkInterval = config.HEALTH_CHECK_INTERVAL || 30000
  const ghostThreshold = config.GHOST_THRESHOLD || 60000
  
  _scope.healthCheckInterval = setInterval(() => {
    this._checkClientHealth(ghostThreshold)
  }, checkInterval)
}

_checkClientHealth(ghostThreshold) {
  const now = Date.now()
  
  clientPeers.forEach((peerInfo, clientId) => {
    const timeSinceLastSeen = now - peerInfo.getLastSeen()
    
    if (timeSinceLastSeen > ghostThreshold) {
      const previousState = peerInfo.getState()
      peerInfo.setState('GHOST')
      
      if (previousState !== 'GHOST') {
        this.emit(events.CLIENT_GHOST, { 
          clientId, 
          lastSeen: peerInfo.getLastSeen(),
          timeSinceLastSeen 
        })
      }
    }
  })
}

_stopHealthChecks() {
  if (_scope.healthCheckInterval) {
    clearInterval(_scope.healthCheckInterval)
    _scope.healthCheckInterval = null
  }
}
```

**Result:** Server automatically detects dead clients!

---

#### 3. **Application Event Handling** ✅
```javascript
_attachApplicationEventHandlers() {
  // Client sends ping (heartbeat)
  this.onTick(events.CLIENT_PING, (data, envelope) => {
    const clientId = envelope.owner
    const peerInfo = clientPeers.get(clientId)
    
    if (peerInfo) {
      peerInfo.updateLastSeen()
      peerInfo.setState('HEALTHY')
    }
  })
  
  // Client is stopping
  this.onTick(events.CLIENT_STOP, (data, envelope) => {
    const clientId = envelope.owner
    const peerInfo = clientPeers.get(clientId)
    
    if (peerInfo) {
      peerInfo.setState('STOPPED')
    }
    
    this.emit(events.CLIENT_STOP, { clientId })
  })
  
  // Client sends options
  this.onTick(events.OPTIONS_SYNC, (data, envelope) => {
    const clientId = envelope.owner
    const peerInfo = clientPeers.get(clientId)
    
    if (peerInfo && data && data.options) {
      peerInfo.setOptions(data.options)
    }
    
    this.emit(events.OPTIONS_SYNC, { clientId, options: data?.options })
  })
  
  // Client handshake
  this.onTick(events.CLIENT_CONNECTED, (data, envelope) => {
    const clientId = envelope.owner
    const peerInfo = clientPeers.get(clientId)
    
    if (peerInfo) {
      peerInfo.setState('HEALTHY')
      if (data && data.clientOptions) {
        peerInfo.setOptions(data.clientOptions)
      }
    }
  })
}
```

**Result:** Server handles client messages and updates peer state!

---

#### 4. **Bind Management** ✅
```javascript
async bind(bindAddress) {
  _scope.bindAddress = bindAddress
  
  // Use Protocol's socket
  const socket = this._getSocket()
  await socket.bind(bindAddress)
  
  // Protocol emits ProtocolEvent.READY when bound
}

async unbind() {
  this._stopHealthChecks()
  
  // Notify all clients
  if (this.isReady()) {
    this.tick({
      event: events.SERVER_STOP,
      data: { serverId: this.getId() },
      mainEvent: true
    })
  }
  
  const socket = this._getSocket()
  await socket.unbind()
}

async close() {
  await this.unbind()
  const socket = this._getSocket()
  await socket.close()
}
```

**Result:** Clean bind/unbind with proper cleanup and client notification!

---

### **What Server Does NOT Do:**

❌ Direct socket access (uses `_getSocket()` only when needed)
❌ Listen to SocketEvent (only ProtocolEvent)
❌ Request/response tracking (Protocol does this)
❌ Envelope serialization/parsing (Protocol does this)
❌ Basic peer tracking (Protocol does this, Server adds state management)

---

### **Server Public API:**

```javascript
// Binding
async bind(bindAddress)
async unbind()
async close()

// Peer Management
getClientPeerInfo(clientId)
getAllClientPeers()
getConnectedClientCount()

// Configuration
setOptions(options, notify = true)

// Inherited from Protocol:
// - request({ to, event, data })
// - tick({ to, event, data })
// - onRequest(pattern, handler)
// - onTick(pattern, handler)
// - getId(), getOptions(), getConfig(), etc.
```

---

## 🎯 Responsibility Comparison Table

| Responsibility | Protocol | Client | Server |
|----------------|----------|--------|--------|
| **Request/Response Tracking** | ✅ Yes | ❌ No | ❌ No |
| **Handler Management** | ✅ Yes | ❌ No | ❌ No |
| **Envelope Serialization** | ✅ Yes | ❌ No | ❌ No |
| **Socket Event Translation** | ✅ Yes | ❌ No | ❌ No |
| **Connection State** | ✅ Yes | ❌ No | ❌ No |
| **Basic Peer Tracking** | ✅ Yes (Router) | ❌ No | ❌ No |
| **Advanced Peer State** | ❌ No | ✅ Yes | ✅ Yes |
| **Ping Mechanism** | ❌ No | ✅ Yes | ❌ No |
| **Health Checks** | ❌ No | ❌ No | ✅ Yes |
| **Application Events** | ❌ No | ✅ Yes | ✅ Yes |
| **Direct Socket Access** | ✅ Yes (private) | ⚠️ Protected | ⚠️ Protected |

---

## 🔄 Event Flow Summary

### Client Connection Flow

```
Socket              Protocol            Client
  │                     │                 │
  │ CONNECT             │                 │
  ├────────────────────>│                 │
  │                     │ READY           │
  │                     ├────────────────>│
  │                     │                 │ setState(CONNECTED)
  │                     │                 │ _startPing()
  │                     │                 │ _sendClientConnected()
```

### Server Client Accept Flow

```
Socket              Protocol            Server
  │                     │                 │
  │ ACCEPT              │                 │
  ├────────────────────>│                 │
  │                     │ PEER_CONNECTED  │
  │                     ├────────────────>│
  │                     │                 │ createPeerInfo(clientId)
  │                     │                 │ setState(CONNECTED)
  │                     │                 │ sendWelcome()
```

### Request/Response Flow

```
Client         Protocol         Socket         Server
  │               │                │               │
  │ request()     │                │               │
  ├──────────────>│                │               │
  │               │ serializeEnv   │               │
  │               │ trackPromise   │               │
  │               │ sendBuffer     │               │
  │               ├───────────────>│ send()        │
  │               │                ├──────────────>│
  │               │                │               │ onRequest handler
  │               │                │               │ return data
  │               │                │ message       │
  │               │<───────────────┤<──────────────┤
  │               │ parseResponse  │               │
  │               │ resolvePromise │               │
  │<──────────────┤                │               │
  │ return result │                │               │
```

---

## 🎓 Summary

### **Protocol = Infrastructure**
- Request/response infrastructure
- Event translation infrastructure
- Connection state infrastructure
- **Result:** Client/Server don't worry about these details

### **Client = Application Logic (Client-Side)**
- Server peer management
- Ping mechanism
- Application event handling
- **Result:** Focus on client-specific business logic

### **Server = Application Logic (Server-Side)**
- Multiple client peer management
- Health check mechanism
- Application event handling
- **Result:** Focus on server-specific business logic

### **Key Principle:**
> **Protocol handles "how"**, **Client/Server handle "what"**

- Protocol: **HOW** to send messages, track requests, translate events
- Client/Server: **WHAT** to do with connections, peers, application logic

