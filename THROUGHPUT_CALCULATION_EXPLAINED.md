# Throughput Calculation - The Truth

## ❌ My Previous Oversimplification

I said: **"throughput = 1 / latency"**  
This was **misleading** - let me clarify properly!

---

## ✅ How Throughput is ACTUALLY Calculated

### **From benchmark/client-server-baseline.js (line 192-193):**

```javascript
const duration = (metrics.endTime - metrics.startTime) / 1000  // Total time in seconds
const throughput = metrics.sent / duration                     // Messages per second
```

**Formula:**
```
throughput = total_messages / total_elapsed_time
```

**This is the ACTUAL measured throughput over the entire test run.**

---

## 🔍 What Does This Mean for Sequential Requests?

### **Sequential Loop (current benchmark):**

```javascript
metrics.startTime = performance.now()

for (let i = 0; i < 10000; i++) {
  const sendTime = performance.now()
  
  await client.request(...)  // Wait for response before next
  
  const latency = performance.now() - sendTime
  metrics.latencies.push(latency)
  metrics.sent++
}

metrics.endTime = performance.now()
```

### **Mathematical Relationship:**

Since we `await` each request sequentially:

```
total_time = latency₁ + latency₂ + latency₃ + ... + latency₁₀₀₀₀
           = sum(all individual latencies)

Therefore:
throughput = num_messages / total_time
           = num_messages / sum(latencies)
           = num_messages / (num_messages × average_latency)
           = 1 / average_latency
```

**So for sequential requests:**
```
throughput ≈ 1 / MEAN_latency
```

**NOT:**
- ❌ `1 / max_latency`
- ❌ `1 / p95_latency`
- ❌ `1 / p99_latency`

---

## 📊 Verification with Actual Results

### **500-byte messages:**
```
Observed throughput:  1,580 msg/s
Mean latency:         0.63ms

Calculation: 1 / 0.00063 = 1,587 msg/s ✅ MATCHES!
```

### **Why not p95 or max?**

```javascript
// Example latencies from a run:
latencies = [
  0.60ms,  // Most requests
  0.61ms,
  0.62ms,
  0.63ms,
  ...
  1.50ms,  // p95 (5% are slower)
  ...
  5.00ms   // max (rare outlier)
]

mean = 0.63ms
p95  = 1.50ms
max  = 5.00ms

throughput = 1 / mean = 1,587 msg/s  ✅ This is what we measure
           ≠ 1 / p95  = 667 msg/s    ❌ Too pessimistic
           ≠ 1 / max  = 200 msg/s    ❌ Way too pessimistic
```

**Why?**
- Throughput measures **sustained rate over time**
- Outliers (p95, max) are rare events
- They contribute to total time, but are **averaged out** with all other requests

---

## 🎯 Your Question: "Should we use p95 instead?"

### **Two Different Questions:**

### **1. "How is throughput calculated?"**
**Answer:** `throughput = total_messages / total_time`

For sequential requests, this naturally equals `1 / mean_latency` because:
```
total_time = sum of all latencies
mean_latency = total_time / num_messages
```

**p95, p99, max are NOT used** in the throughput calculation. They're reported separately for latency analysis.

---

### **2. "What throughput can I SUSTAIN reliably?"**
**Answer:** This is where p95/p99 matter for **capacity planning**, not measurement.

#### **Example:**

```
Measured throughput: 1,580 msg/s (based on mean latency 0.63ms)

But:
- p95 latency: 1.50ms
- p99 latency: 2.50ms
- max latency: 5.00ms
```

**Interpretation:**
- ✅ **Average throughput:** 1,580 msg/s (what we measure)
- ⚠️ **95% of requests:** Complete in ≤ 1.50ms
- ⚠️ **99% of requests:** Complete in ≤ 2.50ms
- ⚠️ **Worst case:** 5.00ms

**For capacity planning:**
```
If your SLA is "p95 latency < 2ms":
  → You can sustain 1,580 msg/s ✅
  
If your SLA is "p95 latency < 1ms":
  → You CANNOT sustain 1,580 msg/s ❌
  → Need to reduce load or optimize
```

---

## 🔄 Concurrent Requests: Different Story!

### **With concurrency, the relationship changes:**

```javascript
// Concurrent: 100 requests in-flight
const semaphore = new Semaphore(100)

await Promise.all(
  Array.from({ length: 10000 }, async () => {
    await semaphore.acquire()
    try {
      await client.request(...)
    } finally {
      semaphore.release()
    }
  })
)
```

**Now:**
```
throughput ≠ 1 / mean_latency  ← This formula breaks!

Instead:
throughput ≈ concurrency / mean_latency

Example:
- Concurrency: 100
- Mean latency: 0.63ms
- Throughput: 100 / 0.00063 ≈ 158,730 msg/s

But with queueing delays:
- Mean latency increases to ~1.5ms
- Throughput: 100 / 0.0015 ≈ 66,667 msg/s
```

**In this case, p95 and p99 matter MORE:**
```
High concurrency → Higher p95/p99 latencies → Capacity concerns

Example:
- Mean: 1.5ms   → Most requests are fast
- p95:  10ms    → 5% are VERY slow (queueing)
- p99:  50ms    → 1% timeout risk

This indicates system is near capacity!
```

---

## 📈 Visual Comparison

### **Sequential (Current Benchmark):**
```
Time ─────────────────────────────────────────────────────→

Request 1:  [send─0.63ms─receive]
Request 2:                        [send─0.63ms─receive]
Request 3:                                             [send─0.63ms─receive]

Total time:  0.63ms × 10,000 = 6,300ms
Throughput:  10,000 / 6.3s = 1,587 msg/s

Formula:  throughput = 1 / mean_latency
```

### **Concurrent (Stress Test):**
```
Time ─────────────────────────────────────────────────────→

Request 1:  [send─0.63ms─receive]
Request 2:  [send─0.63ms─receive]
Request 3:  [send─0.63ms─receive]
...
Request 100: [send─0.63ms─receive]
Request 101:                       [send─0.63ms─receive]
Request 102:                       [send─0.63ms─receive]

Total time:  (10,000 / 100) × 0.63ms = 63ms
Throughput:  10,000 / 0.063s = 158,730 msg/s

Formula:  throughput = concurrency / mean_latency
```

---

## 🎯 Summary

### **How throughput is calculated:**
```javascript
throughput = total_messages / total_elapsed_time

// For sequential requests, this simplifies to:
throughput ≈ 1 / mean_latency

// For concurrent requests:
throughput ≈ concurrency / mean_latency
```

### **p95/p99/max latency:**
- ❌ **NOT used** in throughput calculation
- ✅ **Used for** capacity planning and SLA validation
- ✅ **Indicates** system health under load

### **When to use each metric:**

| Metric | Use For |
|--------|---------|
| **Throughput** | "How many msg/s can I process?" |
| **Mean latency** | "What's the typical response time?" |
| **p95 latency** | "What response time do 95% of users see?" |
| **p99 latency** | "What's the worst case for most users?" |
| **Max latency** | "What's the absolute worst case?" |

### **Capacity Planning Example:**

```
Measured: 1,580 msg/s (mean: 0.63ms, p95: 1.50ms, p99: 2.50ms)

Question: "Can we handle 2,000 msg/s?"

Answer:
- Current load: 1,580 msg/s
- Target load:  2,000 msg/s (26% increase)

If we increase load 26%:
- Mean latency: 0.63ms → ~0.80ms (proportional)
- p95 latency:  1.50ms → ~1.90ms (disproportional - queueing!)
- p99 latency:  2.50ms → ~3.20ms

If SLA is "p95 < 2ms":
  → 2,000 msg/s might be risky
  → Need stress test to verify
```

---

## 📝 Corrected Statements

### ❌ What I said before:
> "throughput = 1 / latency"  
> "If latency = 0.63ms, max throughput = 1,587 msg/s"

### ✅ What I should have said:
> **"For sequential requests, throughput ≈ 1 / mean_latency"**  
> **"If mean latency = 0.63ms, measured throughput ≈ 1,587 msg/s"**
> 
> **Throughput is calculated as: total_messages / total_time**
> 
> **p95 and max latency are NOT used in throughput calculation,**  
> **but are critical for capacity planning and SLA validation.**

---

## 🎓 Key Takeaway

Your intuition was correct! 

**Throughput is based on TOTAL TIME (which reflects MEAN latency), not outliers.**

**p95/p99 are for reliability analysis, not throughput measurement.**

```
Throughput  → "How fast?"     → Based on mean/total time
p95 latency → "How reliable?" → Based on distribution tail
```

**Both are important, but measure different things!**

