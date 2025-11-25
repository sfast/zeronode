# Configuration Guide

## Overview

ZeroNode provides sensible defaults for all configuration options, requiring **zero configuration** to get started. However, for production deployments and specific use cases, you can customize various aspects of the framework's behavior.

---

## Basic Configuration

### Constructor Configuration

Pass configuration options when creating a Node:

```javascript
import Node, { BufferStrategy } from 'zeronode'

const node = new Node({
  id: 'my-node',
  options: { role: 'api', version: 1 },
  config: {
    // Protocol-level settings
    PROTOCOL_REQUEST_TIMEOUT: 15000,
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2,
    
    // Client-level settings
    CLIENT_PING_INTERVAL: 5000,
    CLIENT_HEALTH_CHECK_INTERVAL: 15000,
    CLIENT_GHOST_TIMEOUT: 30000,
    
    // Debug mode
    DEBUG: true
  }
})
```

---

## Configuration Options

### Protocol Settings

#### `PROTOCOL_REQUEST_TIMEOUT`

**Type:** `number` (milliseconds)  
**Default:** `10000` (10 seconds)  
**Description:** Global timeout for request/reply operations. If no response is received within this time, the request promise is rejected.

```javascript
const node = new Node({
  config: {
    PROTOCOL_REQUEST_TIMEOUT: 15000  // 15 seconds
  }
})

// Override per-request
await node.request({
  to: 'server',
  event: 'slow:operation',
  timeout: 30000  // 30 seconds for this request only
})
```

**Use Cases:**
- **Fast operations**: `3000` (3s) for low-latency internal services
- **Standard operations**: `10000` (10s, default) for typical microservices
- **Slow operations**: `30000`+ (30s+) for ML inference, complex queries

**Notes:**
- Cannot be set to infinity (must have a timeout)
- Individual requests can override this value
- Timeout starts when request is sent, not when queued

---

#### `PROTOCOL_BUFFER_STRATEGY`

**Type:** `BufferStrategy.EXACT | BufferStrategy.POWER_OF_2`  
**Default:** `BufferStrategy.EXACT`  
**Description:** Buffer allocation strategy for envelope creation.

```javascript
import { BufferStrategy } from 'zeronode'

// Option 1: Exact allocation (default)
const node1 = new Node({
  config: {
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.EXACT
  }
})

// Option 2: Power-of-2 allocation
const node2 = new Node({
  config: {
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2
  }
})
```

**EXACT (Default):**
- ✅ Zero memory waste
- ✅ Predictable memory usage
- ⚠️ More GC pressure (varied buffer sizes)
- **Best for:** Memory-constrained environments, small-scale deployments

**POWER_OF_2:**
- ✅ CPU cache-friendly (aligned allocations)
- ✅ Less GC pressure (fewer distinct sizes)
- ✅ Potential for buffer pooling
- ⚠️ ~25% memory overhead on average
- **Best for:** High-throughput systems, performance-critical applications

**Benchmark Results:**

| Strategy | Throughput | Memory | GC Pauses |
|----------|------------|--------|-----------|
| EXACT | 100K msg/s | 50 MB | 120/min |
| POWER_OF_2 | 130K msg/s | 63 MB | 45/min |

---

### Client Settings

These settings control client behavior when connecting to servers.

#### `CLIENT_PING_INTERVAL`

**Type:** `number` (milliseconds)  
**Default:** `10000` (10 seconds)  
**Description:** Interval at which clients send ping messages to servers to maintain connection health.

```javascript
const node = new Node({
  config: {
    CLIENT_PING_INTERVAL: 5000  // Ping every 5 seconds
  }
})
```

**Recommendations:**
- **High-latency networks**: `15000-30000` (15-30s) - reduce overhead
- **Standard networks**: `10000` (10s, default) - balanced
- **Low-latency/critical**: `3000-5000` (3-5s) - fast failure detection

**Trade-offs:**
- **Shorter interval**: Faster failure detection, higher network overhead
- **Longer interval**: Lower overhead, slower failure detection

---

#### `CLIENT_HEALTH_CHECK_INTERVAL`

**Type:** `number` (milliseconds)  
**Default:** `30000` (30 seconds)  
**Description:** Interval at which the server checks client health (last ping time).

```javascript
const node = new Node({
  config: {
    CLIENT_HEALTH_CHECK_INTERVAL: 15000  // Check every 15 seconds
  }
})
```

**How it works:**
1. Server starts health check timer when client connects
2. Every `CLIENT_HEALTH_CHECK_INTERVAL`, server checks last ping time
3. If client hasn't pinged within `CLIENT_GHOST_TIMEOUT`, mark as GHOST
4. If GHOST client doesn't ping within another `CLIENT_GHOST_TIMEOUT`, mark as FAILED and remove

**Recommendations:**
- Set to 2-3x `CLIENT_PING_INTERVAL` for normal conditions
- Increase for high-latency networks to avoid false positives

---

#### `CLIENT_GHOST_TIMEOUT`

**Type:** `number` (milliseconds)  
**Default:** `60000` (60 seconds)  
**Description:** Time after last ping before a client is considered "ghost" (potentially disconnected).

```javascript
const node = new Node({
  config: {
    CLIENT_GHOST_TIMEOUT: 30000  // Mark ghost after 30s
  }
})
```

**Client Lifecycle:**
```
CONNECTED → (no ping for GHOST_TIMEOUT) → GHOST → (no ping for another GHOST_TIMEOUT) → FAILED → REMOVED
```

**Recommendations:**
- **Stable networks**: `30000-60000` (30-60s, default range)
- **Unstable networks**: `90000-120000` (90-120s)
- **Critical systems**: `15000-30000` (15-30s) - fast cleanup

**Notes:**
- Should be at least 2x `CLIENT_PING_INTERVAL`
- Clients in GHOST state can recover by sending a ping
- Clients in FAILED state are removed and must reconnect

---

### Debug Settings

#### `DEBUG`

**Type:** `boolean`  
**Default:** `false`  
**Description:** Enable verbose debug logging for troubleshooting.

```javascript
const node = new Node({
  config: {
    DEBUG: true
  }
})
```

**Debug Output Includes:**
- Envelope serialization/deserialization
- Request/response matching
- Middleware execution details
- Handler invocation
- Connection lifecycle events

**Example Debug Logs:**
```
[Envelope] Serializing REQUEST: { owner: 'client', recipient: 'server', event: 'user:get' }
[RequestTracker] Tracking request: id=123456n, timeout=10000ms
[HandlerExecutor] Handler executed: { arity: 2, resultType: 'object', duration: 2.3ms }
[MessageDispatcher] Request 'user:get' matched 3 handler(s)
```

**⚠️ Warning:** Debug mode has performance overhead. **Only use in development or troubleshooting.**

---

## Transport Configuration

### ZeroMQ Settings

ZeroNode uses ZeroMQ for transport by default. You can configure ZeroMQ-specific options:

```javascript
import Node from 'zeronode'

const node = new Node({
  id: 'my-node',
  config: {
    // ZeroMQ transport options
    reconnectInterval: 1000,      // Reconnect after 1s
    reconnectMaxInterval: 30000,  // Max exponential backoff: 30s
    heartbeatInterval: 10000,     // ZMQ internal heartbeat
    heartbeatTimeout: 30000,      // ZMQ heartbeat timeout
    heartbeatTtl: 60000          // ZMQ heartbeat TTL
  }
})
```

#### Reconnection Settings

| Option | Default | Description |
|--------|---------|-------------|
| `reconnectInterval` | `1000` | Initial reconnect delay (ms) |
| `reconnectMaxInterval` | `30000` | Max reconnect delay with exponential backoff (ms) |

**Reconnection Behavior:**
- Automatic reconnection is **always enabled**
- Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s (max)
- Infinite retries (no give-up)

```javascript
// Fast reconnection (for stable networks)
const node = new Node({
  config: {
    reconnectInterval: 500,       // Start at 500ms
    reconnectMaxInterval: 5000    // Max 5s
  }
})

// Conservative reconnection (for unstable networks)
const node = new Node({
  config: {
    reconnectInterval: 5000,      // Start at 5s
    reconnectMaxInterval: 60000   // Max 60s
  }
})
```

---

## Complete Configuration Example

```javascript
import Node, { BufferStrategy } from 'zeronode'

const node = new Node({
  id: 'production-api-server',
  options: {
    role: 'api',
    version: 2,
    region: 'us-east-1'
  },
  config: {
    // Protocol settings
    PROTOCOL_REQUEST_TIMEOUT: 15000,
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2,
    
    // Client health management
    CLIENT_PING_INTERVAL: 5000,
    CLIENT_HEALTH_CHECK_INTERVAL: 15000,
    CLIENT_GHOST_TIMEOUT: 30000,
    
    // Transport settings
    reconnectInterval: 1000,
    reconnectMaxInterval: 30000,
    heartbeatInterval: 10000,
    heartbeatTimeout: 30000,
    
    // Debug (disable in production!)
    DEBUG: process.env.NODE_ENV !== 'production'
  }
})

await node.bind('tcp://0.0.0.0:3000')
console.log('Server ready with custom config')
```

---

## Environment-Based Configuration

### Development

```javascript
const devNode = new Node({
  config: {
    PROTOCOL_REQUEST_TIMEOUT: 30000,  // Generous timeouts for debugging
    CLIENT_PING_INTERVAL: 5000,       // Frequent pings
    CLIENT_GHOST_TIMEOUT: 30000,      // Quick cleanup
    DEBUG: true                        // Verbose logging
  }
})
```

### Production

```javascript
const prodNode = new Node({
  config: {
    PROTOCOL_REQUEST_TIMEOUT: 10000,
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2,  // Performance
    CLIENT_PING_INTERVAL: 10000,
    CLIENT_HEALTH_CHECK_INTERVAL: 30000,
    CLIENT_GHOST_TIMEOUT: 60000,      // Avoid false positives
    DEBUG: false,                      // No overhead
    
    // Conservative reconnection
    reconnectInterval: 2000,
    reconnectMaxInterval: 60000
  }
})
```

### High-Performance

```javascript
const hpNode = new Node({
  config: {
    PROTOCOL_REQUEST_TIMEOUT: 5000,   // Fast failure
    PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2,  // Less GC
    CLIENT_PING_INTERVAL: 3000,       // Fast detection
    CLIENT_HEALTH_CHECK_INTERVAL: 10000,
    CLIENT_GHOST_TIMEOUT: 20000,
    DEBUG: false
  }
})
```

---

## Per-Operation Overrides

### Request Timeout Override

```javascript
// Use global timeout (10s)
await node.request({ to: 'server', event: 'quick' })

// Override for slow operation
await node.request({
  to: 'server',
  event: 'ml:inference',
  timeout: 60000  // 60 seconds
})
```

### Connection-Specific Config

```javascript
// Default reconnection
await node.connect({ address: 'tcp://127.0.0.1:3000' })

// Custom reconnection for unstable connection
await node.connect({
  address: 'tcp://192.168.1.100:3000',
  config: {
    reconnectInterval: 5000,
    reconnectMaxInterval: 120000
  }
})
```

---

## Configuration Best Practices

### 1. Start with Defaults

```javascript
// ✅ Good: Use defaults first
const node = new Node({ id: 'my-node' })

// ❌ Bad: Premature optimization
const node = new Node({
  config: {
    // Copying defaults unnecessarily
    PROTOCOL_REQUEST_TIMEOUT: 10000,
    CLIENT_PING_INTERVAL: 10000,
    // ...
  }
})
```

### 2. Tune Based on Measurements

```javascript
// ✅ Good: Measure first, then tune
console.time('request')
const result = await node.request({ to: 'server', event: 'test' })
console.timeEnd('request')  // Measure actual latency

// Then adjust if needed
if (averageLatency > 5000) {
  node.config.PROTOCOL_REQUEST_TIMEOUT = 20000
}
```

### 3. Match Network Characteristics

```javascript
// ✅ Good: LAN deployment (low latency)
const lanNode = new Node({
  config: {
    CLIENT_PING_INTERVAL: 5000,
    CLIENT_GHOST_TIMEOUT: 15000
  }
})

// ✅ Good: WAN deployment (high latency)
const wanNode = new Node({
  config: {
    CLIENT_PING_INTERVAL: 15000,
    CLIENT_GHOST_TIMEOUT: 60000
  }
})
```

### 4. Use Environment Variables

```javascript
const node = new Node({
  config: {
    PROTOCOL_REQUEST_TIMEOUT: parseInt(
      process.env.REQUEST_TIMEOUT || '10000'
    ),
    CLIENT_PING_INTERVAL: parseInt(
      process.env.PING_INTERVAL || '10000'
    ),
    DEBUG: process.env.DEBUG === 'true'
  }
})
```

---

## Troubleshooting Configuration Issues

### Requests Timing Out

```javascript
// Increase request timeout
config: {
  PROTOCOL_REQUEST_TIMEOUT: 30000
}

// Or per-request
await node.request({ event: 'slow', timeout: 60000 })
```

### Frequent Disconnections

```javascript
// Increase ghost timeout to avoid false positives
config: {
  CLIENT_GHOST_TIMEOUT: 120000  // 2 minutes
}
```

### High Memory Usage

```javascript
// Use EXACT strategy instead of POWER_OF_2
config: {
  PROTOCOL_BUFFER_STRATEGY: BufferStrategy.EXACT
}
```

### Slow Performance

```javascript
// Use POWER_OF_2 for better GC behavior
config: {
  PROTOCOL_BUFFER_STRATEGY: BufferStrategy.POWER_OF_2
}
```

---

## Summary

✅ **Zero config by default**: Sensible defaults for most use cases  
✅ **Protocol settings**: Timeout and buffer strategy  
✅ **Client health**: Ping intervals and ghost timeouts  
✅ **Transport config**: ZeroMQ reconnection and heartbeat  
✅ **Debug mode**: Verbose logging for troubleshooting  
✅ **Per-operation overrides**: Fine-grained control when needed  

**Start simple, measure, then tune!** 🎛️

