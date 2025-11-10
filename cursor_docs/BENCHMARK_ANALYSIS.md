# Benchmark Analysis & Fixes Required 🔍

## Available Benchmarks

### 1. `router-dealer-baseline.js` ⚠️ **NEEDS FIX**
- **Tests:** RouterSocket and DealerSocket (transport layer)
- **Issue:** Uses old `'message'` event instead of `TransportEvent.MESSAGE`
- **Lines to fix:** 105, 112

### 2. `client-server-baseline.js` ✅ **SHOULD WORK**
- **Tests:** Client and Server (application layer)
- **Should work** with new handshake flow
- **May need:** Wait for `CLIENT_READY` event instead of immediate connection

### 3. `zeromq-baseline.js` ✅ **OK**
- **Tests:** Pure ZeroMQ (no wrappers)
- **No changes needed**

---

## Required Fixes

### Fix: `router-dealer-baseline.js`

**Line 105-109:**
```javascript
// OLD:
router.on('message', ({ buffer }) => {
  router.sendBuffer(buffer, dealer.getId())
  metrics.echoed++
})

// NEW:
import { TransportEvent } from '../src/transport-events.js'

router.on(TransportEvent.MESSAGE, ({ buffer }) => {
  router.sendBuffer(buffer, dealer.getId())
  metrics.echoed++
})
```

**Line 112-120:**
```javascript
// OLD:
dealer.on('message', ({ buffer }) => {
  const msgId = metrics.received
  const resolve = pendingMessages.get(msgId)
  if (resolve) {
    pendingMessages.delete(msgId)
    resolve()
  }
  metrics.received++
})

// NEW:
dealer.on(TransportEvent.MESSAGE, ({ buffer }) => {
  const msgId = metrics.received
  const resolve = pendingMessages.get(msgId)
  if (resolve) {
    pendingMessages.delete(msgId)
    resolve()
  }
  metrics.received++
})
```

---

## Benchmark Priority

**For testing Router/Dealer transport layer:**
1. ✅ `router-dealer-baseline.js` (after fix)

**For testing Client/Server application layer:**
2. ✅ `client-server-baseline.js`

**For pure ZeroMQ comparison:**
3. ✅ `zeromq-baseline.js`

---

## How to Run

### Option 1: Router-Dealer (Transport Layer)
```bash
npm run benchmark:router-dealer
# OR
node benchmark/router-dealer-baseline.js
```

### Option 2: Client-Server (Application Layer)
```bash
npm run benchmark:client-server
# OR
node benchmark/client-server-baseline.js
```

### Option 3: All Benchmarks
```bash
npm run benchmark
```

---

## Expected Results

### Router-Dealer Benchmark:
- **Throughput:** ~20,000-40,000 msg/sec
- **Latency:** 0.5-2ms (mean)
- **Overhead:** Minimal (thin wrapper)

### Client-Server Benchmark:
- **Throughput:** ~10,000-20,000 msg/sec
- **Latency:** 5-10ms (mean)
- **Includes:** Handshake, envelope parsing, protocol handling

