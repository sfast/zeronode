# ZeroMQ 6 Compliance & Best Practices

This document explains how our Zeronode implementation follows ZeroMQ 6 best practices for reliability, performance, and correctness.

---

## **Core Principle: Trust ZeroMQ's Automatic Reconnection** ✅

**Our Approach:**
- ✅ We **DO NOT** implement manual reconnection logic
- ✅ We **DO** monitor ZeroMQ events (CONNECT, DISCONNECT)
- ✅ We **DO** let ZeroMQ handle the actual reconnection

**Why This Is Correct:**
ZeroMQ (v6) has sophisticated automatic reconnection built-in. When a DEALER socket loses connection to a ROUTER, ZeroMQ will:
1. Detect the disconnection
2. Emit a `DISCONNECT` event
3. Automatically attempt to reconnect at configured intervals
4. Emit a `CONNECT` event when reconnection succeeds

**Our implementation listens to these events and manages application state accordingly, without interfering with ZeroMQ's internal mechanisms.**

---

## **Socket Options Configured (ZeroMQ 6 Best Practices)**

### **DealerSocket Configuration**

```javascript
// Reconnection behavior
socket.reconnectInterval = 100           // How often to retry (default: 100ms)
socket.reconnectMaxInterval = 0          // Max interval for exponential backoff (0 = no backoff)

// Clean shutdown
socket.linger = 0                        // Discard unsent messages immediately on close

// Backpressure management
socket.sendHighWaterMark = 1000          // Max queued outgoing messages
socket.receiveHighWaterMark = 1000       // Max queued incoming messages

// Optional timeouts (if configured)
socket.sendTimeout = <config>            // Max time for send operation
socket.receiveTimeout = <config>         // Max time for receive operation
```

### **RouterSocket Configuration**

```javascript
// Clean shutdown
socket.linger = 0                        // Discard unsent messages immediately on close

// Backpressure management (per peer)
socket.sendHighWaterMark = 1000          // Max queued outgoing messages per client
socket.receiveHighWaterMark = 1000       // Max queued incoming messages per client

// Error handling
socket.mandatory = <config>              // Fail on send to unknown peer (default: false)

// Optional timeouts (if configured)
socket.sendTimeout = <config>            // Max time for send operation
socket.receiveTimeout = <config>         // Max time for receive operation
```

---

## **Socket Option Details**

### **1. `reconnectInterval` (Dealer only)**
- **Purpose:** How often ZeroMQ attempts to reconnect after disconnection
- **Default:** 100ms
- **Our Default:** 100ms (matches ZeroMQ default)
- **When to Adjust:**
  - Lower (e.g., 50ms) → Faster reconnection, more aggressive
  - Higher (e.g., 500ms) → Less aggressive, reduces network load

**Example:**
```javascript
const dealer = new DealerSocket({
  config: {
    ZMQ_RECONNECT_IVL: 200  // Retry every 200ms
  }
})
```

---

### **2. `reconnectMaxInterval` (Dealer only)**
- **Purpose:** Maximum reconnection interval for exponential backoff
- **Default:** 0 (no exponential backoff)
- **Our Default:** 0
- **When to Adjust:**
  - Set > 0 (e.g., 30000) to implement exponential backoff
  - Useful for reducing load when router is down for extended periods

**Example:**
```javascript
const dealer = new DealerSocket({
  config: {
    ZMQ_RECONNECT_IVL: 100,        // Start at 100ms
    ZMQ_RECONNECT_IVL_MAX: 30000   // Max out at 30s (100ms → 200ms → 400ms ... → 30s)
  }
})
```

---

### **3. `linger` (Dealer & Router)**
- **Purpose:** How long to keep unsent messages after socket close
- **Default:** 0 (discard immediately)
- **Our Default:** 0 (fast shutdown)
- **Options:**
  - `0` → Discard unsent messages, close immediately ✅ (recommended)
  - `-1` → Wait forever for messages to be sent (dangerous!)
  - `> 0` → Wait N milliseconds, then close

**Why We Use 0:**
- Fast, clean shutdown
- Prevents zombie processes waiting for unreachable peers
- Application can implement its own retry logic if needed

**Example:**
```javascript
const dealer = new DealerSocket({
  config: {
    ZMQ_LINGER: 5000  // Wait 5 seconds for unsent messages before closing
  }
})
```

---

### **4. `sendHighWaterMark` & `receiveHighWaterMark` (Dealer & Router)**
- **Purpose:** Maximum number of messages queued in memory
- **Default:** 1000 messages
- **Our Default:** 1000
- **Behavior When Reached:**
  - For **DEALER/ROUTER**: Send operations **block** until queue has space
  - Prevents memory exhaustion under load

**When to Adjust:**
- **Higher (e.g., 10000):** More memory, handles bursts better
- **Lower (e.g., 100):** Less memory, faster backpressure

**Example:**
```javascript
const dealer = new DealerSocket({
  config: {
    ZMQ_SNDHWM: 10000,  // Queue up to 10,000 outgoing messages
    ZMQ_RCVHWM: 10000   // Queue up to 10,000 incoming messages
  }
})
```

---

### **5. `sendTimeout` & `receiveTimeout` (Dealer & Router)**
- **Purpose:** Maximum time to wait for send/receive operations
- **Default:** -1 (infinite wait)
- **Our Default:** Not set (uses ZeroMQ default)
- **Options:**
  - `-1` → Wait forever (default, blocking)
  - `0` → Non-blocking (return immediately if can't complete)
  - `> 0` → Wait N milliseconds, then timeout

**When to Use:**
- Set `sendTimeout` to prevent send operations from blocking forever
- Set `receiveTimeout` for request/response patterns with timeouts

**Example:**
```javascript
const dealer = new DealerSocket({
  config: {
    ZMQ_SNDTIMEO: 5000,  // Send operations timeout after 5s
    ZMQ_RCVTIMEO: 10000  // Receive operations timeout after 10s
  }
})
```

---

### **6. `mandatory` (Router only)**
- **Purpose:** Fail when sending to unknown peer
- **Default:** false (silently drop)
- **Our Default:** Not set (uses ZeroMQ default)
- **Behavior:**
  - `false` → Silently drop messages to unknown peers
  - `true` → Throw error when sending to unknown peer

**When to Use:**
- Set `true` for debugging (detect routing errors)
- Set `false` for production (graceful handling of disconnected clients)

**Example:**
```javascript
const router = new RouterSocket({
  config: {
    ZMQ_ROUTER_MANDATORY: true  // Fail loudly on unknown peer
  }
})
```

---

## **Connection Lifecycle (DealerSocket)**

### **Normal Flow:**
```
1. connect() called
   ↓
2. ZeroMQ attempts connection
   ↓
3. CONNECT event → socket is online
   ↓
4. Application sends/receives messages
   ↓
5. Network failure → DISCONNECT event
   ↓
6. ZeroMQ automatically attempts reconnection
   (every `reconnectInterval` milliseconds)
   ↓
7. CONNECT event → socket is back online
   ↓
8. Repeat from step 4
```

### **Timeout Scenarios:**

#### **Connection Timeout:**
```
1. connect() called with timeout=5000
   ↓
2. ZeroMQ attempts connection
   ↓
3. After 5000ms, no CONNECT event
   ↓
4. Connection timeout error thrown
   ↓
5. disconnect() called for cleanup
```

#### **Reconnection Timeout:**
```
1. Socket connected, then DISCONNECT event
   ↓
2. ZeroMQ attempts reconnection
   ↓
3. After `RECONNECTION_TIMEOUT` ms, no CONNECT event
   ↓
4. RECONNECT_FAILURE event emitted
   ↓
5. disconnect() called (give up)
```

---

## **Error Handling**

### **EAGAIN Errors (Future Enhancement)**
ZeroMQ returns `EAGAIN` errors for non-blocking operations when they would block. We currently don't handle these explicitly because:
- Our async/await pattern is naturally non-blocking
- The underlying ZeroMQ v6 Node.js bindings handle this internally

**If needed in the future:**
```javascript
try {
  await socket.send(message)
} catch (err) {
  if (err.code === 'EAGAIN') {
    // Would block, try again later
    await delay(10)
    await socket.send(message)
  }
}
```

---

## **Best Practices We Follow**

### ✅ **DO:**
1. **Let ZeroMQ handle reconnection** - Don't implement manual reconnection
2. **Monitor socket events** - Listen to CONNECT/DISCONNECT for state management
3. **Set linger = 0** - Fast shutdown, no zombie processes
4. **Set HWM appropriately** - Prevent memory exhaustion
5. **Use timeouts** - Don't wait forever for operations
6. **Clean up on disconnect** - Remove event listeners, clear timeouts

### ❌ **DON'T:**
1. **Don't manually reconnect** - ZeroMQ does this automatically
2. **Don't share sockets between threads** - ZeroMQ sockets are NOT thread-safe
3. **Don't set linger = -1** - Can cause shutdown hangs
4. **Don't ignore DISCONNECT events** - Important for state management
5. **Don't forget to close sockets** - Leads to resource leaks

---

## **Configuration Examples**

### **Development (Fast reconnection, verbose errors):**
```javascript
const dealer = new DealerSocket({
  config: {
    ZMQ_RECONNECT_IVL: 50,           // Retry every 50ms
    ZMQ_LINGER: 0,                   // Fast shutdown
    ZMQ_SNDHWM: 100,                 // Small queue (catch issues early)
    ZMQ_RCVHWM: 100,
    CONNECTION_TIMEOUT: 5000,        // 5s connection timeout
    RECONNECTION_TIMEOUT: 10000      // 10s reconnection timeout
  }
})

const router = new RouterSocket({
  config: {
    ZMQ_ROUTER_MANDATORY: true,      // Fail on unknown peer (debugging)
    ZMQ_LINGER: 0,
    ZMQ_SNDHWM: 100,
    ZMQ_RCVHWM: 100
  }
})
```

### **Production (Resilient, optimized):**
```javascript
const dealer = new DealerSocket({
  config: {
    ZMQ_RECONNECT_IVL: 100,          // Standard retry interval
    ZMQ_RECONNECT_IVL_MAX: 30000,    // Max 30s (exponential backoff)
    ZMQ_LINGER: 0,                   // Fast shutdown
    ZMQ_SNDHWM: 10000,               // Large queue for bursts
    ZMQ_RCVHWM: 10000,
    CONNECTION_TIMEOUT: 30000,       // 30s connection timeout
    RECONNECTION_TIMEOUT: 300000     // 5min reconnection timeout (or Infinity)
  }
})

const router = new RouterSocket({
  config: {
    ZMQ_ROUTER_MANDATORY: false,     // Graceful handling (production)
    ZMQ_LINGER: 0,
    ZMQ_SNDHWM: 10000,
    ZMQ_RCVHWM: 10000
  }
})
```

---

## **Testing Reconnection**

### **Test Script:**
```javascript
// Start server
const server = new Server({ bind: 'tcp://127.0.0.1:5000', config: {...} })
await server.bind()

// Connect client
const client = new Client({ config: {...} })
await client.connect('tcp://127.0.0.1:5000')

// Simulate network failure
await server.unbind()

// Client should emit CONNECTION_LOST event
// ZeroMQ will keep trying to reconnect

// Bring server back
await server.bind()

// Client should emit CONNECTION_RESTORED event
// Messages should flow again
```

---

## **Summary**

Our implementation follows **ZeroMQ 6 best practices** by:
1. ✅ Trusting ZeroMQ's automatic reconnection
2. ✅ Configuring socket options for optimal behavior
3. ✅ Monitoring events without interfering
4. ✅ Implementing clean shutdown with linger=0
5. ✅ Managing backpressure with HWM
6. ✅ Supporting configurable timeouts

**Result:** Production-grade, resilient, ZeroMQ-compliant networking! 🚀

