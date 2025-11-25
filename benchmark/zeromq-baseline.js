#!/usr/bin/env node

/**
 * Pure ZeroMQ DEALER-ROUTER Throughput Benchmark
 * 
 * Tests raw ZeroMQ performance (baseline for comparison)
 * Measures throughput for different message sizes:
 * - 100 bytes (small messages)
 * - 500 bytes (medium messages)
 * - 1000 bytes (larger payloads)
 * - 2000 bytes (large messages)
 * 
 * This establishes the theoretical maximum performance
 */

import * as zmq from 'zeromq'
import { performance } from 'perf_hooks'

// Configuration
const CONFIG = {
  ROUTER_ADDRESS: 'tcp://127.0.0.1:5000',
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
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  // Create Router socket
  const router = new zmq.Router()
  await router.bind(CONFIG.ROUTER_ADDRESS)
  console.log(`✅ Router bound to ${CONFIG.ROUTER_ADDRESS}`)
  
  // Create Dealer socket (client)
  const dealer = new zmq.Dealer()
  dealer.connect(CONFIG.ROUTER_ADDRESS)
  console.log(`✅ Dealer connected to ${CONFIG.ROUTER_ADDRESS}`)
  
  await sleep(500)
  
  // Handle router responses
  const routerHandler = async () => {
    for await (const [identity, delimiter, message] of router) {
      // Echo back the message
      await router.send([identity, delimiter, message])
      metrics.received++
    }
  }
  
  // Start router handler (don't await - let it run)
  routerHandler().catch(err => {
    if (err.message !== 'Context was terminated') {
      console.error('Router error:', err)
    }
  })
  
  // Warmup
  console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
  const warmupMsg = createMessage(messageSize)
  
  for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
    await dealer.send(warmupMsg)
    await dealer.receive()
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
    
    await dealer.send(testMsg)
    await dealer.receive()
    
    const latency = performance.now() - sendTime
    metrics.latencies.push(latency)
    metrics.sent++
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
  
  // Cleanup
  dealer.close()
  router.close()
  
  await sleep(500)
  
  return {
    messageSize,
    duration,
    throughput,
    bandwidth,
    latency: latencyStats
  }
}

async function runBenchmarks() {
  console.log('🚀 Pure ZeroMQ DEALER-ROUTER Throughput Benchmark')
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
  console.log('📊 SUMMARY - Pure ZeroMQ Performance')
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
  console.log('\n' + '═'.repeat(80) + '\n')
  
  process.exit(0)
}

// Run benchmarks
runBenchmarks().catch((err) => {
  console.error('❌ Benchmark suite failed:', err)
  process.exit(1)
})

