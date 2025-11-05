/**
 * Multi-Node Durability & Load Test
 * Tests 1 server node with 3 client nodes under sustained bidirectional load
 */

import Node from '../src/node.js'
import os from 'os'

// Configuration
const TEST_DURATION = 600000 // 60 seconds
const TARGET_RATE_PER_CLIENT = 1000 // Messages per second per client
const REQUEST_RATIO = 0.7 // 30% requests, 70% ticks
const REPORT_INTERVAL = 5000 // Report every 5 seconds
const NUM_CLIENTS = 3

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

function calculateCPUPercent (startCPU, endCPU) {
  const idleDiff = endCPU.idle - startCPU.idle
  const totalDiff = endCPU.total - startCPU.total
  const percentCPU = 100 - ~~(100 * idleDiff / totalDiff)
  return percentCPU
}

function getMemoryUsage () {
  const usage = process.memoryUsage()
  return {
    heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(2),
    heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(2),
    rss: (usage.rss / 1024 / 1024).toFixed(2),
    external: (usage.external / 1024 / 1024).toFixed(2)
  }
}

async function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function multiNodeDurability () {
  console.log('='.repeat(80))
  console.log('🔥 Multi-Node Durability & Load Test')
  console.log('='.repeat(80))
  console.log(`Configuration:`)
  console.log(`  Server Nodes:          1`)
  console.log(`  Client Nodes:          ${NUM_CLIENTS}`)
  console.log(`  Test Duration:         ${TEST_DURATION / 1000}s`)
  console.log(`  Rate Per Client:       ${TARGET_RATE_PER_CLIENT} msg/sec`)
  console.log(`  Total Rate (in):       ${TARGET_RATE_PER_CLIENT * NUM_CLIENTS} msg/sec (to server)`)
  console.log(`  Total Rate (out):      ${TARGET_RATE_PER_CLIENT * NUM_CLIENTS} msg/sec (from server)`)
  console.log(`  Total Rate (combined): ${TARGET_RATE_PER_CLIENT * NUM_CLIENTS * 2} msg/sec`)
  console.log(`  Request Ratio:         ${(REQUEST_RATIO * 100).toFixed(0)}% requests, ${((1 - REQUEST_RATIO) * 100).toFixed(0)}% ticks`)
  console.log('='.repeat(80))

  const serverAddress = 'tcp://127.0.0.1:9700'
  
  // Create server node
  console.log('\n📡 Setting up server node...')
  const serverNode = new Node({
    id: 'server-node',
    bind: serverAddress  // Node expects a string, not an array
  })

  await serverNode.bind()
  console.log('  ✅ Server node bound')

  // Create client nodes
  console.log(`\n👥 Setting up ${NUM_CLIENTS} client nodes...`)
  const clientNodes = []
  
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const clientNode = new Node({
      id: `client-node-${i + 1}`
    })
    clientNodes.push(clientNode)
  }

  // Connect all clients to server
  for (let i = 0; i < NUM_CLIENTS; i++) {
    await clientNodes[i].connect({
      address: serverAddress
    })
    console.log(`  ✅ Client ${i + 1} connected`)
  }

  await sleep(500)

  // Statistics per client and server
  const stats = {
    server: {
      requestsReceived: 0,
      requestsSent: 0,
      ticksReceived: 0,
      ticksSent: 0,
      requestsFailed: 0,
      latencies: []
    },
    clients: clientNodes.map((_, i) => ({
      id: i,
      requestsReceived: 0,
      requestsSent: 0,
      ticksReceived: 0,
      ticksSent: 0,
      requestsFailed: 0,
      latencies: []
    })),
    startTime: Date.now(),
    lastReportTime: Date.now()
  }

  // Setup server handlers
  serverNode.onRequest('load:request', async ({ data, reply }) => {
    stats.server.requestsReceived++
    reply({ echo: data, timestamp: Date.now() })
  })

  serverNode.onTick('load:tick', () => {
    stats.server.ticksReceived++
  })

  // Setup client handlers
  clientNodes.forEach((clientNode, index) => {
    clientNode.onRequest('load:request', async ({ data, reply }) => {
      stats.clients[index].requestsReceived++
      reply({ echo: data, timestamp: Date.now() })
    })

    clientNode.onTick('load:tick', () => {
      stats.clients[index].ticksReceived++
    })
  })

  await sleep(500)

  // Resource tracking
  let startCPU = getCPUUsage()
  const startMemory = getMemoryUsage()

  console.log('\n📊 Starting load test...\n')
  console.log('Time | Total  | Srv→Clt | Clt→Srv | CPU%  | Heap MB | RSS MB  | Errors | Lat P50')
  console.log('-'.repeat(90))

  // Progress reporting
  const reportInterval = setInterval(() => {
    const now = Date.now()
    const elapsed = (now - stats.lastReportTime) / 1000
    
    // Calculate rates
    const serverOut = (stats.server.requestsSent + stats.server.ticksSent) / elapsed
    const serverIn = (stats.server.requestsReceived + stats.server.ticksReceived) / elapsed
    const totalRate = serverOut + serverIn
    
    const endCPU = getCPUUsage()
    const cpuPercent = calculateCPUPercent(startCPU, endCPU)
    startCPU = endCPU
    
    const memory = getMemoryUsage()
    
    // Calculate latency
    const allLatencies = [
      ...stats.server.latencies,
      ...stats.clients.flatMap(c => c.latencies)
    ]
    const p50 = allLatencies.length > 0 
      ? allLatencies.sort((a, b) => a - b)[Math.floor(allLatencies.length * 0.5)].toFixed(2)
      : 'N/A'
    
    const totalErrors = stats.server.requestsFailed + 
      stats.clients.reduce((sum, c) => sum + c.requestsFailed, 0)
    
    const totalTime = ((now - stats.startTime) / 1000).toFixed(0)
    
    console.log(
      `${totalTime}s`.padEnd(5) + ' | ' +
      totalRate.toFixed(0).padStart(6) + ' | ' +
      serverOut.toFixed(0).padStart(7) + ' | ' +
      serverIn.toFixed(0).padStart(7) + ' | ' +
      cpuPercent.toFixed(1).padStart(5) + ' | ' +
      memory.heapUsed.padStart(7) + ' | ' +
      memory.rss.padStart(7) + ' | ' +
      totalErrors.toString().padStart(6) + ' | ' +
      (p50 !== 'N/A' ? p50 + 'ms' : 'N/A')
    )
    
    // Reset interval counters
    stats.server.requestsReceived = 0
    stats.server.requestsSent = 0
    stats.server.ticksReceived = 0
    stats.server.ticksSent = 0
    stats.server.requestsFailed = 0
    stats.server.latencies = []
    
    stats.clients.forEach(client => {
      client.requestsReceived = 0
      client.requestsSent = 0
      client.ticksReceived = 0
      client.ticksSent = 0
      client.requestsFailed = 0
      client.latencies = []
    })
    
    stats.lastReportTime = now
  }, REPORT_INTERVAL)

  // Message sending loops - run concurrently
  const startTime = Date.now()
  
  const sendingTasks = []
  
  // Server to each client
  clientNodes.forEach((_, clientIndex) => {
    sendingTasks.push((async () => {
      let messagesSent = 0
      const messageInterval = 1000 / TARGET_RATE_PER_CLIENT
      
      while (Date.now() - startTime < TEST_DURATION) {
        const shouldSendRequest = Math.random() < REQUEST_RATIO
        
        try {
          if (shouldSendRequest) {
            stats.server.requestsSent++
            const reqStart = process.hrtime.bigint()
            
            await serverNode.request({
              to: `client-node-${clientIndex + 1}`,
              event: 'load:request',
              data: { from: 'server', index: messagesSent },
              timeout: 5000
            })
            
            const reqEnd = process.hrtime.bigint()
            const latency = Number(reqEnd - reqStart) / 1e6
            stats.server.latencies.push(latency)
          } else {
            serverNode.tick({
              to: `client-node-${clientIndex + 1}`,
              event: 'load:tick',
              data: { from: 'server', index: messagesSent }
            })
            stats.server.ticksSent++
          }
        } catch (err) {
          stats.server.requestsFailed++
        }
        
        messagesSent++
        
        // Pacing
        if (messagesSent % 10 === 0) {
          const elapsed = Date.now() - startTime
          const expected = messagesSent * messageInterval
          const drift = expected - elapsed
          if (drift > 1) {
            await sleep(Math.min(drift, 10))
          }
        }
      }
    })())
  })
  
  // Each client to server
  clientNodes.forEach((clientNode, clientIndex) => {
    sendingTasks.push((async () => {
      let messagesSent = 0
      const messageInterval = 1000 / TARGET_RATE_PER_CLIENT
      
      while (Date.now() - startTime < TEST_DURATION) {
        const shouldSendRequest = Math.random() < REQUEST_RATIO
        
        try {
          if (shouldSendRequest) {
            stats.clients[clientIndex].requestsSent++
            const reqStart = process.hrtime.bigint()
            
            await clientNode.request({
              to: 'server-node',
              event: 'load:request',
              data: { from: `client-${clientIndex + 1}`, index: messagesSent },
              timeout: 5000
            })
            
            const reqEnd = process.hrtime.bigint()
            const latency = Number(reqEnd - reqStart) / 1e6
            stats.clients[clientIndex].latencies.push(latency)
          } else {
            clientNode.tick({
              to: 'server-node',
              event: 'load:tick',
              data: { from: `client-${clientIndex + 1}`, index: messagesSent }
            })
            stats.clients[clientIndex].ticksSent++
          }
        } catch (err) {
          stats.clients[clientIndex].requestsFailed++
        }
        
        messagesSent++
        
        // Pacing
        if (messagesSent % 10 === 0) {
          const elapsed = Date.now() - startTime
          const expected = messagesSent * messageInterval
          const drift = expected - elapsed
          if (drift > 1) {
            await sleep(Math.min(drift, 10))
          }
        }
      }
    })())
  })

  // Wait for all sending tasks to complete
  await Promise.all(sendingTasks)
  
  clearInterval(reportInterval)
  await sleep(1000)

  console.log('-'.repeat(90))

  // Final summary
  const totalElapsed = (Date.now() - startTime) / 1000
  const endMemory = getMemoryUsage()
  const memoryGrowth = (parseFloat(endMemory.heapUsed) - parseFloat(startMemory.heapUsed)).toFixed(2)
  const memoryGrowthPercent = ((memoryGrowth / parseFloat(startMemory.heapUsed)) * 100).toFixed(2)

  console.log('\n📈 Final Summary:')
  console.log('='.repeat(80))
  console.log(`Total Runtime:        ${totalElapsed.toFixed(2)}s`)
  console.log(`\nServer Node:`)
  console.log(`  Messages Sent:      ${(stats.server.requestsSent + stats.server.ticksSent).toLocaleString()}`)
  console.log(`  Messages Received:  ${(stats.server.requestsReceived + stats.server.ticksReceived).toLocaleString()}`)
  
  console.log(`\nClient Nodes:`)
  stats.clients.forEach((client, i) => {
    const totalSent = client.requestsSent + client.ticksSent
    const totalReceived = client.requestsReceived + client.ticksReceived
    console.log(`  Client ${i + 1}:`)
    console.log(`    Sent:             ${totalSent.toLocaleString()}`)
    console.log(`    Received:         ${totalReceived.toLocaleString()}`)
    console.log(`    Errors:           ${client.requestsFailed}`)
  })
  
  const totalMessages = (stats.server.requestsSent + stats.server.ticksSent) * 2
  console.log(`\nTotal Messages:       ${totalMessages.toLocaleString()}`)
  console.log(`Average Rate:         ${(totalMessages / totalElapsed).toFixed(0)} msg/sec`)
  
  console.log(`\nMemory:`)
  console.log(`  Start Heap:         ${startMemory.heapUsed} MB`)
  console.log(`  End Heap:           ${endMemory.heapUsed} MB`)
  console.log(`  Growth:             ${memoryGrowth > 0 ? '+' : ''}${memoryGrowth} MB (${memoryGrowthPercent > 0 ? '+' : ''}${memoryGrowthPercent}%)`)
  console.log(`  RSS:                ${endMemory.rss} MB`)

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
  for (const clientNode of clientNodes) {
    await clientNode.stop()
  }
  await serverNode.stop()

  console.log('\n' + '='.repeat(80))
  console.log('✅ Multi-Node Durability Test Complete')
  console.log('='.repeat(80))
}

// Run benchmark
(async () => {
  try {
    await multiNodeDurability()
    process.exit(0)
  } catch (err) {
    console.error('Benchmark error:', err)
    process.exit(1)
  }
})()

