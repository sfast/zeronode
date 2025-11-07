#!/usr/bin/env node

/**
 * Router-Dealer Socket Throughput Benchmark
 * 
 * Tests the professionally refactored RouterSocket and DealerSocket
 * Measures throughput for different message sizes:
 * - 100 bytes (small messages)
 * - 500 bytes (medium messages)
 * - 1000 bytes (larger payloads)
 * - 2000 bytes (large messages)
 * 
 * This verifies our socket wrappers maintain performance
 */

import { performance } from 'perf_hooks'
import RouterSocket from '../src/sockets/router.js'
import DealerSocket from '../src/sockets/dealer.js'
import { Timeouts } from '../src/sockets/enum.js'
import { TransportEvent } from '../src/transport-events.js'

// Configuration
const CONFIG = {
  ROUTER_ADDRESS: 'tcp://127.0.0.1:6100',
  NUM_MESSAGES: 10000,  // 100K messages for accurate throughput analysis
  WARMUP_MESSAGES: 100,  // Increased warmup
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
    echoed: 0,
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  // Create Router socket (server)
  const router = new RouterSocket({ 
    id: 'benchmark-router',
    config: {
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 10000,
      ZMQ_RCVHWM: 10000
    }
  })
  
  await router.bind(CONFIG.ROUTER_ADDRESS)
  console.log(`✅ Router bound to ${CONFIG.ROUTER_ADDRESS}`)
  
  // Create Dealer socket (client)
  const dealer = new DealerSocket({ 
    id: 'benchmark-dealer',
    config: {
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 10000,
      ZMQ_RCVHWM: 10000,
      CONNECTION_TIMEOUT: 5000,
      RECONNECTION_TIMEOUT: Timeouts.INFINITY
    }
  })
  
  await dealer.connect(CONFIG.ROUTER_ADDRESS)
  console.log(`✅ Dealer connected to ${CONFIG.ROUTER_ADDRESS}`)
  
  await sleep(500)
  
  // Track received messages and promises
  const pendingMessages = new Map()
  
  // Handle router messages (echo back)
  router.on(TransportEvent.MESSAGE, ({ buffer }) => {
    // Echo back to the sender (dealer)
    router.sendBuffer(buffer, dealer.getId())
    metrics.echoed++
  })
  
  // Handle dealer responses
  dealer.on(TransportEvent.MESSAGE, ({ buffer }) => {
    const msgId = metrics.received
    const resolve = pendingMessages.get(msgId)
    if (resolve) {
      pendingMessages.delete(msgId)
      resolve()
    }
    metrics.received++
  })
  
  // Warmup
  console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
  const warmupMsg = createMessage(messageSize)
  
  for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
    await new Promise((resolve) => {
      pendingMessages.set(i, resolve)
      dealer.sendBuffer(warmupMsg)
    })
  }
  
  console.log('✅ Warmup complete')
  await sleep(500)
  
  // Reset metrics after warmup
  metrics.received = 0
  metrics.echoed = 0
  pendingMessages.clear()
  
  // Run benchmark
  console.log(`🏃 Running benchmark (${CONFIG.NUM_MESSAGES} messages)...`)
  const testMsg = createMessage(messageSize)
  
  metrics.startTime = performance.now()
  
  // Send messages with latency tracking
  for (let i = 0; i < CONFIG.NUM_MESSAGES; i++) {
    const sendTime = performance.now()
    
    await new Promise((resolve) => {
      pendingMessages.set(i, resolve)
      dealer.sendBuffer(testMsg)
    })
    
    const latency = performance.now() - sendTime
    metrics.latencies.push(latency)
    metrics.sent++
  }
  
  metrics.endTime = performance.now()
  
  // Wait for any pending messages
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
  console.log(`   Messages Echoed:     ${formatNumber(metrics.echoed)}`)
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
  await dealer.close()
  await router.close()
  
  await sleep(500)
  
  return {
    messageSize,
    duration,
    throughput,
    bandwidth,
    latency: latencyStats,
    sent: metrics.sent,
    received: metrics.received,
    echoed: metrics.echoed
  }
}

async function runBenchmarks() {
  console.log('🚀 Router-Dealer Socket Throughput Benchmark')
  console.log('   (Professionally Refactored ZeroMQ Wrappers)')
  console.log('═'.repeat(80))
  console.log(`Router Address:          ${CONFIG.ROUTER_ADDRESS}`)
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
      await sleep(1000)
    } catch (err) {
      console.error(`❌ Benchmark failed for ${messageSize}-byte messages:`, err)
    }
  }
  
  // Print summary
  console.log('\n' + '═'.repeat(80))
  console.log('📊 SUMMARY - Router-Dealer Socket Performance')
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
  console.log('   • This tests RouterSocket and DealerSocket (our refactored wrappers)')
  console.log('   • Compare with benchmark/zeromq-baseline.js for pure ZeroMQ performance')
  console.log('   • Expected overhead: 5-10% due to wrapper layer and event handling')
  
  console.log('\n' + '═'.repeat(80) + '\n')
  
  process.exit(0)
}

// Run benchmarks
runBenchmarks().catch((err) => {
  console.error('❌ Benchmark suite failed:', err)
  console.error(err.stack)
  process.exit(1)
})

