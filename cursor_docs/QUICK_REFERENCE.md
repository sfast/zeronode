# ZeroMQ Transport Quick Reference

## 🎯 Configuration Cheat Sheet

### Dealer (Client) Configuration

```javascript
import { Dealer, ZMQConfigDefaults } from './transport/zeromq/index.js'

const dealer = new Dealer({
  id: 'my-dealer',
  config: {
    // === RECONNECTION (Native ZMQ) ===
    ZMQ_RECONNECT_IVL: 100,          // Retry every 100ms
    ZMQ_RECONNECT_IVL_MAX: 0,        // No exponential backoff
    
    // === TIMEOUTS (Application) ===
    CONNECTION_TIMEOUT: -1,           // -1 = infinite
    RECONNECTION_TIMEOUT: -1,         // -1 = never give up
    
    // === PERFORMANCE ===
    dealerIoThreads: 1,               // 1 thread = standard client
    ZMQ_SNDHWM: 10000,               // Send queue: 10k messages
    ZMQ_RCVHWM: 10000,               // Receive queue: 10k messages
    
    // === SHUTDOWN ===
    ZMQ_LINGER: 0,                   // 0 = discard unsent, fast shutdown
    
    // === LOGGING ===
    debug: false,
    logger: console                   // Or winston/pino/bunyan
  }
})
```

### Router (Server) Configuration

```javascript
import { Router } from './transport/zeromq/index.js'

const router = new Router({
  id: 'my-router',
  config: {
    // === PERFORMANCE ===
    routerIoThreads: 2,               // 2 threads = standard server
    ZMQ_SNDHWM: 10000,               // Send queue per client
    ZMQ_RCVHWM: 10000,               // Receive queue total
    
    // === ROUTER-SPECIFIC ===
    ZMQ_ROUTER_MANDATORY: false,      // false = drop to unknown clients
    ZMQ_ROUTER_HANDOVER: false,       // false = no HA handover
    
    // === SHUTDOWN ===
    ZMQ_LINGER: 0,                   // 0 = fast shutdown
    
    // === LOGGING ===
    debug: false,
    logger: console
  }
})
```

---

## 🔄 Event Flow Diagram

```
DEALER (Client)                          ROUTER (Server)
───────────────                          ───────────────

Initial State:                           Initial State:
  DISCONNECTED                             DISCONNECTED
  isOnline: false                          isOnline: false
       ↓                                        ↓
  connect()                                 bind()
       ↓                                        ↓
  [ZMQ: connect event]                     [ZMQ: listening event]
       ↓                                        ↓
  emit(READY) ✅                            emit(READY) ✅
  CONNECTED                                 CONNECTED
  isOnline: true                            isOnline: true
       ↓                                        ↓
       │                                        │
  ┌────▼────────────────────┐            ┌─────▼─────────────────┐
  │  Can send/receive ✅     │            │  Can send/receive ✅   │
  └────┬────────────────────┘            └─────┬─────────────────┘
       │                                        │
       │                                        │
  💥 Connection Lost                        [explicit unbind()]
       ↓                                        ↓
  [ZMQ: disconnect event]                  [ZMQ: close event]
       ↓                                        ↓
  emit(NOT_READY) ❌                        emit(CLOSED) 💀
  RECONNECTING                              DISCONNECTED
  isOnline: false                           isOnline: false
       ↓
       │
  ┌────▼───────────────────────────┐
  │ ZMQ Auto-Reconnect (background)│
  │ Retry every ZMQ_RECONNECT_IVL  │
  │                                 │
  │ Start RECONNECTION_TIMEOUT      │
  └────┬───────────────────┬────────┘
       │                   │
       │ Success           │ Timeout
       ↓                   ↓
  [ZMQ: connect event]    emit(CLOSED) 💀
       ↓                   DISCONNECTED
  emit(READY) ✅           isOnline: false
  CONNECTED                Must recreate!
  isOnline: true
```

---

## ⚡ Quick Config Recipes

### 1. Production Client (Resilient)
```javascript
{
  CONNECTION_TIMEOUT: -1,           // Never timeout initial
  RECONNECTION_TIMEOUT: -1,         // Never give up
  ZMQ_RECONNECT_IVL: 100,          // Fast retry
  ZMQ_LINGER: 0                    // Fast shutdown
}
```

### 2. Testing (Fast Failure)
```javascript
{
  CONNECTION_TIMEOUT: 1000,         // 1s
  RECONNECTION_TIMEOUT: 5000,       // 5s
  ZMQ_RECONNECT_IVL: 50,           // Very fast
  ZMQ_LINGER: 0
}
```

### 3. External Service (Polite)
```javascript
{
  CONNECTION_TIMEOUT: 10000,        // 10s
  RECONNECTION_TIMEOUT: 300000,     // 5 minutes
  ZMQ_RECONNECT_IVL: 1000,         // Start at 1s
  ZMQ_RECONNECT_IVL_MAX: 60000,    // Max 60s (exponential)
  ZMQ_LINGER: 5000                 // Wait for unsent
}
```

### 4. High-Throughput Server
```javascript
{
  routerIoThreads: 4,              // More threads
  ZMQ_SNDHWM: 100000,              // Large queues
  ZMQ_RCVHWM: 100000,
  ZMQ_LINGER: 5000                 // Wait for unsent
}
```

---

## 📊 Config Impact Table

| Config | Default | Impact | Events |
|--------|---------|--------|--------|
| `ZMQ_RECONNECT_IVL` | `100` | ⏱️ Reconnection speed | Time to READY |
| `ZMQ_RECONNECT_IVL_MAX` | `0` | 📈 Backoff behavior | Time to READY (grows) |
| `ZMQ_LINGER` | `0` | 🛑 Shutdown delay | Time to CLOSED |
| `ZMQ_SNDHWM` | `10000` | 📤 Send queue | SEND_FAILED errors |
| `ZMQ_RCVHWM` | `10000` | 📥 Receive queue | MESSAGE delays |
| `CONNECTION_TIMEOUT` | `-1` | ⏱️ Initial connect | Throws error |
| `RECONNECTION_TIMEOUT` | `-1` | ⏱️ Reconnect attempts | Emits CLOSED |
| `dealerIoThreads` | `1` | ⚡ Client speed | Event processing |
| `routerIoThreads` | `2` | ⚡ Server speed | Event processing |

---

## 🎓 Key Concepts

### Native ZMQ vs Application Level

```
┌─────────────────────────────────────┐
│ APPLICATION LEVEL                   │
│ - High-level behavior               │
│ - Timeouts (CONNECTION, RECONNECT)  │
│ - Threading (dealerIo, routerIo)    │
│ - Logging, debugging                │
└─────────────┬───────────────────────┘
              │ Controls
              ▼
┌─────────────────────────────────────┐
│ NATIVE ZEROMQ                       │
│ - Socket options (ZMQ_*)            │
│ - Automatic reconnection            │
│ - Message queuing (HWM)             │
│ - Backoff (RECONNECT_IVL_MAX)      │
└─────────────────────────────────────┘
```

### Event Meaning

- **READY** = Connected, online, can send/receive ✅
- **NOT_READY** = Disconnected, reconnecting... 🔄
- **CLOSED** = Dead, gave up or explicitly closed 💀
- **MESSAGE** = Received data 📨

### States

- **DISCONNECTED** = Not connected yet (initial or gave up)
- **CONNECTED** = Connected and working
- **RECONNECTING** = Lost connection, trying to reconnect

### Important Rules

1. **ZMQ reconnects automatically** - you don't need to do anything!
2. **RECONNECTION_TIMEOUT: -1** = never give up (production default)
3. **Can only send when isOnline() = true**
4. **CLOSED event = transport is dead**, must recreate
5. **NOT_READY → READY** = successful reconnection
6. **NOT_READY → CLOSED** = failed reconnection (timeout)

---

## 🚀 Usage Pattern

```javascript
import { Dealer, TransportEvent } from './transport/zeromq/index.js'

// Create
const dealer = new Dealer({ 
  id: 'my-dealer',
  config: { /* ... */ }
})

// Listen
dealer.on(TransportEvent.READY, () => {
  console.log('✅ Connected!')
})

dealer.on(TransportEvent.NOT_READY, () => {
  console.log('❌ Lost connection, reconnecting...')
})

dealer.on(TransportEvent.CLOSED, () => {
  console.log('💀 Gave up reconnecting')
})

dealer.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
  console.log('📨 Received:', buffer)
})

// Connect
await dealer.connect('tcp://127.0.0.1:5000')

// Send (only when online!)
if (dealer.isOnline()) {
  dealer.sendBuffer(Buffer.from('Hello'))
}

// Cleanup
await dealer.close()
```

---

## ❓ FAQ

**Q: When should I use CONNECTION_TIMEOUT?**  
A: Only for initial connection. Use `-1` in production (wait forever).

**Q: When should I use RECONNECTION_TIMEOUT?**  
A: Use `-1` in production (never give up). Use finite timeout only for testing or when you want to fail over to alternative connection.

**Q: What's the difference between NOT_READY and CLOSED?**  
A: `NOT_READY` = temporary loss, still trying to reconnect. `CLOSED` = permanent failure, transport is dead.

**Q: Can I send messages when NOT_READY?**  
A: No! Check `isOnline()` before sending. It will throw `SEND_FAILED` error.

**Q: How do I make reconnection faster?**  
A: Lower `ZMQ_RECONNECT_IVL` (e.g., `50` instead of `100`).

**Q: Should I use exponential backoff?**  
A: Yes for external services (`ZMQ_RECONNECT_IVL_MAX > 0`). No for internal services (`ZMQ_RECONNECT_IVL_MAX: 0`).

**Q: How many I/O threads should I use?**  
A: `dealerIoThreads: 1` for clients, `routerIoThreads: 2` for servers. Only increase for high throughput (>100K msg/s).

---

## 📖 See Also

- [CONFIGURATION_GUIDE.md](./CONFIGURATION_GUIDE.md) - Detailed documentation
- [CONFIG_REFERENCE.md](../../../cursor_docs/CONFIG_REFERENCE.md) - All config options
- [RECONNECTION_ANALYSIS.md](../../../RECONNECTION_ANALYSIS.md) - Reconnection deep dive

