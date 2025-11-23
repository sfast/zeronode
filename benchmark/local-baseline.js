#!/usr/bin/env node

/**
 * Pure Local Transport Throughput Benchmark
 * 
 * Tests raw Local Transport performance (baseline for comparison)
 * Measures throughput for different message sizes:
 * - 100 bytes (small messages)
 * - 500 bytes (medium messages)
 * - 1000 bytes (larger payloads)
 * - 2000 bytes (large messages)
 * 
 * This establishes the theoretical maximum performance for in-memory transport
 * Compare with zeromq-baseline.js to see network overhead
 */

import LocalClientSocket from '../src/transport/local/client.js'
import LocalServerSocket from '../src/transport/local/server.js'
import { TransportEvent } from '../src/transport/events.js'
import { performance } from 'perf_hooks'

// Configuration
const CONFIG = {
  SERVER_ID: 'local://benchmark-server',
  NUM_MESSAGES: 10000,
  WARMUP_MESSAGES: 100,
  MESSAGE_SIZES: [100, 500, 1000, 2000]
}

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createMessage(size) {
  // Create a buffer of specified size filled with 'A'
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

async function benchmarkMessageSize(messageSize) {
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
  
  // Create server socket
  const server = new LocalServerSocket({ 
    id: CONFIG.SERVER_ID 
  })
  
  // Create client socket
  const client = new LocalClientSocket({ 
    id: 'benchmark-client' 
  })
  
  // Handle server messages - echo back
  server.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
    metrics.received++
    server.sendBuffer(buffer, sender) // Echo back to sender
  })
  
  // Setup client to receive responses
  let responseResolver = null
  client.on(TransportEvent.MESSAGE, ({ buffer }) => {
    if (responseResolver) {
      responseResolver(buffer)
      responseResolver = null
    }
  })
  
  const waitForResponse = () => new Promise(resolve => {
    responseResolver = resolve
  })
  
  // Bind server
  await server.bind(CONFIG.SERVER_ID)
  console.log(`✅ Server bound to ${CONFIG.SERVER_ID}`)
  
  // Connect client
  await client.connect(CONFIG.SERVER_ID)
  console.log(`✅ Client connected to ${CONFIG.SERVER_ID}`)
  
  await sleep(100)
  
  // Warmup
  console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
  const warmupMsg = createMessage(messageSize)
  
  for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
    client.sendBuffer(warmupMsg)
    await waitForResponse()
  }
  
  console.log('✅ Warmup complete')
  await sleep(100)
  
  // Run benchmark
  console.log(`🏃 Running benchmark (${CONFIG.NUM_MESSAGES} messages)...`)
  const testMsg = createMessage(messageSize)
  
  metrics.startTime = performance.now()
  
  // Send messages with latency tracking
  for (let i = 0; i < CONFIG.NUM_MESSAGES; i++) {
    const sendTime = performance.now()
    
    client.sendBuffer(testMsg)
    await waitForResponse()
    
    const latency = performance.now() - sendTime
    metrics.latencies.push(latency)
    metrics.sent++
  }
  
  metrics.endTime = performance.now()
  
  // Calculate results
  const duration = (metrics.endTime - metrics.startTime) / 1000
  const throughput = metrics.sent / duration
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
  
  // Cleanup
  client.close()
  server.close()
  
  await sleep(100)
  
  return {
    messageSize,
    duration,
    throughput,
    bandwidth,
    latency: latencyStats
  }
}

async function runBenchmarks() {
  console.log('🚀 Pure Local Transport Throughput Benchmark')
  console.log('   (Raw Socket Performance - No Protocol Overhead)')
  console.log('═'.repeat(80))
  console.log(`Server Address:          ${CONFIG.SERVER_ID}`)
  console.log(`Messages per test:       ${formatNumber(CONFIG.NUM_MESSAGES)}`)
  console.log(`Warmup messages:         ${CONFIG.WARMUP_MESSAGES}`)
  console.log(`Message sizes:           ${CONFIG.MESSAGE_SIZES.join(', ')} bytes`)
  console.log('═'.repeat(80))
  
  const results = []
  
  // Run benchmark for each message size
  for (const messageSize of CONFIG.MESSAGE_SIZES) {
    try {
      const result = await benchmarkMessageSize(messageSize)
      results.push(result)
      
      // Wait between tests
      await sleep(200)
    } catch (err) {
      console.error(`❌ Benchmark failed for ${messageSize}-byte messages:`, err)
    }
  }
  
  // Print summary
  console.log('\n' + '═'.repeat(80))
  console.log('📊 SUMMARY - Pure Local Transport Performance')
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
  console.log('\n📝 Notes:')
  console.log('   • Pure in-memory socket-to-socket communication')
  console.log('   • No Protocol layer overhead (handshake, envelope, routing)')
  console.log('   • Direct buffer passing via global registry')
  console.log('   • Establishes theoretical maximum for local transport')
  console.log('\n💡 Comparison:')
  console.log('   • Pure Local:    ~X,XXX msg/sec (this benchmark)')
  console.log('   • Pure ZeroMQ:   benchmark/zeromq-baseline.js')
  console.log('   • Node+Local:    benchmark/local-transport.js')
  console.log('   • Node+ZeroMQ:   benchmark/node-throughput.js')
  console.log('\n' + '═'.repeat(80) + '\n')
  
  process.exit(0)
}

// Run benchmarks
runBenchmarks().catch((err) => {
  console.error('❌ Benchmark suite failed:', err)
  process.exit(1)
})

