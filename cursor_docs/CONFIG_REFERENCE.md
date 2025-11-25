# ZeroMQ Transport Configuration Reference

Complete reference for all configuration options available when creating ZeroMQ Router and Dealer sockets.

## Quick Start

```javascript
import { Dealer, Router, ZMQConfigDefaults } from 'zeronode/transport/zeromq'

// Use defaults (no config needed)
const dealer = new Dealer({ id: 'my-dealer' })

// Override specific options
const router = new Router({ 
  id: 'my-router',
  config: {
    ZMQ_LINGER: 5000,
    ZMQ_SNDHWM: 50000,
    ioThreads: 4
  }
})

// View all defaults
console.log(ZMQConfigDefaults)
```

## Configuration Options

### Context Options (I/O Threading)

#### `ioThreads` (optional)
Number of I/O threads for ZeroMQ context.

- **Default:** `undefined` (auto-select: 1 for dealer, 2 for router)
- **Values:**
  - `1` - Single-threaded (clients, <100K msg/s)
  - `2` - Dual-threaded (servers with multiple clients)
  - `4+` - High-throughput (>500K msg/s)
- **Example:**
  ```javascript
  const dealer = new Dealer({ config: { ioThreads: 1 } })
  ```

#### `expectedClients` (Router only, optional)
Expected number of concurrent clients. Used to optimize I/O threads.

- **Default:** `undefined` (uses 2 threads)
- **Auto-scaling:**
  - `<10` clients → 1-2 threads
  - `10-50` clients → 2 threads
  - `>50` clients → 4 threads
- **Example:**
  ```javascript
  const router = new Router({ config: { expectedClients: 100 } })
  ```

---

### Logging & Debugging

#### `logger` (optional)
Logger instance for socket operations.

- **Default:** `undefined` (uses `console`)
- **Example:**
  ```javascript
  import winston from 'winston'
  const logger = winston.createLogger({ level: 'info' })
  
  const dealer = new Dealer({ config: { logger } })
  ```

#### `debug` (optional)
Enable verbose debug logging.

- **Default:** `false`
- **Values:** `true` | `false`
- **Example:**
  ```javascript
  const dealer = new Dealer({ config: { debug: true } })
  ```

---

### Common Socket Options

#### `ZMQ_LINGER`
How long to keep unsent messages after socket close.

- **Default:** `0` (discard immediately)
- **Values:**
  - `0` - Fast shutdown (recommended)
  - `-1` - Wait forever (NOT recommended)
  - `>0` - Wait N milliseconds
- **Example:**
  ```javascript
  const dealer = new Dealer({ config: { ZMQ_LINGER: 5000 } })
  ```

#### `ZMQ_SNDHWM`
Send High Water Mark (max queued outgoing messages).

- **Default:** `10000`
- **Range:** `>0`
- **Purpose:** Prevents memory exhaustion, blocks when limit reached
- **Example:**
  ```javascript
  const router = new Router({ config: { ZMQ_SNDHWM: 50000 } })
  ```

#### `ZMQ_RCVHWM`
Receive High Water Mark (max queued incoming messages).

- **Default:** `10000`
- **Range:** `>0`
- **Example:**
  ```javascript
  const router = new Router({ config: { ZMQ_RCVHWM: 50000 } })
  ```

#### `ZMQ_SNDTIMEO` (optional)
Send timeout in milliseconds.

- **Default:** `undefined` (ZeroMQ manages)
- **Values:**
  - `-1` - Infinite
  - `0` - Non-blocking
  - `>0` - Timeout in ms
- **Example:**
  ```javascript
  const dealer = new Dealer({ config: { ZMQ_SNDTIMEO: 5000 } })
  ```

#### `ZMQ_RCVTIMEO` (optional)
Receive timeout in milliseconds.

- **Default:** `undefined` (ZeroMQ manages)
- **Values:** Same as `ZMQ_SNDTIMEO`

---

### Dealer-Specific Options

#### `ZMQ_RECONNECT_IVL`
How often ZeroMQ attempts to reconnect after losing connection.

- **Default:** `100` (100ms)
- **Range:** `>0` milliseconds
- **Example:**
  ```javascript
  const dealer = new Dealer({ config: { ZMQ_RECONNECT_IVL: 500 } })
  ```

#### `ZMQ_RECONNECT_IVL_MAX`
Maximum reconnection interval for exponential backoff.

- **Default:** `0` (no backoff, constant interval)
- **Values:**
  - `0` - No exponential backoff
  - `>0` - Max interval in ms (e.g., `30000` = max 30s)
- **Example:**
  ```javascript
  // Exponential backoff: 100ms → 200ms → 400ms → ... → 30000ms
  const dealer = new Dealer({ 
    config: { 
      ZMQ_RECONNECT_IVL: 100,
      ZMQ_RECONNECT_IVL_MAX: 30000
    } 
  })
  ```

---

### Router-Specific Options

#### `ZMQ_ROUTER_MANDATORY` (optional)
Fail if sending to unknown peer.

- **Default:** `undefined` (ZeroMQ default: `false`)
- **Values:**
  - `false` - Silently drop messages to unknown peers (production)
  - `true` - Throw error (debugging)
- **Example:**
  ```javascript
  const router = new Router({ config: { ZMQ_ROUTER_MANDATORY: true } })
  ```

#### `ZMQ_ROUTER_HANDOVER` (optional)
Take over identity from another router (high-availability).

- **Default:** `undefined` (ZeroMQ default: `false`)
- **Values:** `true` | `false`
- **Example:**
  ```javascript
  const router = new Router({ config: { ZMQ_ROUTER_HANDOVER: true } })
  ```

---

### Application-Level Timeouts

#### `CONNECTION_TIMEOUT`
How long to wait for initial connection.

- **Default:** `-1` (infinite)
- **Values:**
  - `-1` - Wait forever
  - `>0` - Timeout in milliseconds
- **Example:**
  ```javascript
  const dealer = new Dealer({ config: { CONNECTION_TIMEOUT: 5000 } })
  ```

#### `RECONNECTION_TIMEOUT`
How long to keep trying to reconnect.

- **Default:** `-1` (infinite, never give up)
- **Values:**
  - `-1` - Never give up (recommended for production)
  - `>0` - Give up after N milliseconds
- **Example:**
  ```javascript
  // Give up after 30 seconds
  const dealer = new Dealer({ config: { RECONNECTION_TIMEOUT: 30000 } })
  ```

#### `INFINITY`
Constant for infinite timeout.

- **Value:** `-1`
- **Example:**
  ```javascript
  import { ZMQConfigDefaults } from 'zeronode/transport/zeromq'
  
  const dealer = new Dealer({ 
    config: { 
      RECONNECTION_TIMEOUT: ZMQConfigDefaults.INFINITY 
    } 
  })
  ```

---

## Configuration Helpers

### View All Defaults

```javascript
import { ZMQConfigDefaults } from 'zeronode/transport/zeromq'

console.log(ZMQConfigDefaults)
```

### Merge with Defaults

```javascript
import { mergeConfig } from 'zeronode/transport/zeromq'

const config = mergeConfig({
  ZMQ_LINGER: 5000,
  ZMQ_SNDHWM: 50000
})
// Result: { ZMQ_LINGER: 5000, ZMQ_SNDHWM: 50000, ZMQ_RCVHWM: 10000, ... }
```

### Validate Configuration

```javascript
import { validateConfig } from 'zeronode/transport/zeromq'

try {
  validateConfig({
    ZMQ_LINGER: 5000,
    ioThreads: 4,
    expectedClients: 100
  })
  console.log('Config is valid!')
} catch (err) {
  console.error('Invalid config:', err.message)
}
```

### Create Preset Configurations

```javascript
import { createDealerConfig, createRouterConfig } from 'zeronode/transport/zeromq'

// Production dealer preset
const prodDealerConfig = createDealerConfig({
  ZMQ_LINGER: 5000,
  ZMQ_SNDHWM: 100000,
  RECONNECTION_TIMEOUT: 60000
})

// High-throughput router preset
const highPerfRouterConfig = createRouterConfig({
  ioThreads: 4,
  expectedClients: 200,
  ZMQ_SNDHWM: 500000,
  ZMQ_RCVHWM: 500000
})
```

---

## Common Configurations

### Development (Fast Shutdown, Debug)

```javascript
{
  ZMQ_LINGER: 0,
  debug: true,
  CONNECTION_TIMEOUT: 5000,
  RECONNECTION_TIMEOUT: 10000
}
```

### Production Client (Reliable)

```javascript
{
  ZMQ_LINGER: 5000,
  ZMQ_RECONNECT_IVL: 100,
  CONNECTION_TIMEOUT: -1,
  RECONNECTION_TIMEOUT: -1  // Never give up
}
```

### Production Server (High-Throughput)

```javascript
{
  ioThreads: 4,
  expectedClients: 100,
  ZMQ_LINGER: 5000,
  ZMQ_SNDHWM: 500000,
  ZMQ_RCVHWM: 500000
}
```

### Testing (Fast Timeouts)

```javascript
{
  ZMQ_LINGER: 0,
  CONNECTION_TIMEOUT: 1000,
  RECONNECTION_TIMEOUT: 5000,
  ZMQ_RECONNECT_IVL: 50
}
```

---

## Related

- [ZeroMQ Guide](http://zguide.zeromq.org/)
- [ZeroMQ Socket Options](http://api.zeromq.org/master:zmq-setsockopt)

