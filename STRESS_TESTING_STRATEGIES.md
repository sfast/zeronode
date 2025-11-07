# Stress Testing Strategies for Client-Server Architecture

## 🎯 Goal
Fire requests concurrently (not sequentially) to measure true throughput potential and identify bottlenecks under load.

## 🚫 Current Problem (Sequential Pattern)

```javascript
// Current benchmark - SEQUENTIAL (line 167-184)
for (let i = 0; i < 10000; i++) {
  await client.request(...)  // ⚠️ BLOCKING: Only 1 in-flight
}

// Result: Throughput = 1 / latency
// Example: 0.63ms latency → Max 1,587 msg/s
```

**Problem:** Throughput capped at `1/latency`, doesn't test system under real load.

---

## ✅ Stress Testing Approaches

### **Option 1: Unlimited Concurrency (Fire All At Once)** 🔥

**Pattern: Promise.all()**
```javascript
// Fire all requests immediately, wait for all to complete
const promises = []

metrics.startTime = performance.now()

for (let i = 0; i < 10000; i++) {
  const promise = client.request({
    event: 'ping',
    data: testPayload,
    timeout: 5000
  })
  promises.push(promise)
}

// Wait for all responses
const results = await Promise.all(promises)

metrics.endTime = performance.now()
```

**Pros:**
- ✅ Maximum throughput test
- ✅ Simple implementation
- ✅ Tests system limits

**Cons:**
- ⚠️ Can overwhelm system (10K promises at once)
- ⚠️ High memory usage (10K pending requests)
- ⚠️ May trigger timeouts if server can't keep up
- ⚠️ Unrealistic load pattern (no real client fires 10K at once)

**Use Case:** Finding absolute maximum throughput

---

### **Option 2: Controlled Concurrency (Semaphore)** ⭐ RECOMMENDED

**Pattern: Limit in-flight requests**
```javascript
class Semaphore {
  constructor(max) {
    this.max = max
    this.count = 0
    this.queue = []
  }

  async acquire() {
    if (this.count < this.max) {
      this.count++
      return Promise.resolve()
    }

    return new Promise(resolve => this.queue.push(resolve))
  }

  release() {
    this.count--
    if (this.queue.length > 0) {
      this.count++
      const resolve = this.queue.shift()
      resolve()
    }
  }
}

// Stress test with controlled concurrency
const CONCURRENCY = 100  // Max 100 in-flight requests
const semaphore = new Semaphore(CONCURRENCY)

metrics.startTime = performance.now()

const promises = Array.from({ length: 10000 }, async (_, i) => {
  await semaphore.acquire()
  
  const sendTime = performance.now()
  
  try {
    const result = await client.request({
      event: 'ping',
      data: testPayload,
      timeout: 5000
    })
    
    const latency = performance.now() - sendTime
    metrics.latencies.push(latency)
    metrics.sent++
    
    return result
  } finally {
    semaphore.release()
  }
})

await Promise.all(promises)

metrics.endTime = performance.now()
```

**Pros:**
- ✅ Realistic load pattern
- ✅ Prevents overwhelming system
- ✅ Stable memory usage
- ✅ Adjustable load (change CONCURRENCY)
- ✅ Tests sustained throughput

**Cons:**
- ⚠️ Need to tune CONCURRENCY value
- ⚠️ Slightly more complex

**Use Case:** Realistic production stress testing ⭐

**Expected Results:**
```
CONCURRENCY = 1   → ~1,500 msg/s  (sequential, baseline)
CONCURRENCY = 10  → ~10,000 msg/s (10x improvement)
CONCURRENCY = 100 → ~50,000 msg/s (50x improvement)
CONCURRENCY = 1000 → ~80,000 msg/s (starts hitting limits)
```

---

### **Option 3: Rate-Limited Fire-and-Forget** 🎯

**Pattern: Send at fixed rate, track responses separately**
```javascript
// Send messages at fixed rate (e.g., 10,000 msg/s)
const TARGET_RATE = 10000  // messages per second
const INTERVAL = 1000 / TARGET_RATE  // 0.1ms between sends

const pendingRequests = new Map()
let sent = 0
let received = 0

// Response handler (non-blocking)
function handleResponse(id, data) {
  const requestData = pendingRequests.get(id)
  if (requestData) {
    const latency = performance.now() - requestData.sendTime
    metrics.latencies.push(latency)
    pendingRequests.delete(id)
    received++
  }
}

// Fire requests at fixed rate
metrics.startTime = performance.now()

for (let i = 0; i < 10000; i++) {
  setTimeout(async () => {
    const sendTime = performance.now()
    
    try {
      const result = await client.request({
        event: 'ping',
        data: testPayload,
        timeout: 5000
      })
      
      const latency = performance.now() - sendTime
      metrics.latencies.push(latency)
      sent++
      received++
    } catch (err) {
      console.error('Request failed:', err.message)
    }
  }, i * INTERVAL)
}

// Wait for all responses
await new Promise(resolve => {
  const checkComplete = setInterval(() => {
    if (received >= 10000) {
      clearInterval(checkComplete)
      metrics.endTime = performance.now()
      resolve()
    }
  }, 100)
})
```

**Pros:**
- ✅ Tests specific throughput targets
- ✅ Realistic load pattern (steady rate)
- ✅ Good for SLA testing ("Can we sustain 10K msg/s?")

**Cons:**
- ⚠️ Complex timing logic
- ⚠️ Need to handle late responses
- ⚠️ Timer overhead for high rates

**Use Case:** Testing specific throughput requirements

---

### **Option 4: Burst Testing** 💥

**Pattern: Alternating bursts and idle periods**
```javascript
// Send bursts of messages, then wait
const BURST_SIZE = 1000
const BURST_DELAY = 100  // ms between bursts

metrics.startTime = performance.now()

for (let burst = 0; burst < 10; burst++) {
  const promises = []
  
  // Fire burst
  for (let i = 0; i < BURST_SIZE; i++) {
    const promise = client.request({
      event: 'ping',
      data: testPayload,
      timeout: 5000
    })
    promises.push(promise)
  }
  
  // Wait for burst to complete
  await Promise.all(promises)
  
  // Delay before next burst
  if (burst < 9) {
    await sleep(BURST_DELAY)
  }
}

metrics.endTime = performance.now()
```

**Pros:**
- ✅ Tests recovery between bursts
- ✅ Simulates spiky traffic
- ✅ Good for capacity planning

**Cons:**
- ⚠️ Not sustained load
- ⚠️ Complex result interpretation

**Use Case:** Testing burst handling and recovery

---

### **Option 5: Continuous Stream (Producer-Consumer)** 🌊

**Pattern: Continuous send/receive with backpressure**
```javascript
// Producer: Send messages continuously
// Consumer: Handle responses as they arrive

const MAX_IN_FLIGHT = 100
let inFlight = 0
let sent = 0
let received = 0

metrics.startTime = performance.now()

// Consumer: Handle responses
const responseHandler = () => {
  inFlight--
  received++
  
  if (received >= 10000) {
    metrics.endTime = performance.now()
    return
  }
  
  // Trigger producer if backpressure relieved
  if (inFlight < MAX_IN_FLIGHT) {
    sendNext()
  }
}

// Producer: Send next message
async function sendNext() {
  if (sent >= 10000) return
  if (inFlight >= MAX_IN_FLIGHT) return  // Backpressure
  
  inFlight++
  sent++
  
  try {
    await client.request({
      event: 'ping',
      data: testPayload,
      timeout: 5000
    })
    responseHandler()
  } catch (err) {
    inFlight--
    console.error('Request failed:', err.message)
  }
  
  // Immediately try to send next
  setImmediate(sendNext)
}

// Start producers
for (let i = 0; i < MAX_IN_FLIGHT; i++) {
  sendNext()
}

// Wait for completion
await new Promise(resolve => {
  const checkComplete = setInterval(() => {
    if (received >= 10000) {
      clearInterval(checkComplete)
      resolve()
    }
  }, 100)
})
```

**Pros:**
- ✅ Maximum sustained throughput
- ✅ Natural backpressure
- ✅ Efficient resource usage

**Cons:**
- ⚠️ Most complex implementation
- ⚠️ Harder to debug

**Use Case:** Absolute maximum throughput testing

---

## 🎯 Recommended Approach: **Controlled Concurrency (Option 2)**

### Why?
1. ✅ **Realistic:** Simulates real-world client behavior
2. ✅ **Tunable:** Easy to adjust load level
3. ✅ **Stable:** Won't crash system
4. ✅ **Measurable:** Clear metrics
5. ✅ **Simple:** Easy to understand and maintain

### Implementation

```javascript
// benchmark/client-server-stress.js

import { performance } from 'perf_hooks'
import { Client, Server } from '../src/index.js'
import { events } from '../src/enum.js'

// Semaphore for controlled concurrency
class Semaphore {
  constructor(max) {
    this.max = max
    this.count = 0
    this.queue = []
  }

  async acquire() {
    if (this.count < this.max) {
      this.count++
      return Promise.resolve()
    }
    return new Promise(resolve => this.queue.push(resolve))
  }

  release() {
    this.count--
    if (this.queue.length > 0) {
      this.count++
      const resolve = this.queue.shift()
      resolve()
    }
  }
}

async function stressTest({ concurrency, numMessages, messageSize }) {
  const ADDRESS = `tcp://127.0.0.1:7000`
  
  const metrics = {
    sent: 0,
    received: 0,
    errors: 0,
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  // Create Server
  const server = new Server({
    id: 'stress-server',
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false,
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 50000,  // Higher watermarks for stress
      ZMQ_RCVHWM: 50000
    }
  })
  
  // Create Client
  const client = new Client({
    id: 'stress-client',
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false,
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 50000,
      ZMQ_RCVHWM: 50000,
      CONNECTION_TIMEOUT: 5000,
      REQUEST_TIMEOUT: 30000  // Longer timeout for stress
    }
  })
  
  // Server: Echo handler
  server.onRequest('ping', (data) => data)
  
  try {
    await server.bind(ADDRESS)
    await client.connect(ADDRESS)
    
    // Wait for handshake
    await new Promise((resolve) => {
      client.once(events.CLIENT_READY, resolve)
    })
    
    await sleep(500)
    
    console.log(`\n🔥 Stress Test: ${numMessages} messages, concurrency=${concurrency}`)
    console.log('─'.repeat(80))
    
    // Create test payload
    const testPayload = Buffer.alloc(messageSize, 'A')
    
    // Semaphore for controlled concurrency
    const semaphore = new Semaphore(concurrency)
    
    metrics.startTime = performance.now()
    
    // Fire all requests with controlled concurrency
    const promises = Array.from({ length: numMessages }, async (_, i) => {
      await semaphore.acquire()
      
      const sendTime = performance.now()
      
      try {
        await client.request({
          event: 'ping',
          data: testPayload,
          timeout: 30000
        })
        
        const latency = performance.now() - sendTime
        metrics.latencies.push(latency)
        metrics.sent++
        metrics.received++
      } catch (err) {
        metrics.errors++
        console.error(`Request ${i} failed:`, err.message)
      } finally {
        semaphore.release()
      }
    })
    
    // Wait for all requests to complete
    await Promise.all(promises)
    
    metrics.endTime = performance.now()
    
    // Calculate results
    const duration = (metrics.endTime - metrics.startTime) / 1000
    const throughput = metrics.sent / duration
    const latencyStats = calculateStats(metrics.latencies)
    const bandwidth = (throughput * messageSize) / (1024 * 1024)
    
    // Print results
    console.log(`\n📊 Results:`)
    console.log(`   Messages Sent:       ${metrics.sent.toLocaleString()}`)
    console.log(`   Messages Received:   ${metrics.received.toLocaleString()}`)
    console.log(`   Errors:              ${metrics.errors}`)
    console.log(`   Duration:            ${duration.toFixed(2)}s`)
    console.log(`   Throughput:          ${throughput.toLocaleString('en-US', { maximumFractionDigits: 2 })} msg/sec`)
    console.log(`   Bandwidth:           ${bandwidth.toFixed(2)} MB/sec`)
    console.log(`   Concurrency:         ${concurrency}`)
    
    if (latencyStats) {
      console.log(`\n   📈 Latency Statistics (ms):`)
      console.log(`      Min:              ${latencyStats.min.toFixed(2)}`)
      console.log(`      Mean:             ${latencyStats.mean.toFixed(2)}`)
      console.log(`      Median:           ${latencyStats.median.toFixed(2)}`)
      console.log(`      95th percentile:  ${latencyStats.p95.toFixed(2)}`)
      console.log(`      99th percentile:  ${latencyStats.p99.toFixed(2)}`)
      console.log(`      Max:              ${latencyStats.max.toFixed(2)}`)
    }
    
    return {
      concurrency,
      throughput,
      latency: latencyStats,
      errors: metrics.errors
    }
    
  } finally {
    await client.close()
    await server.close()
    await sleep(500)
  }
}

function calculateStats(latencies) {
  if (latencies.length === 0) return null
  
  const sorted = latencies.slice().sort((a, b) => a - b)
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)]
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Run stress tests with different concurrency levels
async function runStressTests() {
  console.log('🚀 Client-Server Stress Test Suite')
  console.log('═'.repeat(80))
  
  const results = []
  
  // Test different concurrency levels
  const concurrencyLevels = [1, 10, 50, 100, 200]
  
  for (const concurrency of concurrencyLevels) {
    try {
      const result = await stressTest({
        concurrency,
        numMessages: 10000,
        messageSize: 500
      })
      results.push(result)
      
      await sleep(2000)  // Cooldown between tests
    } catch (err) {
      console.error(`❌ Stress test failed for concurrency=${concurrency}:`, err)
    }
  }
  
  // Print summary
  console.log('\n' + '═'.repeat(80))
  console.log('📊 STRESS TEST SUMMARY')
  console.log('═'.repeat(80))
  console.log('\n┌─────────────┬───────────────┬─────────────┬────────┐')
  console.log('│ Concurrency │   Throughput  │ Mean Latency│ Errors │')
  console.log('├─────────────┼───────────────┼─────────────┼────────┤')
  
  for (const result of results) {
    const conc = result.concurrency.toString().padStart(9)
    const throughput = result.throughput.toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(11)
    const latency = result.latency.mean.toFixed(2).padStart(9)
    const errors = result.errors.toString().padStart(4)
    
    console.log(`│ ${conc}   │ ${throughput} msg/s │ ${latency}ms │ ${errors}   │`)
  }
  
  console.log('└─────────────┴───────────────┴─────────────┴────────┘')
  
  // Calculate speedup
  if (results.length > 1) {
    const baseline = results[0].throughput
    console.log('\n📈 Speedup vs Sequential (concurrency=1):')
    for (const result of results) {
      const speedup = (result.throughput / baseline).toFixed(1)
      console.log(`   Concurrency ${result.concurrency}: ${speedup}x faster`)
    }
  }
  
  console.log('\n' + '═'.repeat(80) + '\n')
  
  process.exit(0)
}

runStressTests().catch((err) => {
  console.error('❌ Stress test suite failed:', err)
  console.error(err.stack)
  process.exit(1)
})
```

---

## 📊 Expected Results

### Throughput vs Concurrency
```
┌─────────────┬───────────────┬─────────────┬──────────┐
│ Concurrency │   Throughput  │ Mean Latency│  Speedup │
├─────────────┼───────────────┼─────────────┼──────────┤
│      1      │   1,600 msg/s │    0.62ms   │   1.0x   │  ← Sequential baseline
│     10      │  12,000 msg/s │    0.83ms   │   7.5x   │
│     50      │  45,000 msg/s │    1.11ms   │  28.1x   │
│    100      │  70,000 msg/s │    1.43ms   │  43.8x   │
│    200      │  85,000 msg/s │    2.35ms   │  53.1x   │  ← System limit
│   1000      │  90,000 msg/s │   11.11ms   │  56.3x   │  ← Degrading
└─────────────┴───────────────┴─────────────┴──────────┘

Key observations:
- Linear scaling up to ~100 concurrency
- Diminishing returns beyond 200
- Latency increases with concurrency (queueing)
- System limit around 80-100K msg/s
```

---

## 🎯 Key Insights

### 1. **Concurrency Sweet Spot**
- Too low: Underutilizes system
- Too high: Overhead dominates
- Typical: 50-200 for client-server

### 2. **Latency vs Throughput Tradeoff**
```
Low concurrency:  Low latency, low throughput
High concurrency: High latency, high throughput
```

### 3. **System Bottlenecks**
As concurrency increases, you'll hit:
1. **ZeroMQ watermarks** (ZMQ_SNDHWM, ZMQ_RCVHWM)
2. **Request map size** (memory)
3. **CPU (MessagePack, event handling)**
4. **OS limits (file descriptors, TCP buffers)**

---

## 🚀 Quick Start

```bash
# Create stress test
cat > benchmark/client-server-stress.js << 'EOF'
# (Copy implementation from above)
EOF

# Add npm script
# package.json: "benchmark:stress": "node benchmark/client-server-stress.js"

# Run stress test
npm run benchmark:stress
```

---

## 📝 Summary

**Best Approach: Controlled Concurrency (Semaphore)**
- ✅ Realistic load pattern
- ✅ Tunable (adjust concurrency)
- ✅ Stable and measurable
- ✅ Tests sustained throughput
- ✅ Identifies system limits

**Expected Results:**
- Sequential (baseline): ~1,500-2,500 msg/s
- Concurrency 50-100: ~40,000-70,000 msg/s
- Concurrency 200+: ~80,000-100,000 msg/s (system limit)

**Speedup: 30-50x over sequential! 🚀**

