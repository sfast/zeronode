# ZeroMQ Transport Configuration & Event Flow

Complete guide to configuring ZeroMQ transport and understanding how it affects your Router/Dealer layer and transport events.

---

## 📋 Table of Contents

1. [Configuration Architecture](#configuration-architecture)
2. [Native ZeroMQ Configurations](#native-zeromq-configurations)
3. [Application-Level Configurations](#application-level-configurations)
4. [Event Flow: ZMQ → Transport](#event-flow-zmq--transport)
5. [Reconnection Lifecycle](#reconnection-lifecycle)
6. [Configuration Examples](#configuration-examples)

---

## Configuration Architecture

There are **TWO configuration levels**:

```
┌─────────────────────────────────────────────────────────┐
│ APPLICATION LEVEL (Transport Layer)                     │
│ - CONNECTION_TIMEOUT                                     │
│ - RECONNECTION_TIMEOUT                                   │
│ - dealerIoThreads / routerIoThreads                     │
│ - logger, debug                                          │
└────────────────┬────────────────────────────────────────┘
                 │ Controls high-level behavior
                 ▼
┌─────────────────────────────────────────────────────────┐
│ NATIVE ZEROMQ LEVEL (Socket Options)                    │
│ - ZMQ_RECONNECT_IVL (how often to retry)               │
│ - ZMQ_RECONNECT_IVL_MAX (exponential backoff)          │
│ - ZMQ_LINGER (shutdown behavior)                        │
│ - ZMQ_SNDHWM / ZMQ_RCVHWM (message queues)             │
│ - ZMQ_ROUTER_MANDATORY, etc.                            │
└─────────────────────────────────────────────────────────┘
                 Native socket behavior
```

---

## Native ZeroMQ Configurations

These configure **ZeroMQ's native socket behavior**. They are passed directly to the ZeroMQ socket.

### 🔄 Reconnection Options (Dealer Only)

#### `ZMQ_RECONNECT_IVL` (default: `100`)
**How often ZeroMQ attempts to reconnect** after losing connection.

- **Unit**: Milliseconds
- **Default**: `100` (retry every 100ms)
- **Impact**: Faster = quicker reconnection, more CPU usage

```javascript
const dealer = new Dealer({
  config: {
    ZMQ_RECONNECT_IVL: 50  // Retry every 50ms (very fast)
  }
})
```

**Effect on Transport Events:**
- ⏱️ Affects **time between disconnect and READY event**
- 🔄 Does NOT affect whether READY fires (only when/how fast)

#### `ZMQ_RECONNECT_IVL_MAX` (default: `0`)
**Maximum reconnection interval** for exponential backoff.

- **Unit**: Milliseconds
- **Default**: `0` (no backoff, constant interval)
- **Values**:
  - `0` = constant interval (always use `ZMQ_RECONNECT_IVL`)
  - `>0` = exponential backoff up to this max

```javascript
const dealer = new Dealer({
  config: {
    ZMQ_RECONNECT_IVL: 100,       // Start at 100ms
    ZMQ_RECONNECT_IVL_MAX: 30000  // Max 30s
  }
})
// Pattern: 100ms → 200ms → 400ms → 800ms → ... → 30000ms
```

**Effect on Transport Events:**
- ⏱️ Affects **reconnection speed over time**
- 🔄 Long disconnects take longer to recover
- ✅ Good for external services (reduces load during outages)

---

### 💾 Message Queue Options

#### `ZMQ_SNDHWM` (default: `10000`)
**Send High Water Mark** - Max queued outgoing messages.

- **Unit**: Messages
- **Default**: `10,000`
- **Behavior**: When limit reached:
  - **Router**: Drops messages to that client
  - **Dealer**: Blocks or drops (depends on socket type)

```javascript
const router = new Router({
  config: {
    ZMQ_SNDHWM: 50000  // Queue up to 50k outgoing messages
  }
})
```

**Effect on Transport Events:**
- 🚫 **Does NOT emit events** when HWM reached
- 💥 May throw `SEND_FAILED` error when sending
- ⚠️ Messages may be silently dropped

#### `ZMQ_RCVHWM` (default: `10000`)
**Receive High Water Mark** - Max queued incoming messages.

- **Unit**: Messages
- **Default**: `10,000`
- **Behavior**: When limit reached, sender is blocked

```javascript
const dealer = new Dealer({
  config: {
    ZMQ_RCVHWM: 20000  // Queue up to 20k incoming messages
  }
})
```

**Effect on Transport Events:**
- 📨 **MESSAGE events may be delayed** if queue is full
- 🔄 Backpressure to sender

---

### 🛑 Shutdown Options

#### `ZMQ_LINGER` (default: `0`)
**How long to wait for unsent messages** when closing socket.

- **Unit**: Milliseconds
- **Default**: `0` (discard immediately, fast shutdown)
- **Values**:
  - `0` = discard unsent messages (recommended)
  - `-1` = wait forever (NOT recommended - can hang!)
  - `>0` = wait N milliseconds

```javascript
const dealer = new Dealer({
  config: {
    ZMQ_LINGER: 5000  // Wait 5s for unsent messages
  }
})
```

**Effect on Transport Events:**
- ⏱️ Affects **time to emit CLOSED event**
- 🛑 Long linger = slow shutdown

---

### 🏢 Router-Specific Options

#### `ZMQ_ROUTER_MANDATORY` (default: `undefined`)
**Fail when sending to unknown peer.**

- **Default**: `undefined` (ZeroMQ default: `false`)
- **Values**:
  - `false` = silently drop messages to unknown peers (production)
  - `true` = throw error (debugging)

```javascript
const router = new Router({
  config: {
    ZMQ_ROUTER_MANDATORY: true  // Strict mode - catch bugs
  }
})
```

**Effect on Transport Events:**
- 💥 May throw `SEND_FAILED` error
- 🚫 Does NOT emit events

#### `ZMQ_ROUTER_HANDOVER` (default: `undefined`)
**Allow identity takeover** from another router.

- **Default**: `undefined` (ZeroMQ default: `false`)
- **Use Case**: High-availability setups with multiple routers

```javascript
const router = new Router({
  config: {
    ZMQ_ROUTER_HANDOVER: true  // Allow HA failover
  }
})
```

**Effect on Transport Events:**
- 🔄 Enables seamless client reconnection to backup router
- ✅ Client emits READY immediately on takeover

---

## Application-Level Configurations

These configure **our transport layer's behavior** on top of ZeroMQ.

### ⏱️ Timeout Options

#### `CONNECTION_TIMEOUT` (default: `-1`)
**How long to wait** for initial connection.

- **Unit**: Milliseconds
- **Default**: `-1` (infinite, wait forever)
- **Values**:
  - `-1` = wait forever
  - `>0` = timeout after N milliseconds

```javascript
const dealer = new Dealer({
  config: {
    CONNECTION_TIMEOUT: 5000  // Give up after 5s
  }
})

await dealer.connect('tcp://127.0.0.1:5000')
// Throws CONNECTION_TIMEOUT error after 5s if can't connect
```

**Effect on Transport Events:**
- ❌ Throws `TransportError` with `CONNECTION_TIMEOUT` code
- 🚫 **NO READY event** if timeout expires
- 🔄 **NO reconnection** - this is for initial connection only

#### `RECONNECTION_TIMEOUT` (default: `-1`)
**How long to keep trying to reconnect** after losing connection.

- **Unit**: Milliseconds
- **Default**: `-1` (infinite, never give up)
- **Values**:
  - `-1` = never give up (recommended for production)
  - `>0` = give up after N milliseconds

```javascript
const dealer = new Dealer({
  config: {
    RECONNECTION_TIMEOUT: 30000  // Give up after 30s
  }
})
```

**Effect on Transport Events:**
- ✅ Emits **CLOSED event** when timeout expires
- 🔄 ZeroMQ stops trying to reconnect
- 💀 Transport is dead, must create new instance

---

### 🧵 Threading Options

#### `dealerIoThreads` (default: `1`)
**Number of I/O threads** for Dealer (client) sockets.

- **Default**: `1` (recommended for most clients)
- **Range**: `1-16`
- **Rule of thumb**: 1 thread per gigabit/sec

```javascript
const dealer = new Dealer({
  config: {
    dealerIoThreads: 2  // High-throughput client
  }
})
```

**Effect on Transport Events:**
- ⚡ Faster event processing with more threads
- 📈 Higher throughput

#### `routerIoThreads` (default: `2`)
**Number of I/O threads** for Router (server) sockets.

- **Default**: `2` (recommended for servers)
- **Range**: `1-16`
- **Recommendation**:
  - `1` = <10 clients
  - `2` = 10-50 clients (default)
  - `4+` = >50 clients or high throughput

```javascript
const router = new Router({
  config: {
    routerIoThreads: 4  // High-load server
  }
})
```

**Effect on Transport Events:**
- ⚡ More concurrent READY/MESSAGE events
- 📈 Better handling of multiple clients

---

## Event Flow: ZMQ → Transport

How native ZeroMQ events map to our transport events.

### Dealer (Client) Event Flow

```
ZeroMQ Native Event          Transport Event
─────────────────────       ─────────────────
socket.events.on('connect')  → TransportEvent.READY
  ↓ (setOnline() called first!)
  
socket.events.on('disconnect') → TransportEvent.NOT_READY
  ↓ (setOffline() called)
  ↓ (Start RECONNECTION_TIMEOUT timer)
  ↓
  ↓ ZeroMQ auto-reconnects in background...
  ↓ (every ZMQ_RECONNECT_IVL ms)
  ↓
socket.events.on('connect')  → TransportEvent.READY (again!)
  ↓ (Clear RECONNECTION_TIMEOUT timer)
  
OR

RECONNECTION_TIMEOUT expires → TransportEvent.CLOSED
  ↓ (Transport is dead)
```

### Router (Server) Event Flow

```
ZeroMQ Native Event          Transport Event
─────────────────────       ─────────────────
socket.events.on('listening') → TransportEvent.READY
  ↓ (Router is now accepting connections)
  
socket.events.on('accept')    → (no transport event)
  ↓ (Client connected, start receiving messages)

socket.events.on('close')     → TransportEvent.CLOSED
  ↓ (Router explicitly closed)
```

### Common Events (Both Dealer & Router)

```
ZeroMQ Native Event          Transport Event
─────────────────────       ─────────────────
socket receives message      → TransportEvent.MESSAGE
  ↓ { buffer, sender }

socket.events.on('close')    → TransportEvent.CLOSED
  ↓ (Explicit close)
```

---

## Reconnection Lifecycle

Complete lifecycle with state transitions and events.

### 1️⃣ Initial Connection

```javascript
const dealer = new Dealer({
  id: 'my-dealer',
  config: {
    CONNECTION_TIMEOUT: 5000,      // Give up after 5s
    ZMQ_RECONNECT_IVL: 100         // Retry every 100ms
  }
})

// State: DISCONNECTED
// isOnline(): false

await dealer.connect('tcp://127.0.0.1:5000')

// ↓ ZeroMQ tries to connect...
// ↓ Retries every 100ms (ZMQ_RECONNECT_IVL)
// ↓
// ✅ Connected!

// Event: TransportEvent.READY
// State: CONNECTED
// isOnline(): true
```

**If connection times out:**
```javascript
// ❌ After 5s (CONNECTION_TIMEOUT)
// Throws: TransportError { code: 'CONNECTION_TIMEOUT' }
// State: DISCONNECTED
// isOnline(): false
```

---

### 2️⃣ Connection Lost

```javascript
// ✅ Currently connected
// State: CONNECTED
// isOnline(): true

// 💥 Router crashes or network fails

// Event: TransportEvent.NOT_READY
// State: RECONNECTING
// isOnline(): false

// ↓ Start RECONNECTION_TIMEOUT timer
// ↓ ZeroMQ auto-reconnects in background
// ↓ Retries every ZMQ_RECONNECT_IVL (100ms)
```

---

### 3️⃣ Automatic Reconnection (Success)

```javascript
// State: RECONNECTING
// isOnline(): false

// ↓ ZeroMQ keeps trying...
// ↓ Router comes back online
// ↓
// ✅ Reconnected!

// Event: TransportEvent.READY (again!)
// State: CONNECTED
// isOnline(): true

// ↓ Clear RECONNECTION_TIMEOUT timer
// ↓ Ready to send/receive again
```

---

### 4️⃣ Automatic Reconnection (Failure)

```javascript
// State: RECONNECTING
// isOnline(): false
// Config: { RECONNECTION_TIMEOUT: 30000 }

// ↓ ZeroMQ keeps trying...
// ↓ 30 seconds pass...
// ↓ Router never comes back
// ↓
// ❌ RECONNECTION_TIMEOUT expires

// Event: TransportEvent.CLOSED
// State: DISCONNECTED
// isOnline(): false

// ⚠️ Transport is DEAD
// ⚠️ Must create new Dealer instance to reconnect
```

---

## Configuration Examples

### Production Client (Never Give Up)

```javascript
const dealer = new Dealer({
  id: 'production-client',
  config: {
    // ZeroMQ Native
    ZMQ_RECONNECT_IVL: 100,         // Fast reconnection
    ZMQ_RECONNECT_IVL_MAX: 0,       // No backoff
    ZMQ_LINGER: 0,                  // Fast shutdown
    ZMQ_SNDHWM: 50000,              // Large queue
    ZMQ_RCVHWM: 50000,
    
    // Application Level
    CONNECTION_TIMEOUT: -1,          // Wait forever for initial
    RECONNECTION_TIMEOUT: -1,        // Never give up reconnecting
    dealerIoThreads: 1,              // Standard client
    
    // Logging
    debug: false,
    logger: myWinstonLogger
  }
})

dealer.on(TransportEvent.READY, () => {
  console.log('✅ Connected!')
})

dealer.on(TransportEvent.NOT_READY, () => {
  console.log('❌ Lost connection, reconnecting...')
})

// This will NEVER fire with RECONNECTION_TIMEOUT: -1
dealer.on(TransportEvent.CLOSED, () => {
  console.log('💀 Transport is dead')
})

await dealer.connect('tcp://production-server:5000')
```

---

### Production Server (High-Throughput)

```javascript
const router = new Router({
  id: 'production-server',
  config: {
    // ZeroMQ Native
    ZMQ_LINGER: 5000,                // Wait 5s for unsent messages
    ZMQ_SNDHWM: 100000,              // Huge queue for many clients
    ZMQ_RCVHWM: 100000,
    ZMQ_ROUTER_MANDATORY: false,     // Drop messages to unknown clients
    
    // Application Level
    routerIoThreads: 4,              // High throughput
    
    // Logging
    debug: false,
    logger: myWinstonLogger
  }
})

router.on(TransportEvent.READY, () => {
  console.log('✅ Server listening!')
})

router.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
  console.log(`📨 Message from ${sender.toString('hex')}`)
  // Process message...
})

await router.bind('tcp://*:5000')
```

---

### Testing Client (Fast Timeouts)

```javascript
const dealer = new Dealer({
  id: 'test-client',
  config: {
    // ZeroMQ Native
    ZMQ_RECONNECT_IVL: 50,           // Very fast for tests
    ZMQ_RECONNECT_IVL_MAX: 0,
    ZMQ_LINGER: 0,
    
    // Application Level
    CONNECTION_TIMEOUT: 1000,         // Give up fast
    RECONNECTION_TIMEOUT: 5000,       // Give up after 5s
    dealerIoThreads: 1,
    
    // Logging
    debug: true
  }
})
```

---

### External Service Client (Exponential Backoff)

```javascript
const dealer = new Dealer({
  id: 'external-client',
  config: {
    // ZeroMQ Native - Be gentle on external services
    ZMQ_RECONNECT_IVL: 1000,         // Start at 1s
    ZMQ_RECONNECT_IVL_MAX: 60000,    // Max 60s between retries
    ZMQ_LINGER: 0,
    
    // Application Level
    CONNECTION_TIMEOUT: 10000,        // 10s for initial
    RECONNECTION_TIMEOUT: 300000,     // 5 minutes total
    dealerIoThreads: 1
  }
})

// Backoff pattern: 1s → 2s → 4s → 8s → 16s → 32s → 60s → 60s → ...
```

---

## Summary: Config Impact on Events

| Configuration | Affects | Events Impacted |
|---------------|---------|-----------------|
| `ZMQ_RECONNECT_IVL` | How fast ZMQ retries | Time to READY after NOT_READY |
| `ZMQ_RECONNECT_IVL_MAX` | Backoff behavior | Time to READY (increases over time) |
| `ZMQ_LINGER` | Shutdown delay | Time to CLOSED |
| `ZMQ_SNDHWM` | Send queue | May cause SEND_FAILED errors |
| `ZMQ_RCVHWM` | Receive queue | May delay MESSAGE events |
| `CONNECTION_TIMEOUT` | Initial connect timeout | Throws error, no READY |
| `RECONNECTION_TIMEOUT` | Reconnect timeout | Emits CLOSED when expires |
| `dealerIoThreads` | Processing speed | Faster event processing |
| `routerIoThreads` | Processing speed | Faster event processing |

---

## Key Takeaways

1. **ZeroMQ handles reconnection automatically** - You don't need to do anything!
2. **`ZMQ_RECONNECT_IVL`** controls **how fast** it reconnects
3. **`RECONNECTION_TIMEOUT`** controls **how long** it keeps trying
4. **READY** = connected and online (can send/receive)
5. **NOT_READY** = disconnected but reconnecting
6. **CLOSED** = gave up or explicitly closed (dead transport)
7. **Set `RECONNECTION_TIMEOUT: -1` in production** to never give up
8. **Most defaults are production-ready** - only tune if needed!

---

## Common Patterns

### Pattern 1: Resilient Client
```javascript
RECONNECTION_TIMEOUT: -1  // Never give up
ZMQ_RECONNECT_IVL: 100   // Fast reconnection
```

### Pattern 2: Fast-Failing Test
```javascript
CONNECTION_TIMEOUT: 1000
RECONNECTION_TIMEOUT: 5000
ZMQ_RECONNECT_IVL: 50
```

### Pattern 3: Gentle External Service
```javascript
ZMQ_RECONNECT_IVL: 1000
ZMQ_RECONNECT_IVL_MAX: 60000  // Exponential backoff
RECONNECTION_TIMEOUT: 300000
```

### Pattern 4: High-Throughput Server
```javascript
routerIoThreads: 4
ZMQ_SNDHWM: 100000
ZMQ_RCVHWM: 100000
```

