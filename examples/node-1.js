/**
 * ============================================================================
 * Node 1 - Server Node Example
 * ============================================================================
 * 
 * This example demonstrates a Zeronode server that binds to a TCP address
 * and handles incoming connections, requests, and messages.
 * 
 * USAGE:
 * ------
 * 1. Start this server first in one terminal:
 *    $ node examples/node-1.js
 * 
 * 2. Then start the client (node-2.js) in another terminal:
 *    $ node examples/node-2.js
 * 
 * 3. Watch the server handle:
 *    - Client connection events
 *    - Request/reply messages (with responses)
 *    - Fire-and-forget ticks (no response needed)
 *    - Periodic heartbeats to connected clients
 * 
 * 4. Kill the client (Ctrl+C) and watch the server detect disconnection
 *    within 10 seconds (configurable timeout)
 * 
 * CONFIGURATION:
 * --------------
 * - Ping interval: 2 seconds (client sends pings)
 * - Health check: 2 seconds (server checks client health)
 * - Timeout: 10 seconds (disconnect detection)
 * 
 * FEATURES DEMONSTRATED:
 * ----------------------
 * ✓ Binding to TCP address
 * ✓ Event tracking (PEER_JOINED, PEER_LEFT, ERROR)
 * ✓ Request/Reply handlers (calculate:sum, user:get)
 * ✓ Fire-and-forget tick handlers (log:info, notification)
 * ✓ Sending periodic messages to connected clients
 * ✓ Peer connection tracking
 * ✓ Graceful shutdown handling
 * 
 * ============================================================================
 */

import { Node, NodeEvent, ServerEvent } from '../src/index.js'

/**
 * Node 1 - Server Node
 * 
 * This node binds to a TCP address and acts as a server.
 * It handles incoming requests and ticks, and sends periodic messages to connected clients.
 */

(async function () {
  try {
    console.log('🚀 Node 1 - Server Node Starting...\n')
    console.log('⚙️  Debug mode: Tracking all events\n')

    // Create node with debug enabled and custom config
    const node1 = new Node({
      id: 'server-node',
      options: {
        role: 'server',
        version: '1.0.0',
        status: 'ready'
      },
      config: {
        CLIENT_HEALTH_CHECK_INTERVAL: 2000,  // Check client health every 2 seconds
        CLIENT_GHOST_TIMEOUT: 10000           // Consider client dead after 10 seconds
      }
    })

    // ========================================================================
    // Event Listeners - Track all node lifecycle events
    // ========================================================================

    let connectedPeers = new Set()

    node1.on(NodeEvent.READY, () => {
      const time = new Date().toLocaleTimeString()
      console.log(`✅ [${time}] [EVENT] Node ready`)
    })

    node1.on(NodeEvent.PEER_JOINED, ({ peerId, peerOptions, direction }) => {
      const time = new Date().toLocaleTimeString()
      console.log(`🤝 [${time}] [EVENT] Peer joined: ${peerId}`)
      console.log(`   Direction: ${direction}`)
      console.log(`   Options:`, peerOptions)
      console.log('')
      
      connectedPeers.add(peerId)
      
      // Start sending heartbeats when first peer connects
      if (connectedPeers.size === 1) {
        console.log('💚 First peer connected - starting heartbeat...\n')
      }
    })

    node1.on(NodeEvent.PEER_LEFT, ({ peerId, direction }) => {
      const time = new Date().toLocaleTimeString()
      console.log(`\n👋 [${time}] [EVENT] ⚠️  PEER LEFT DETECTED ⚠️`)
      console.log(`   Peer ID: ${peerId}`)
      console.log(`   Direction: ${direction}`)
      console.log(`   Remaining peers: ${connectedPeers.size - 1}`)
      console.log('')
      
      connectedPeers.delete(peerId)
      
      if (connectedPeers.size === 0) {
        console.log('💔 No peers connected - waiting for connections...\n')
      }
    })

    node1.on(NodeEvent.ERROR, ({ code, message }) => {
      const time = new Date().toLocaleTimeString()
      console.error(`❌ [${time}] [EVENT] Error [${code}]: ${message}`)
    })

    // ========================================================================
    // Request Handler - Respond to client requests
    // ========================================================================

    node1.onRequest('calculate:sum', ({ data }, reply) => {
      console.log('📥 [REQUEST] Received calculate:sum request')
      console.log('   Data:', data)
      
      const { numbers } = data
      const sum = numbers.reduce((a, b) => a + b, 0)
      
      const response = { result: sum, processedBy: 'server-node' }
      console.log('📤 [RESPONSE] Sending:', response)
      console.log('')
      
      return response
    })

    node1.onRequest('user:get', ({ data }, reply) => {
      console.log('📥 [REQUEST] Received user:get request')
      console.log('   Data:', data)
      
      const response = {
        id: data.userId,
        name: 'John Doe',
        email: 'john@example.com',
        server: 'server-node'
      }
      
      console.log('📤 [RESPONSE] Sending:', response)
      console.log('')
      
      return response
    })

    // ========================================================================
    // Tick Handler - Handle fire-and-forget messages
    // ========================================================================

    node1.onTick('log:info', ({ data }) => {
      console.log('📨 [TICK] Received log:info')
      console.log('   Message:', data.message)
      console.log('   Metadata:', data.metadata)
      console.log('')
    })

    node1.onTick('notification', ({ data }) => {
      console.log('🔔 [TICK] Received notification')
      console.log('   Type:', data.type)
      console.log('   Content:', data.content)
      console.log('')
    })

    // ========================================================================
    // Bind to address
    // ========================================================================

    const address = 'tcp://127.0.0.1:5000'
    await node1.bind(address)
    console.log(`🔌 Bound to ${address}`)
    console.log('🎯 Waiting for connections...')
    console.log('⏱️  Health check interval: 2s | Timeout: 10s')
    console.log('   (Disconnects will be detected within 10 seconds)')
    console.log('')

    // ========================================================================
    // Periodic message sending to connected clients
    // ========================================================================

    let messageCount = 0
    setInterval(async () => {
      // Only send if there are connected peers
      if (connectedPeers.size === 0) {
        return // Skip sending when no peers connected
      }
      
      try {
        // Send a tick to any connected peer
        node1.tickAny({
          event: 'server:heartbeat',
          data: {
            count: ++messageCount,
            timestamp: Date.now(),
            message: 'Server is alive!'
          }
        })
        console.log(`💓 [TICK] Sent heartbeat #${messageCount} to ${connectedPeers.size} client(s)`)
      } catch (err) {
        console.error('Error sending heartbeat:', err.message)
      }
    }, 5000) // Every 5 seconds

    // ========================================================================
    // Graceful shutdown
    // ========================================================================

    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down server node...')
      process.exit(0)
    })

  } catch (err) {
    console.error('❌ Fatal error:', err)
    process.exit(1)
  }
}())

