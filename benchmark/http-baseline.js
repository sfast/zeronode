#!/usr/bin/env node

/**
 * HTTP Baseline Throughput Benchmark
 * 
 * Tests pure HTTP request-response performance using Node.js http module
 * Comparable to zeromq-baseline.js for direct comparison
 * 
 * Measures throughput for different message sizes:
 * - 100 bytes (small messages)
 * - 500 bytes (medium messages)
 * - 1000 bytes (larger payloads)
 * - 2000 bytes (large messages)
 */

import { performance } from 'perf_hooks'
import http from 'http'

// Configuration
const CONFIG = {
  HTTP_HOST: '127.0.0.1',
  HTTP_PORT: 8080,
  NUM_MESSAGES: 10000,  // 100K messages for accurate analysis
  WARMUP_MESSAGES: 100,
  MESSAGE_SIZES: [100, 500, 1000, 2000],
  KEEP_ALIVE: true  // Use HTTP keep-alive for fair comparison
}

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createMessage(size) {
  return Buffer.alloc(size, 'A')
}

function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
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

// HTTP request function
function sendHttpRequest(data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: CONFIG.HTTP_HOST,
      port: CONFIG.HTTP_PORT,
      path: '/echo',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
        'Connection': CONFIG.KEEP_ALIVE ? 'keep-alive' : 'close'
      }
    }
    
    const req = http.request(options, (res) => {
      const chunks = []
      
      res.on('data', (chunk) => {
        chunks.push(chunk)
      })
      
      res.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
    })
    
    req.on('error', reject)
    
    req.write(data)
    req.end()
  })
}

async function benchmarkMessageSize(messageSize, server, agent) {
  console.log(`\n${'─'.repeat(80)}`)
  console.log(`📦 Testing ${messageSize}-byte messages`)
  console.log('─'.repeat(80))
  
  const metrics = {
    sent: 0,
    received: 0,
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  await sleep(500)
  
  // Warmup phase
  console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
  const warmupMsg = createMessage(messageSize)
  
  for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
    await sendHttpRequest(warmupMsg)
  }
  
  console.log('✅ Warmup complete')
  await sleep(500)
  
  // Run benchmark
  console.log(`🏃 Running benchmark (${CONFIG.NUM_MESSAGES} messages)...`)
  const testMsg = createMessage(messageSize)
  
  metrics.startTime = performance.now()
  
  // Send messages with latency tracking
  for (let i = 0; i < CONFIG.NUM_MESSAGES; i++) {
    const sendTime = performance.now()
    
    await sendHttpRequest(testMsg)
    
    const latency = performance.now() - sendTime
    metrics.latencies.push(latency)
    metrics.sent++
    metrics.received++
  }
  
  metrics.endTime = performance.now()
  
  // Calculate results
  // Throughput = total messages / total elapsed time (industry standard)
  // For sequential requests, this equals 1 / mean_latency
  const duration = (metrics.endTime - metrics.startTime) / 1000  // Total time in seconds
  const throughput = metrics.sent / duration  // Messages per second
  const latencyStats = calculateStats(metrics.latencies)
  const bandwidth = (throughput * messageSize) / (1024 * 1024) // MB/s
  
  // Print results
  console.log(`\n📊 Results for ${messageSize}-byte messages:`)
  console.log(`   Messages Sent:       ${formatNumber(metrics.sent)}`)
  console.log(`   Messages Received:   ${formatNumber(metrics.received)}`)
  console.log(`   Duration:            ${formatNumber(duration)}s`)
  console.log(`   Throughput:          ${formatNumber(throughput)} msg/sec`)
  console.log(`   Bandwidth:           ${formatNumber(bandwidth)} MB/sec`)
  
  if (latencyStats) {
    console.log(`\n   📈 Latency Statistics (ms):`)
    console.log(`      Min:              ${formatNumber(latencyStats.min)}`)
    console.log(`      Mean:             ${formatNumber(latencyStats.mean)}  ← Throughput based on this (sequential)`)
    console.log(`      Median:           ${formatNumber(latencyStats.median)}`)
    console.log(`      95th percentile:  ${formatNumber(latencyStats.p95)}  ← For SLA validation`)
    console.log(`      99th percentile:  ${formatNumber(latencyStats.p99)}  ← For capacity planning`)
    console.log(`      Max:              ${formatNumber(latencyStats.max)}`)
  }
  
  return {
    messageSize,
    duration,
    throughput,
    bandwidth,
    latency: latencyStats,
    sent: metrics.sent,
    received: metrics.received
  }
}

async function runBenchmarks() {
  console.log('🚀 Pure HTTP Request-Response Throughput Benchmark')
  console.log('   (Node.js http module with Keep-Alive)')
  console.log('═'.repeat(80))
  console.log(`HTTP Server:             http://${CONFIG.HTTP_HOST}:${CONFIG.HTTP_PORT}`)
  console.log(`Messages per test:       ${formatNumber(CONFIG.NUM_MESSAGES)}`)
  console.log(`Warmup messages:         ${CONFIG.WARMUP_MESSAGES}`)
  console.log(`Message sizes:           ${CONFIG.MESSAGE_SIZES.join(', ')} bytes`)
  console.log(`Keep-Alive:              ${CONFIG.KEEP_ALIVE ? 'Enabled' : 'Disabled'}`)
  console.log('═'.repeat(80))
  
  // Create HTTP server (echo server)
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/echo') {
      const chunks = []
      
      req.on('data', (chunk) => {
        chunks.push(chunk)
      })
      
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length
        })
        
        res.end(body)
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  
  // Start server
  await new Promise((resolve) => {
    server.listen(CONFIG.HTTP_PORT, CONFIG.HTTP_HOST, () => {
      console.log(`✅ HTTP Server listening on http://${CONFIG.HTTP_HOST}:${CONFIG.HTTP_PORT}`)
      resolve()
    })
  })
  
  // Configure HTTP agent for keep-alive
  const agent = new http.Agent({
    keepAlive: CONFIG.KEEP_ALIVE,
    maxSockets: 1,  // Single connection for sequential requests
    maxFreeSockets: 1
  })
  
  const results = []
  
  // Run benchmark for each message size
  for (const messageSize of CONFIG.MESSAGE_SIZES) {
    try {
      const result = await benchmarkMessageSize(messageSize, server, agent)
      results.push(result)
      
      // Wait between tests
      await sleep(1000)
    } catch (err) {
      console.error(`❌ Benchmark failed for ${messageSize}-byte messages:`, err)
      console.error(err.stack)
    }
  }
  
  // Cleanup
  agent.destroy()
  await new Promise((resolve) => {
    server.close(() => resolve())
  })
  
  await sleep(500)
  
  // Print summary
  console.log('\n' + '═'.repeat(80))
  console.log('📊 SUMMARY - Pure HTTP Performance')
  console.log('═'.repeat(80))
  console.log('\n┌──────────────┬───────────────┬──────────────┬─────────────┐')
  console.log('│ Message Size │   Throughput  │   Bandwidth  │ Mean Latency│')
  console.log('├──────────────┼───────────────┼──────────────┼─────────────┤')
  
  for (const result of results) {
    const size = result.messageSize.toString().padStart(10)
    const throughput = formatNumber(result.throughput).padStart(11)
    const bandwidth = formatNumber(result.bandwidth).padStart(10)
    const latency = formatNumber(result.latency.mean).padStart(9)
    
    console.log(`│ ${size}B  │ ${throughput} msg/s │ ${bandwidth} MB/s │ ${latency}ms │`)
  }
  
  console.log('└──────────────┴───────────────┴──────────────┴─────────────┘')
  
  // Print comparison note
  console.log('\n📝 Notes:')
  console.log('   • This tests pure HTTP/1.1 request-response with Keep-Alive')
  console.log('   • Compare with benchmark/zeromq-baseline.js for ZeroMQ performance')
  console.log('   • HTTP has higher overhead (headers, parsing, text-based protocol)')
  console.log('   • Expected: HTTP typically 50-70% slower than ZeroMQ on localhost')
  console.log('   • For better HTTP performance, consider HTTP/2 or gRPC')
  
  console.log('\n' + '═'.repeat(80) + '\n')
  
  process.exit(0)
}

// Run benchmarks
runBenchmarks().catch((err) => {
  console.error('❌ Benchmark suite failed:', err)
  console.error(err.stack)
  process.exit(1)
})

