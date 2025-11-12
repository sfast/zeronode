#!/usr/bin/env node

/**
 * Client-Server Architecture Throughput Benchmark
 * 
 * Tests the professionally refactored Client and Server classes
 * Measures throughput and latency for different message sizes:
 * - 100 bytes (small messages)
 * - 500 bytes (medium messages)
 * - 1000 bytes (larger payloads)
 * - 2000 bytes (large messages)
 * 
 * This verifies our full application-layer stack maintains performance
 */

import { performance } from 'perf_hooks'
import { Client, Server, ClientEvent, ServerEvent } from '../src/index.js'

// Configuration
const CONFIG = {
  BASE_ADDRESS: 'tcp://127.0.0.1:5560',
  NUM_MESSAGES: 10000,  // 100K messages for accurate throughput analysis
  WARMUP_MESSAGES: 100,  // Increased warmup
  MESSAGE_SIZES: [100, 500, 1000, 2000],
  HANDSHAKE_TIMEOUT: 5000
}

// ============================================================================
// Utility Functions
// ============================================================================

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

// Use different port for each test to avoid "Address already in use"
function getAddress(testIndex) {
  const port = 5560 + testIndex
  return `tcp://127.0.0.1:${port}`
}

// ============================================================================
// Benchmark for a Specific Message Size
// ============================================================================

async function benchmarkMessageSize(messageSize, testIndex) {
  const ADDRESS = getAddress(testIndex)
  
  console.log(`\n${'─'.repeat(80)}`)
  console.log(`📦 Testing ${messageSize}-byte messages`)
  console.log('─'.repeat(80))
  
  const metrics = {
    sent: 0,
    received: 0,
    responded: 0,
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  // Create Server
  const server = new Server({
    id: `benchmark-server`,
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false,
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 10000,
      ZMQ_RCVHWM: 10000
    }
  })
  
  // Create Client
  const client = new Client({
    id: `benchmark-client`,
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false,
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 10000,
      ZMQ_RCVHWM: 10000,
      CONNECTION_TIMEOUT: 5000,
      REQUEST_TIMEOUT: 5000
    }
  })
  
  // Server: Handle requests (echo back with reply callback)
  server.onRequest('ping', (envelope, reply) => {
    metrics.responded++
    reply(envelope.data) // Echo back
  })
  
  try {
    // Bind server
    await server.bind(ADDRESS)
    console.log(`✅ Server bound to ${ADDRESS}`)
    
    // Connect client (waits for handshake to complete)
    await client.connect(ADDRESS)
    console.log(`✅ Client connected to ${ADDRESS}`)
    console.log(`✅ Handshake complete`)
    
    await sleep(500)
    
    // Warmup phase
    console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
    const warmupPayload = createMessage(messageSize)
    
    for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
      await client.request({
        event: 'ping',
        data: warmupPayload,
        timeout: 5000
      })
    }
    
    console.log('✅ Warmup complete')
    await sleep(500)
    
    // Reset metrics after warmup
    metrics.responded = 0
    
    // Run benchmark
    console.log(`🏃 Running benchmark (${CONFIG.NUM_MESSAGES} messages)...`)
    const testPayload = createMessage(messageSize)
    
    metrics.startTime = performance.now()
    
    // Send messages with latency tracking
    for (let i = 0; i < CONFIG.NUM_MESSAGES; i++) {
      const sendTime = performance.now()
      
      try {
        await client.request({
          event: 'ping',
          data: testPayload,
          timeout: 5000
        })
        
        const latency = performance.now() - sendTime
        metrics.latencies.push(latency)
        metrics.sent++
        metrics.received++
      } catch (err) {
        console.error(`Request ${i} failed:`, err.message)
      }
    }
    
    metrics.endTime = performance.now()
    
    // Wait for any pending operations
    await sleep(500)
    
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
    console.log(`   Messages Responded:  ${formatNumber(metrics.responded)}`)
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
      received: metrics.received,
      responded: metrics.responded
    }
    
  } finally {
    // Cleanup
    await client.close()
    await server.close()
    await sleep(500)
  }
}

// ============================================================================
// Main Benchmark Runner
// ============================================================================

async function runBenchmarks() {
  console.log('🚀 Client-Server Architecture Throughput Benchmark')
  console.log('   (Protocol-First Design with Message-Based Handshake)')
  console.log('═'.repeat(80))
  console.log(`Base Address:            ${CONFIG.BASE_ADDRESS}`)
  console.log(`Messages per test:       ${formatNumber(CONFIG.NUM_MESSAGES)}`)
  console.log(`Warmup messages:         ${CONFIG.WARMUP_MESSAGES}`)
  console.log(`Message sizes:           ${CONFIG.MESSAGE_SIZES.join(', ')} bytes`)
  console.log('═'.repeat(80))
  
  const results = []
  
  // Run benchmark for each message size
  for (let i = 0; i < CONFIG.MESSAGE_SIZES.length; i++) {
    const messageSize = CONFIG.MESSAGE_SIZES[i]
    try {
      const result = await benchmarkMessageSize(messageSize, i)
      results.push(result)
      
      // Wait between tests to ensure port is released
      await sleep(1000)
    } catch (err) {
      console.error(`❌ Benchmark failed for ${messageSize}-byte messages:`, err)
      console.error(err.stack)
      
      // Extra wait on error
      await sleep(2000)
    }
  }
  
  // Print summary
  console.log('\n' + '═'.repeat(80))
  console.log('📊 SUMMARY - Client-Server Architecture Performance')
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
  console.log('   • This tests Client and Server (full application stack)')
  console.log('   • Includes Protocol layer with handshake and request/response tracking')
  console.log('   • Compare with benchmark/router-dealer-baseline.js for transport-only performance')
  console.log('   • Expected overhead: 10-20% due to Protocol layer and event handling')
  
  console.log('\n' + '═'.repeat(80) + '\n')
  
  process.exit(0)
}

// Run benchmarks
runBenchmarks().catch((err) => {
  console.error('❌ Benchmark suite failed:', err)
  console.error(err.stack)
  process.exit(1)
})

