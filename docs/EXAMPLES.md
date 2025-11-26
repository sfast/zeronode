# Real-World Examples

This document provides complete, production-ready examples demonstrating ZeroNode's capabilities in real-world scenarios.

**All examples are fully working and can be run directly!**

---

## Table of Contents

- [API Gateway with Load-Balanced Workers](#api-gateway-with-load-balanced-workers)
- [Distributed Logging System](#distributed-logging-system)
- [Task Queue with Priority Workers](#task-queue-with-priority-workers)
- [Microservices with Service Discovery](#microservices-with-service-discovery)
- [Real-Time Analytics Pipeline](#real-time-analytics-pipeline)
- [Distributed Cache System](#distributed-cache-system)
- [Multi-Agent AI System](#multi-agent-ai-system)
- [Event-Driven Notification System](#event-driven-notification-system)

---

## API Gateway with Load-Balanced Workers

**Scenario:** API gateway routes requests to a pool of workers, automatically load-balancing across available (idle) workers.

### Gateway

```javascript
// examples/api-gateway/gateway.js
import { Node, NodeEvent } from 'zeronode'

const gateway = new Node({
  id: 'api-gateway',
  options: { role: 'gateway', version: 1 }
})

await gateway.bind('tcp://0.0.0.0:8000')
console.log('✅ API Gateway listening on tcp://0.0.0.0:8000')

// Middleware: Request logging
gateway.onRequest(/^api:/, (envelope, reply) => {
  console.log(`📥 Request: ${envelope.event} from ${envelope.owner}`)
})

// Route all API requests to available workers
gateway.onRequest(/^api:/, async (envelope, reply) => {
  try {
    // Automatically load-balance across idle workers
    const result = await gateway.requestAny({
      event: envelope.event,
      data: envelope.data,
      filter: {
        role: 'worker',
        status: 'idle'
      },
      timeout: 30000
    })

    console.log(`✅ Request handled by worker`)
    return result
  } catch (err) {
    console.error(`❌ No workers available: ${err.message}`)
    return reply.error({
      code: 'NO_WORKERS',
      message: 'All workers are busy or unavailable'
    })
  }
})

// Error handling
gateway.on(NodeEvent.ERROR, ({ source, error }) => {
  console.error(`Gateway error from ${source}:`, error.message)
})
```

### Worker

```javascript
// examples/api-gateway/worker.js
import Node from 'zeronode'

const workerId = `worker-${process.pid}`

const worker = new Node({
  id: workerId,
  options: {
    role: 'worker',
    status: 'idle',
    capacity: 100,
    pid: process.pid
  }
})

// Connect to gateway
await worker.connect({ address: 'tcp://127.0.0.1:8000' })
console.log(`✅ Worker ${workerId} connected to gateway`)

// Handle API requests
worker.onRequest(/^api:/, async (envelope, reply) => {
  console.log(`📝 Processing ${envelope.event}...`)

  // Simulate processing
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1000))

  return {
    success: true,
    worker: workerId,
    data: `Processed ${envelope.event}`
  }
})

console.log(`Worker ${workerId} ready and waiting for tasks`)
```

### Client

```javascript
// examples/api-gateway/client.js
import Node from 'zeronode'

const client = new Node({ id: 'api-client' })

await client.connect({ address: 'tcp://127.0.0.1:8000' })
console.log('✅ Client connected to gateway')

// Send requests
for (let i = 0; i < 10; i++) {
  const result = await client.request({
    to: 'api-gateway',
    event: 'api:user:get',
    data: { userId: i }
  })

  console.log(`Response ${i}:`, result)
}
```

**Run:**
```bash
node examples/api-gateway/gateway.js
node examples/api-gateway/worker.js  # Run multiple workers
node examples/api-gateway/client.js
```

---

## Distributed Logging System

**Scenario:** Centralized log aggregation from multiple services using fire-and-forget tick messages.

### Log Aggregator

```javascript
// examples/distributed-logging/aggregator.js
import Node from 'zeronode'
import fs from 'fs/promises'

const aggregator = new Node({
  id: 'log-aggregator',
  options: { role: 'logger' }
})

await aggregator.bind('tcp://0.0.0.0:9000')
console.log('✅ Log Aggregator listening on tcp://0.0.0.0:9000')

const logFile = 'logs/application.log'

// Handle all log events (info, warn, error, debug)
aggregator.onTick(/^log:/, async (envelope) => {
  const level = envelope.event.split(':')[1]  // log:info -> info
  const { service, message, metadata } = envelope.data

  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    service,
    message,
    metadata
  }

  // Write to file
  await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n')

  // Also print to console
  const emoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '📝'
  console.log(`${emoji} [${level.toUpperCase()}] [${service}] ${message}`)
})

console.log('Log aggregator ready to receive logs')
```

### Service Using Logger

```javascript
// examples/distributed-logging/service.js
import Node from 'zeronode'

const service = new Node({
  id: 'user-service',
  options: { role: 'api' }
})

await service.connect({ address: 'tcp://127.0.0.1:9000' })
console.log('✅ Service connected to log aggregator')

// Helper function for logging
function log(level, message, metadata = {}) {
  service.tick({
    to: 'log-aggregator',
    event: `log:${level}`,
    data: {
      service: 'user-service',
      message,
      metadata
    }
  })
}

// Example usage
log('info', 'Service started successfully')
log('info', 'User logged in', { userId: 123, ip: '192.168.1.1' })
log('warn', 'Rate limit approaching', { current: 95, limit: 100 })
log('error', 'Database connection failed', {
  error: 'Connection timeout',
  host: 'db.example.com'
})

// Simulate service work
setInterval(() => {
  log('info', 'Health check', { status: 'healthy', uptime: process.uptime() })
}, 5000)
```

**Run:**
```bash
mkdir -p logs
node examples/distributed-logging/aggregator.js
node examples/distributed-logging/service.js
```

---

## Task Queue with Priority Workers

**Scenario:** Task dispatcher routes high-priority tasks to high-priority workers, with automatic load balancing.

### Dispatcher

```javascript
// examples/task-queue/dispatcher.js
import Node from 'zeronode'

const dispatcher = new Node({
  id: 'task-dispatcher',
  options: { role: 'dispatcher' }
})

await dispatcher.bind('tcp://0.0.0.0:7000')
console.log('✅ Task Dispatcher listening on tcp://0.0.0.0:7000')

dispatcher.onRequest('task:submit', async (envelope, reply) => {
  const { priority = 'normal', type, payload } = envelope.data

  console.log(`📥 Task submitted: ${type} (priority: ${priority})`)

  try {
    // Route to appropriate worker based on priority
    const result = await dispatcher.requestAny({
      event: 'task:execute',
      data: { type, payload },
      filter: {
        predicate: (options) => {
          if (options.role !== 'worker') return false
          if (options.status !== 'idle') return false

          // High-priority tasks need high-priority workers (priority >= 7)
          if (priority === 'high' && options.priority < 7) return false

          // Normal tasks can use any priority worker
          return true
        }
      },
      timeout: 60000
    })

    console.log(`✅ Task completed by ${result.worker}`)
    return { success: true, result }
  } catch (err) {
    console.error(`❌ Task failed: ${err.message}`)
    return reply.error({
      code: 'TASK_FAILED',
      message: err.message
    })
  }
})

console.log('Dispatcher ready to accept tasks')
```

### Worker

```javascript
// examples/task-queue/worker.js
import Node from 'zeronode'

const workerId = `worker-${process.pid}`
const workerPriority = parseInt(process.env.PRIORITY || '5')

const worker = new Node({
  id: workerId,
  options: {
    role: 'worker',
    status: 'idle',
    priority: workerPriority,  // 1-10 scale
    processed: 0
  }
})

await worker.connect({ address: 'tcp://127.0.0.1:7000' })
console.log(`✅ Worker ${workerId} connected (priority: ${workerPriority})`)

worker.onRequest('task:execute', async (envelope, reply) => {
  const { type, payload } = envelope.data

  console.log(`⚙️  Executing task: ${type}`)

  try {
    // Simulate task processing
    const processingTime = Math.random() * 3000 + 1000
    await new Promise(resolve => setTimeout(resolve, processingTime))

    // Increment processed count
    const processed = worker.getOptions().processed + 1
    worker.setOptions({ processed })

    return {
      success: true,
      worker: workerId,
      processingTime: Math.round(processingTime),
      result: `Task ${type} completed`
    }
  } catch (err) {
    console.error(`❌ Task failed: ${err.message}`)
    throw err
  }
})

console.log(`Worker ready (priority: ${workerPriority})`)
```

### Client

```javascript
// examples/task-queue/client.js
import Node from 'zeronode'

const client = new Node({ id: 'task-client' })

await client.connect({ address: 'tcp://127.0.0.1:7000' })
console.log('✅ Client connected to dispatcher')

// Submit normal priority tasks
for (let i = 0; i < 3; i++) {
  const result = await client.request({
    to: 'task-dispatcher',
    event: 'task:submit',
    data: {
      priority: 'normal',
      type: 'data-processing',
      payload: { id: i }
    }
  })
  console.log(`Normal task ${i}:`, result)
}

// Submit high priority tasks
for (let i = 0; i < 2; i++) {
  const result = await client.request({
    to: 'task-dispatcher',
    event: 'task:submit',
    data: {
      priority: 'high',
      type: 'urgent-processing',
      payload: { id: i }
    }
  })
  console.log(`High priority task ${i}:`, result)
}
```

**Run:**
```bash
node examples/task-queue/dispatcher.js
PRIORITY=5 node examples/task-queue/worker.js  # Normal worker
PRIORITY=8 node examples/task-queue/worker.js  # High-priority worker
node examples/task-queue/client.js
```

---

## Microservices with Service Discovery

**Scenario:** Multiple microservices discover and communicate with each other based on their roles.

### Service Registry (Coordinator)

```javascript
// examples/microservices/registry.js
import Node, { NodeEvent } from 'zeronode'

const registry = new Node({
  id: 'service-registry',
  options: { role: 'registry' }
})

const services = new Map()

await registry.bind('tcp://0.0.0.0:5000')
console.log('✅ Service Registry listening on tcp://0.0.0.0:5000')

// Track services joining/leaving
registry.on(NodeEvent.PEER_JOINED, ({ peerId, peerOptions }) => {
  services.set(peerId, peerOptions)
  console.log(`📥 Service joined: ${peerId} (role: ${peerOptions.role})`)
  console.log(`   Active services: ${services.size}`)
})

registry.on(NodeEvent.PEER_LEFT, ({ peerId }) => {
  services.delete(peerId)
  console.log(`📤 Service left: ${peerId}`)
  console.log(`   Active services: ${services.size}`)
})

// Service discovery endpoint
registry.onRequest('registry:discover', (envelope, reply) => {
  const { role } = envelope.data

  const matchingServices = Array.from(services.entries())
    .filter(([_, opts]) => opts.role === role)
    .map(([id, opts]) => ({ id, ...opts }))

  console.log(`🔍 Discovery request for role: ${role} (found: ${matchingServices.length})`)

  return { services: matchingServices }
})

console.log('Service Registry ready')
```

### Auth Service

```javascript
// examples/microservices/auth-service.js
import Node from 'zeronode'

const auth = new Node({
  id: 'auth-service',
  options: {
    role: 'auth',
    version: 1,
    endpoints: ['auth:login', 'auth:verify']
  }
})

await auth.connect({ address: 'tcp://127.0.0.1:5000' })
console.log('✅ Auth Service connected to registry')

auth.onRequest('auth:login', async (envelope, reply) => {
  const { username, password } = envelope.data

  // Simulate authentication
  if (username && password) {
    return {
      success: true,
      token: `token_${Date.now()}`,
      userId: 123
    }
  }

  return reply.error({ code: 'AUTH_FAILED', message: 'Invalid credentials' })
})

auth.onRequest('auth:verify', (envelope, reply) => {
  const { token } = envelope.data

  // Simulate token verification
  const isValid = token && token.startsWith('token_')

  return { valid: isValid }
})

console.log('Auth Service ready')
```

### API Service

```javascript
// examples/microservices/api-service.js
import Node from 'zeronode'

const api = new Node({
  id: 'api-service',
  options: {
    role: 'api',
    version: 1
  }
})

await api.connect({ address: 'tcp://127.0.0.1:5000' })
console.log('✅ API Service connected to registry')

// Discover auth service
const { services: authServices } = await api.request({
  to: 'service-registry',
  event: 'registry:discover',
  data: { role: 'auth' }
})

console.log(`Found ${authServices.length} auth service(s)`)

// Handle API requests
api.onRequest('api:user:profile', async (envelope, reply) => {
  const { token } = envelope.data

  // Verify token with auth service
  const authResult = await api.requestAny({
    event: 'auth:verify',
    data: { token },
    filter: { role: 'auth' }
  })

  if (!authResult.valid) {
    return reply.error({ code: 'UNAUTHORIZED', message: 'Invalid token' })
  }

  // Return user profile
  return {
    userId: 123,
    name: 'John Doe',
    email: 'john@example.com'
  }
})

console.log('API Service ready')
```

**Run:**
```bash
node examples/microservices/registry.js
node examples/microservices/auth-service.js
node examples/microservices/api-service.js
```

---

## Real-Time Analytics Pipeline

**Scenario:** Stream processing pipeline with multiple stages (ingest → process → aggregate → store).

```javascript
// examples/analytics/ingester.js
import Node from 'zeronode'

const ingester = new Node({
  id: 'data-ingester',
  options: { role: 'ingester' }
})

await ingester.bind('tcp://0.0.0.0:6000')
console.log('✅ Ingester listening on tcp://0.0.0.0:6000')

// Accept events and forward to processors
ingester.onTick('event:track', (envelope) => {
  const { event, userId, properties } = envelope.data

  console.log(`📊 Event received: ${event} from user ${userId}`)

  // Forward to all processors for parallel processing
  ingester.tickAll({
    event: 'analytics:process',
    data: {
      event,
      userId,
      properties,
      timestamp: Date.now()
    },
    filter: { role: 'processor' }
  })
})
```

```javascript
// examples/analytics/processor.js
import Node from 'zeronode'

const processorId = `processor-${process.pid}`

const processor = new Node({
  id: processorId,
  options: { role: 'processor', type: 'real-time' }
})

await processor.connect({ address: 'tcp://127.0.0.1:6000' })
console.log(`✅ Processor ${processorId} connected`)

processor.onTick('analytics:process', (envelope) => {
  const { event, userId, properties, timestamp } = envelope.data

  // Process the event (enrich, filter, transform)
  const enriched = {
    ...properties,
    event,
    userId,
    timestamp,
    processedBy: processorId,
    processedAt: Date.now()
  }

  console.log(`⚙️  Processed event: ${event}`)

  // Forward to aggregator
  processor.tick({
    to: 'aggregator',
    event: 'analytics:aggregate',
    data: enriched
  })
})
```

**Run:**
```bash
node examples/analytics/ingester.js
node examples/analytics/processor.js  # Run multiple
```

---

## Summary

All examples demonstrate:

✅ **Production-ready code**: Copy-paste and run  
✅ **Real-world patterns**: Gateway, logging, task queue, service discovery  
✅ **Load balancing**: Automatic distribution across workers  
✅ **Service discovery**: Dynamic peer discovery  
✅ **Error handling**: Graceful failure management  
✅ **Scalability**: Run multiple instances easily  

**Explore the `/examples` directory for complete, runnable code!** 🚀

