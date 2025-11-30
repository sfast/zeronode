#!/usr/bin/env node

/**
 * Zeronode Router Overhead Benchmark
 * 
 * Compares direct communication vs router-based communication
 * to measure the overhead introduced by router-based service discovery.
 * 
 * Scenarios:
 * 1. Direct: Node A → Node B (direct connection)
 * 2. Routed: Node A → Router → Node B (router-based discovery)
 * 
 * Measures:
 * - Throughput (messages/second)
 * - Latency (min/mean/median/p95/p99/max)
 * - Overhead percentage
 */

import { Node, Router } from '../src/index.js'
import { performance } from 'perf_hooks'

// Configuration
const CONFIG = {
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
  const dataSize = Math.max(1, Math.floor((size - 50) / 10))
  const data = {
    payload: 'x'.repeat(dataSize),
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

async function benchmarkDirect(messageSize) {
  console.log(`\n${'─'.repeat(80)}`)
  console.log(`📦 Direct Communication: ~${messageSize}-byte messages`)
  console.log('─'.repeat(80))
  
  const metrics = {
    sent: 0,
    received: 0,
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  // Setup nodes
  const nodeA = new Node({
    id: 'node-a',
    bind: 'tcp://127.0.0.1:6000',
    options: { role: 'client' }
  })
  
  const nodeB = new Node({
    id: 'node-b',
    bind: 'tcp://127.0.0.1:6001',
    options: { role: 'server' }
  })
  
  // Register handler
  nodeB.onRequest('ping', (envelope, reply) => {
    metrics.received++
    reply({ pong: true, echo: envelope.data })
  })
  
  await nodeA.bind()
  await nodeB.bind()
  await nodeA.connect({ address: nodeB.getAddress() })
  
  console.log(`✅ Node A bound to tcp://127.0.0.1:6000`)
  console.log(`✅ Node B bound to tcp://127.0.0.1:6001`)
  console.log(`✅ Node A connected directly to Node B`)
  
  await sleep(500)
  
  // Warmup
  console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
  const warmupMsg = createMessage(messageSize)
  
  for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
    await nodeA.request({
      to: nodeB.getId(),
      event: 'ping',
      data: warmupMsg
    })
  }
  
  console.log('✅ Warmup complete')
  await sleep(500)
  
  // Benchmark
  console.log(`🏃 Running benchmark (${CONFIG.NUM_MESSAGES} messages)...`)
  const testMsg = createMessage(messageSize)
  
  metrics.startTime = performance.now()
  
  for (let i = 0; i < CONFIG.NUM_MESSAGES; i++) {
    const sendTime = performance.now()
    
    await nodeA.request({
      to: nodeB.getId(),
      event: 'ping',
      data: testMsg
    })
    
    const latency = performance.now() - sendTime
    metrics.latencies.push(latency)
    metrics.sent++
  }
  
  metrics.endTime = performance.now()
  
  // Calculate results
  const duration = (metrics.endTime - metrics.startTime) / 1000
  const throughput = metrics.sent / duration
  const latencyStats = calculateStats(metrics.latencies)
  
  const sampleMsg = JSON.stringify(testMsg)
  const actualSize = Buffer.byteLength(sampleMsg, 'utf8')
  const bandwidth = (throughput * actualSize) / (1024 * 1024)
  
  // Print results
  console.log(`\n📊 Direct Communication Results (~${messageSize}B, actual: ${actualSize}B):`)
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
  await nodeA.close()
  await nodeB.close()
  await sleep(2000)
  
  return {
    messageSize,
    actualSize,
    duration,
    throughput,
    bandwidth,
    latency: latencyStats
  }
}

async function benchmarkRouter(messageSize) {
  console.log(`\n${'─'.repeat(80)}`)
  console.log(`📦 Router-Based Communication: ~${messageSize}-byte messages`)
  console.log('─'.repeat(80))
  
  const metrics = {
    sent: 0,
    received: 0,
    latencies: [],
    startTime: 0,
    endTime: 0
  }
  
  // Setup router and nodes
  const router = new Router({
    id: 'router',
    bind: 'tcp://127.0.0.1:7000'
  })
  
  const nodeA = new Node({
    id: 'node-a',
    bind: 'tcp://127.0.0.1:7001',
    options: { role: 'client' }
  })
  
  const nodeB = new Node({
    id: 'node-b',
    bind: 'tcp://127.0.0.1:7002',
    options: { role: 'server' }
  })
  
  // Register handler
  nodeB.onRequest('ping', (envelope, reply) => {
    metrics.received++
    reply({ pong: true, echo: envelope.data })
  })
  
  await router.bind()
  await nodeA.bind()
  await nodeB.bind()
  
  // Connect both nodes to router (no direct connection!)
  await nodeA.connect({ address: router.getAddress() })
  await nodeB.connect({ address: router.getAddress() })
  
  console.log(`✅ Router bound to tcp://127.0.0.1:7000`)
  console.log(`✅ Node A bound to tcp://127.0.0.1:7001`)
  console.log(`✅ Node B bound to tcp://127.0.0.1:7002`)
  console.log(`✅ Node A connected to Router`)
  console.log(`✅ Node B connected to Router`)
  
  await sleep(500)
  
  // Warmup
  console.log(`⚙️  Warming up (${CONFIG.WARMUP_MESSAGES} messages)...`)
  const warmupMsg = createMessage(messageSize)
  
  for (let i = 0; i < CONFIG.WARMUP_MESSAGES; i++) {
    await nodeA.requestAny({
      filter: { role: 'server' },
      event: 'ping',
      data: warmupMsg
    })
  }
  
  console.log('✅ Warmup complete')
  await sleep(500)
  
  // Benchmark
  console.log(`🏃 Running benchmark (${CONFIG.NUM_MESSAGES} messages)...`)
  const testMsg = createMessage(messageSize)
  
  metrics.startTime = performance.now()
  
  for (let i = 0; i < CONFIG.NUM_MESSAGES; i++) {
    const sendTime = performance.now()
    
    await nodeA.requestAny({
      filter: { role: 'server' },
      event: 'ping',
      data: testMsg
    })
    
    const latency = performance.now() - sendTime
    metrics.latencies.push(latency)
    metrics.sent++
  }
  
  metrics.endTime = performance.now()
  
  // Calculate results
  const duration = (metrics.endTime - metrics.startTime) / 1000
  const throughput = metrics.sent / duration
  const latencyStats = calculateStats(metrics.latencies)
  
  const sampleMsg = JSON.stringify(testMsg)
  const actualSize = Buffer.byteLength(sampleMsg, 'utf8')
  const bandwidth = (throughput * actualSize) / (1024 * 1024)
  
  // Get router stats
  const routerStats = router.getRoutingStats()
  
  // Print results
  console.log(`\n📊 Router-Based Communication Results (~${messageSize}B, actual: ${actualSize}B):`)
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
  
  console.log(`\n   🔀 Router Statistics:`)
  console.log(`      Proxy Requests:   ${routerStats.proxyRequests}`)
  console.log(`      Proxy Ticks:      ${routerStats.proxyTicks}`)
  console.log(`      Successful:       ${routerStats.successfulRoutes}`)
  console.log(`      Failed:           ${routerStats.failedRoutes}`)
  console.log(`      Router Uptime:    ${formatNumber(routerStats.uptime)}s`)
  console.log(`      Avg Req/Sec:      ${formatNumber(routerStats.requestsPerSecond)}`)
  
  // Cleanup
  await nodeA.close()
  await nodeB.close()
  await router.close()
  await sleep(2000)
  
  return {
    messageSize,
    actualSize,
    duration,
    throughput,
    bandwidth,
    latency: latencyStats,
    routerStats
  }
}

async function runBenchmarks() {
  console.log('🚀 Zeronode Router Overhead Benchmark')
  console.log('   (Sequential requests - measures router overhead)')
  console.log('═'.repeat(80))
  console.log(`Messages per test:       ${formatNumber(CONFIG.NUM_MESSAGES)}`)
  console.log(`Warmup messages:         ${CONFIG.WARMUP_MESSAGES}`)
  console.log(`Target message sizes:    ${CONFIG.MESSAGE_SIZES.join(', ')} bytes`)
  console.log('═'.repeat(80))
  
  const directResults = []
  const routerResults = []
  
  // Run benchmarks for each message size
  for (const messageSize of CONFIG.MESSAGE_SIZES) {
    try {
      // Direct communication
      const directResult = await benchmarkDirect(messageSize)
      directResults.push(directResult)
      
      await sleep(1000)
      
      // Router-based communication
      const routerResult = await benchmarkRouter(messageSize)
      routerResults.push(routerResult)
      
      await sleep(1000)
    } catch (err) {
      console.error(`❌ Benchmark failed for ${messageSize}-byte messages:`, err)
    }
  }
  
  // Print comparison summary
  console.log('\n' + '═'.repeat(80))
  console.log('📊 COMPARISON SUMMARY - Direct vs Router-Based')
  console.log('═'.repeat(80))
  
  console.log('\n🎯 Throughput Comparison:')
  console.log('┌──────────────┬───────────────┬───────────────┬─────────────┐')
  console.log('│ Message Size │ Direct (msg/s)│ Router (msg/s)│   Overhead  │')
  console.log('├──────────────┼───────────────┼───────────────┼─────────────┤')
  
  for (let i = 0; i < directResults.length; i++) {
    const direct = directResults[i]
    const router = routerResults[i]
    
    const size = `${direct.messageSize} (${direct.actualSize})`.padStart(10)
    const directTput = formatNumber(direct.throughput).padStart(11)
    const routerTput = formatNumber(router.throughput).padStart(11)
    const overhead = ((1 - router.throughput / direct.throughput) * 100).toFixed(1)
    const overheadStr = `${overhead}%`.padStart(9)
    
    console.log(`│ ${size}B  │ ${directTput}   │ ${routerTput}   │ ${overheadStr}   │`)
  }
  
  console.log('└──────────────┴───────────────┴───────────────┴─────────────┘')
  
  console.log('\n⚡ Mean Latency Comparison:')
  console.log('┌──────────────┬───────────────┬───────────────┬─────────────┐')
  console.log('│ Message Size │  Direct (ms)  │  Router (ms)  │  Overhead   │')
  console.log('├──────────────┼───────────────┼───────────────┼─────────────┤')
  
  for (let i = 0; i < directResults.length; i++) {
    const direct = directResults[i]
    const router = routerResults[i]
    
    const size = `${direct.messageSize} (${direct.actualSize})`.padStart(10)
    const directLat = formatNumber(direct.latency.mean).padStart(11)
    const routerLat = formatNumber(router.latency.mean).padStart(11)
    const overhead = ((router.latency.mean / direct.latency.mean - 1) * 100).toFixed(1)
    const overheadStr = `${overhead}%`.padStart(9)
    
    console.log(`│ ${size}B  │ ${directLat}    │ ${routerLat}    │ ${overheadStr}   │`)
  }
  
  console.log('└──────────────┴───────────────┴───────────────┴─────────────┘')
  
  console.log('\n📈 P95 Latency Comparison:')
  console.log('┌──────────────┬───────────────┬───────────────┬─────────────┐')
  console.log('│ Message Size │  Direct (ms)  │  Router (ms)  │  Overhead   │')
  console.log('├──────────────┼───────────────┼───────────────┼─────────────┤')
  
  for (let i = 0; i < directResults.length; i++) {
    const direct = directResults[i]
    const router = routerResults[i]
    
    const size = `${direct.messageSize} (${direct.actualSize})`.padStart(10)
    const directP95 = formatNumber(direct.latency.p95).padStart(11)
    const routerP95 = formatNumber(router.latency.p95).padStart(11)
    const overhead = ((router.latency.p95 / direct.latency.p95 - 1) * 100).toFixed(1)
    const overheadStr = `${overhead}%`.padStart(9)
    
    console.log(`│ ${size}B  │ ${directP95}    │ ${routerP95}    │ ${overheadStr}   │`)
  }
  
  console.log('└──────────────┴───────────────┴───────────────┴─────────────┘')
  
  // Calculate average overhead
  const avgThroughputOverhead = routerResults.reduce((sum, router, i) => {
    return sum + (1 - router.throughput / directResults[i].throughput) * 100
  }, 0) / routerResults.length
  
  const avgLatencyOverhead = routerResults.reduce((sum, router, i) => {
    return sum + (router.latency.mean / directResults[i].latency.mean - 1) * 100
  }, 0) / routerResults.length
  
  console.log('\n💡 Analysis:')
  console.log(`   Average throughput overhead: ${avgThroughputOverhead.toFixed(1)}%`)
  console.log(`   Average latency overhead:    ${avgLatencyOverhead.toFixed(1)}%`)
  
  if (avgLatencyOverhead < 10) {
    console.log('   🟢 Excellent: Router overhead is minimal (<10%)')
  } else if (avgLatencyOverhead < 25) {
    console.log('   🟡 Good: Router overhead is acceptable (<25%)')
  } else if (avgLatencyOverhead < 50) {
    console.log('   🟠 Fair: Router overhead is moderate (<50%)')
  } else {
    console.log('   🔴 High: Router overhead is significant (>50%)')
  }
  
  console.log('\n📝 Notes:')
  console.log('   • Router adds one extra hop (A → Router → B instead of A → B)')
  console.log('   • Router performs service discovery + filter matching per request')
  console.log('   • Overhead includes: 2x network hops + routing logic + metadata handling')
  console.log('   • For latency-critical apps, use direct connections when topology is known')
  console.log('   • For dynamic topologies, router overhead is worth the flexibility')
  console.log('\n' + '═'.repeat(80) + '\n')
  
  process.exit(0)
}

// Run benchmarks
runBenchmarks().catch((err) => {
  console.error('❌ Benchmark suite failed:', err)
  process.exit(1)
})
