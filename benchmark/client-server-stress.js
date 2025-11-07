#!/usr/bin/env node

/**
 * Client-Server Concurrent Stress Test with System Monitoring
 * 
 * Tests concurrent request patterns with real-time monitoring:
 * - Parallel requests (not sequential)
 * - CPU usage tracking
 * - Memory usage tracking
 * - Latency percentiles (p50, p95, p99)
 * - Reports every 10 seconds
 * 
 * This reveals true system capacity under concurrent load
 */

import { performance } from 'perf_hooks'
import os from 'os'
import { Client, Server } from '../src/index.js'
import { events } from '../src/enum.js'

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  ADDRESS: 'tcp://127.0.0.1:7000',
  CONCURRENCY: 100,        // Number of concurrent requests in-flight
  DURATION_SECONDS: 60,    // Test duration (60 seconds)
  MESSAGE_SIZE: 500,       // Message size in bytes
  REPORT_INTERVAL: 10000,  // Report every 10 seconds
  HANDSHAKE_TIMEOUT: 5000
}

// ============================================================================
// SEMAPHORE (Controlled Concurrency)
// ============================================================================

class Semaphore {
  constructor(max) {
    this.max = max
    this.count = 0
    this.queue = []
  }

  async acquire() {
    if (this.count < this.max) {
      this.count++
      return Promise.resolve()
    }
    return new Promise(resolve => this.queue.push(resolve))
  }

  release() {
    this.count--
    if (this.queue.length > 0) {
      this.count++
      const resolve = this.queue.shift()
      resolve()
    }
  }

  getInFlight() {
    return this.count
  }
}

// ============================================================================
// SYSTEM MONITORING
// ============================================================================

class SystemMonitor {
  constructor() {
    this.startCpuUsage = process.cpuUsage()
    this.startTime = performance.now()
    this.lastCpuUsage = this.startCpuUsage
    this.lastTime = this.startTime
  }

  /**
   * Get current CPU usage percentage (user + system)
   * Returns percentage of CPU time used since last call
   */
  getCpuUsage() {
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage)
    const currentTime = performance.now()
    const elapsedTime = (currentTime - this.lastTime) * 1000 // Convert to microseconds
    
    // CPU usage = (user + system) / elapsed time * 100
    const cpuPercent = ((currentCpuUsage.user + currentCpuUsage.system) / elapsedTime) * 100
    
    this.lastCpuUsage = process.cpuUsage()
    this.lastTime = currentTime
    
    return cpuPercent
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    const mem = process.memoryUsage()
    return {
      heapUsed: mem.heapUsed / 1024 / 1024,      // MB
      heapTotal: mem.heapTotal / 1024 / 1024,    // MB
      rss: mem.rss / 1024 / 1024,                // MB (Resident Set Size)
      external: mem.external / 1024 / 1024       // MB
    }
  }

  /**
   * Get system-wide CPU info
   */
  getSystemCpu() {
    const cpus = os.cpus()
    let totalIdle = 0
    let totalTick = 0

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
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
}

// ============================================================================
// METRICS COLLECTOR
// ============================================================================

class MetricsCollector {
  constructor() {
    this.reset()
  }

  reset() {
    this.sentCount = 0
    this.successCount = 0
    this.errorCount = 0
    this.latencies = []
    this.startTime = performance.now()
  }

  recordSuccess(latency) {
    this.sentCount++
    this.successCount++
    this.latencies.push(latency)
  }

  recordError() {
    this.sentCount++
    this.errorCount++
  }

  getStats() {
    const now = performance.now()
    const duration = (now - this.startTime) / 1000  // seconds
    const throughput = this.successCount / duration

    // Calculate latency percentiles
    const sortedLatencies = this.latencies.slice().sort((a, b) => a - b)
    const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.50)] || 0
    const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0
    const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0
    const mean = sortedLatencies.length > 0
      ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
      : 0

    return {
      sent: this.sentCount,
      success: this.successCount,
      errors: this.errorCount,
      duration,
      throughput,
      latency: {
        mean,
        p50,
        p95,
        p99,
        min: sortedLatencies[0] || 0,
        max: sortedLatencies[sortedLatencies.length - 1] || 0
      }
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createMessage(size) {
  return Buffer.alloc(size, 'A')
}

function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

function printReport(reportNum, metrics, monitor, semaphore) {
  const stats = metrics.getStats()
  const memory = monitor.getMemoryUsage()
  const cpu = monitor.getCpuUsage()

  console.log(`\n${'═'.repeat(80)}`)
  console.log(`📊 Report #${reportNum} (${stats.duration.toFixed(1)}s elapsed)`)
  console.log('═'.repeat(80))
  
  // Throughput & Requests
  console.log('\n📈 Throughput:')
  console.log(`   Throughput:          ${formatNumber(stats.throughput)} msg/sec`)
  console.log(`   Total Sent:          ${stats.sent.toLocaleString()}`)
  console.log(`   Success:             ${stats.success.toLocaleString()}`)
  console.log(`   Errors:              ${stats.errors}`)
  console.log(`   In-flight:           ${semaphore.getInFlight()}`)
  
  // Latency
  console.log('\n⏱️  Latency (ms):')
  console.log(`   Mean:                ${formatNumber(stats.latency.mean)}`)
  console.log(`   p50 (median):        ${formatNumber(stats.latency.p50)}`)
  console.log(`   p95:                 ${formatNumber(stats.latency.p95)}`)
  console.log(`   p99:                 ${formatNumber(stats.latency.p99)}`)
  console.log(`   Min:                 ${formatNumber(stats.latency.min)}`)
  console.log(`   Max:                 ${formatNumber(stats.latency.max)}`)
  
  // System Resources
  console.log('\n💻 System Resources:')
  console.log(`   CPU Usage:           ${formatNumber(cpu)}%`)
  console.log(`   Heap Used:           ${formatNumber(memory.heapUsed)} MB`)
  console.log(`   Heap Total:          ${formatNumber(memory.heapTotal)} MB`)
  console.log(`   RSS:                 ${formatNumber(memory.rss)} MB`)
  console.log(`   External:            ${formatNumber(memory.external)} MB`)
}

// ============================================================================
// CONCURRENT STRESS TEST
// ============================================================================

async function runStressTest() {
  console.log('🚀 Client-Server Concurrent Stress Test')
  console.log('   (Parallel Requests with Real-time Monitoring)')
  console.log('═'.repeat(80))
  console.log(`Address:             ${CONFIG.ADDRESS}`)
  console.log(`Concurrency:         ${CONFIG.CONCURRENCY} requests in-flight`)
  console.log(`Duration:            ${CONFIG.DURATION_SECONDS} seconds`)
  console.log(`Message Size:        ${CONFIG.MESSAGE_SIZE} bytes`)
  console.log(`Report Interval:     ${CONFIG.REPORT_INTERVAL / 1000} seconds`)
  console.log('═'.repeat(80))
  
  // Initialize components
  const semaphore = new Semaphore(CONFIG.CONCURRENCY)
  const metrics = new MetricsCollector()
  const monitor = new SystemMonitor()
  
  // Create Server
  const server = new Server({
    id: 'stress-server',
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false,
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 100000,  // High watermarks for stress test
      ZMQ_RCVHWM: 100000,
      ZMQ_SNDBUF: 8388608,  // 8MB OS send buffer
      ZMQ_RCVBUF: 8388608   // 8MB OS receive buffer
    }
  })
  
  // Create Client
  const client = new Client({
    id: 'stress-client',
    config: {
      logger: { info: () => {}, warn: () => {}, error: console.error },
      debug: false,
      ZMQ_LINGER: 0,
      ZMQ_SNDHWM: 100000,
      ZMQ_RCVHWM: 100000,
      ZMQ_SNDBUF: 8388608,  // 8MB OS send buffer
      ZMQ_RCVBUF: 8388608,  // 8MB OS receive buffer
      CONNECTION_TIMEOUT: 5000,
      REQUEST_TIMEOUT: 30000  // Longer timeout for stress
    }
  })
  
  // Server: Echo handler
  server.onRequest('ping', (data) => data)
  
  try {
    // Setup
    await server.bind(CONFIG.ADDRESS)
    console.log(`✅ Server bound to ${CONFIG.ADDRESS}`)
    
    await client.connect(CONFIG.ADDRESS)
    console.log(`✅ Client connected to ${CONFIG.ADDRESS}`)
    
    // Wait for handshake
    await Promise.race([
      new Promise((resolve) => {
        client.once(events.CLIENT_READY, () => {
          console.log('✅ Handshake complete')
          resolve()
        })
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Handshake timeout')), CONFIG.HANDSHAKE_TIMEOUT)
      })
    ])
    
    await sleep(500)
    
    // Test payload
    const testPayload = createMessage(CONFIG.MESSAGE_SIZE)
    
    // Start reporting interval
    let reportNum = 0
    const reportInterval = setInterval(() => {
      reportNum++
      printReport(reportNum, metrics, monitor, semaphore)
    }, CONFIG.REPORT_INTERVAL)
    
    console.log('\n🏃 Starting stress test...\n')
    
    // Test control
    const endTime = performance.now() + (CONFIG.DURATION_SECONDS * 1000)
    let shouldStop = false
    
    // Signal handler for graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n⚠️  Received SIGINT, stopping test...')
      shouldStop = true
    })
    
    // Worker function: Continuously send requests
    async function worker() {
      while (!shouldStop && performance.now() < endTime) {
        await semaphore.acquire()
        
        const sendTime = performance.now()
        
        try {
          await client.request({
            event: 'ping',
            data: testPayload,
            timeout: 30000
          })
          
          const latency = performance.now() - sendTime
          metrics.recordSuccess(latency)
        } catch (err) {
          metrics.recordError()
          // Don't log every error (too noisy)
        } finally {
          semaphore.release()
        }
      }
    }
    
    // Start workers (one per concurrency slot)
    const workers = []
    for (let i = 0; i < CONFIG.CONCURRENCY; i++) {
      workers.push(worker())
    }
    
    // Wait for all workers to complete
    await Promise.all(workers)
    
    // Stop reporting
    clearInterval(reportInterval)
    
    // Final report
    console.log('\n\n' + '═'.repeat(80))
    console.log('📊 FINAL RESULTS')
    console.log('═'.repeat(80))
    
    reportNum++
    printReport(reportNum, metrics, monitor, semaphore)
    
    // Summary
    const finalStats = metrics.getStats()
    console.log('\n' + '═'.repeat(80))
    console.log('✅ Test Complete!')
    console.log('═'.repeat(80))
    console.log(`\nTotal Duration:      ${finalStats.duration.toFixed(2)}s`)
    console.log(`Total Requests:      ${finalStats.sent.toLocaleString()}`)
    console.log(`Success Rate:        ${((finalStats.success / finalStats.sent) * 100).toFixed(2)}%`)
    console.log(`Average Throughput:  ${formatNumber(finalStats.throughput)} msg/sec`)
    console.log(`Average Latency:     ${formatNumber(finalStats.latency.mean)}ms`)
    console.log(`p95 Latency:         ${formatNumber(finalStats.latency.p95)}ms`)
    console.log(`p99 Latency:         ${formatNumber(finalStats.latency.p99)}ms`)
    
    // Compare to sequential baseline
    const sequentialThroughput = 1 / (finalStats.latency.mean / 1000)
    const speedup = finalStats.throughput / sequentialThroughput
    console.log(`\n📈 Performance vs Sequential:`)
    console.log(`   Sequential (estimated): ${formatNumber(sequentialThroughput)} msg/sec`)
    console.log(`   Concurrent (measured):  ${formatNumber(finalStats.throughput)} msg/sec`)
    console.log(`   Speedup:                ${formatNumber(speedup)}x`)
    
    console.log('\n' + '═'.repeat(80) + '\n')
    
  } catch (err) {
    console.error('❌ Stress test failed:', err)
    console.error(err.stack)
  } finally {
    // Cleanup
    await client.close()
    await server.close()
    await sleep(500)
  }
  
  process.exit(0)
}

// ============================================================================
// RUN
// ============================================================================

runStressTest().catch((err) => {
  console.error('❌ Fatal error:', err)
  console.error(err.stack)
  process.exit(1)
})

