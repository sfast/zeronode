/**
 * Request/Response Throughput Benchmark
 * Tests message throughput and latency
 */

import Server from '../src/server.js'
import Client from '../src/client.js'

const TEST_DURATION = 5000 // 5 seconds
const WARMUP_DURATION = 1000 // 1 second warmup

async function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function benchmarkRequestResponse () {
  console.log('='.repeat(60))
  console.log('🚀 Request/Response Throughput Benchmark')
  console.log('='.repeat(60))

  const address = 'tcp://127.0.0.1:9500'
  
  // Setup server
  const server = new Server({
    id: 'benchmark-server',
    bind: address
  })

  await server.bind()
  
  // Setup client
  const client = new Client({
    id: 'benchmark-client'
  })

  await client.connect(address)
  
  // Set up echo handler AFTER connection
  server.onRequest('echo', ({ body, reply }) => {
    reply(body)
  })
  
  await sleep(500) // Let connection stabilize

  console.log('\n🔥 Warmup phase...')
  const warmupStart = Date.now()
  let warmupCount = 0
  while (Date.now() - warmupStart < WARMUP_DURATION) {
    await client.request({ event: 'echo', data: { test: 'data' } })
    warmupCount++
  }
  console.log(`   Completed ${warmupCount} requests`)

  console.log('\n📊 Benchmark phase...')
  const latencies = []
  const start = Date.now()
  let requestCount = 0
  let errorCount = 0

  while (Date.now() - start < TEST_DURATION) {
    const reqStart = process.hrtime.bigint()
    try {
      await client.request({ event: 'echo', data: { test: 'data', index: requestCount } })
      const reqEnd = process.hrtime.bigint()
      const latency = Number(reqEnd - reqStart) / 1e6 // Convert to ms
      latencies.push(latency)
      requestCount++
    } catch (err) {
      errorCount++
    }
  }

  const totalTime = Date.now() - start

  // Calculate statistics
  const throughput = (requestCount / totalTime) * 1000 // requests per second
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const minLatency = Math.min(...latencies)
  const maxLatency = Math.max(...latencies)
  
  // Calculate percentiles
  const sorted = latencies.sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]

  console.log('\n📈 Results:')
  console.log(`  Duration:        ${totalTime}ms`)
  console.log(`  Total Requests:  ${requestCount.toLocaleString()}`)
  console.log(`  Errors:          ${errorCount}`)
  console.log(`  Throughput:      ${throughput.toFixed(2)} req/sec`)
  console.log('\n⏱️  Latency:')
  console.log(`  Average:         ${avgLatency.toFixed(2)}ms`)
  console.log(`  Min:             ${minLatency.toFixed(2)}ms`)
  console.log(`  Max:             ${maxLatency.toFixed(2)}ms`)
  console.log(`  P50 (median):    ${p50.toFixed(2)}ms`)
  console.log(`  P95:             ${p95.toFixed(2)}ms`)
  console.log(`  P99:             ${p99.toFixed(2)}ms`)

  // Cleanup
  await client.disconnect()
  await server.unbind()

  console.log('\n' + '='.repeat(60))
  console.log('✅ Benchmark Complete')
  console.log('='.repeat(60))
}

async function benchmarkTicks () {
  console.log('\n\n')
  console.log('='.repeat(60))
  console.log('🚀 Tick (One-Way Message) Throughput Benchmark')
  console.log('='.repeat(60))

  const address = 'tcp://127.0.0.1:9501'
  
  const server = new Server({
    id: 'tick-benchmark-server',
    bind: address
  })

  await server.bind()
  
  const client = new Client({
    id: 'tick-benchmark-client'
  })

  await client.connect(address)
  
  let receivedCount = 0
  server.onTick('tick:test', () => {
    receivedCount++
  })
  
  await sleep(500)

  console.log('\n🔥 Warmup phase...')
  const warmupStart = Date.now()
  let warmupCount = 0
  while (Date.now() - warmupStart < WARMUP_DURATION) {
    try {
      client.tick({ event: 'tick:test', data: { test: 'data' } })
      warmupCount++
      // Small delay to prevent socket saturation
      if (warmupCount % 100 === 0) {
        await sleep(1)
      }
    } catch (err) {
      if (err.code !== 'EBUSY') throw err
      await sleep(10)
    }
  }
  await sleep(100) // Let messages be processed
  console.log(`   Sent ${warmupCount} ticks`)

  receivedCount = 0 // Reset counter
  
  console.log('\n📊 Benchmark phase...')
  const start = Date.now()
  let sentCount = 0

  while (Date.now() - start < TEST_DURATION) {
    try {
      client.tick({ event: 'tick:test', data: { test: 'data', index: sentCount } })
      sentCount++
      // Small delay every 100 ticks to prevent socket saturation
      if (sentCount % 100 === 0) {
        await sleep(1)
      }
    } catch (err) {
      if (err.code !== 'EBUSY') throw err
      await sleep(10)
    }
  }

  await sleep(500) // Wait for all ticks to be processed

  const totalTime = Date.now() - start
  const throughput = (sentCount / totalTime) * 1000

  console.log('\n📈 Results:')
  console.log(`  Duration:        ${totalTime}ms`)
  console.log(`  Sent:            ${sentCount.toLocaleString()} ticks`)
  console.log(`  Received:        ${receivedCount.toLocaleString()} ticks`)
  console.log(`  Loss:            ${((1 - receivedCount / sentCount) * 100).toFixed(2)}%`)
  console.log(`  Throughput:      ${throughput.toFixed(2)} ticks/sec`)

  await client.disconnect()
  await server.unbind()

  console.log('\n' + '='.repeat(60))
  console.log('✅ Benchmark Complete')
  console.log('='.repeat(60))
}

// Run benchmarks
(async () => {
  try {
    await benchmarkRequestResponse()
    await benchmarkTicks()
    process.exit(0)
  } catch (err) {
    console.error('Benchmark error:', err)
    process.exit(1)
  }
})()

