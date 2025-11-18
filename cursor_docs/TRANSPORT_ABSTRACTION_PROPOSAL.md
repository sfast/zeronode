# Transport Abstraction Layer - Architecture Proposal

## 🎯 Current Architecture Analysis

### Current State
```
Node (Orchestration)
  ├── Server (extends Protocol)
  │   └── RouterSocket (ZeroMQ)
  └── Client (extends Protocol)
      └── DealerSocket (ZeroMQ)
```

**Current Issues:**
1. ❌ Direct ZeroMQ socket imports in `Client` and `Server`
2. ❌ No abstraction for other transports (TCP, WebSocket, QUIC, etc.)
3. ❌ Hard to swap transports without modifying protocol layer
4. ❌ No transport configuration at Node level

---

## 💡 Proposed Architecture Options

### **Option 1: Transport Factory Pattern** (⭐ RECOMMENDED)

```
Node (Orchestration)
  ├── Server (extends Protocol)
  │   └── Transport (interface)
  │       └── ZeroMQTransport.createServer()
  └── Client (extends Protocol)
      └── Transport (interface)
          └── ZeroMQTransport.createClient()
```

#### Structure
```javascript
// src/transport/transport.js
export class Transport {
  static setDefaultTransport(transportImpl) {
    // Configure default transport globally
  }
  
  static createServerSocket(config) {
    // Factory method for server sockets
  }
  
  static createClientSocket(config) {
    // Factory method for client sockets
  }
}

// src/transport/zeromq/zeromq-transport.js
export class ZeroMQTransport {
  static createServerSocket(config) {
    return new Router(config)
  }
  
  static createClientSocket(config) {
    return new Dealer(config)
  }
}

// Usage in Client/Server
import { Transport } from '../transport/transport.js'

class Client extends Protocol {
  constructor({ id, options, config } = {}) {
    const socket = Transport.createClientSocket({ id, config })
    super(socket, config)
  }
}
```

#### Pros ✅
- Clean separation of concerns
- Easy to add new transports
- Configuration at Node level
- Backward compatible
- Factory pattern is familiar

#### Cons ⚠️
- Global state for default transport
- Requires transport registration

---

### **Option 2: Transport Interface with Dependency Injection**

```
Node (Orchestration)
  ├── Transport: ITransport (injected)
  ├── Server (extends Protocol)
  │   └── socket from transport
  └── Client (extends Protocol)
      └── socket from transport
```

#### Structure
```javascript
// src/transport/interface.js
export class ITransport {
  createServerSocket(config) { throw new Error('Not implemented') }
  createClientSocket(config) { throw new Error('Not implemented') }
}

// src/transport/zeromq/index.js
export class ZeroMQTransport extends ITransport {
  createServerSocket(config) {
    return new Router(config)
  }
  
  createClientSocket(config) {
    return new Dealer(config)
  }
}

// Usage in Node
import { ZeroMQTransport } from './transport/zeromq/index.js'

class Node extends EventEmitter {
  constructor({ id, transport = new ZeroMQTransport() }) {
    this.transport = transport
    // Pass transport to Client/Server constructors
  }
}

// Usage
const node = new Node({
  transport: new ZeroMQTransport()
})
```

#### Pros ✅
- Explicit dependency injection
- No global state
- Very flexible
- Testable with mock transports

#### Cons ⚠️
- Breaking change to Node API
- More complex for users
- Verbose for simple cases

---

### **Option 3: Transport Plugin System** (Most Flexible)

```
Node (Orchestration)
  ├── TransportRegistry
  │   ├── 'zeromq' → ZeroMQTransport
  │   ├── 'tcp' → TCPTransport
  │   └── 'websocket' → WebSocketTransport
  ├── Server (extends Protocol)
  └── Client (extends Protocol)
```

#### Structure
```javascript
// src/transport/registry.js
export class TransportRegistry {
  static transports = new Map()
  static defaultTransport = 'zeromq'
  
  static register(name, transportClass) {
    this.transports.set(name, transportClass)
  }
  
  static setDefault(name) {
    this.defaultTransport = name
  }
  
  static get(name = this.defaultTransport) {
    return this.transports.get(name)
  }
}

// Auto-register ZeroMQ
import { ZeroMQTransport } from './zeromq/zeromq-transport.js'
TransportRegistry.register('zeromq', ZeroMQTransport)
TransportRegistry.setDefault('zeromq')

// Usage in Node
class Node extends EventEmitter {
  constructor({ id, transport = 'zeromq' }) {
    const Transport = TransportRegistry.get(transport)
    // Use Transport to create sockets
  }
}

// Advanced usage: Register custom transport
import { TransportRegistry } from 'zeronode'
import { MyCustomTransport } from './my-transport.js'

TransportRegistry.register('custom', MyCustomTransport)

const node = new Node({ transport: 'custom' })
```

#### Pros ✅
- Plugin architecture
- Easy to add community transports
- String-based configuration
- Global registry for easy access
- Best for extensibility

#### Cons ⚠️
- Most complex implementation
- Registry management overhead
- Potential naming conflicts

---

### **Option 4: Minimal Wrapper** (Simplest)

```
Node → Server/Client → TransportAdapter → Socket
```

#### Structure
```javascript
// src/transport/adapter.js
export class TransportAdapter {
  static createServer(config) {
    // For now, only ZeroMQ
    const { Router } = require('./zeromq/index.js')
    return new Router(config)
  }
  
  static createClient(config) {
    const { Dealer } = require('./zeromq/index.js')
    return new Dealer(config)
  }
}

// Usage in Client/Server
import { TransportAdapter } from '../transport/adapter.js'

class Client extends Protocol {
  constructor({ id, options, config } = {}) {
    const socket = TransportAdapter.createClient({ id, config })
    super(socket, config)
  }
}
```

#### Pros ✅
- Minimal changes
- Easiest to implement
- No breaking changes
- Good first step

#### Cons ⚠️
- Not truly pluggable
- Hard-coded to ZeroMQ
- Limited extensibility

---

## 🏆 Recommended Approach: **Option 1 + Option 3 Hybrid**

Combine the simplicity of Option 1 with the extensibility of Option 3:

```javascript
// src/transport/transport.js
export class Transport {
  static registry = new Map()
  static defaultTransport = 'zeromq'
  
  // Plugin registration
  static register(name, transportImpl) {
    this.registry.set(name, transportImpl)
  }
  
  static setDefault(name) {
    this.defaultTransport = name
  }
  
  // Factory methods (use default transport)
  static createServerSocket(config) {
    const impl = this.registry.get(this.defaultTransport)
    if (!impl) throw new Error(`Transport '${this.defaultTransport}' not registered`)
    return impl.createServerSocket(config)
  }
  
  static createClientSocket(config) {
    const impl = this.registry.get(this.defaultTransport)
    if (!impl) throw new Error(`Transport '${this.defaultTransport}' not registered`)
    return impl.createClientSocket(config)
  }
  
  // Get specific transport
  static use(name) {
    return this.registry.get(name)
  }
}

// src/transport/zeromq/zeromq-transport.js
import { Router, Dealer } from './index.js'

export class ZeroMQTransport {
  static createServerSocket(config) {
    return new Router(config)
  }
  
  static createClientSocket(config) {
    return new Dealer(config)
  }
}

// Auto-register in src/transport/index.js
import { Transport } from './transport.js'
import { ZeroMQTransport } from './zeromq/zeromq-transport.js'

Transport.register('zeromq', ZeroMQTransport)
Transport.setDefault('zeromq')

export { Transport }
```

### Usage Examples

#### Simple (no changes for existing users)
```javascript
import { Node } from 'zeronode'

const node = new Node()
await node.bind('tcp://127.0.0.1:3000')
// Uses default ZeroMQ transport
```

#### Configure Transport Globally
```javascript
import { Transport } from 'zeronode'

// Set default transport for all new nodes
Transport.setDefault('zeromq')

const node = new Node()
// Uses configured transport
```

#### Custom Transport
```javascript
import { Transport } from 'zeronode'

// Register custom transport
class MyTransport {
  static createServerSocket(config) {
    return new MyServerSocket(config)
  }
  
  static createClientSocket(config) {
    return new MyClientSocket(config)
  }
}

Transport.register('mytransport', MyTransport)
Transport.setDefault('mytransport')

const node = new Node()
// Uses custom transport
```

#### Per-Node Transport (Future Enhancement)
```javascript
import { Node, Transport } from 'zeronode'

const node = new Node({
  transport: Transport.use('tcp')
})
```

---

## 📁 Proposed File Structure

```
src/
├── transport/
│   ├── transport.js           ✨ NEW - Transport factory & registry
│   ├── index.js               📝 UPDATED - Export Transport
│   ├── events.js              ✅ KEEP
│   ├── errors.js              ✅ KEEP
│   └── zeromq/
│       ├── zeromq-transport.js  ✨ NEW - ZeroMQ implementation
│       ├── index.js             ✅ KEEP - Export Router/Dealer
│       ├── router.js            ✅ KEEP
│       ├── dealer.js            ✅ KEEP
│       ├── socket.js            ✅ KEEP
│       ├── context.js           ✅ KEEP
│       └── config.js            ✅ KEEP
├── protocol/
│   ├── client.js              📝 UPDATED - Use Transport.createClientSocket()
│   ├── server.js              📝 UPDATED - Use Transport.createServerSocket()
│   └── ...                    ✅ KEEP
└── node.js                    ✅ KEEP (or minor updates)
```

---

## 🔄 Migration Path

### Phase 1: Create Abstraction (Non-Breaking)
1. Create `Transport` class
2. Create `ZeroMQTransport` wrapper
3. Auto-register ZeroMQ
4. Keep existing imports working

### Phase 2: Update Protocol Layer
1. Change `Client` to use `Transport.createClientSocket()`
2. Change `Server` to use `Transport.createServerSocket()`
3. Remove direct ZeroMQ imports from protocol layer

### Phase 3: Documentation
1. Update docs with Transport API
2. Add custom transport guide
3. Examples for different transports

### Phase 4: Future Enhancements
1. Add built-in TCP transport
2. Add built-in WebSocket transport
3. Community transports (MQTT, NATS, etc.)

---

## 🎨 Transport Interface Contract

All transports must implement:

```javascript
interface ITransport {
  // Factory methods
  static createServerSocket(config): IServerSocket
  static createClientSocket(config): IClientSocket
}

interface IServerSocket {
  bind(address): Promise<void>
  unbind(): Promise<void>
  send(clientId, frames): Promise<void>
  getId(): string
  getAddress(): string
  isOnline(): boolean
  on(event, handler): void
  once(event, handler): void
  close(): Promise<void>
}

interface IClientSocket {
  connect(address): Promise<void>
  disconnect(): Promise<void>
  send(frames): Promise<void>
  getId(): string
  isOnline(): boolean
  on(event, handler): void
  once(event, handler): void
  close(): Promise<void>
}
```

**Events all sockets must emit:**
- `TransportEvent.READY` / `TransportEvent.NOT_READY`
- `TransportEvent.MESSAGE`
- `TransportEvent.ERROR`
- `TransportEvent.CLOSED`

---

## 🚀 Benefits of This Approach

### For ZeroNode Core
✅ Clean architecture
✅ Pluggable transports
✅ Easy to test (mock transports)
✅ Future-proof

### For Users
✅ Zero breaking changes
✅ Opt-in transport switching
✅ Simple API
✅ Extensible

### For Community
✅ Can build custom transports
✅ Clear interface contract
✅ Plugin ecosystem potential

---

## 📊 Comparison Matrix

| Feature | Option 1 | Option 2 | Option 3 | Option 4 | **Hybrid** |
|---------|----------|----------|----------|----------|------------|
| Easy to implement | ✅ | ⚠️ | ❌ | ✅ | ✅ |
| Pluggable | ✅ | ✅ | ✅ | ❌ | ✅ |
| No breaking changes | ✅ | ❌ | ✅ | ✅ | ✅ |
| Global config | ✅ | ❌ | ✅ | ❌ | ✅ |
| Per-instance config | ⚠️ | ✅ | ⚠️ | ❌ | ✅ |
| Community extensible | ✅ | ✅ | ✅ | ❌ | ✅ |
| Simple API | ✅ | ❌ | ✅ | ✅ | ✅ |
| **TOTAL SCORE** | 6/7 | 4/7 | 6/7 | 3/7 | **7/7** |

---

## 🎯 Next Steps

1. **Create `Transport` class** with registry
2. **Create `ZeroMQTransport` wrapper**
3. **Update `Client` and `Server`** to use Transport
4. **Add tests** for transport abstraction
5. **Document** the transport API
6. **Example**: Create a simple TCP transport as proof-of-concept

---

## 💭 Open Questions

1. **Should we support per-Node transport configuration?**
   - Pro: More flexible
   - Con: More complex API
   - **Recommendation**: Start with global, add per-node later

2. **Should Transport be a class or a module?**
   - Class: Better for DI/testing
   - Module: Simpler for users
   - **Recommendation**: Static class (best of both)

3. **Should we version the transport interface?**
   - Important for long-term stability
   - **Recommendation**: Yes, with semver

4. **How do we handle transport-specific config?**
   - Pass through to socket constructor
   - **Recommendation**: Keep current config approach

---

## ✨ Conclusion

The **Hybrid Approach (Option 1 + 3)** gives us:
- ✅ Simple factory pattern
- ✅ Plugin registry
- ✅ Zero breaking changes
- ✅ Fully extensible
- ✅ Clean architecture
- ✅ Future-proof

**This is the recommended path forward!** 🚀

