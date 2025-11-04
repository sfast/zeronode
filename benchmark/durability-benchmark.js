/**
 * Durability & Resource Usage Benchmark
 * Tests system stability under sustained mixed load and monitors CPU/memory
 */

import Server from '../src/server.js'
import Client from '../src/client.js'
import os from 'os'

// Configuration
const TEST_DURATION = 60000 // 60 seconds (can be increased for longer tests)
const TARGET_RATE = 1000 // Messages per second
const REQUEST_RATIO = 0.3 // 30% requests, 70% ticks
const REPORT_INTERVAL = 5000 // Report every 5 seconds

// Get CPU usage
function getCPUUsage () {
  const cpus = os.cpus()
  let totalIdle = 0
  let totalTick = 0

  cpus.forEach(cpu => {
    for (let type in cpu.times) {
      totalTick += cpu.times[type]
    }
    totalIdle += cpu.times.idle
  })

  return {
    idle: totalIdle / cpus.length,
    total: totalTick / cpus.length,
    count: cpus.length
  }
}

// Calculate CPU percentage
function calculateCPUPercent (startCPU, endCPU) {
  const idleDiff = endCPU.idle - startCPU.idle
  const totalDiff = endCPU.total - startCPU.total
  const percentCPU = 100 - ~~(100 * idleDiff / totalDiff)
  return percentCPU
}

// Get memory usage
function getMemoryUsage () {
  const usage = process.memoryUsage()
  return {
    heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(2), // MB
    heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(2), // MB
    rss: (usage.rss / 1024 / 1024).toFixed(2), // MB
    external: (usage.external / 1024 / 1024).toFixed(2) // MB
  }
}

// Format bytes to human readable
function formatBytes (bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

async function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function durabilityBenchmark () {
  console.log('='.repeat(70))
  console.log('🔥 Durability & Resource Usage Benchmark')
  console.log('='.repeat(70))
  console.log(`Test Duration:    ${TEST_DURATION / 1000}s`)
  console.log(`Target Rate:      ${TARGET_RATE} msg/sec`)
  console.log(`Request Ratio:    ${(REQUEST_RATIO * 100).toFixed(0)}% requests, ${((1 - REQUEST_RATIO) * 100).toFixed(0)}% ticks`)
  console.log(`Report Interval:  ${REPORT_INTERVAL / 1000}s`)
  console.log('='.repeat(70))

  const address = 'tcp://127.0.0.1:9600'
  
  // Setup server
  const server = new Server({
    id: 'durability-server',
    bind: address
  })

  await server.bind()
  
  // Setup client
  const client = new Client({
    id: 'durability-client'
  })

  await client.connect(address)
  
  // Handlers
  server.onRequest('durability:request', ({ body, reply }) => {
    reply({ echo: body, timestamp: Date.now() })
  })
  
  let ticksReceived = 0
  server.onTick('durability:tick', () => {
    ticksReceived++
  })
  
  await sleep(500)

  // Statistics
  const stats = {
    requestsSent: 0,
    requestsSucceeded: 0,
    requestsFailed: 0,
    ticksSent: 0,
    startTime: Date.now(),
    lastReportTime: Date.now(),
    reports: [],
    latencies: []
  }

  // Resource tracking
  let startCPU = getCPUUsage()
  const startMemory = getMemoryUsage()

  console.log('\n📊 Starting benchmark...\n')
  console.log('Time  | Msgs/s | Req/s | Tck/s | CPU%  | Heap MB | RSS MB  | Req Err | Latency P50')
  console.log('-'.repeat(90))

  // Progress reporting
  const reportInterval = setInterval(() => {
    const now = Date.now()
    const elapsed = (now - stats.lastReportTime) / 1000
    
    const msgsPerSec = ((stats.requestsSent + stats.ticksSent) / elapsed).toFixed(0)
    const reqPerSec = (stats.requestsSent / elapsed).toFixed(0)
    const tickPerSec = (stats.ticksSent / elapsed).toFixed(0)
    
    const endCPU = getCPUUsage()
    const cpuPercent = calculateCPUPercent(startCPU, endCPU)
    startCPU = endCPU
    
    const memory = getMemoryUsage()
    
    // Calculate latency percentile
    const p50 = stats.latencies.length > 0 
      ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.5)].toFixed(2)
      : 'N/A'
    
    const errorRate = stats.requestsSent > 0 
      ? ((stats.requestsFailed / stats.requestsSent) * 100).toFixed(2) + '%'
      : '0%'
    
    const totalTime = ((now - stats.startTime) / 1000).toFixed(0)
    
    console.log(
      `${totalTime}s`.padEnd(6) + ' | ' +
      msgsPerSec.padStart(6) + ' | ' +
      reqPerSec.padStart(5) + ' | ' +
      tickPerSec.padStart(5) + ' | ' +
      cpuPercent.toFixed(1).padStart(5) + ' | ' +
      memory.heapUsed.padStart(7) + ' | ' +
      memory.rss.padStart(7) + ' | ' +
      errorRate.padStart(7) + ' | ' +
      (p50 !== 'N/A' ? p50 + 'ms' : 'N/A')
    )
    
    // Save snapshot
    stats.reports.push({
      time: totalTime,
      msgsPerSec: parseInt(msgsPerSec),
      reqPerSec: parseInt(reqPerSec),
      tickPerSec: parseInt(tickPerSec),
      cpuPercent,
      memory: { ...memory },
      errorRate,
      p50
    })
    
    // Reset interval counters
    stats.requestsSent = 0
    stats.requestsSucceeded = 0
    stats.requestsFailed = 0
    stats.ticksSent = 0
    stats.latencies = []
    stats.lastReportTime = now
  }, REPORT_INTERVAL)

  // Message sending loop
  const startTime = Date.now()
  const messageInterval = 1000 / TARGET_RATE // Time between messages in ms
  let messagesSent = 0
  
  while (Date.now() - startTime < TEST_DURATION) {
    const shouldSendRequest = Math.random() < REQUEST_RATIO
    
    if (shouldSendRequest) {
      // Send request
      stats.requestsSent++
      const reqStart = process.hrtime.bigint()
      
      try {
        await client.request({ 
          event: 'durability:request', 
          data: { index: messagesSent, timestamp: Date.now() },
          timeout: 5000
        })
        const reqEnd = process.hrtime.bigint()
        const latency = Number(reqEnd - reqStart) / 1e6
        stats.latencies.push(latency)
        stats.requestsSucceeded++
      } catch (err) {
        stats.requestsFailed++
      }
    } else {
      // Send tick
      try {
        client.tick({ 
          event: 'durability:tick', 
          data: { index: messagesSent, timestamp: Date.now() }
        })
        stats.ticksSent++
      } catch (err) {
        // Ignore tick errors (fire and forget)
      }
    }
    
    messagesSent++
    
    // Pace messages to hit target rate
    if (messagesSent % 10 === 0) {
      const elapsed = Date.now() - startTime
      const expected = messagesSent * messageInterval
      const drift = expected - elapsed
      if (drift > 1) {
        await sleep(Math.min(drift, 10))
      }
    }
  }

  clearInterval(reportInterval)
  await sleep(1000) // Let final messages process

  console.log('-'.repeat(90))

  // Final summary
  const totalElapsed = (Date.now() - startTime) / 1000
  const endMemory = getMemoryUsage()
  const memoryGrowth = (parseFloat(endMemory.heapUsed) - parseFloat(startMemory.heapUsed)).toFixed(2)
  const memoryGrowthPercent = ((memoryGrowth / parseFloat(startMemory.heapUsed)) * 100).toFixed(2)

  console.log('\n📈 Final Summary:')
  console.log('='.repeat(70))
  console.log(`Total Runtime:        ${totalElapsed.toFixed(2)}s`)
  console.log(`Total Messages:       ${messagesSent.toLocaleString()}`)
  console.log(`Average Rate:         ${(messagesSent / totalElapsed).toFixed(0)} msg/sec`)
  console.log(`Ticks Received:       ${ticksReceived.toLocaleString()}`)
  console.log(`\nMemory:`)
  console.log(`  Start Heap:         ${startMemory.heapUsed} MB`)
  console.log(`  End Heap:           ${endMemory.heapUsed} MB`)
  console.log(`  Growth:             ${memoryGrowth > 0 ? '+' : ''}${memoryGrowth} MB (${memoryGrowthPercent > 0 ? '+' : ''}${memoryGrowthPercent}%)`)
  console.log(`  RSS:                ${endMemory.rss} MB`)
  
  // Calculate average CPU
  const avgCPU = stats.reports.reduce((sum, r) => sum + r.cpuPercent, 0) / stats.reports.length
  console.log(`\nCPU:`)
  console.log(`  Average:            ${avgCPU.toFixed(2)}%`)
  console.log(`  Cores:              ${os.cpus().length}`)
  
  // Memory leak detection
  if (parseFloat(memoryGrowthPercent) > 50) {
    console.log(`\n⚠️  WARNING: Significant memory growth detected (${memoryGrowthPercent}%)`)
    console.log('   This may indicate a memory leak.')
  } else if (parseFloat(memoryGrowthPercent) > 20) {
    console.log(`\n⚡ NOTICE: Moderate memory growth (${memoryGrowthPercent}%)`)
  } else {
    console.log(`\n✅ Memory usage stable (${memoryGrowthPercent}% growth)`)
  }

  // Cleanup
  await client.disconnect()
  await server.unbind()

  console.log('\n' + '='.repeat(70))
  console.log('✅ Durability Benchmark Complete')
  console.log('='.repeat(70))
}

// Run benchmark
(async () => {
  try {
    await durabilityBenchmark()
    process.exit(0)
  } catch (err) {
    console.error('Benchmark error:', err)
    process.exit(1)
  }
})()

