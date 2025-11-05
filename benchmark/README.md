# Zeronode Performance Benchmarks

This directory contains performance benchmarks for the zeronode library.

## Available Benchmarks

### 1. Envelope Benchmark (`envelope-benchmark.js`)
Tests the performance of message serialization and deserialization.

**What it measures:**
- Buffer serialization speed (ops/sec)
- Buffer deserialization speed (ops/sec)
- Performance across different message sizes (small, medium, large)

**Run:**
```bash
npm run benchmark:envelope
```

### 2. Throughput Benchmark (`throughput-benchmark.js`)
Tests end-to-end messaging performance.

**What it measures:**
- Request/response throughput (requests/sec)
- Request latency (min, max, avg, p50, p95, p99)
- One-way message (tick) throughput
- Message loss rate

**Run:**
```bash
npm run benchmark:throughput
```

### 3. Durability Benchmark (`durability-benchmark.js`)
Tests system stability under sustained mixed load with resource monitoring.

**What it measures:**
- CPU usage over time
- Memory usage and heap growth
- Mixed workload (requests + ticks) stability
- Error rates under load
- Memory leak detection

**Run:**
```bash
npm run benchmark:durability
```

**Configuration:**
Edit the constants in the file to adjust:
- `TEST_DURATION` - How long to run (default: 60s)
- `TARGET_RATE` - Messages per second (default: 1000)
- `REQUEST_RATIO` - Ratio of requests vs ticks (default: 0.3 = 30% requests)

### 4. Multi-Node Durability (`multi-node-durability.js`)
Tests realistic multi-client scenario with bidirectional communication.

**What it measures:**
- 1 server node + 3 client nodes
- Bidirectional messaging (server ↔ clients)
- Per-client message distribution
- CPU and memory under multi-node load
- Realistic production-like scenario

**Run:**
```bash
npm run benchmark:multi-node
```

**Configuration:**
- `NUM_CLIENTS` - Number of client nodes (default: 3)
- `TARGET_RATE_PER_CLIENT` - Messages per second per client (default: 1000)
- `TEST_DURATION` - How long to run (default: 60s)

## Running All Benchmarks

```bash
npm run benchmark
```

## Interpreting Results

### Envelope Benchmark
- **Higher ops/sec = Better**
- Typical results: 50,000 - 500,000 ops/sec depending on message size
- Serialize should be slightly faster than deserialize

### Throughput Benchmark

**Request/Response:**
- **Throughput:** Higher is better. Typical: 1,000 - 10,000 req/sec
- **Latency P50:** Lower is better. Typical: 1-5ms
- **Latency P99:** Should be < 20ms for good performance

**Ticks (One-Way):**
- **Throughput:** Should be 2-5x higher than request/response
- **Loss Rate:** Should be 0% or very close

## Performance Tips

1. **Network**: Use `tcp://` for local testing, `ipc://` for same-machine communication
2. **Message Size**: Smaller messages = higher throughput
3. **Concurrency**: These benchmarks are sequential; parallel requests will show different characteristics
4. **Node Version**: Newer Node.js versions typically perform better

## Comparing Changes

To compare before/after performance:

```bash
# Before changes
npm run benchmark > before.txt

# Make your changes...

# After changes
npm run benchmark > after.txt

# Compare
diff before.txt after.txt
```

## System Info

When reporting benchmark results, include:
- Node.js version: `node --version`
- OS: `uname -a` (Linux/Mac) or `ver` (Windows)
- CPU: Check system info
- RAM: Check system info

