# Zeronode

<p align="center">
  <img src="https://i.imgur.com/NZVXZPo.png" alt="Zeronode Logo" width="100%"/>
</p>

<p align="center">
  <strong>Production-Grade Microservices Framework for Node.js</strong>
  <br/>
  <em>Sub-millisecond Latency • Zero Configuration • Battle-Tested</em>
</p>

<p align="center">
  <a href="https://codecov.io/gh/sfast/zeronode"><img src="https://img.shields.io/badge/coverage-95%25-brightgreen" alt="Coverage"></a>
  <a href="https://www.npmjs.com/package/zeronode"><img src="https://img.shields.io/npm/v/zeronode.svg" alt="npm version"></a>
  <a href="https://github.com/sfast/zeronode/blob/master/LICENSE"><img src="https://img.shields.io/github/license/sfast/zeronode.svg" alt="MIT License"></a>
  <a href="https://gitter.im/npm-zeronode/Lobby"><img src="https://img.shields.io/gitter/room/nwjs/nw.js.svg" alt="Gitter"></a>
</p>

---

## What is Zeronode?

**Zeronode is a lightweight, high-performance framework for building distributed systems in Node.js.** Each Node can simultaneously act as both a server (binding to an address) and a client (connecting to multiple remote nodes), forming a flexible peer-to-peer mesh network.

### Traditional vs Zeronode Architecture

```
Traditional Client-Server          Zeronode Mesh Network
-------------------------          ------------------------

   +--------+                        +---------+
   |Client 1|---+                 +--|  Node A |--+
   +--------+   |                 |  +---------+  |
                |                 |      <->      |
   +--------+   |    +------+     |  +---------+  |
   |Client 2|---+--->|Server|     +--|  Node B |--+
   +--------+   |    +------+     |  +---------+  |
                |                 |      <->      |
   +--------+   |                 |  +---------+  |
   |Client 3|---+                 +--|  Node C |--+
   +--------+                        +---------+
   
   One-way only                   Each node is both
                                  client AND server!
```

Unlike traditional client-server architectures, Zeronode provides:

- **N:M Connectivity**: One Node can bind as a server while connecting to N other nodes as a client
- **Automatic Health Management**: Built-in ping from clients to server and server's heartbeat check protocol keeps track of live connections and failures.
- **Intelligent Reconnection**: Automatic recovery from network failures with exponential backoff
- **Sub-millisecond Latency**: Average 0.3ms request-response times for low-latency applications
- **Smart Routing**: Route messages by ID, and by filters or predicate functions based on each node's  options, automatic smart load balancing and "publish to all" is built in
- **Zero Configuration**: No brokers, no registries, no complex setup—just bind and connect

**Perfect for:** High-frequency trading systems, AI model inference clusters, multi-agent AI systems, real-time analytics, microservices and more.

---

### Installation

```bash
npm install zeronode
```

Zeronode automatically installs required dependencies for supported platforms.

### Basic Example

```javascript

// A Node can:
// - bind to an address (accept downstream connections)
// - connect to many other nodes (act as a client)
// - do both simultaneously

import Node from 'zeronode'

// Create a Node and bind
const server = new Node({ 
  // Node id
  id: 'api-server',                    
  // Node metadata — arbitrary data used for smart routing
  options: { role: 'api', version: 1 }
})

// Bind to an address
await server.bind('tcp://127.0.0.1:8000')

// Register a request handler
server.onRequest('user:get', (envelope, reply) => {
  // The envelope wraps the underlying message buffer
  const { userId } = envelope.data 
  
  // Simulate server returning user info
  const userInfo = { id: userId, name: 'John Doe', email: 'john@example.com' }
  // Return response back to the caller
  return userInfo // or: reply(userInfo)
})

console.log('Server ready at tcp://127.0.0.1:8000')
```

```javascript
// Create a new Node 
const client = new Node({ id: 'web-client' })

// Connect to the first Node
await client.connect({ address: 'tcp://127.0.0.1:8000' })

// Now we can make a request from client to server 
const requestObject = {
  to: 'api-server',           // Target node ID
  event: 'user:get',          // Event name
  data: { userId: 123 },      // Request payload
  timeout: 5000               // Optional timeout in ms
}

// Read user data by id from server
const user = await client.request(requestObject)

console.log(user)
// Output: { id: 123, name: 'John Doe', email: 'john@example.com' }
```

What does `client.connect()` do?
- Establishes a transport connection to the server address
- Performs a handshake to exchange identities and options
- Starts periodic client→server pings and server-side heartbeat tracking
- Manages automatic reconnection with exponential backoff

---


## Core Concepts

### Messaging Patterns

#### 1. Request/Reply (RPC-Style)

Use when you need a response from the target service.

```
+------------+                                         +------------+
|   Client   |                                         |   Server   |
+------+-----+                                         +------+-----+
       |                                                      |
       |  request('calculate:sum', [1,2,3,4,5])               |
       +----------------------------------------------------->|
       |                                                      |
       |                  Processing...                       |
       |                  sum = 15                            |
       |                                                      |
       |<-----------------------------------------------------+
       |           reply({ result: 15 })                      |
       |                                                      |
   [~0.3ms latency]
```

```javascript
// Server: Register a handler
server.onRequest('calculate:sum', ({ data }, reply) => {
  const { numbers } = data
  
  // Perform calculation
  const sum = numbers.reduce((a, b) => a + b, 0)
  
  // Return result (or call reply({ result: sum }))
  return { result: sum }
})

// Client: Make a request
const response = await client.request({
  to: 'calc-server',
  event: 'calculate:sum',
  data: { numbers: [1, 2, 3, 4, 5] }
})

console.log(response.result) // 15
```

#### 2. Tick (Fire-and-Forget)

Use when you don't need a response (logging, notifications, analytics).

```
+------------+                                         +------------+
|   Client   |                                         |   Server   |
+------+-----+                                         +------+-----+
       |                                                      |
       |  tick('log:info', { message: 'User login' })         |
       +----------------------------------------------------->|
       |                                                      |
       | <- Returns immediately (non-blocking)                |
       |                                                      |
       |                                          Process async
       |                                          +-> Log to DB
       |                                          +-> Send to monitoring
```

```javascript
// Server: Register a tick handler
server.onTick('log:info', ({data}) => {
  // envelope.data contains the log data
  const { message, metadata } = data
  
  // Process asynchronously (no response expected)
  console.log(`[INFO] ${message}`, metadata)
  logToDatabase(message, metadata)
})

// Client: Send a tick (non-blocking, returns immediately)
client.tick({
  to: 'log-server',
  event: 'log:info',
  data: {
    message: 'User logged in',
    metadata: { userId: 123, timestamp: Date.now() }
  }
})
```

#### 3. Broadcasting

Send to multiple nodes simultaneously.

```
                         +-------------+
                         |  Scheduler  |
                         +------+------+
                                |
              tickAll('config:reload', { version: '2.0' })
                                |
          +---------------------+---------------------+
          |                     |                     |
          v                     v                     v
    +----------+          +----------+          +----------+
    | Worker 1 |          | Worker 2 |          | Worker 3 |
    |role:worker          |role:worker          |role:worker
    |status:ready         |status:ready         |status:ready
    +----------+          +----------+          +----------+
         |                     |                     |
         +-------> All receive config update <-------+
```

```javascript
// Send to ALL nodes matching a filter
await node.tickAll({
  event: 'config:reload',
  data: { version: '2.0', config: newConfig },
  filter: { 
    role: 'worker',    // Only workers
    status: 'ready'    // That are ready
  }
})
```

---

### Smart Routing

#### Direct Routing (by ID)

```
+---------+
| Gateway |  request({ to: 'user-service-1' })
+----+----+
     |
     | Direct route by ID
     |
     v
+--------------+
|user-service-1| <- Exact match
+--------------+

+--------------+
|user-service-2| <- Not selected
+--------------+
```

```javascript
// Route to a specific node by ID
const response = await node.request({
  to: 'user-service-1',  // Exact node ID
  event: 'user:get',
  data: { userId: 123 }
})
```

#### Filter-Based Routing / Load balancing 

```
+---------+
| Gateway |  requestAny({ filter: { role: 'worker', status: 'idle' } })
+----+----+
     |
     | Smart routing picks ONE matching node
     | (automatic load balancing)
     |
     +--------------+--------------+
     v              v              v
+---------+    +---------+    +---------+
|Worker 1 |    |Worker 2 |    |Worker 3 |
|idle (Y) |    |busy (N) |    |idle (Y) |
+---------+    +---------+    +---------+
     ^                              |
     |                              |
     +---- One is selected ---------+
            (round-robin)
```

```javascript
// Route to ANY node matching the filter (automatic load balancing)
const response = await node.requestAny({
  event: 'job:process',
  data: { jobId: 456 },
  filter: {
    role: 'worker',           // Must be a worker
    status: 'idle',           // Must be idle
    region: 'us-west',        // In the correct region
    capacity: { $gte: 50 }    // With sufficient capacity
  }
})
```

#### Pattern Matching

Zeronode supports pattern-based handlers using strings or RegExp. With RegExp you can register
one handler for a family of events that share a common prefix. The incoming event name is available
as `envelope.event`, so you can branch on the action and keep code DRY and fast.

```javascript
// Handle multiple events with a single handler using RegExp
server.onRequest(/^api:user:/, ({data, tag }, reply) => {
  // Matches: 'api:user:get', 'api:user:create', 'api:user:update', etc.
  const action = tag.split(':')[2] // 'get', 'create', 'update'
  
  switch (action) {
    case 'get':
      return getUserData(data)
    case 'create':
      return createUser(data)
    // ...
  }
})
```

---

### Node Options and Metadata

Use metadata (Node options) for service discovery and routing.

```
   Metadata for Smart Routing
   ===========================
   
   +------------------------------+
   |      Worker Node             |
   +------------------------------+
   | id: 'worker-12345'           |
   |                              |
   | options: {                   |
   |   role: 'worker'             | <--- Route by role
   |   region: 'us-east-1'        | <--- Geographic routing
   |   version: '2.1.0'           | <--- Version matching
   |   capacity: 100              | <--- Load-based routing
   |   features: ['ml', 'image']  | <--- Capability routing
   |   status: 'ready'            | <--- State-based routing
   | }                            |
   +------------------------------+
```

```javascript
// Worker node with metadata
const worker = new Node({
  id: `worker-${process.pid}`,
  options: {
    role: 'worker',
    region: 'us-east-1',
    version: '2.1.0',
    capacity: 100,
    features: ['ml', 'image-processing'],
    status: 'ready'
  }
})

// workShedulerNode routes based on metadata
const response = await workShedulerNode.requestAny({
  event: 'process:image',
  data: imageData,
  filter: {
    role: 'worker',
    features: { $contains: 'image-processing' },
    capacity: { $gte: 50 },
    status: 'ready'
  }
})

// Update options dynamically
await worker.setOptions({ status: 'busy' })
// Process work...
await worker.setOptions({ status: 'ready' })
```

**Advanced Filtering Operators:**


```javascript
filter: {
  // Exact match
  role: 'worker',
  
  // Comparison
  capacity: { $gte: 50, $lte: 100 },
  priority: { $in: [1, 2, 3] },
  
  // String matching
  region: { $regex: /^us-/ },
  name: { $contains: 'prod' },
  
  // Array matching
  features: { $containsAny: ['ml', 'gpu'] },
  excluded: { $containsNone: ['deprecated'] }
}
```

---

## Middleware System

Zeronode provides **Express.js-style middleware chains** for composing request handling logic with automatic handler chaining.

```
   Middleware Chain Flow
   =====================
   
   Request arrives
        |
        v
   +---------------------+
   |  Logging Middleware |  <- 2-param: auto-continue
   |  (2 parameters)     |
   +----------+----------+
              | next() automatically called
              v
   +---------------------+
   |  Auth Middleware    |  <- 3-param: manual control
   |  (3 parameters)     |
   +----------+----------+
              | next() manually called
              v
   +---------------------+
   |  Business Handler   |  <- Final handler
   |  Returns data       |
   +----------+----------+
              |
              v
          Response
          
   +========================+
   |  If error occurs:      |
   |  -> Error Handler      |
   |    (4 parameters)      |
   +========================+
```

```javascript
// 2-parameter: Auto-continue (logging, metrics)
server.onRequest(/^api:/, (envelope, reply) => {
  console.log(`Request: ${envelope.event}`)
  // Auto-continues to next handler
})

// 3-parameter: Manual control (auth, validation)
server.onRequest(/^api:/, (envelope, reply, next) => {
  if (!envelope.data.token) {
    return reply.error('Unauthorized')
  }
  envelope.user = verifyToken(envelope.data.token)
  next()  // Explicitly continue
})

// 4-parameter: Error handler
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  reply.error({ code: 'API_ERROR', message: error.message })
})

// Business logic
server.onRequest('api:user:get', async (envelope, reply) => {
  return await database.users.findOne({ id: envelope.data.userId })
})
```

**See [docs/MIDDLEWARE.md](docs/MIDDLEWARE.md) for complete middleware patterns, error handling, and best practices.**

---

## Real-World Examples

Zeronode provides comprehensive production-ready examples for common distributed system patterns:

```
   Common Architecture Patterns
   ============================
   
   API Gateway Pattern              Distributed Logging
   -------------------              -------------------
   
        +---------+                     +--------+
        | Gateway |                     |Services|
        +----+----+                     +---+----+
             |                               |
      +------+------+                        |
      v      v      v                        v
   +----+ +----+ +----+              +----------+
   |API1| |API2| |API3|              |Log Server|
   +----+ +----+ +----+              +-----+----+
                                           |
   Task Queue                        +-----+-----+
   ----------                        v           v
                                  [Store]    [Monitor]
        +-------+
        |Queuer |
        +---+---+
            |
     +------+------+              Microservices Mesh
     v      v      v              ------------------
  +-----++-----++-----+
  |Wrkr1||Wrkr2||Wrkr3|          +----+   +----+
  +-----++-----++-----+          |Auth|<->|User|
                                  +-+--+   +--+-+
                                    |         |
                                    +----+----+
                                         |
                                     +---+---+
                                     |Payment|
                                     +-------+
```

- **API Gateway** - Load-balanced workers with automatic routing
- **Distributed Logging** - Centralized log aggregation system
- **Task Queue** - Priority-based task distribution
- **Microservices** - Service discovery and inter-service communication
- **Analytics Pipeline** - Real-time data processing
- **Distributed Cache** - Multi-node caching system

**See [docs/EXAMPLES.md](docs/EXAMPLES.md) for complete working code and usage instructions.**

---

## Lifecycle Events

Monitor node connections, disconnections, and state changes:

```javascript
import { NodeEvent } from 'zeronode'

// Peer joined the network
node.on(NodeEvent.PEER_JOINED, ({ peerId, peerOptions, direction }) => {
  console.log(`Peer joined: ${peerId} (${direction})`)
  // direction: 'upstream' or 'downstream'
})

// Peer left the network
node.on(NodeEvent.PEER_LEFT, ({ peerId, direction }) => {
  console.log(`Peer left: ${peerId}`)
})

// Handle errors
node.on(NodeEvent.ERROR, ({ code, message }) => {
  console.error(`Error [${code}]: ${message}`)
})
```

**See [docs/EVENTS.md](docs/EVENTS.md) for complete event reference including ClientEvent, ServerEvent, and error handling patterns.**

---

## Documentation

### Getting Started
- **[Quick Start Guide](#quick-start)** - Get up and running in minutes
- **[Core Concepts](#core-concepts)** - Understanding Zeronode fundamentals

### Feature Guides
- **[Middleware System](docs/MIDDLEWARE.md)** - Express-style middleware chains
- **[Smart Routing](docs/ROUTING.md)** - Service discovery and load balancing
- **[Events Reference](docs/EVENTS.md)** - All events and lifecycle hooks
- **[Real-World Examples](docs/EXAMPLES.md)** - Production-ready example code

### Advanced Topics
- **[Architecture Guide](docs/ARCHITECTURE.md)** - Deep dive into internals
- **[Envelope Format](docs/ENVELOPE.md)** - Binary message format specification
- **[Benchmarks](docs/BENCHMARKS.md)** - Performance testing and analysis
- **[Testing Guide](docs/TESTING.md)** - Testing distributed systems
- **[Configuration](docs/CONFIGURATION.md)** - All configuration options

---

## Performance

Zeronode delivers **sub-millisecond latency** with high throughput:

- **Latency**: ~0.3ms average request-response time
- **Efficiency**: Zero-copy buffer passing, lazy parsing

```bash
# Run benchmarks
npm run benchmark
```

**See [docs/BENCHMARKS.md](docs/BENCHMARKS.md) for detailed benchmark methodology and results.**

---

## Community & Support

- 🐛 **[Issue Tracker](https://github.com/sfast/zeronode/issues)** - Bug reports and feature requests
- 🔧 **[Examples](https://github.com/sfast/zeronode/tree/master/examples)** - Code examples

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
git clone https://github.com/sfast/zeronode.git
cd zeronode
npm install
npm test
```

---

## License
MIT

---