#!/usr/bin/env node

/**
 * Zeronode Node Throughput Benchmark - NPM Version
 * 
 * Tests the latest published npm version of Zeronode
 * Compare against the local optimized version
 * 
 * SETUP:
 * 1. Install npm version: cd benchmark && npm install zeronode
 * 2. Run: npm run benchmark:node-npm
 * 3. Compare: npm run benchmark:compare-npm
 */

import { Node } from './node_modules/zeronode/dist/index.js'  // Use npm version from benchmark folder
import { performance } from 'perf_hooks'

// Configuration
const CONFIG = {
  SERVER_ADDRESS: 'tcp://127.0.0.1:5502',  // Different port to avoid conflicts
  NUM_MESSAGES: 10000,
  WARMUP_MESSAGES: 100,
  MESSAGE_SIZES: [100, 500, 1000, 2000]
}

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createMessage(size) {
  // Create an object with approximately 'size' bytes when serialized
  const dataSize = Math.max(1, Math.floor((size - 50) / 10)) // Rough estimate
  const data = {
    payload: 'A'.repeat(dataSize),
    timestamp: Date.now(),
    index: 0
  }
  return data
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
  console.log(`📦 Testing ~${messageSize}-byte messages`)
  console.log('─'.repeat(80))
  
  const metrics = {
    sent: 0,
    received: 0,
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  // Create Server Node
  const serverNode = new Node({
    id: 'benchmark-server-npm',
    bind: CONFIG.SERVER_ADDRESS
  })
  
  // Handle server requests
  serverNode.onRequest('echo', (request) => {
    const { body, reply } = request
    metrics.received++
    reply({ success: true, data: body.data, timestamp: Date.now() })
  })
  
  await serverNode.bind()
  console.log(`✅ Server node bound to ${CONFIG.SERVER_ADDRESS}`)
  
  await sleep(500)
  
  // Create Client Node
  const clientNode = new Node({
    id: 'benchmark-client-npm'
  })
  
  console.log(`✅ Client node created`)
  
  // Connect to server
  await clientNode.connect({ address: CONFIG.SERVER_ADDRESS })
  console.log(`✅ Client connected to server`)
  
  await sleep(500)
  
  // Warmup
  console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
  const warmupMsg = createMessage(messageSize)
  
  for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
    try {
      await clientNode.request({
        to: 'benchmark-server-npm',
        event: 'echo',
        data: warmupMsg
      })
    } catch (err) {
      // Ignore warmup errors
    }
  }
  
  console.log('✅ Warmup complete')
  await sleep(500)
  
  // Run benchmark
  console.log(`🏃 Running benchmark (${CONFIG.NUM_MESSAGES} messages)...`)
  const testMsg = createMessage(messageSize)
  
  metrics.startTime = performance.now()
  
  // Send messages with latency tracking
  const BATCH_SIZE = 50
  const numBatches = Math.ceil(CONFIG.NUM_MESSAGES / BATCH_SIZE)
  
  for (let batch = 0; batch < numBatches; batch++) {
    const promises = []
    const batchSize = Math.min(BATCH_SIZE, CONFIG.NUM_MESSAGES - batch * BATCH_SIZE)
    
    for (let i = 0; i < batchSize; i++) {
      const sendTime = performance.now()
      
      const promise = clientNode.request({
        to: 'benchmark-server-npm',
        event: 'echo',
        data: { ...testMsg, index: batch * BATCH_SIZE + i }
      })
        .then(() => {
          const latency = performance.now() - sendTime
          metrics.latencies.push(latency)
          metrics.sent++
        })
        .catch((err) => {
          console.error('Request failed:', err.message)
        })
      
      promises.push(promise)
    }
    
    await Promise.all(promises)
    
    // Small delay between batches
    if (batch % 10 === 0 && batch > 0) {
      await sleep(10)
    }
  }
  
  metrics.endTime = performance.now()
  
  // Calculate results
  const duration = (metrics.endTime - metrics.startTime) / 1000
  const throughput = metrics.sent / duration
  const latencyStats = calculateStats(metrics.latencies)
  
  // Estimate actual message size
  const sampleMsg = JSON.stringify(testMsg)
  const actualSize = Buffer.byteLength(sampleMsg, 'utf8')
  const bandwidth = (throughput * actualSize) / (1024 * 1024) // MB/s
  
  // Print results
  console.log(`\n📊 Results for ~${messageSize}-byte messages (actual: ${actualSize}B):`)
  console.log(`   Messages Sent:       ${formatNumber(metrics.sent)}`)
  console.log(`   Messages Received:   ${formatNumber(metrics.received)}`)
  console.log(`   Duration:            ${formatNumber(duration)}s`)
  console.log(`   Throughput:          ${formatNumber(throughput)} msg/sec`)
  console.log(`   Bandwidth:           ${formatNumber(bandwidth)} MB/sec`)
  
  if (latencyStats) {
    console.log(`\n   📈 Latency Statistics (ms):`)
    console.log(`      Min:              ${formatNumber(latencyStats.min)}`)
    console.log(`      Mean:             ${formatNumber(latencyStats.mean)}`)
    console.log(`      Median:           ${formatNumber(latencyStats.median)}`)
    console.log(`      95th percentile:  ${formatNumber(latencyStats.p95)}`)
    console.log(`      99th percentile:  ${formatNumber(latencyStats.p99)}`)
    console.log(`      Max:              ${formatNumber(latencyStats.max)}`)
  }
  
  // Cleanup
  await clientNode.stop()
  await serverNode.stop()
  
  // Wait for socket cleanup and OS to release port
  await sleep(3000)
  
  return {
    messageSize,
    actualSize,
    duration,
    throughput,
    bandwidth,
    latency: latencyStats
  }
}

async function runBenchmarks() {
  console.log('🚀 Zeronode Node Throughput Benchmark (NPM VERSION)')
  console.log('═'.repeat(80))
  console.log(`Server Address:          ${CONFIG.SERVER_ADDRESS}`)
  console.log(`Messages per test:       ${formatNumber(CONFIG.NUM_MESSAGES)}`)
  console.log(`Warmup messages:         ${CONFIG.WARMUP_MESSAGES}`)
  console.log(`Target message sizes:    ${CONFIG.MESSAGE_SIZES.join(', ')} bytes`)
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
  console.log('📊 SUMMARY - Zeronode NPM Version Performance')
  console.log('═'.repeat(80))
  console.log('\n┌──────────────┬───────────────┬──────────────┬─────────────┐')
  console.log('│ Message Size │   Throughput  │   Bandwidth  │ Mean Latency│')
  console.log('├──────────────┼───────────────┼──────────────┼─────────────┤')
  
  for (const result of results) {
    const size = `${result.messageSize} (${result.actualSize})`.padStart(10)
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

