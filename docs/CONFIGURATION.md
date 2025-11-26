# Configuration Guide

Complete reference for all Zeronode configuration options.

## Quick Start

```javascript
import { Node } from 'zeronode'

const node = new Node({
  id: 'my-node',                    // Node identity
  options: {                         // Node metadata (for routing)
    role: 'worker',
    region: 'us-east-1'
  },
  config: {                          // System configuration
    PING_INTERVAL: 2000,             // Client ping every 2 seconds
    CLIENT_GHOST_TIMEOUT: 10000      // Server timeout after 10 seconds
  }
})
```

## Node Configuration

### Node Identity & Options

```javascript
{
  id: string,        // Node ID (auto-generated if not provided)
  options: Object,   // Node metadata for smart routing
  bind: string,      // Auto-bind address (optional)
  config: Object     // System configuration (see below)
}
```

### ID (Node Identifier)

**Type:** `string`  
**Default:** Auto-generated (e.g., `'sleepy-giraffe-42'`)  
**Required:** No

The unique identifier for this node. Used in routing and peer identification.

```javascript
const node = new Node({
  id: 'api-server-1'  // Custom ID
})

// Or let Zeronode generate one
const node = new Node()  // Auto: 'sleepy-giraffe-42'
```

### Options (Node Metadata)

**Type:** `Object`  
**Default:** `{}`  
**Required:** No

Arbitrary metadata attached to this node. Used for smart routing and filtering.

```javascript
const node = new Node({
  id: 'worker-1',
  options: {
    role: 'worker',
    region: 'us-east-1',
    version: '2.1.0',
    capacity: 100,
    features: ['ml', 'image-processing'],
    status: 'ready',
    // Any custom fields you need
    customField: 'value'
  }
})
```

**Dynamic updates:**
```javascript
// Update options at runtime
await node.setOptions({ status: 'busy' })
await node.setOptions({ status: 'ready', capacity: 80 })
```

### Bind (Auto-bind Address)

**Type:** `string`  
**Default:** `null`  
**Required:** No

If provided, node will automatically bind to this address on creation.

```javascript
const node = new Node({
  id: 'server',
  bind: 'tcp://0.0.0.0:5000'  // Auto-bind
})

// Equivalent to:
const node = new Node({ id: 'server' })
await node.bind('tcp://0.0.0.0:5000')
```

---

## System Configuration

### Client Configuration

#### PING_INTERVAL

**Type:** `number` (milliseconds)  
**Default:** `10000` (10 seconds)  
**Range:** `1000` - `60000` recommended  

How often clients send heartbeat pings to servers.

```javascript
config: {
  PING_INTERVAL: 2000  // Ping every 2 seconds
}
```

**Tuning guide:**
- **1000-2000ms**: Low latency requirements, fast disconnect detection
- **5000-10000ms**: Balanced (recommended for most use cases)
- **30000-60000ms**: Low traffic, can tolerate slow disconnect detection

#### CLIENT_HANDSHAKE_TIMEOUT

**Type:** `number` (milliseconds)  
**Default:** `10000` (10 seconds)  
**Range:** `1000` - `30000` recommended  

Maximum time to wait for server handshake response.

```javascript
config: {
  CLIENT_HANDSHAKE_TIMEOUT: 5000  // 5 second timeout
}
```

---

### Server Configuration

#### CLIENT_HEALTH_CHECK_INTERVAL

**Type:** `number` (milliseconds)  
**Default:** `30000` (30 seconds)  
**Range:** `1000` - `60000` recommended  

How often server checks client health (last ping time).

```javascript
config: {
  CLIENT_HEALTH_CHECK_INTERVAL: 2000  // Check every 2 seconds
}
```

#### CLIENT_GHOST_TIMEOUT

**Type:** `number` (milliseconds)  
**Default:** `60000` (60 seconds)  
**Range:** `5000` - `300000` recommended  

How long without a ping before server considers client dead.

```javascript
config: {
  CLIENT_GHOST_TIMEOUT: 10000  // Timeout after 10 seconds
}
```

**Important:** Should be significantly larger than `PING_INTERVAL`:
```
CLIENT_GHOST_TIMEOUT >= PING_INTERVAL * 3
```

---

### Protocol Configuration

#### PROTOCOL_REQUEST_TIMEOUT

**Type:** `number` (milliseconds)  
**Default:** `10000` (10 seconds)  
**Range:** `1000` - `60000` recommended  

Default timeout for request/reply operations.

```javascript
config: {
  PROTOCOL_REQUEST_TIMEOUT: 5000  // 5 second default timeout
}
```

Can be overridden per-request:
```javascript
const response = await node.request({
  to: 'peer-id',
  event: 'operation',
  data: payload,
  timeout: 3000  // Override: 3 seconds for this request
})
```

#### BUFFER_STRATEGY

**Type:** `string`  
**Default:** `'msgpack'`  
**Options:** `'msgpack'`, `'json'`  

Message serialization format.

```javascript
config: {
  BUFFER_STRATEGY: 'msgpack'  // Faster, smaller (recommended)
  // or
  BUFFER_STRATEGY: 'json'     // Human-readable, debugging
}
```

---

### Transport Configuration (ZeroMQ)

#### ZMQ_LINGER

**Type:** `number` (milliseconds)  
**Default:** `0`  
**Range:** `0` - `30000`  

How long to wait for pending messages when closing socket.

```javascript
config: {
  ZMQ_LINGER: 1000  // Wait 1 second for pending messages
}
```

- **`0`**: Don't wait, discard pending messages (default, fast shutdown)
- **`> 0`**: Wait up to N ms for messages to send

#### ZMQ_SEND_HWM / ZMQ_RECV_HWM

**Type:** `number` (messages)  
**Default:** `1000`  
**Range:** `100` - `100000`  

High water mark - maximum queued messages before blocking/dropping.

```javascript
config: {
  ZMQ_SEND_HWM: 10000,  // Queue up to 10,000 outgoing messages
  ZMQ_RECV_HWM: 10000   // Queue up to 10,000 incoming messages
}
```

**Tuning guide:**
- **Low (100-1000)**: Low memory, may drop messages under load
- **Medium (1000-10000)**: Balanced (recommended)
- **High (10000+)**: High throughput, more memory usage

#### ZMQ_SEND_TIMEOUT / ZMQ_RECV_TIMEOUT

**Type:** `number` (milliseconds)  
**Default:** `5000`  
**Range:** `100` - `30000`  

Send/receive operation timeouts at socket level.

```javascript
config: {
  ZMQ_SEND_TIMEOUT: 5000,  // 5 second send timeout
  ZMQ_RECV_TIMEOUT: 5000   // 5 second receive timeout
}
```

#### ZMQ_RECONNECT_IVL / ZMQ_RECONNECT_IVL_MAX

**Type:** `number` (milliseconds)  
**Default:** `100` / `0` (no max)  
**Range:** `10` - `60000`  

Reconnection interval and maximum interval (exponential backoff).

```javascript
config: {
  ZMQ_RECONNECT_IVL: 1000,      // Start at 1 second
  ZMQ_RECONNECT_IVL_MAX: 30000  // Max 30 seconds between attempts
}
```

---

## Configuration Presets

### Low Latency

Fast disconnect detection, high responsiveness:

```javascript
const lowLatencyConfig = {
  // Client
  PING_INTERVAL: 1000,                    // 1 second
  CLIENT_HANDSHAKE_TIMEOUT: 3000,         // 3 seconds
  
  // Server
  CLIENT_HEALTH_CHECK_INTERVAL: 1000,     // 1 second
  CLIENT_GHOST_TIMEOUT: 3000,             // 3 seconds
  
  // Protocol
  PROTOCOL_REQUEST_TIMEOUT: 3000,         // 3 seconds
  
  // Trade-off: More network traffic, more CPU usage
}
```

### Balanced (Recommended)

Good balance between responsiveness and efficiency:

```javascript
const balancedConfig = {
  // Client
  PING_INTERVAL: 2000,                    // 2 seconds
  CLIENT_HANDSHAKE_TIMEOUT: 10000,        // 10 seconds
  
  // Server
  CLIENT_HEALTH_CHECK_INTERVAL: 2000,     // 2 seconds
  CLIENT_GHOST_TIMEOUT: 10000,            // 10 seconds
  
  // Protocol
  PROTOCOL_REQUEST_TIMEOUT: 10000,        // 10 seconds
}
```

### Efficient

Low overhead, slow disconnect detection:

```javascript
const efficientConfig = {
  // Client
  PING_INTERVAL: 10000,                   // 10 seconds
  CLIENT_HANDSHAKE_TIMEOUT: 30000,        // 30 seconds
  
  // Server
  CLIENT_HEALTH_CHECK_INTERVAL: 30000,    // 30 seconds
  CLIENT_GHOST_TIMEOUT: 60000,            // 60 seconds
  
  // Protocol
  PROTOCOL_REQUEST_TIMEOUT: 30000,        // 30 seconds
  
  // Trade-off: Slower disconnect detection
}
```

---

## Complete Example

```javascript
import { Node } from 'zeronode'

const server = new Node({
  // Identity
  id: 'api-server-1',
  
  // Metadata for routing
  options: {
    role: 'api-server',
    region: 'us-east-1',
    version: '2.0.0',
    capacity: 100
  },
  
  // Auto-bind (optional)
  bind: 'tcp://0.0.0.0:5000',
  
  // System configuration
  config: {
    // Server health checks
    CLIENT_HEALTH_CHECK_INTERVAL: 2000,
    CLIENT_GHOST_TIMEOUT: 10000,
    
    // Protocol
    PROTOCOL_REQUEST_TIMEOUT: 10000,
    BUFFER_STRATEGY: 'msgpack',
    
    // ZeroMQ transport
    ZMQ_LINGER: 1000,
    ZMQ_SEND_HWM: 10000,
    ZMQ_RECV_HWM: 10000,
    ZMQ_SEND_TIMEOUT: 5000,
    ZMQ_RECV_TIMEOUT: 5000,
    ZMQ_RECONNECT_IVL: 1000,
    ZMQ_RECONNECT_IVL_MAX: 30000
  }
})

const client = new Node({
  id: 'web-client-1',
  options: {
    role: 'client',
    version: '1.0.0'
  },
  config: {
    // Client pings
    PING_INTERVAL: 2000,
    CLIENT_HANDSHAKE_TIMEOUT: 10000,
    
    // Protocol
    PROTOCOL_REQUEST_TIMEOUT: 10000
  }
})
```

---

## Environment Variables

You can also use environment variables for configuration:

```bash
# Server
export ZERONODE_CLIENT_HEALTH_CHECK_INTERVAL=2000
export ZERONODE_CLIENT_GHOST_TIMEOUT=10000

# Client
export ZERONODE_PING_INTERVAL=2000

# Protocol
export ZERONODE_PROTOCOL_REQUEST_TIMEOUT=10000
```

Then in code:
```javascript
const config = {
  CLIENT_HEALTH_CHECK_INTERVAL: parseInt(process.env.ZERONODE_CLIENT_HEALTH_CHECK_INTERVAL) || 30000,
  CLIENT_GHOST_TIMEOUT: parseInt(process.env.ZERONODE_CLIENT_GHOST_TIMEOUT) || 60000,
  PING_INTERVAL: parseInt(process.env.ZERONODE_PING_INTERVAL) || 10000,
  PROTOCOL_REQUEST_TIMEOUT: parseInt(process.env.ZERONODE_PROTOCOL_REQUEST_TIMEOUT) || 10000
}
```

---

## Configuration Best Practices

### 1. Match Timeout to Ping Interval

```javascript
// Good: Timeout is 5x ping interval
{
  PING_INTERVAL: 2000,
  CLIENT_GHOST_TIMEOUT: 10000  // 2s * 5 = 10s
}

// Bad: Timeout too close to ping interval
{
  PING_INTERVAL: 2000,
  CLIENT_GHOST_TIMEOUT: 3000  // Too tight!
}
```

### 2. Match Health Check to Timeout

```javascript
// Good: Check frequently relative to timeout
{
  CLIENT_HEALTH_CHECK_INTERVAL: 2000,  // Check every 2s
  CLIENT_GHOST_TIMEOUT: 10000           // Timeout at 10s
}

// Bad: Check infrequently
{
  CLIENT_HEALTH_CHECK_INTERVAL: 30000,  // Check every 30s
  CLIENT_GHOST_TIMEOUT: 10000           // But timeout at 10s? Won't work!
}
```

### 3. Consider Your Use Case

| Use Case | Configuration Style |
|----------|-------------------|
| **Real-time gaming** | Low latency (1-3s timeouts) |
| **Chat application** | Low latency (1-3s timeouts) |
| **API services** | Balanced (10s timeouts) |
| **Background workers** | Efficient (30-60s timeouts) |
| **Batch processing** | Efficient (60s+ timeouts) |

### 4. Start Conservative, Then Tune

```javascript
// Start with balanced defaults
const config = {
  PING_INTERVAL: 2000,
  CLIENT_GHOST_TIMEOUT: 10000
}

// Monitor in production
// Adjust based on actual needs
```

---

## Troubleshooting

### Problem: Peers keep timing out

**Solution:** Increase `CLIENT_GHOST_TIMEOUT` and reduce `CLIENT_HEALTH_CHECK_INTERVAL`

```javascript
config: {
  CLIENT_HEALTH_CHECK_INTERVAL: 1000,  // Check more often
  CLIENT_GHOST_TIMEOUT: 30000          // More lenient timeout
}
```

### Problem: Slow disconnect detection

**Solution:** Decrease `PING_INTERVAL` and `CLIENT_GHOST_TIMEOUT`

```javascript
config: {
  PING_INTERVAL: 1000,                // Ping more often
  CLIENT_GHOST_TIMEOUT: 3000          // Timeout faster
}
```

### Problem: High network traffic

**Solution:** Increase `PING_INTERVAL`

```javascript
config: {
  PING_INTERVAL: 10000  // Ping less often
}
```

### Problem: Requests timing out

**Solution:** Increase `PROTOCOL_REQUEST_TIMEOUT` or per-request timeout

```javascript
// Global default
config: {
  PROTOCOL_REQUEST_TIMEOUT: 30000  // 30 seconds
}

// Or per-request
await node.request({
  to: 'peer',
  event: 'slow-operation',
  data: payload,
  timeout: 60000  // 60 seconds for this specific request
}

)
```

---

## Summary

| Configuration | Purpose | Recommended |
|--------------|---------|-------------|
| `PING_INTERVAL` | Client ping frequency | 2000ms |
| `CLIENT_HEALTH_CHECK_INTERVAL` | Server check frequency | 2000ms |
| `CLIENT_GHOST_TIMEOUT` | Disconnect threshold | 10000ms |
| `PROTOCOL_REQUEST_TIMEOUT` | Request timeout | 10000ms |
| `BUFFER_STRATEGY` | Serialization format | 'msgpack' |

**Start with the balanced preset and tune based on your specific needs!**
