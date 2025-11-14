# ZeroNode

<p align="center">
  <img src="https://i.imgur.com/NZVXZPo.png" alt="ZeroNode Logo" width="100%"/>
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

## What is ZeroNode?

**ZeroNode is a lightweight, high-performance framework for building distributed systems in Node.js.** Each Node can simultaneously act as both a server (binding to an address) and a client (connecting to multiple remote nodes), forming a flexible peer-to-peer mesh network.

Unlike traditional client-server architectures, ZeroNode provides:

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

ZeroNode automatically installs required dependencies for supported platforms.

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
- Subscribes to disconnection/failure events
- Manages automatic reconnection with exponential backoff

---


## Core Concepts

### Messaging Patterns

#### 1. Request/Reply (RPC-Style)

Use when you need a response from the target service.

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

```javascript
// Route to a specific node by ID
const response = await node.request({
  to: 'user-service-1',  // Exact node ID
  event: 'user:get',
  data: { userId: 123 }
})
```

#### Filter-Based Routing / Load balancing 

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

ZeroNode supports pattern-based handlers using strings or RegExp. With RegExp you can register
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

ZeroNode provides Express.js-style middleware chains for composing request handling logic.

### Basic Middleware

```javascript
// 2-parameter: Auto-continue after execution (for side effects)
server.onRequest(/^api:/, (envelope, reply) => {
  // Log every API request
  console.log(`${envelope.event} from ${envelope.owner}`)
  
  // Automatically continues to next handler
})

// 3-parameter: Manual control (for validation/auth)
server.onRequest(/^api:/, (envelope, reply, next) => {
  // Check authentication
  if (!envelope.data.token) {
    return reply.error('Unauthorized')  // Stop chain
  }
  
  // Attach user info to envelope
  envelope.user = verifyToken(envelope.data.token)
  
  // Continue to next handler
  next()
})

// Business logic handler
server.onRequest('api:user:get', async (envelope, reply) => {
  // envelope.user is available from middleware
  const user = await database.users.findOne({ 
    id: envelope.data.userId 
  })
  
  return user
})
```

### Error Handling

```javascript
// 4-parameter: Error handler (catches errors from middleware chain)
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  // Log error
  console.error('API Error:', error)
  
  // Send structured error response
  reply.error({
    code: 'API_ERROR',
    message: error.message,
    requestId: envelope.id
  })
})
```

### Complete Middleware Example

```javascript
// 1. Request logging
server.onRequest(/^api:/, (envelope, reply) => {
  logger.info(`[${envelope.id}] ${envelope.event}`)
})

// 2. Authentication
server.onRequest(/^api:/, async (envelope, reply, next) => {
  const user = await authenticate(envelope.data.token)
  if (!user) return reply.error('Unauthorized')
  
  envelope.user = user
  next()
})

// 3. Rate limiting
server.onRequest(/^api:/, (envelope, reply, next) => {
  if (rateLimiter.isExceeded(envelope.user.id)) {
    return reply.error('Rate limit exceeded')
  }
  next()
})

// 4. Validation
server.onRequest(/^api:user:/, (envelope, reply, next) => {
  if (!envelope.data.userId) {
    return reply.error('userId is required')
  }
  next()
})

// 5. Error handler
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  metrics.increment('api.errors')
  reply.error({ code: 'API_ERROR', message: error.message })
})

// 6. Business logic
server.onRequest('api:user:get', async (envelope, reply) => {
  return await database.users.findOne({ id: envelope.data.userId })
})
```

See [docs/MIDDLEWARE.md](docs/MIDDLEWARE.md) for comprehensive middleware documentation.

---

// TODO lets have a list of real world examples under examples folder and a README inside it and just have alist of some real worl examples with github links of each file in readme 

i.e API Gateway
i.e Distributed Logging System
i.e Task Queue with Priority Workers
 .... 

## Real-World Examples


### Example 1: API Gateway with Load-Balanced Workers

```javascript
// gateway.js - API Gateway
const gateway = new Node({ 
  id: 'api-gateway',
  options: { role: 'gateway' }
})

await gateway.bind('tcp://0.0.0.0:8000')

// Route all API requests to available workers
gateway.onRequest(/^api:/, async (envelope, reply) => {
  // Automatically load-balance across idle workers
  return await gateway.requestAny({
    event: envelope.event,        // Forward the same event
    data: envelope.data,        // Forward the same data
    filter: { 
      role: 'worker', 
      status: 'idle' 
    },
    timeout: 30000              // 30 second timeout
  })
})

console.log('API Gateway ready')
```

```javascript
// worker.js - Worker Instance (run multiple copies)
const worker = new Node({
  id: `worker-${process.pid}`,
  options: { 
    role: 'worker',
    status: 'idle',           // Initially idle
    capacity: 100
  }
})

// Connect to gateway
await worker.connect({ address: 'tcp://gateway:8000' })

// Handle requests
worker.onRequest(/^api:/, async (envelope, reply) => {
  // Mark as busy
  await worker.setOptions({ status: 'busy' })
  
  try {
    // Process the request
    const result = await processRequest(envelope)
    
    return result
  } finally {
    // Mark as idle again
    await worker.setOptions({ status: 'idle' })
  }
})

console.log(`Worker ${worker.getId()} ready`)
```

### Example 2: Distributed Logging System

```javascript
// log-aggregator.js - Central Log Collector
const aggregator = new Node({ id: 'log-aggregator' })
await aggregator.bind('tcp://0.0.0.0:9000')

// Handle all log events
aggregator.onTick(/^log:/, (envelope) => {
  // Extract log level from event name (log:info, log:warn, log:error)
  const level = envelope.event.split(':')[1]
  
  const { service, message, metadata } = envelope.data
  
  // Write to storage (Elasticsearch, file, etc.)
  writeToElasticsearch({
    service,
    level,
    message,
    metadata,
    timestamp: Date.now()
  })
  
  // Also write to console for debugging
  console.log(`[${level.toUpperCase()}] [${service}] ${message}`)
})

console.log('Log aggregator ready')
```

```javascript
// app.js - Application using the logger
const app = new Node({ id: 'user-service' })
await app.connect({ address: 'tcp://log-aggregator:9000' })

// Log from anywhere in your application (non-blocking)
app.tick({
  to: 'log-aggregator',
  event: 'log:info',
  data: {
    service: 'user-service',
    message: 'User logged in successfully',
    metadata: { userId: 123, ip: '192.168.1.1' }
  }
})

// Log errors
app.tick({
  to: 'log-aggregator',
  event: 'log:error',
  data: {
    service: 'user-service',
    message: 'Database connection failed',
    metadata: { error: err.message, stack: err.stack }
  }
})
```

### Example 3: Task Queue with Priority Workers

```javascript
// dispatcher.js - Task Dispatcher
const dispatcher = new Node({ id: 'task-dispatcher' })
await dispatcher.bind('tcp://0.0.0.0:7000')

dispatcher.onRequest('task:submit', async (envelope, reply) => {
  const { priority, taskData } = envelope.data
  
  try {
    // Route high-priority tasks to high-priority workers
    const result = await dispatcher.requestAny({
      event: 'task:execute',
      data: taskData,
      filter: {
        role: 'worker',
        status: 'idle',
        priority: priority === 'high' ? { $gte: 5 } : { $gte: 1 }
      },
      timeout: 60000  // 60 second timeout
    })
    
    return { success: true, result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
```

```javascript
// worker.js - Priority Worker
const worker = new Node({
  id: `worker-${process.pid}`,
  options: {
    role: 'worker',
    status: 'idle',
    priority: process.env.PRIORITY || 5  // 1-10 scale
  }
})

await worker.connect({ address: 'tcp://dispatcher:7000' })

worker.onRequest('task:execute', async (envelope, reply) => {
  // Mark as busy
  await worker.setOptions({ status: 'busy' })
  
  try {
    // Execute the task
    const result = await executeTask(envelope.data)
    return result
  } finally {
    // Mark as idle
    await worker.setOptions({ status: 'idle' })
  }
})
```

---

## Error Handling & Reconnection

### Automatic Reconnection

```javascript
// Client automatically reconnects on connection loss
await client.connect({
  address: 'tcp://server:8000',
  reconnectionTimeout: -1  // -1 = infinite retries (default)
  // reconnectionTimeout: 30000  // Give up after 30 seconds
})

// Connection lost? ZeroNode automatically reconnects with exponential backoff
// No manual intervention required!
```

### Handling Errors

```javascript
import { NodeError, NodeErrorCode } from 'zeronode'

try {
  const response = await node.request({
    to: 'remote-service',
    event: 'process:data',
    data: payload,
    timeout: 5000
  })
  
  return response
} catch (err) {
  // ZeroNode provides structured error codes
  if (err instanceof NodeError) {
    switch (err.code) {
      case NodeErrorCode.NODE_NOT_FOUND:
        // No route to the target node
        logger.warn('Service not available, using fallback')
        return fallbackResponse
        
      case NodeErrorCode.REQUEST_TIMEOUT:
        // Request timed out
        logger.error('Request timed out, will retry')
        return retryRequest()
        
        // TODO maybe this can be also 
      case NodeErrorCode.NO_NODES_MATCH_FILTER:
        // No nodes match the filter criteria
        logger.error('No available workers')
        throw new Error('Service unavailable')
        
      default:
        logger.error('Unexpected error:', err)
        throw err
    }
  }
  
  // Handle other error types
  throw err
}
```

### Lifecycle Events

```javascript
import { NodeEvent } from 'zeronode'

// Monitor peer connections
node.on(NodeEvent.PEER_JOINED, ({ peerId, peerOptions, direction }) => {
  logger.info(`Peer connected: ${peerId}`, { direction, options: peerOptions })
  // direction: 'upstream' (we connected to them) | 'downstream' (they connected to us)
})

node.on(NodeEvent.PEER_LEFT, ({ peerId, reason, direction }) => {
  logger.warn(`Peer disconnected: ${peerId}`, { reason, direction })
  // reason: 'disconnected' | 'timeout' | 'stopped' | 'failed'
})

// Monitor node lifecycle
node.on(NodeEvent.READY, ({ nodeId }) => {
  logger.info(`Node ready: ${nodeId}`)
})

node.on(NodeEvent.STOPPED, () => {
  logger.info('Node stopped gracefully')
})

// Handle errors
node.on('error', (err) => {
  logger.error('Node error:', err)
  metrics.increment('node.errors')
})
```

---

## Performance

ZeroNode is designed for high-performance microservices communication:

### Latency Benchmarks in AWS t3 micro (smallest one)


### Running Benchmarks

```bash
npm run benchmark:node      # Node-to-node latency
npm run benchmark:throughput # Throughput test
```

See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for detailed performance tuning guide.

---

## Documentation

### Getting Started
- **[Quick Start Guide](#quick-start)** - Get up and running in minutes
- **[Core Concepts](#core-concepts)** - Understanding ZeroNode fundamentals

### Feature Guides
- **[Middleware System](docs/MIDDLEWARE.md)** - Express-style middleware chains
- **[Smart Routing](docs/ROUTING.md)** - Service discovery and load balancing
- **[Error Handling](docs/ERROR_HANDLING.md)** - Comprehensive error handling
- **[Events Reference](docs/EVENTS.md)** - All events and lifecycle hooks

### Advanced Topics
- **[Architecture Guide](docs/ARCHITECTURE.md)** - Deep dive into internals
- **[Performance Tuning](docs/PERFORMANCE.md)** - Optimization strategies
- **[Benchmarks](docs/BENCHMARKS.md)** - Performance testing and analysis
- **[Testing Guide](docs/TESTING.md)** - Testing distributed systems
- **[Production Deployment](docs/PRODUCTION.md)** - Best practices for production

### API Reference
- **[Complete API](docs/API.md)** - Full API documentation
- **[Configuration](docs/CONFIGURATION.md)** - All configuration options

---

## Production Best Practices

### 1. Use Unique Node IDs

```javascript
// ✓ Unique per instance
const node = new Node({
  id: `${process.env.SERVICE}-${process.env.HOSTNAME}-${process.pid}`
})

// ✗ Same ID for all instances (routing conflicts)
const node = new Node({ id: 'worker' })
```

### 2. Always Set Timeouts

```javascript
// ✓ Explicit timeout
const response = await node.request({
  to: 'service',
  event: 'process',
  data: payload,
  timeout: 30000  // 30 second max
})

// ✗ Using default timeout (may be too long/short)
```

### 3. Handle All Error Cases

```javascript
// ✓ Comprehensive error handling
try {
  return await node.request({ ... })
} catch (err) {
  if (err.code === 'REQUEST_TIMEOUT') {
    return cachedResponse
  } else if (err.code === 'NODE_NOT_FOUND') {
    return fallbackService()
  } else {
    throw err
  }
}
```

### 4. Implement Health Checks

```javascript
// Expose health endpoint
node.onRequest('health:check', () => ({
  status: 'healthy',
  uptime: process.uptime(),
  memory: process.memoryUsage(),
  connections: node.getFilteredNodes({ up: true, down: true }).length
}))
```

### 5. Graceful Shutdown

```javascript
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...')
  
  // Stop accepting new connections
  await node.unbind()
  
  // Wait for in-flight requests
  await new Promise(resolve => setTimeout(resolve, 5000))
  
  // Close all connections
  await node.stop()
  
  process.exit(0)
})
```

---

## Community & Support

- 💬 **[Gitter Chat](https://gitter.im/npm-zeronode/Lobby)** - Community discussions
- 🐛 **[Issue Tracker](https://github.com/sfast/zeronode/issues)** - Bug reports and feature requests
- 📖 **[Wiki](https://github.com/sfast/zeronode/wiki)** - Community guides and tutorials
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

[MIT](LICENSE) © [SFast](https://github.com/sfast)

---

<p align="center">
  <strong>Built for the Node.js community</strong>
  <br/>
  <em>If ZeroNode helps your project, please ⭐ star this repository!</em>
</p>
