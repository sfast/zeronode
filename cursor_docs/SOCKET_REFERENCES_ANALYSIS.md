# Socket References Analysis - Client, Server & Protocol Layer

## 🔍 Complete Socket API Usage Audit

### Summary
The protocol layer uses **10 socket methods** across 5 files. All socket references are well-contained and use a consistent interface.

---

## 📊 Socket Method Usage by File

### **1. Protocol Layer (`protocol.js`)**

#### Read Methods (6 uses)
```javascript
// ID & State
socket.getId()        // 5 times - Get socket ID
socket.isOnline()     // 1 time  - Check connection state

// Configuration
socket.logger         // 3 times - Access logger instance
socket.debug = value  // 1 time  - Set debug mode
socket.setLogger()    // 1 time  - Set logger
```

#### Write Methods (1 use)
```javascript
// Send Messages
socket.sendBuffer(buffer, to)  // 2 times - Send binary envelope
```

**Lines**:
- Line 43: `socket.getId()` - ID generator init
- Line 47: `socket.getId()` - Request tracker init
- Line 50: `socket.logger` - Request tracker logger
- Line 58: `socket.logger` - Handler executor logger
- Line 67: `socket.logger` - Message dispatcher logger
- Line 76: `socket.getId()` - Lifecycle manager init
- Line 78: `socket.logger` - Lifecycle manager logger
- Line 105: `socket.getId()` - Public API
- Line 115: `socket.setLogger()` - Public API
- Line 120: `socket.isOnline()` - Public API
- Line 131: `socket.debug = value` - Public API
- Line 193: `socket.sendBuffer(buffer, to)` - Send request
- Line 291: `socket.sendBuffer(buffer, to)` - Send tick

---

### **2. Client Layer (`client.js`)**

#### Connection Methods (1 use)
```javascript
socket.connect(serverAddress)  // Line 241 - Connect to server
```

**Full context**:
```javascript
async connect ({ address, timeout } = {}) {
  let _scope = _private.get(this)
  // ... validation ...
  _scope.serverAddress = address
  await socket.connect(serverAddress)  // ✅ Only socket call
  return this
}
```

---

### **3. Server Layer (`server.js`)**

#### Server Methods (2 uses)
```javascript
socket.bind(bindAddress)    // Line 189 - Bind server
socket.getAddress()         // Line 220 - Get bind address
```

**Full context**:
```javascript
async bind (address) {
  let { socket } = _private.get(this)
  // ... validation ...
  await socket.bind(bindAddress)  // ✅ Socket call 1
  return this
}

getAddress() {
  let { socket } = _private.get(this)
  return socket.getAddress()  // ✅ Socket call 2
}
```

---

### **4. Lifecycle Manager (`lifecycle.js`)**

#### Event Listeners (10 uses)
```javascript
// Attach listeners
socket.on(TransportEvent.MESSAGE, handler)     // Line 78
socket.on(TransportEvent.READY, handler)       // Line 79
socket.on(TransportEvent.NOT_READY, handler)   // Line 80
socket.on(TransportEvent.CLOSED, handler)      // Line 81
socket.on(TransportEvent.ERROR, handler)       // Line 82

// Detach listeners
socket.removeAllListeners(TransportEvent.MESSAGE)     // Line 93
socket.removeAllListeners(TransportEvent.READY)       // Line 94
socket.removeAllListeners(TransportEvent.NOT_READY)   // Line 95
socket.removeAllListeners(TransportEvent.CLOSED)      // Line 96
socket.removeAllListeners(TransportEvent.ERROR)       // Line 97
```

#### Lifecycle Methods (3 uses)
```javascript
socket.disconnect()  // Line 179 - Client disconnect
socket.unbind()      // Line 192 - Server unbind
socket.close()       // Line 211 - Close socket
```

**Full context**:
```javascript
async disconnect () {
  await this.socket.disconnect()
}

async unbind () {
  await this.socket.unbind()
}

async close () {
  if (this.socket && typeof this.socket.close === 'function') {
    try {
      await this.socket.close()
    } catch (err) {
      // Ignore close errors
    }
  }
}
```

---

### **5. Handler Executor (`handler-executor.js`)**

#### Send Methods (4 uses)
```javascript
this.socket.getId()                    // Line 250, 277 - Get owner ID
this.socket.sendBuffer(buffer, target) // Line 254, 281 - Send response/error
```

**Full context**:
```javascript
// Send response
const buffer = Envelope.createBuffer({
  type: EnvelopType.RESPONSE,
  id: envelope.id,
  event: envelope.event,
  data,
  owner: this.socket.getId(),  // ✅ Get ID
  recipient: envelope.owner
}, this.config.BUFFER_STRATEGY)

this.socket.sendBuffer(buffer, envelope.owner)  // ✅ Send

// Send error
const buffer = Envelope.createBuffer({
  type: EnvelopType.ERROR,
  id: envelope.id,
  event: envelope.event,
  data: errorMessage,
  owner: this.socket.getId(),  // ✅ Get ID
  recipient: envelope.owner
}, this.config.BUFFER_STRATEGY)

this.socket.sendBuffer(buffer, envelope.owner)  // ✅ Send
```

---

### **6. Message Dispatcher (`message-dispatcher.js`)**

#### No Direct Socket Usage ✅
Message dispatcher uses handler-executor, which uses socket internally.

---

## 🎯 Socket Interface Contract

Based on the analysis, the **Transport Socket Interface** must provide:

### **Core Properties**
```typescript
interface ITransportSocket {
  // Properties
  logger: Logger           // Read/write access
  debug: boolean          // Read/write access
  
  // Methods - Identity
  getId(): string
  
  // Methods - State
  isOnline(): boolean
  
  // Methods - Configuration
  setLogger(logger: Logger): void
  
  // Methods - Messaging
  sendBuffer(buffer: Buffer, to?: string): void
  
  // Methods - Event Emitter
  on(event: string, handler: Function): void
  removeAllListeners(event: string): void
  
  // Methods - Lifecycle
  close(): Promise<void>
}
```

### **Client Socket (extends ITransportSocket)**
```typescript
interface IClientSocket extends ITransportSocket {
  connect(address: string): Promise<void>
  disconnect(): Promise<void>
}
```

### **Server Socket (extends ITransportSocket)**
```typescript
interface IServerSocket extends ITransportSocket {
  bind(address: string): Promise<void>
  unbind(): Promise<void>
  getAddress(): string
}
```

---

## 📋 Complete Socket Method Reference

| Method | Usage Count | Used In | Purpose |
|--------|-------------|---------|---------|
| `getId()` | 8 | protocol.js, handler-executor.js | Get socket/node ID |
| `isOnline()` | 1 | protocol.js | Check connection state |
| `sendBuffer(buffer, to)` | 4 | protocol.js, handler-executor.js | Send binary envelopes |
| `logger` | 5 | protocol.js | Access logger instance |
| `debug` | 1 | protocol.js | Set debug mode |
| `setLogger(logger)` | 1 | protocol.js | Configure logger |
| `connect(address)` | 1 | client.js | Connect to server |
| `disconnect()` | 1 | lifecycle.js | Disconnect from server |
| `bind(address)` | 1 | server.js | Bind server |
| `unbind()` | 1 | lifecycle.js | Unbind server |
| `getAddress()` | 1 | server.js | Get bind address |
| `close()` | 1 | lifecycle.js | Close socket |
| `on(event, handler)` | 5 | lifecycle.js | Attach event listeners |
| `removeAllListeners(event)` | 5 | lifecycle.js | Detach event listeners |
| **TOTAL** | **36** | | |

---

## 🔑 Key Findings

### ✅ Good Architecture
1. **Well-contained**: Socket usage is limited to 5 files
2. **Consistent interface**: All socket calls follow same patterns
3. **Clear separation**: 
   - Protocol layer: messaging & state
   - Client/Server: connection management
   - Lifecycle: event handling
   - Handler-executor: response sending

### 🎯 Transport Abstraction Requirements

To successfully abstract the transport layer, we need:

1. **Core Interface**: 14 methods total
   - 6 read methods (getId, isOnline, logger, debug, getAddress, etc.)
   - 8 action methods (sendBuffer, connect, bind, close, etc.)

2. **EventEmitter**: Socket must be an EventEmitter
   - `on()` for attaching listeners
   - `removeAllListeners()` for cleanup

3. **Properties**: 2 settable properties
   - `logger` - Logger instance
   - `debug` - Boolean flag

---

## 📝 Transport Abstraction Strategy

### Phase 1: Define Interface
```javascript
// src/transport/interface.js
export class ITransportSocket {
  // Core
  getId() { throw new Error('Not implemented') }
  isOnline() { throw new Error('Not implemented') }
  
  // Messaging
  sendBuffer(buffer, to) { throw new Error('Not implemented') }
  
  // Configuration
  get logger() { throw new Error('Not implemented') }
  set logger(value) { throw new Error('Not implemented') }
  get debug() { throw new Error('Not implemented') }
  set debug(value) { throw new Error('Not implemented') }
  setLogger(logger) { throw new Error('Not implemented') }
  
  // Lifecycle
  close() { throw new Error('Not implemented') }
  
  // EventEmitter (inherited from EventEmitter class)
  // on(), removeAllListeners()
}

export class IClientSocket extends ITransportSocket {
  connect(address) { throw new Error('Not implemented') }
  disconnect() { throw new Error('Not implemented') }
}

export class IServerSocket extends ITransportSocket {
  bind(address) { throw new Error('Not implemented') }
  unbind() { throw new Error('Not implemented') }
  getAddress() { throw new Error('Not implemented') }
}
```

### Phase 2: Verify ZeroMQ Compliance
```javascript
// src/transport/zeromq/dealer.js
export default class Dealer extends Socket {
  // ✅ Already implements:
  // - getId()
  // - isOnline()
  // - sendBuffer()
  // - logger (property)
  // - debug (property)
  // - setLogger()
  // - connect()
  // - disconnect()
  // - close()
  // - on(), removeAllListeners() (from EventEmitter)
}

// src/transport/zeromq/router.js
export default class Router extends Socket {
  // ✅ Already implements:
  // - getId()
  // - isOnline()
  // - sendBuffer()
  // - logger (property)
  // - debug (property)
  // - setLogger()
  // - bind()
  // - unbind()
  // - getAddress()
  // - close()
  // - on(), removeAllListeners() (from EventEmitter)
}
```

### Phase 3: Create Transport Factory
```javascript
// src/transport/transport.js
import { Router, Dealer } from './zeromq/index.js'

export class Transport {
  static createServerSocket(config) {
    return new Router(config)
  }
  
  static createClientSocket(config) {
    return new Dealer(config)
  }
}
```

### Phase 4: Update Protocol Layer
```javascript
// src/protocol/client.js
import { Transport } from '../transport/transport.js'

class Client extends Protocol {
  constructor({ id, options, config } = {}) {
    const socket = Transport.createClientSocket({ id, config })
    super(socket, config)
  }
}

// src/protocol/server.js
import { Transport } from '../transport/transport.js'

class Server extends Protocol {
  constructor({ id, options, config } = {}) {
    const socket = Transport.createServerSocket({ id, config })
    super(socket, config)
  }
}
```

---

## ✨ Summary

### Socket API Surface Area
- **14 unique methods** across the interface
- **36 total call sites** in the codebase
- **5 files** with socket references
- **100% contained** in protocol layer (no leakage to Node layer)

### Transport Abstraction Readiness
✅ **EXCELLENT** - The current architecture is already well-abstracted:
- Socket is passed as dependency to Protocol constructor
- All socket calls go through well-defined interface
- No direct ZeroMQ-specific code in protocol logic
- EventEmitter pattern is standard across Node.js

### Next Steps
1. ✅ Define `ITransportSocket`, `IClientSocket`, `IServerSocket` interfaces
2. ✅ Create `Transport` factory class with `createClientSocket()` / `createServerSocket()`
3. ✅ Update `Client` and `Server` to use `Transport` factory
4. ✅ Keep ZeroMQ as default transport implementation
5. ✅ Document transport interface for community implementations

**The abstraction is straightforward and non-breaking!** 🚀

