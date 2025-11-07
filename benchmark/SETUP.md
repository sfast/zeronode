# Transport Benchmarks Setup Guide

## 🎯 Overview

We have baseline benchmarks for 3 transport protocols:
- **ZeroMQ** - High-performance binary messaging
- **NATS** - Cloud-native messaging system
- **HTTP** - Standard REST API pattern

All benchmarks test the same pattern: **request/reply with 100K messages**

---

## 📊 Available Benchmarks

```bash
npm run benchmark:zeromq         # Pure ZeroMQ (no setup needed)
npm run benchmark:nats           # NATS (requires NATS server)
npm run benchmark:http           # HTTP (no setup needed)
npm run benchmark:quic           # QUIC/HTTP3 analysis (no actual benchmark)
npm run benchmark:compare-transports  # Run all three sequentially
```

---

## 🚀 Quick Start

### **1. ZeroMQ Benchmark** ✅ (No Setup Required)

```bash
npm run benchmark:zeromq
```

**Why no setup?**
- ZeroMQ is a library, not a server
- Everything runs in one process
- Server and client are both in the benchmark script

---

### **2. HTTP Benchmark** ✅ (No Setup Required)

```bash
npm run benchmark:http
```

**Why no setup?**
- HTTP server starts automatically in the benchmark
- Uses Node.js built-in `http` module
- Server and client are both in the benchmark script

---

### **3. NATS Benchmark** ⚠️ (Requires NATS Server)

**Step 1: Install NATS Server**

```bash
# macOS (using Homebrew):
brew install nats-server

# OR using Docker:
docker run -p 4222:4222 nats:latest

# OR download binary:
# Visit: https://github.com/nats-io/nats-server/releases
```

**Step 2: Start NATS Server**

```bash
# Terminal 1: Start NATS server
nats-server

# Output should show:
# [1] 2024/11/07 12:00:00.000000 [INF] Starting nats-server
# [2] 2024/11/07 12:00:00.000000 [INF]   Version:  2.10.0
# [3] 2024/11/07 12:00:00.000000 [INF]   Listening for client connections on 0.0.0.0:4222
```

**Step 3: Run Benchmark**

```bash
# Terminal 2: Run benchmark
npm run benchmark:nats
```

**To stop NATS server:**
```bash
# Press Ctrl+C in Terminal 1
```

---

### **4. QUIC/HTTP3 Analysis** ℹ️ (Informational Only)

```bash
npm run benchmark:quic
```

**Why no benchmark?**
- QUIC is not natively supported in stable Node.js
- QUIC performance on localhost ≈ HTTP/1.1 performance
- QUIC shines on WAN/lossy networks (not testable on localhost)
- The script provides analysis and expected performance

**Key QUIC Features:**
- UDP-based (no head-of-line blocking)
- Built-in TLS 1.3 encryption
- 0-RTT connection resumption
- Connection migration (survives IP changes)

**Expected Performance:**
- Localhost: Similar to HTTP/1.1 (~1,500-2,500 msg/s)
- WAN: Better than HTTP/1.1 (especially on lossy networks)

---

## 📈 Expected Results

### **Throughput Comparison (500B messages, localhost):**

```
┌─────────────┬──────────────────┬──────────────┬──────────────┐
│ Transport   │    Throughput    │ Mean Latency │  Overhead    │
├─────────────┼──────────────────┼──────────────┼──────────────┤
│ ZeroMQ      │  3,500-4,000/s   │   0.25-0.30ms│  Baseline    │
│ NATS        │  2,500-3,500/s   │   0.30-0.40ms│  +10-30%     │
│ QUIC/HTTP3  │  1,500-2,500/s   │   0.40-0.70ms│  +60-100%    │
│ HTTP/1.1    │  1,000-2,000/s   │   0.50-1.00ms│  +100-200%   │
└─────────────┴──────────────────┴──────────────┴──────────────┘

Note: Results are for localhost sequential request/reply pattern.
      QUIC performance is estimated (not benchmarked).
      QUIC excels on WAN/lossy networks (better than HTTP/1.1).
```

---

## 🔍 Why These Results?

### **ZeroMQ (Fastest)**
- Binary protocol
- Zero-copy where possible
- Minimal overhead
- No broker (direct peer-to-peer)

### **NATS (Middle)**
- Text-based protocol (adds parsing overhead)
- Requires a broker (NATS server)
- Additional network hop (client → server → subscriber → server → client)
- But still very fast!

### **HTTP (Slowest)**
- Text-based headers
- HTTP parsing overhead
- Request/response cycle overhead
- But most widely supported!

---

## 🎯 Running All Benchmarks

### **Option 1: Run individually**

```bash
# Terminal 1: Start NATS server
nats-server

# Terminal 2: Run benchmarks one by one
npm run benchmark:zeromq
npm run benchmark:http
npm run benchmark:nats
```

### **Option 2: Run all at once** ⭐

```bash
# Terminal 1: Start NATS server
nats-server

# Terminal 2: Run all benchmarks
npm run benchmark:compare-transports

# This runs:
# 1. ZeroMQ benchmark
# 2. NATS benchmark (if server is running)
# 3. HTTP benchmark
```

---

## 🛠️ Troubleshooting

### **NATS: "CONNECTION_REFUSED" error**

```
Error: connect ECONNREFUSED 127.0.0.1:4222
```

**Solution:**
```bash
# Make sure NATS server is running:
nats-server

# Or if port 4222 is in use:
nats-server -p 4223

# Then update benchmark:
# In benchmark/nats-baseline.js, change:
NATS_SERVER: 'nats://127.0.0.1:4223'
```

### **HTTP: "Address already in use" error**

```
Error: listen EADDRINUSE: address already in use :::8080
```

**Solution:**
```bash
# Kill process using port 8080:
lsof -ti:8080 | xargs kill -9

# Or change port in benchmark/http-baseline.js:
HTTP_PORT: 8081
```

### **ZeroMQ: Build errors**

```bash
# Rebuild zeromq native bindings:
npm rebuild zeromq

# Or reinstall:
npm install zeromq
```

---

## 📝 Benchmark Configuration

All benchmarks use the same settings for fair comparison:

```javascript
{
  NUM_MESSAGES: 100000,      // 100K messages
  WARMUP_MESSAGES: 1000,     // 1K warmup
  MESSAGE_SIZES: [100, 500, 1000, 2000],  // bytes
  PATTERN: 'Sequential request/reply'
}
```

---

## 🎓 Understanding the Results

### **Throughput**
- Messages per second
- Higher = better
- Formula: `total_messages / total_time`

### **Latency**
- Time for single request/reply
- Lower = better
- Mean latency directly affects throughput in sequential tests

### **Why Sequential?**
- Fair comparison (all transports tested same way)
- Real-world pattern (many apps do sequential requests)
- Shows per-request overhead clearly

### **For Concurrent Performance:**
- See `benchmark/client-server-stress.js` (ZeroMQ with 100 concurrent)
- NATS and HTTP would have similar concurrent improvements

---

## 🚀 Next Steps

1. **Start with ZeroMQ** (no setup):
   ```bash
   npm run benchmark:zeromq
   ```

2. **Try HTTP** (no setup):
   ```bash
   npm run benchmark:http
   ```

3. **Install NATS** (if you want to compare):
   ```bash
   brew install nats-server
   nats-server  # In one terminal
   npm run benchmark:nats  # In another terminal
   ```

4. **Compare all** (if NATS is running):
   ```bash
   npm run benchmark:compare-transports
   ```

---

## 📚 More Information

- **ZeroMQ**: https://zeromq.org/
- **NATS**: https://nats.io/
- **HTTP/1.1 Spec**: https://httpwg.org/specs/

---

## 💡 Tips

- Run benchmarks multiple times for consistency
- Close other applications to reduce noise
- Localhost results don't reflect network latency
- For production, test over real networks
- ZeroMQ is best for high-performance microservices
- NATS is best for cloud-native distributed systems
- HTTP is best for public APIs and broad compatibility

