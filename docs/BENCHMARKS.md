# Benchmarks

> **Performance Testing and Analysis for ZeroNode**

---

## Overview

ZeroNode provides comprehensive benchmarks to measure performance across different layers of the framework.

### Quick Results

| Layer | Throughput | Latency (avg) | Test Size |
|-------|-----------|---------------|-----------|
| **Transport (Router-Dealer)** | 3,100+ msg/s | 0.32ms | 10,000 msgs |
| **Protocol (Client-Server)** | 2,500+ msg/s | 0.40ms | 10,000 msgs |
| **Application (Node-to-Node)** | 2,000+ msg/s | 0.50ms | 10,000 msgs |

---

## Running Benchmarks

### Available Benchmarks

```bash
# Full benchmark suite
npm run benchmark

# Individual benchmarks
npm run benchmark:node              # Node layer (application)
npm run benchmark:client-server     # Protocol layer
npm run benchmark:router-dealer     # Transport layer
```

---

## Transport Layer Benchmark

**What it measures:** Raw socket performance without protocol overhead

```bash
npm run benchmark:router-dealer
```

### Results

| Message Size | Throughput | Bandwidth | Mean Latency | P95 | P99 |
|--------------|-----------|-----------|--------------|-----|-----|
| 100B | 3,122 msg/s | 0.3 MB/s | 0.32ms | 0.55ms | 1.05ms |
| 500B | 2,512 msg/s | 1.2 MB/s | 0.40ms | 0.75ms | 1.96ms |
| 1000B | 2,493 msg/s | 2.38 MB/s | 0.40ms | 0.76ms | 1.92ms |
| 2000B | 1,929 msg/s | 3.68 MB/s | 0.52ms | 0.97ms | 1.88ms |

**Key Findings:**
- ✅ Sub-millisecond latency for all message sizes
- ✅ 0% message loss
- ✅ Predictable performance scaling
- ✅ Excellent P99 latency (<2ms)

---

## Protocol Layer Benchmark

**What it measures:** Client-Server communication with full envelope serialization

```bash
npm run benchmark:client-server
```

### Results

```
Messages:        10,000
Duration:        ~4.0s
Throughput:      2,500 req/s
Mean Latency:    0.40ms
P95 Latency:     0.75ms
P99 Latency:     1.80ms
Success Rate:    100%
```

**Key Findings:**
- ✅ Minimal overhead over transport layer (~20%)
- ✅ Efficient binary serialization
- ✅ Lazy parsing optimization
- ✅ Zero-copy buffer handling

---

## Application Layer Benchmark

**What it measures:** Full Node-to-Node communication with handshake, routing, and middleware

```bash
npm run benchmark:node
```

### Results

```
Messages:        10,000
Duration:        ~5.0s
Throughput:      2,000 req/s
Mean Latency:    0.50ms
P95 Latency:     0.90ms
P99 Latency:     2.50ms
Success Rate:    100%
```

**Key Findings:**
- ✅ Production-ready performance
- ✅ Full feature set (routing, middleware, health checks)
- ✅ Sub-millisecond average latency
- ✅ Framework overhead: ~35% over raw transport

---

## Performance Characteristics

### Latency Distribution

```
P50 (Median):  0.30ms  ████████████████████
P75:           0.45ms  ██████████████████████████████
P90:           0.70ms  ███████████████████████████████████████
P95:           0.90ms  ████████████████████████████████████████████
P99:           2.00ms  ████████████████████████████████████████████████████████████
```

### Throughput vs Message Size

```
100B:   3,100 msg/s  ████████████████████
500B:   2,500 msg/s  ████████████████
1000B:  2,400 msg/s  ███████████████
2000B:  1,900 msg/s  ████████████
```

---

## Comparison with Other Frameworks

| Framework | Throughput | Latency | Transport | Notes |
|-----------|-----------|---------|-----------|-------|
| **ZeroNode** | 2,000+ msg/s | 0.5ms | TCP/ZeroMQ | Full-featured |
| HTTP/REST | 1,000-5,000 msg/s | 5-50ms | HTTP | Request overhead |
| gRPC | 5,000-20,000 msg/s | 1-10ms | HTTP/2 | Binary protocol |
| RabbitMQ | 4,000-20,000 msg/s | 1-5ms | AMQP | Message broker |
| Redis Pub/Sub | 100,000+ msg/s | <1ms | TCP | No persistence |

**Note:** Benchmarks depend heavily on hardware, network conditions, message size, and workload patterns. These are approximate values for comparison.

---

## Benchmark Methodology

### Test Configuration

- **Hardware:** MacBook (darwin 22.6.0)
- **Node.js:** v22.20.0
- **Transport:** TCP (local loopback)
- **Network:** 127.0.0.1 (no network latency)
- **Warmup:** 100-1,000 messages
- **Test Duration:** 5-10 seconds per test

### What We Measure

1. **Throughput:** Messages per second (msg/s)
2. **Latency:** Round-trip time from send to receive
3. **Bandwidth:** Data transferred per second
4. **Percentiles:** P50, P75, P90, P95, P99
5. **Reliability:** Success rate and message loss

### Sequential vs Concurrent

**Sequential (Current):**
```javascript
for (let i = 0; i < 10000; i++) {
  await client.request({ event: 'echo', data: payload })
}
// Measures: End-to-end latency including processing time
```

**Concurrent (Alternative):**
```javascript
const promises = []
for (let i = 0; i < 10000; i++) {
  promises.push(client.request({ event: 'echo', data: payload }))
}
await Promise.all(promises)
// Measures: Maximum throughput under load
```

ZeroNode benchmarks use **sequential** testing to measure realistic latency and ensure fair comparison with synchronous frameworks.

---

## Performance Tuning

### System-Level Optimizations

```bash
# Increase file descriptor limit
ulimit -n 65536

# TCP tuning for high-performance
sysctl -w net.ipv4.tcp_fin_timeout=30
sysctl -w net.ipv4.tcp_tw_reuse=1
```

### ZeroNode Configuration

```javascript
const node = new Node({
  id: 'high-perf-node',
  config: {
    // Buffer strategy for large messages
    BUFFER_STRATEGY: 'POWER_OF_2',
    
    // Disable debug logging in production
    DEBUG: false,
    
    // Tune heartbeat interval
    PING_INTERVAL: 30000,  // 30 seconds
    PING_TIMEOUT: 90000    // 90 seconds
  }
})
```

### Application-Level Tips

1. **Use Ticks for One-Way Messages**
   - No response overhead
   - 2-3x faster than request/reply

2. **Batch Related Operations**
   - Send arrays instead of individual items
   - Reduces round trips

3. **Minimize Middleware Overhead**
   - Use 2-param handlers for auto-continue
   - Avoid heavy computation in middleware

4. **Lazy Data Parsing**
   - Access `envelope.data` only when needed
   - ZeroNode parses JSON on-demand

---

## Stress Testing

For production deployment, run extended stress tests:

```bash
# Long-running stability test
npm run benchmark -- --duration=3600  # 1 hour

# High concurrency test
npm run benchmark -- --concurrent=1000

# Large payload test
npm run benchmark -- --size=10000  # 10KB messages
```

---

## Interpreting Results

### Good Performance Indicators

✅ **Latency P99 < 5ms** - Most requests are fast  
✅ **Success Rate = 100%** - No message loss  
✅ **Throughput > 1,000 msg/s** - Sufficient for most use cases  
✅ **Stable Latency** - No spikes or anomalies

### Warning Signs

⚠️ **P99 > 50ms** - Long tail latency issues  
⚠️ **Success Rate < 99%** - Message loss or errors  
⚠️ **Throughput Degradation** - Performance drops over time  
⚠️ **High Variance** - Unpredictable performance

---

## Continuous Performance Monitoring

### CI/CD Integration

Add performance gates to your CI pipeline:

```yaml
# .github/workflows/benchmark.yml
- name: Run Benchmarks
  run: npm run benchmark

- name: Check Performance
  run: |
    # Fail if latency > 2ms or throughput < 1500 msg/s
    node scripts/check-performance.js
```

### Production Monitoring

```javascript
// Track metrics in production
node.on(NodeEvent.REQUEST_RECEIVED, ({ event, duration }) => {
  metrics.histogram('request_duration_ms', duration)
  metrics.increment('requests_total', { event })
})
```

---

## Contributing Benchmarks

To add new benchmarks:

1. Create test file in `benchmark/`
2. Follow existing patterns (warmup, measurement, statistics)
3. Document what you're measuring
4. Add npm script to `package.json`
5. Update this document with results

---

## Conclusion

ZeroNode provides:

✅ **Sub-millisecond latency** for distributed systems  
✅ **Predictable performance** across message sizes  
✅ **Production-ready throughput** (2,000+ msg/s)  
✅ **Comprehensive benchmarking** tools

For detailed architecture and optimization strategies, see [ARCHITECTURE.md](./ARCHITECTURE.md) and [PERFORMANCE.md](./PERFORMANCE.md).

