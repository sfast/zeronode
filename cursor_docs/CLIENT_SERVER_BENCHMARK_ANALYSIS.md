# Client-Server Benchmark Analysis 🔍

## Issue Found: ⚠️ **CRITICAL - Will Fail**

### Problem

The benchmark doesn't wait for the handshake to complete before sending requests!

**Current flow (Lines 76-87):**
```javascript
// Bind server
await server.bind(ADDRESS)
console.log(`✓ Server bound to ${ADDRESS}`)

// Connect client
await client.connect(ADDRESS)  // ← Resolves when transport is ready
console.log(`✓ Client connected to ${ADDRESS}`)

// Wait for connection to stabilize
await sleep(100)  // ← Not long enough for handshake!

// Immediately start sending requests
for (let i = 0; i < MESSAGES_PER_SIZE; i++) {
  await client.request({ ... })  // ← WILL FAIL!
}
```

### Why It Will Fail

1. **`client.connect()` resolves when transport is ready** (TCP connected)
2. **But `client.isReady()` returns `false`** until handshake completes
3. **`Protocol.request()` checks `isReady()`** (line 105):
   ```javascript
   if (!this.isReady()) {
     return Promise.reject(new ZeronodeError({ 
       code: ErrorCodes.SOCKET_ISNOT_ONLINE 
     }))
   }
   ```
4. **First requests will be rejected** with "Protocol is not ready"

### Handshake Flow (Reminder)

```
Client                          Server
  |                               |
  | connect() resolves            | bind() resolves
  | isReady() = FALSE ❌          | isReady() = TRUE ✅
  |                               |
  | Send CLIENT_CONNECTED         |
  |------------------------------>|
  |                               |
  |<-- CLIENT_CONNECTED (ACK) ----|
  |                               |
  | Extract server ID             |
  | isReady() = TRUE ✅           |
  | Emit CLIENT_READY             |
  |                               |
  |====== NOW CAN SEND REQUESTS ======|
```

---

## Required Fix

### Option 1: Wait for CLIENT_READY Event (Recommended) ✅

```javascript
// Bind server
await server.bind(ADDRESS)
console.log(`✓ Server bound to ${ADDRESS}`)

// Connect client
await client.connect(ADDRESS)
console.log(`✓ Client transport connected`)

// ✅ Wait for handshake to complete
await new Promise((resolve) => {
  client.once(events.CLIENT_READY, ({ serverId }) => {
    console.log(`✓ Client handshake complete (server: ${serverId})`)
    resolve()
  })
})

console.log(`✓ Client is ready (isReady: ${client.isReady()})`)

// NOW we can send requests!
for (let i = 0; i < MESSAGES_PER_SIZE; i++) {
  await client.request({ ... })  // ✅ Will work!
}
```

### Option 2: Poll client.isReady() (Alternative)

```javascript
await client.connect(ADDRESS)
console.log(`✓ Client transport connected`)

// Wait for handshake
let attempts = 0
while (!client.isReady() && attempts < 50) {
  await sleep(100)
  attempts++
}

if (!client.isReady()) {
  throw new Error('Client handshake timeout')
}

console.log(`✓ Client is ready`)
```

**Recommendation:** Use Option 1 (event-based) - it's cleaner and more reliable.

---

## Complete Fixed Benchmark

```javascript
import { Client, Server } from '../src/index.js'
import { events } from '../src/enum.js'  // ✅ Import events

// ... rest of code ...

async function runBenchmark(messageSize, testIndex) {
  const ADDRESS = getAddress(testIndex)
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Testing ${messageSize}-byte messages`)
  console.log(`Address: ${ADDRESS}`)
  console.log('='.repeat(60))

  // Create server
  const server = new Server({
    id: `server-${Date.now()}`,
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false
    }
  })

  // Create client
  const client = new Client({
    id: `client-${Date.now()}`,
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false
    }
  })

  // Track metrics
  let received = 0
  let startTime
  const latencies = []

  // Server: Handle ping requests and respond
  server.onRequest('ping', (data) => {
    return data // Echo back
  })

  try {
    // Bind server
    await server.bind(ADDRESS)
    console.log(`✓ Server bound to ${ADDRESS}`)

    // Connect client
    await client.connect(ADDRESS)
    console.log(`✓ Client transport connected`)

    // ✅ NEW: Wait for handshake to complete
    await new Promise((resolve) => {
      client.once(events.CLIENT_READY, ({ serverId }) => {
        console.log(`✓ Client handshake complete (server: ${serverId})`)
        resolve()
      })
    })

    console.log(`✓ Client is ready (isReady: ${client.isReady()})`)

    const payload = generatePayload(messageSize)
    console.log(`\nSending ${MESSAGES_PER_SIZE} messages of ${messageSize} bytes...`)

    startTime = Date.now()

    // Send messages in batches
    const BATCH_SIZE = 100
    const BATCH_DELAY = 1 // ms

    for (let i = 0; i < MESSAGES_PER_SIZE; i++) {
      const messageId = `msg-${i}`
      const sendTime = Date.now()

      try {
        await client.request({
          event: 'ping',
          data: { id: messageId, payload },
          timeout: 5000
        })

        // Calculate latency
        const latency = Date.now() - sendTime
        latencies.push(latency)
        received++

        // Add delay after each batch
        if ((i + 1) % BATCH_SIZE === 0) {
          await sleep(BATCH_DELAY)
        }
      } catch (err) {
        console.error(`Request ${i} failed:`, err.message)
      }
    }

    // ... rest of the benchmark ...
  } finally {
    // Cleanup
    await client.close()
    await sleep(200)
    await server.close()
    await sleep(500)
  }
}
```

---

## Changes Required

### File: `benchmark/client-server-baseline.js`

**Line 1-8: Add import**
```javascript
/**
 * Client-Server Baseline Benchmark
 * ...
 */

import { Client, Server } from '../src/index.js'
import { events } from '../src/enum.js'  // ✅ ADD THIS
```

**Line 76-84: Update connection sequence**
```javascript
// OLD:
await client.connect(ADDRESS)
console.log(`✓ Client connected to ${ADDRESS}`)

// Wait for connection to stabilize
await sleep(100)

// NEW:
await client.connect(ADDRESS)
console.log(`✓ Client transport connected`)

// ✅ Wait for handshake to complete
await new Promise((resolve) => {
  client.once(events.CLIENT_READY, ({ serverId }) => {
    console.log(`✓ Client handshake complete (server: ${serverId})`)
    resolve()
  })
})

console.log(`✓ Client is ready (isReady: ${client.isReady()})`)
```

---

## Testing Strategy

### Before Fix (Expected to Fail):
```bash
node benchmark/client-server-baseline.js

# Expected output:
# ❌ Request 0 failed: Protocol 'client-xxx' is not ready
# ❌ Request 1 failed: Protocol 'client-xxx' is not ready
# ... (many failures until handshake completes by chance)
```

### After Fix (Expected to Pass):
```bash
node benchmark/client-server-baseline.js

# Expected output:
# ✓ Server bound to tcp://127.0.0.1:5560
# ✓ Client transport connected
# ✓ Client handshake complete (server: server-xxx)
# ✓ Client is ready (isReady: true)
# Sending 10000 messages of 100 bytes...
# ✅ All messages successful
```

---

## Additional Improvements (Optional)

### 1. Add Handshake Timeout Protection

```javascript
// Wait for handshake with timeout
await Promise.race([
  new Promise((resolve) => {
    client.once(events.CLIENT_READY, ({ serverId }) => {
      console.log(`✓ Client handshake complete (server: ${serverId})`)
      resolve()
    })
  }),
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Handshake timeout')), 5000)
  })
])
```

### 2. Track Handshake Latency

```javascript
const handshakeStart = Date.now()

await new Promise((resolve) => {
  client.once(events.CLIENT_READY, ({ serverId }) => {
    const handshakeLatency = Date.now() - handshakeStart
    console.log(`✓ Client handshake complete in ${handshakeLatency}ms (server: ${serverId})`)
    resolve()
  })
})
```

---

## Summary

| Item | Status | Action |
|------|--------|--------|
| **Issue Identified** | ✅ | Benchmark doesn't wait for handshake |
| **Root Cause** | ✅ | `client.isReady()` returns false until handshake completes |
| **Impact** | ⚠️ | First requests will fail with "not ready" error |
| **Fix Required** | ✅ | Wait for `CLIENT_READY` event after `connect()` |
| **Lines to Change** | ~10 | Import events, update connection sequence |
| **Complexity** | Low | Simple event listener addition |

---

## How to Run (After Fix)

```bash
# Run the benchmark
npm run benchmark:client-server

# OR directly
node benchmark/client-server-baseline.js
```

**Expected Performance:**
- Throughput: 1,000-5,000 msg/s (includes full protocol overhead)
- Latency: 5-20ms (includes envelope parsing, request tracking, handshake)
- Success rate: 100% (all messages delivered)

---

## Conclusion

The benchmark **MUST be fixed** to wait for the `CLIENT_READY` event before sending requests. This is a direct consequence of our professional handshake implementation where:

✅ Transport ready ≠ Application ready  
✅ Client extracts server ID from handshake  
✅ `isReady()` enforces handshake completion  

The fix is simple and makes the benchmark correctly test the full Client-Server stack! 🚀

