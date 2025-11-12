# ZeroNode

<p align="center">
  <img src="https://i.imgur.com/NZVXZPo.png" alt="Zeronode Logo" />
</p>

<p align="center">
  <strong>Production-Grade Microservices Communication Layer for Node.js</strong>
  <br/>
  <em>Built on ZeroMQ • Fully Async/Await • Type-Safe • Battle-Tested</em>
</p>

<p align="center">
  <a href="https://github.com/standard/standard"><img src="https://cdn.rawgit.com/standard/standard/master/badge.svg" alt="JavaScript Style Guide"></a>
  <a href="https://gitter.im/npm-zeronode/Lobby"><img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg" alt="Gitter"></a>
  <a href="https://snyk.io/test/github/sfast/zeronode"><img src="https://snyk.io/test/github/sfast/zeronode/badge.svg" alt="Known Vulnerabilities"></a>
  <a href="https://github.com/sfast/zeronode/blob/master/LICENSE"><img src="https://img.shields.io/github/license/sfast/zeronode.svg" alt="GitHub license"></a>
</p>

<p align="center">
  <a href="https://nodei.co/npm/zeronode/"><img src="https://nodei.co/npm/zeronode.png" alt="NPM"></a>
</p>

---

## 📖 Table of Contents

- [Why ZeroNode?](#why-zeronode)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Events & Error Handling](#events--error-handling)
- [Production Best Practices](#production-best-practices)
- [Contributing](#contributing)
- [License](#license)

---

## Why ZeroNode?

### The Problem

Building reliable microservice communication is **hard**:

- ❓ How to handle dynamic scaling? (services come and go)
- 🔄 How to handle reconnections? (network failures happen)
- 🎯 How to route messages? (one-to-one, one-to-many, filtered routing)
- 🚨 How to handle errors gracefully? (timeouts, disconnections, invalid data)
- 📦 How to deal with message queuing? (when a service is temporarily down)
- 🔍 How to discover services? (without a central registry)
- ⚖️ How to load balance? (distribute requests across multiple instances)

### The Solution

ZeroNode solves these problems with:

✅ **Automatic Reconnection** - Never worry about network failures  
✅ **Built-in Patterns** - Request/Reply, Fire-and-Forget (Tick), Broadcasting  
✅ **Mesh Networking** - Peer-to-peer communication without central broker  
✅ **Dynamic Discovery** - Services discover each other automatically  
✅ **Smart Routing** - Filter-based routing with options matching  
✅ **Load Balancing** - Random, round-robin, priority-based routing  
✅ **Zero Configuration** - Works out of the box with sensible defaults  
✅ **Production-Ready** - Comprehensive error handling and lifecycle management  

---

## Installation

### Prerequisites

ZeroNode requires [ZeroMQ](http://zeromq.org) to be installed.

**Automatic Installation (Ubuntu, Debian, macOS):**

```bash
npm install zeronode
```

The install script will automatically install ZeroMQ for supported platforms.

**Manual Installation (Other Platforms):**

```bash
# Install ZeroMQ first
# Ubuntu/Debian
sudo apt-get install libzmq3-dev

# macOS
brew install zeromq

# Then install ZeroNode
npm install zeronode
```

**Docker:**

```dockerfile
FROM node:18-alpine
RUN apk add --no-cache zeromq-dev
RUN npm install zeronode
```

---

## Quick Start

### 1. Create a Server

```javascript
import Node from 'zeronode'

const server = new Node({ id: 'api-server' })

// Bind to a port
await server.bind('tcp://127.0.0.1:8000')

// Handle requests
server.onRequest('user:get', (envelope) => {
  return {
    id: envelope.data.userId,
    name: 'John Doe',
    email: 'john@example.com'
  }
})

console.log('✓ Server ready at tcp://127.0.0.1:8000')
```

### 2. Create a Client

```javascript
import Node from 'zeronode'

const client = new Node({ id: 'web-client' })

// Connect to server
await client.connect({ address: 'tcp://127.0.0.1:8000' })

// Make a request
const response = await client.request({
  to: 'api-server',
  event: 'user:get',
  data: { userId: 123 }
})

console.log('User:', response)
// { id: 123, name: 'John Doe', email: 'john@example.com' }
```

### 3. Fire-and-Forget (Tick)

```javascript
// Send a message without waiting for a response
client.tick({
  to: 'api-server',
  event: 'analytics:track',
  data: { action: 'page_view', page: '/home' }
})

// Handle tick messages on server
server.onTick('analytics:track', (envelope) => {
  console.log('Analytics event:', envelope.data)
  // No response needed - fire and forget!
})
```

That's it! 🎉 You now have a working microservices communication layer.

---

## Core Concepts

### Node

A **Node** is the core building block of ZeroNode. Each Node can:
- **Bind** to an address (acts as a server)
- **Connect** to other nodes (acts as a client)  
- Both! (hybrid mode)

Think of a Node as a **participant** in your distributed system.

```javascript
const node = new Node({
  id: 'unique-node-id',        // Unique identifier (auto-generated if not provided)
  options: { role: 'worker' },  // Metadata for routing/discovery
  config: {}                    // ZeroMQ configuration (optional)
})
```

### Messaging Patterns

#### 1. **Request/Reply** (RPC-style)

**Use when:** You need a response (API calls, database queries, calculations)

```javascript
// Server
server.onRequest('math:add', (envelope) => {
  const { a, b } = envelope.data
  return { result: a + b }
})

// Client
const response = await client.request({
  to: 'calc-server',
  event: 'math:add',
  data: { a: 5, b: 3 }
})
console.log(response.result) // 8
```

#### 2. **Tick** (Fire-and-Forget)

**Use when:** You don't need a response (logging, analytics, notifications)

```javascript
// Server
server.onTick('log:info', (envelope) => {
  console.log(envelope.data.message)
})

// Client (non-blocking!)
client.tick({
  to: 'log-server',
  event: 'log:info',
  data: { message: 'User logged in' }
})
```

#### 3. **Broadcasting**

**Use when:** Send to multiple nodes at once (pub/sub, notifications)

```javascript
// Send to ALL nodes that match a filter
await node.tickAll({
  event: 'config:reload',
  data: { version: '2.0' },
  filter: { role: 'worker' }  // Only nodes with options.role === 'worker'
})
```

### Routing

ZeroNode provides powerful routing capabilities:

#### **Direct Routing** (by ID)

```javascript
// Send to a specific node
await node.request({
  to: 'specific-node-id',
  event: 'ping',
  data: {}
})
```

#### **Smart Routing** (by options/filter)

```javascript
// Send to ANY node that matches the filter
await node.requestAny({
  event: 'process:job',
  data: { jobId: 123 },
  filter: {
    role: 'worker',
    status: 'idle',
    region: 'us-west'
  }
})
```

#### **Directional Routing**

```javascript
// Send only to downstream nodes (nodes that connected TO this node)
await node.requestDownAny({
  event: 'task:assign',
  data: { taskId: 456 }
})

// Send only to upstream nodes (nodes this node connected TO)
await node.requestUpAny({
  event: 'report:status',
  data: { status: 'healthy' }
})
```

### Pattern Matching

Use RegExp for flexible routing:

```javascript
// Handle all API routes
server.onRequest(/^api:.*/, (envelope) => {
  const route = envelope.tag // e.g., 'api:users:get'
  const data = envelope.data
  // Route to appropriate handler
  return handleApiRequest(route, data)
})

// Handle all log events
server.onTick(/^log:/, (envelope) => {
  logToFile(envelope.data)
})
```

---

## Architecture

ZeroNode is built with a clean, layered architecture:

```
┌─────────────────────────────────────────┐
│            Node Layer                   │  ← Mesh networking, routing, discovery
│  (Orchestration & Smart Routing)        │
├─────────────────────────────────────────┤
│     Client Layer    │   Server Layer    │  ← Application protocols
│  (Connection mgmt)  │  (Client tracking)│
├─────────────────────────────────────────┤
│         Protocol Layer                  │  ← Request/reply, handshakes, pings
│  (Message serialization & routing)      │
├─────────────────────────────────────────┤
│        Transport Layer (ZeroMQ)         │  ← Raw socket communication
│    Router Socket  │  Dealer Socket      │
└─────────────────────────────────────────┘
```

### Layer Responsibilities

#### **Node Layer** (`src/node.js`)
- Manages N clients + 1 server
- Intelligent routing (by ID, by filter, random selection)
- Handler registry (works even if server/clients created later)
- Event transformation (Client/Server events → Node events)

#### **Client Layer** (`src/protocol/client.js`)
- Connects to remote servers
- Handshake protocol
- Heartbeat/ping management
- Automatic reconnection

#### **Server Layer** (`src/protocol/server.js`)
- Binds to address
- Tracks connected clients
- Client timeout detection
- Graceful shutdown protocol

#### **Protocol Layer** (`src/protocol/protocol.js`)
- Message serialization (MessagePack)
- Request/response matching
- Envelope format
- Pattern-based routing

#### **Transport Layer** (`src/transport/zeromq/`)
- ZeroMQ socket management (Router, Dealer)
- Connection state machine
- Error handling
- Native ZeroMQ features

---

## API Reference

### Node Class

#### Constructor

```javascript
const node = new Node({
  id: string,           // Optional. Auto-generated if not provided
  bind: string,         // Optional. Address to bind (e.g., 'tcp://127.0.0.1:8000')
  options: object,      // Optional. Metadata for routing/discovery
  config: object        // Optional. ZeroMQ configuration
})
```

#### Connection Management

```javascript
// Bind (act as server)
await node.bind(address: string): Promise<string>
// Returns the actual bound address (useful for port 0)

// Connect (act as client)
await node.connect({
  address: string,
  timeout?: number,           // Handshake timeout (default: 5000ms)
  reconnectionTimeout?: number // Max reconnection time (default: -1 = infinite)
}): Promise<object>
// Returns remote node info

// Disconnect
await node.disconnect(address: string): Promise<boolean>

// Stop (close all connections)
await node.stop(): Promise<void>
```

#### Messaging

```javascript
// Request/Reply (waits for response)
await node.request({
  to: string,          // Target node ID
  event: string,       // Event name
  data: object,        // Payload
  timeout?: number     // Request timeout (default: 10000ms)
}): Promise<any>

// Tick (fire-and-forget, returns immediately)
node.tick({
  to: string,
  event: string,
  data: object
}): void

// Request to ANY matching node
await node.requestAny({
  event: string,
  data: object,
  timeout?: number,
  filter?: object,     // Options filter
  down?: boolean,      // Include downstream nodes (default: true)
  up?: boolean         // Include upstream nodes (default: true)
}): Promise<any>

// Tick to ANY matching node
await node.tickAny({
  event: string,
  data: object,
  filter?: object,
  down?: boolean,
  up?: boolean
}): Promise<void>

// Tick to ALL matching nodes
await node.tickAll({
  event: string,
  data: object,
  filter?: object,
  down?: boolean,
  up?: boolean
}): Promise<void>
```

#### Handler Registration

```javascript
// Register request handler
node.onRequest(
  pattern: string | RegExp,
  handler: (envelope, reply) => any
)

// Register tick handler
node.onTick(
  pattern: string | RegExp,
  handler: (envelope) => void
)

// Unregister handlers
node.offRequest(pattern, handler?)
node.offTick(pattern, handler?)
```

#### Utility Methods

```javascript
// Get node info
node.getId(): string
node.getAddress(): string
node.getOptions(): object

// Update options (for routing/discovery)
await node.setOptions(options: object): Promise<void>

// Get filtered nodes
node.getFilteredNodes({
  options?: object,
  predicate?: function,
  up?: boolean,
  down?: boolean
}): string[]

// Get peer info
node.getServerInfo({ id?, address? }): object | null
node.getClientInfo({ id }): object | null
```

---

## Examples

### Example 1: API Gateway + Workers

```javascript
// api-gateway.js
import Node from 'zeronode'

const gateway = new Node({ id: 'gateway' })
await gateway.bind('tcp://0.0.0.0:8000')

gateway.onRequest('api:*', async (envelope) => {
  // Forward to any available worker
  return await gateway.requestAny({
    event: 'worker:process',
    data: envelope.data,
    filter: { role: 'worker', status: 'ready' }
  })
})
```

```javascript
// worker.js
import Node from 'zeronode'

const worker = new Node({
  id: `worker-${process.pid}`,
  options: { role: 'worker', status: 'ready' }
})

await worker.connect({ address: 'tcp://gateway:8000' })

worker.onRequest('worker:process', (envelope) => {
  // Process the request
  return { result: 'processed', data: envelope.data }
})
```

### Example 2: Distributed Logging

```javascript
// log-aggregator.js
const aggregator = new Node({ id: 'log-aggregator' })
await aggregator.bind('tcp://0.0.0.0:9000')

aggregator.onTick(/^log:/, (envelope) => {
  const level = envelope.tag.split(':')[1] // 'info', 'warn', 'error'
  const message = envelope.data.message
  
  console.log(`[${level.toUpperCase()}] ${message}`)
  // Write to database, send to monitoring, etc.
})
```

```javascript
// app-server.js
const app = new Node({ id: 'app-1' })
await app.connect({ address: 'tcp://log-aggregator:9000' })

// Log anywhere in your app
app.tick({
  to: 'log-aggregator',
  event: 'log:info',
  data: { message: 'User logged in', userId: 123 }
})
```

### Example 3: Health Check System

```javascript
// monitor.js
const monitor = new Node({ id: 'monitor' })
await monitor.bind('tcp://0.0.0.0:7000')

// Ping all services every 30 seconds
setInterval(async () => {
  const services = monitor.getFilteredNodes({ up: true, down: true })
  
  for (const serviceId of services) {
    try {
      const response = await monitor.request({
        to: serviceId,
        event: 'health:check',
        timeout: 5000
      })
      console.log(`✓ ${serviceId}: ${response.status}`)
    } catch (err) {
      console.error(`✗ ${serviceId}: ${err.message}`)
    }
  }
}, 30000)
```

```javascript
// service.js
const service = new Node({ id: 'service-1' })
await service.connect({ address: 'tcp://monitor:7000' })

service.onRequest('health:check', () => {
  return {
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  }
})
```

### Example 4: Load-Balanced Task Queue

```javascript
// task-dispatcher.js
const dispatcher = new Node({ id: 'dispatcher' })
await dispatcher.bind('tcp://0.0.0.0:6000')

dispatcher.onRequest('task:submit', async (envelope) => {
  const { taskId, data } = envelope.data
  
  // Send to any idle worker (load balancing!)
  try {
    const result = await dispatcher.requestAny({
      event: 'task:execute',
      data: { taskId, data },
      filter: { role: 'worker', status: 'idle' },
      timeout: 30000
    })
    
    return { success: true, result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
```

```javascript
// worker.js (run multiple instances!)
const worker = new Node({
  id: `worker-${process.pid}`,
  options: { role: 'worker', status: 'idle' }
})

await worker.connect({ address: 'tcp://dispatcher:6000' })

worker.onRequest('task:execute', async (envelope) => {
  // Mark as busy
  await worker.setOptions({ role: 'worker', status: 'busy' })
  
  // Process task
  const result = await processTask(envelope.data)
  
  // Mark as idle again
  await worker.setOptions({ role: 'worker', status: 'idle' })
  
  return result
})
```

---

## Events & Error Handling

### Node Events

```javascript
import { NodeEvent } from 'zeronode'

node.on(NodeEvent.READY, ({ nodeId, hasServer }) => {
  console.log('Node ready:', nodeId)
})

node.on(NodeEvent.PEER_JOINED, ({ peerId, direction, peerOptions }) => {
  console.log('Peer joined:', peerId, direction)
  // direction: 'upstream' (we connected TO them) | 'downstream' (they connected TO us)
})

node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason }) => {
  console.log('Peer left:', peerId, reason)
  // reason: 'disconnected' | 'timeout' | 'stopped' | 'failed'
})

node.on(NodeEvent.STOPPED, () => {
  console.log('Node stopped')
})

node.on('error', (err) => {
  console.error('Node error:', err)
})
```

### Error Types

```javascript
import { NodeError, NodeErrorCode } from 'zeronode'

try {
  await node.request({ to: 'unknown-node', event: 'ping', data: {} })
} catch (err) {
  if (err instanceof NodeError) {
    switch (err.code) {
      case NodeErrorCode.NODE_NOT_FOUND:
        console.error('No route to node')
        break
      case NodeErrorCode.NO_NODES_MATCH_FILTER:
        console.error('No nodes match the filter')
        break
      case NodeErrorCode.ROUTING_FAILED:
        console.error('Routing failed:', err.message)
        break
      default:
        console.error('Node error:', err)
    }
  }
}
```

### Protocol Errors

```javascript
import { ProtocolError, ProtocolErrorCode } from 'zeronode'

node.onRequest('api:*', async (envelope) => {
  try {
    // Your logic
  } catch (err) {
    // Return structured error
    throw new ProtocolError({
      code: ProtocolErrorCode.HANDLER_ERROR,
      message: 'Failed to process request',
      cause: err
    })
  }
})
```

---

## Connection Lifecycle

### Handshake Protocol

When a client connects to a server:

```
Client                          Server
  │                              │
  ├──── CONNECT (options) ───────>│
  │                              │ (validates client)
  │<───── CONNECTED (options) ───┤
  │                              │
  │ ✓ Connection established     │
```

### Heartbeat/Ping

To detect disconnections:

```
Client                          Server
  │                              │
  ├──── PING ────────────────────>│
  │<───── PONG ────────────────── │
  │                              │
  │ (every 2.5 seconds)          │ (expects ping within 10s)
```

**Configuration:**

```javascript
const node = new Node({
  config: {
    PING_INTERVAL: 2500,      // Client ping frequency (ms)
    CLIENT_TIMEOUT: 10000,    // Server timeout for missing pings (ms)
    HANDSHAKE_TIMEOUT: 5000   // Handshake timeout (ms)
  }
})
```

### Reconnection

**Automatic reconnection** is built-in:

```javascript
await node.connect({
  address: 'tcp://server:8000',
  reconnectionTimeout: -1  // -1 = infinite reconnection attempts (default)
  // reconnectionTimeout: 30000  // Give up after 30 seconds
})

// Client will automatically reconnect if connection is lost!
```

**Reconnection behavior:**

1. Connection lost → Client enters RECONNECTING state
2. Attempts to reconnect using exponential backoff
3. On success → Re-handshake and restore handlers
4. On timeout → Emits FAILED/CLOSED events

**Listen for reconnection events:**

```javascript
import { ClientEvent } from 'zeronode'

node.on(ClientEvent.DISCONNECTED, ({ serverId }) => {
  console.log('Disconnected from server, will attempt reconnection...')
})

node.on(ClientEvent.READY, ({ serverId }) => {
  console.log('Reconnected successfully!')
})

node.on(ClientEvent.FAILED, ({ serverId }) => {
  console.error('Reconnection failed - giving up')
})
```

### Graceful Shutdown

```javascript
// Server sends STOP to all clients
await server.stop()

// Clients receive STOP and gracefully disconnect
// No need for manual cleanup!
```

---

## Production Best Practices

### 1. **Use Unique Node IDs**

```javascript
// ✅ Good: Unique per instance
const node = new Node({
  id: `${process.env.SERVICE_NAME}-${process.env.HOSTNAME}-${process.pid}`
})

// ❌ Bad: Same ID for all instances
const node = new Node({ id: 'worker' })
```

### 2. **Set Meaningful Options**

```javascript
const node = new Node({
  options: {
    role: 'api-worker',
    region: process.env.AWS_REGION,
    version: process.env.APP_VERSION,
    capacity: 100
  }
})
```

### 3. **Handle Errors Properly**

```javascript
// ✅ Good: Handle all error scenarios
try {
  const response = await node.request({
    to: 'service',
    event: 'process',
    data: payload,
    timeout: 5000
  })
  return response
} catch (err) {
  if (err.code === 'REQUEST_TIMEOUT') {
    // Retry or return cached response
  } else if (err.code === 'NODE_NOT_FOUND') {
    // Route to backup service
  } else {
    // Log and handle
  }
}

// ❌ Bad: No error handling
const response = await node.request({ to: 'service', event: 'process', data: payload })
```

### 4. **Use Timeouts**

```javascript
// ✅ Good: Always set timeouts
await node.request({
  to: 'external-api',
  event: 'fetch',
  data: {},
  timeout: 30000  // 30 seconds max
})

// ❌ Bad: No timeout (default is 10s, but be explicit!)
await node.request({ to: 'external-api', event: 'fetch', data: {} })
```

### 5. **Monitor Node Health**

```javascript
// Expose health endpoint
node.onRequest('health:check', () => ({
  status: 'healthy',
  uptime: process.uptime(),
  memory: process.memoryUsage(),
  peers: node.getFilteredNodes({ up: true, down: true }).length
}))

// Listen for connection issues
node.on('error', (err) => {
  metrics.increment('node.errors', { code: err.code })
})

node.on(NodeEvent.PEER_LEFT, ({ peerId, reason }) => {
  metrics.increment('node.peer_left', { reason })
})
```

### 6. **Graceful Shutdown**

```javascript
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  
  // Stop accepting new requests
  await node.unbind()
  
  // Wait for in-flight requests to complete
  await new Promise(resolve => setTimeout(resolve, 5000))
  
  // Close all connections
  await node.stop()
  
  process.exit(0)
})
```

### 7. **Use Load Balancing**

```javascript
// Distribute load across multiple workers
const response = await dispatcher.requestAny({
  event: 'task:process',
  data: payload,
  filter: {
    role: 'worker',
    status: 'idle'
  }
})
```

### 8. **Implement Circuit Breaker**

```javascript
const circuitBreaker = {
  failures: 0,
  threshold: 5,
  resetTime: 60000,
  isOpen: false
}

async function callService(event, data) {
  if (circuitBreaker.isOpen) {
    throw new Error('Circuit breaker open')
  }
  
  try {
    const response = await node.request({ to: 'service', event, data })
    circuitBreaker.failures = 0
    return response
  } catch (err) {
    circuitBreaker.failures++
    if (circuitBreaker.failures >= circuitBreaker.threshold) {
      circuitBreaker.isOpen = true
      setTimeout(() => {
        circuitBreaker.isOpen = false
        circuitBreaker.failures = 0
      }, circuitBreaker.resetTime)
    }
    throw err
  }
}
```

---

## Testing

ZeroNode is thoroughly tested with **95%+ code coverage**.

```bash
# Run all tests
npm test

# Run specific test file
npm test test/node.test.js

# Run with coverage
npm run coverage

# Run benchmarks
npm run benchmark
```

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
git clone https://github.com/sfast/zeronode.git
cd zeronode
npm install
npm test
```

---

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md) - In-depth architecture documentation
- [Performance Guide](docs/PERFORMANCE.md) - Performance tuning and benchmarks
- [Testing Guide](docs/TESTING.md) - Testing best practices
- [API Reference](docs/API.md) - Complete API documentation
- [Migration Guide](docs/MIGRATION.md) - Upgrading from older versions

---

## Community

- 💬 [Gitter Chat](https://gitter.im/npm-zeronode/Lobby)
- 🐛 [Issue Tracker](https://github.com/sfast/zeronode/issues)
- 📖 [Wiki](https://github.com/sfast/zeronode/wiki)
- 🐦 [Twitter](https://twitter.com/intent/tweet?text=Zeronode%20-%20rock%20solid%20transport%20and%20smarts%20for%20building%20NodeJS%20microservices.%E2%9C%8C%E2%9C%8C%E2%9C%8C&url=https://github.com/sfast/zeronode&hashtags=microservices,scaling,loadbalancing,zeromq,awsomenodejs,nodejs)

---

## License

[MIT](LICENSE) © [SFast](https://github.com/sfast)

---

<p align="center">
  <strong>Built with ❤️ by the ZeroNode team</strong>
  <br/>
  <em>Star ⭐ this repo if you find it useful!</em>
</p>
