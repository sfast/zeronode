# Routing & Message Distribution

## Overview

ZeroNode provides **intelligent routing** for sending messages across a distributed mesh network. Each node can simultaneously connect to multiple upstream servers and accept multiple downstream clients, forming a flexible N:M topology.

**Routing Strategies:**
- **By ID**: Send to specific node by identifier
- **By Filter**: Send to nodes matching criteria (object match)
- **By Predicate**: Send to nodes matching custom function
- **Load Balancing**: Automatic selection from matching nodes
- **Direction Control**: Target upstream, downstream, or both

---

## Core Concepts

### Network Topology

```
       Upstream Servers (we connect to them)
              ↑
              │
         ┌────┴────┐
         │  THIS   │
         │  NODE   │
         └────┬────┘
              │
              ↓
      Downstream Clients (connect to us)
```

**Upstream (`up`)**: Servers this node connects to as a client  
**Downstream (`down`)**: Clients connected to this node's server

---

## Routing Methods

### By ID (Direct Routing)

Send message to a specific node by its ID.

#### `request({ to, event, data, timeout })`

Send request to specific node, expect response.

```javascript
const response = await node.request({
  to: 'server-node-1',      // Target node ID
  event: 'user:get',         // Event name
  data: { userId: 123 },     // Request data
  timeout: 5000              // Optional timeout (default: 10s)
})

console.log(response)  // { name: 'John', email: 'john@example.com' }
```

**Use Cases:**
- RPC calls to known service
- Direct service-to-service communication
- Stateful operations requiring specific node

**Error Handling:**
```javascript
try {
  const result = await node.request({ to: 'api-server', event: 'process' })
} catch (err) {
  if (err.code === 'NODE_NOT_FOUND') {
    console.error('Node not reachable')
  } else if (err.code === 'REQUEST_TIMEOUT') {
    console.error('Request timed out')
  } else {
    console.error('Request failed:', err)
  }
}
```

---

#### `tick({ to, event, data })`

Send one-way message to specific node (no response expected).

```javascript
node.tick({
  to: 'logger-node',
  event: 'log:info',
  data: { message: 'User logged in', userId: 123 }
})
```

**Use Cases:**
- Logging/metrics
- Fire-and-forget notifications
- Events that don't require acknowledgment

**Characteristics:**
- ✅ No response (faster than request)
- ✅ No timeout/retry logic
- ✅ Lower overhead
- ⚠️ No delivery guarantee

---

### By Filter (Smart Routing)

Send message to nodes matching specific criteria.

#### `requestAny({ event, data, filter, timeout, up, down })`

Send request to **one random node** matching filter.

```javascript
// Filter by role
const result = await node.requestAny({
  event: 'ml:infer',
  data: { model: 'gpt-4', input: 'Hello' },
  filter: { role: 'ml-worker' }
})

// Filter by multiple properties
const result = await node.requestAny({
  event: 'query:execute',
  data: { sql: 'SELECT * FROM users' },
  filter: {
    role: 'database',
    region: 'us-east-1',
    version: 2
  }
})

// Filter by predicate function
const result = await node.requestAny({
  event: 'process:video',
  data: { videoId: 'abc123' },
  filter: {
    predicate: (options) => {
      return options.role === 'video-processor' && 
             options.cpu > 50 && 
             options.queueSize < 10
    }
  }
})
```

**Parameters:**
- `event`: Event name to invoke
- `data`: Request payload
- `filter`: Object with matching criteria or `{ predicate: fn }`
- `timeout`: Optional timeout (default: global config)
- `up`: Search upstream (default: `true`)
- `down`: Search downstream (default: `true`)

**Selection Strategy:**
- Finds all nodes matching filter
- Randomly selects one
- Sends request to selected node

**Use Cases:**
- Load balancing across workers
- Service discovery
- Failover (automatically picks available node)
- Resource-based routing (CPU, memory, queue size)

---

#### Direction Control

Control whether to search upstream, downstream, or both:

```javascript
// Search both directions (default)
await node.requestAny({
  event: 'cache:get',
  filter: { role: 'cache' }
  // up: true, down: true (implicit)
})

// Only downstream (clients connected to us)
await node.requestAny({
  event: 'task:process',
  filter: { role: 'worker' },
  down: true,
  up: false
})

// Only upstream (servers we're connected to)
await node.requestAny({
  event: 'auth:verify',
  filter: { role: 'auth' },
  down: false,
  up: true
})
```

**Shortcuts:**
```javascript
// Shortcut for downstream only
await node.requestDownAny({
  event: 'task:process',
  filter: { role: 'worker' }
})

// Shortcut for upstream only
await node.requestUpAny({
  event: 'auth:verify',
  filter: { role: 'auth' }
})
```

---

#### `tickAny({ event, data, filter, up, down })`

Send tick to **one random node** matching filter.

```javascript
node.tickAny({
  event: 'metrics:record',
  data: { metric: 'request_count', value: 1 },
  filter: { role: 'metrics' }
})
```

**Shortcuts:**
```javascript
// Downstream only
node.tickDownAny({ event: 'notify', filter: { role: 'subscriber' } })

// Upstream only
node.tickUpAny({ event: 'heartbeat', filter: { role: 'monitor' } })
```

---

#### `tickAll({ event, data, filter, up, down })`

Send tick to **all nodes** matching filter.

```javascript
// Broadcast to all matching nodes
node.tickAll({
  event: 'config:reload',
  data: { configVersion: 5 },
  filter: { role: 'api-server' }
})
```

**Use Cases:**
- Configuration updates
- Broadcasting events
- Cache invalidation
- Cluster-wide notifications

**Shortcuts:**
```javascript
// Downstream only
node.tickDownAll({ event: 'shutdown', filter: { role: 'worker' } })

// Upstream only
node.tickUpAll({ event: 'status:update', data: { status: 'healthy' } })
```

---

## Filter Matching

### Object Matching

Filter is matched against peer's `options` object:

```javascript
// Peer registered with:
const peer = new Node({
  id: 'worker-1',
  options: {
    role: 'worker',
    region: 'us-east-1',
    version: 2,
    capabilities: ['video', 'image']
  }
})

// This matches:
node.requestAny({
  event: 'process',
  filter: { role: 'worker' }  // ✅ Matches
})

node.requestAny({
  event: 'process',
  filter: { role: 'worker', region: 'us-east-1' }  // ✅ Matches
})

// This doesn't match:
node.requestAny({
  event: 'process',
  filter: { role: 'api' }  // ❌ No match
})

node.requestAny({
  event: 'process',
  filter: { role: 'worker', region: 'eu-west-1' }  // ❌ No match
})
```

**Matching Rules:**
- All filter properties must match peer options
- Peer can have additional properties (not in filter)
- Deep equality comparison for nested objects/arrays

---

### Predicate Matching

Use custom function for complex filtering:

```javascript
node.requestAny({
  event: 'process:task',
  filter: {
    predicate: (options) => {
      // Custom logic
      return options.role === 'worker' &&
             options.cpu < 80 &&           // Not overloaded
             options.memory > 1024 &&      // Has memory
             options.region.startsWith('us')  // US region
    }
  }
})
```

**Predicate Function:**
- **Input**: Peer's `options` object
- **Output**: `true` to match, `false` to skip
- **Use Cases**: Complex logic, resource-based routing, computed matches

**Examples:**

```javascript
// Route to least busy node
const leastBusy = (options) => {
  return options.role === 'worker' && options.queueSize === 0
}

// Route to newest version
const newestVersion = (options) => {
  return options.role === 'api' && options.version >= 3
}

// Route to specific capabilities
const hasCapability = (options) => {
  return options.capabilities?.includes('video-encoding')
}
```

---

## Load Balancing

### Random Selection (Default)

ZeroNode uses **random selection** by default when multiple nodes match:

```javascript
// If 5 workers match filter, picks one randomly
await node.requestAny({
  event: 'task:process',
  filter: { role: 'worker' }
})
```

**Benefits:**
- ✅ Simple
- ✅ Good distribution over time
- ✅ No coordination needed
- ✅ Works well with auto-scaling

**Trade-offs:**
- ⚠️ Not deterministic
- ⚠️ No awareness of node load

---

### Custom Load Balancing

For advanced use cases, implement custom load balancing logic:

```javascript
// Custom load balancer wrapper
async function requestLeastLoaded({ event, data, filter }) {
  // Get all matching nodes
  const matchingNodes = await node.getFilteredPeers(filter)
  
  // Query load from each node
  const loads = await Promise.all(
    matchingNodes.map(peer =>
      node.request({ to: peer.id, event: 'system:get_load' })
    )
  )
  
  // Find least loaded
  const leastLoaded = matchingNodes.reduce((min, peer, idx) => {
    return loads[idx] < loads[min] ? idx : min
  }, 0)
  
  // Send to least loaded node
  return node.request({
    to: matchingNodes[leastLoaded].id,
    event,
    data
  })
}
```

**Strategies:**
- Round-robin (track last used)
- Least connections (track active requests)
- Weighted random (based on capacity)
- Consistent hashing (for caching)

---

## Advanced Patterns

### Service Discovery

```javascript
// Workers register with metadata
const worker = new Node({
  id: 'worker-1',
  options: {
    role: 'worker',
    capabilities: ['video', 'image', 'audio'],
    maxConcurrent: 10,
    region: 'us-east-1'
  }
})

await worker.connect({ address: 'tcp://coordinator:3000' })

// Coordinator routes based on capabilities
await coordinator.requestAny({
  event: 'process:video',
  data: { videoId: 'abc' },
  filter: {
    predicate: (opts) => {
      return opts.capabilities?.includes('video') &&
             opts.currentLoad < opts.maxConcurrent
    }
  }
})
```

---

### Failover

```javascript
// Try primary, fallback to secondary
async function requestWithFailover({ event, data }) {
  try {
    // Try primary region
    return await node.requestAny({
      event,
      data,
      filter: { role: 'api', region: 'us-east-1' },
      timeout: 3000
    })
  } catch (err) {
    console.warn('Primary failed, trying secondary...')
    
    // Failover to secondary region
    return await node.requestAny({
      event,
      data,
      filter: { role: 'api', region: 'eu-west-1' },
      timeout: 5000
    })
  }
}
```

---

### Scatter-Gather

```javascript
// Send to all nodes, wait for all responses
async function scatterGather({ event, data, filter }) {
  // Get all matching nodes
  const nodes = await node.getFilteredPeers(filter)
  
  // Send request to all nodes
  const promises = nodes.map(peer =>
    node.request({
      to: peer.id,
      event,
      data,
      timeout: 5000
    }).catch(err => ({ error: err }))
  )
  
  // Wait for all responses
  const results = await Promise.all(promises)
  
  // Filter out errors
  return results.filter(r => !r.error)
}

// Usage: Query all caches
const allCacheData = await scatterGather({
  event: 'cache:get',
  data: { key: 'user:123' },
  filter: { role: 'cache' }
})

// Merge results
const mergedData = allCacheData.reduce((acc, result) => {
  return { ...acc, ...result }
}, {})
```

---

### Circuit Breaker

```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failures = 0
    this.threshold = threshold
    this.timeout = timeout
    this.isOpen = false
  }
  
  async execute(fn) {
    if (this.isOpen) {
      throw new Error('Circuit breaker is open')
    }
    
    try {
      const result = await fn()
      this.failures = 0  // Reset on success
      return result
    } catch (err) {
      this.failures++
      
      if (this.failures >= this.threshold) {
        this.isOpen = true
        setTimeout(() => {
          this.isOpen = false
          this.failures = 0
        }, this.timeout)
      }
      
      throw err
    }
  }
}

const breaker = new CircuitBreaker()

async function requestWithCircuitBreaker({ to, event, data }) {
  return breaker.execute(() =>
    node.request({ to, event, data })
  )
}
```

---

### Sticky Routing (Session Affinity)

```javascript
// Route same user to same worker
class StickyRouter {
  constructor() {
    this.assignments = new Map()
  }
  
  async request({ userId, event, data, filter }) {
    // Check if user already assigned
    if (this.assignments.has(userId)) {
      const nodeId = this.assignments.get(userId)
      
      try {
        return await node.request({
          to: nodeId,
          event,
          data
        })
      } catch (err) {
        // Node failed, reassign
        this.assignments.delete(userId)
      }
    }
    
    // Assign to random matching node
    const result = await node.requestAny({
      event,
      data,
      filter
    })
    
    // Remember assignment
    this.assignments.set(userId, result.handledBy)
    
    return result
  }
}

const router = new StickyRouter()

// All requests from same user go to same worker
await router.request({
  userId: 123,
  event: 'session:get',
  data: {},
  filter: { role: 'session-store' }
})
```

---

## Router-Based Discovery (Service Mesh)

When nodes cannot find matching peers locally, they can automatically route through a **Router** node for service discovery.

### How It Works

```
Client Node                Router               Service Node
    │                        │                       │
    │ 1. requestAny(filter) │                       │
    ├──────────────────────►│                       │
    │   (no local match)     │                       │
    │                        │ 2. requestAny(filter) │
    │                        ├──────────────────────►│
    │                        │                       │
    │                        │ 3. response           │
    │                        │◄──────────────────────┤
    │ 4. response            │                       │
    │◄───────────────────────┤                       │
```

**Process:**
1. Client calls `requestAny({ filter })` but no local peers match
2. Client automatically forwards to connected router via system proxy message
3. Router performs its own `requestAny({ filter })` across its connections
4. Router returns result back to client

### Creating a Router

```javascript
import { Router } from 'zeronode'

const router = new Router({
  id: 'main-router',
  bind: 'tcp://0.0.0.0:8080'
})

console.log('Router started on tcp://0.0.0.0:8080')
```

### Service Registration

Services connect to router as upstream servers:

```javascript
import { Node } from 'zeronode'

// Auth service
const authService = new Node({
  id: 'auth-service',
  options: { role: 'auth', version: '2.0' },
  bind: 'tcp://0.0.0.0:3001'
})

await authService.connect({ address: 'tcp://127.0.0.1:8080' })

authService.onRequest('auth:login', async ({ data }) => {
  // Authentication logic
  return { token: 'abc123', userId: data.username }
})

// Payment service
const paymentService = new Node({
  id: 'payment-service',
  options: { role: 'payment', version: '1.5' }
})

await paymentService.connect({ address: 'tcp://127.0.0.1:8080' })

paymentService.onRequest('payment:charge', async ({ data }) => {
  // Payment logic
  return { success: true, transactionId: '12345' }
})
```

### Client Usage

Clients connect to router and request services without knowing their location:

```javascript
import { Node } from 'zeronode'

const client = new Node({ id: 'api-client' })
await client.connect({ address: 'tcp://127.0.0.1:8080' })

// Request auth service (router automatically forwards)
const authResult = await client.requestAny({
  event: 'auth:login',
  data: { username: 'john', password: 'secret' },
  filter: { role: 'auth' }
})
console.log(authResult)  // { token: 'abc123', userId: 'john' }

// Request payment service
const paymentResult = await client.requestAny({
  event: 'payment:charge',
  data: { amount: 100, card: '****1234' },
  filter: { role: 'payment' }
})
console.log(paymentResult)  // { success: true, transactionId: '12345' }
```

### Router Statistics

Monitor router performance:

```javascript
const stats = router.getRoutingStats()
console.log(stats)
// {
//   proxyRequests: { total: 1500, successful: 1480, failed: 20 },
//   proxyTicks: { total: 3200 },
//   uptime: 7200.5,
//   averageResponseTime: 18.3
// }

// Reset statistics
router.resetRoutingStats()
```

### Fallback Behavior

When `requestAny` / `tickAny` cannot find a match:

1. **Try Local Match**: Search downstream + upstream peers
2. **Try Router**: If no match and router connected, forward to router
3. **Error**: If router also has no match, return `NO_NODES_MATCH_FILTER`

```javascript
try {
  const result = await node.requestAny({
    event: 'rare:service',
    filter: { role: 'rare' }
  })
} catch (err) {
  if (err.code === 'NO_NODES_MATCH_FILTER') {
    console.error('Service not available (checked locally and via router)')
  }
}
```

### Multi-Router Setup

For high availability, nodes can connect to multiple routers:

```javascript
const client = new Node({ id: 'client' })

// Connect to multiple routers
await client.connect({ address: 'tcp://router-1:8080' })
await client.connect({ address: 'tcp://router-2:8080' })
await client.connect({ address: 'tcp://router-3:8080' })

// Client will try local first, then round-robin through routers
const result = await client.requestAny({
  event: 'service:request',
  filter: { role: 'worker' }
})
```

### CLI Usage

**Start Router:**
```bash
npx zeronode --router --bind tcp://0.0.0.0:8087
```

**Register Services:**
```bash
# Auth service
npx zeronode --node --name auth --connect tcp://127.0.0.1:8087

# Payment service
npx zeronode --node --name payment --connect tcp://127.0.0.1:8087
```

**Connect Client:**
```bash
npx zeronode --node --name client --connect tcp://127.0.0.1:8087 --interactive
```

See [CLI Documentation](./CLI.md) for more details.

### Advantages

✅ **Service Discovery**: Clients don't need to know service locations  
✅ **Dynamic Scaling**: Add/remove services without client changes  
✅ **Load Balancing**: Router automatically distributes requests  
✅ **Centralized Monitoring**: Track all inter-service communication  
✅ **Flexible Topology**: Mix direct connections with router-based discovery  

---

## Error Handling

### No Route Found

```javascript
try {
  await node.request({ to: 'unknown-node', event: 'test' })
} catch (err) {
  if (err.code === 'NODE_NOT_FOUND') {
    console.error('Node not reachable')
  }
}
```

### No Nodes Match Filter

```javascript
try {
  await node.requestAny({
    event: 'task:process',
    filter: { role: 'worker', region: 'mars' }
  })
} catch (err) {
  if (err.code === 'NO_NODES_MATCH_FILTER') {
    console.error('No nodes match filter')
  }
}
```

### Request Timeout

```javascript
try {
  await node.request({
    to: 'slow-node',
    event: 'slow:operation',
    timeout: 1000
  })
} catch (err) {
  if (err.code === 'REQUEST_TIMEOUT') {
    console.error('Request timed out')
  }
}
```

---

## Best Practices

### 1. Use Specific Filters

```javascript
// ✅ Good: Specific filter
await node.requestAny({
  event: 'ml:infer',
  filter: { role: 'ml-worker', model: 'gpt-4' }
})

// ❌ Bad: Too broad
await node.requestAny({
  event: 'ml:infer',
  filter: { role: 'worker' }  // Might match non-ML workers
})
```

### 2. Set Appropriate Timeouts

```javascript
// ✅ Good: Short timeout for fast operations
await node.request({
  to: 'cache',
  event: 'get',
  timeout: 1000  // 1s
})

// ✅ Good: Long timeout for slow operations
await node.request({
  to: 'ml-worker',
  event: 'train:model',
  timeout: 300000  // 5 minutes
})
```

### 3. Handle Failures Gracefully

```javascript
// ✅ Good: Retry logic with backoff
async function requestWithRetry({ to, event, data, maxRetries = 3 }) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await node.request({ to, event, data })
    } catch (err) {
      if (i === maxRetries - 1) throw err
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)))
    }
  }
}
```

### 4. Use Direction Control

```javascript
// ✅ Good: Explicit direction
await node.requestDownAny({
  event: 'task:process',
  filter: { role: 'worker' }
})

// ❌ Bad: Searching both directions unnecessarily
await node.requestAny({
  event: 'task:process',
  filter: { role: 'worker' },
  up: true,  // Workers are only downstream
  down: true
})
```

### 5. Monitor Routing Failures

```javascript
node.on(NodeEvent.ERROR, ({ code, message, context }) => {
  if (code === 'NO_NODES_MATCH_FILTER') {
    monitoring.increment('routing.no_match', {
      filter: context.filter,
      event: context.event
    })
    
    alerting.warn(`No nodes match filter: ${JSON.stringify(context.filter)}`)
  }
})
```

---

## Summary

✅ **By ID**: Direct routing to specific node  
✅ **By Filter**: Smart routing based on metadata  
✅ **By Predicate**: Custom routing logic  
✅ **Load Balancing**: Automatic random selection  
✅ **Direction Control**: Upstream/downstream targeting  
✅ **Broadcasting**: Send to all matching nodes  
✅ **Error Handling**: Graceful failure management  

**ZeroNode's routing makes building distributed systems feel like calling local functions!** 🎯

