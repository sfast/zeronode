/**
 * ============================================================================
 * Node 2 - Client Node Example
 * ============================================================================
 * 
 * This example demonstrates a Zeronode client that connects to a server
 * and sends various types of messages (requests and ticks).
 * 
 * USAGE:
 * ------
 * 1. Start the server (node-1.js) FIRST in one terminal:
 *    $ node examples/node-1.js
 * 
 * 2. Then start this client in another terminal:
 *    $ node examples/node-2.js
 * 
 * 3. Watch the client:
 *    - Connect to the server
 *    - Send multiple requests and receive responses
 *    - Send fire-and-forget ticks (no response)
 *    - Receive periodic heartbeats from server
 * 
 * 4. Press Ctrl+C to stop (server will detect disconnect in ~10 seconds)
 * 
 * CONFIGURATION:
 * --------------
 * - Ping interval: 2 seconds (sends heartbeat to server)
 * - Server address: tcp://127.0.0.1:5000
 * 
 * FEATURES DEMONSTRATED:
 * ----------------------
 * ✓ Connecting to a server
 * ✓ Event tracking (PEER_JOINED, PEER_LEFT, ERROR)
 * ✓ Sending requests and receiving replies (request/reply pattern)
 * ✓ Sending fire-and-forget ticks (no response expected)
 * ✓ Receiving messages from server (tick handlers)
 * ✓ Multiple sequential requests
 * ✓ Graceful shutdown handling
 * 
 * MESSAGE SEQUENCE:
 * -----------------
 * 1. calculate:sum request → receives result
 * 2. user:get request → receives user data
 * 3. log:info tick → no response (fire-and-forget)
 * 4. notification tick → no response (fire-and-forget)
 * 5. Multiple calculate requests in sequence
 * 6. Continuous listening for server heartbeats
 * 
 * ============================================================================
 */

import { Node, NodeEvent } from '../src/index.js'

/**
 * Node 2 - Client Node
 * 
 * This node connects to the server node and sends various types of messages.
 * It demonstrates request/reply pattern and fire-and-forget ticks.
 */

(async function () {
  try {
    console.log('🚀 Node 2 - Client Node Starting...\n')

    // Create node with debug enabled and custom config
    const node2 = new Node({
      id: 'client-node',
      options: {
        role: 'client',
        version: '1.0.0',
        status: 'active'
      },
      config: {
        PING_INTERVAL: 2000  // Send ping to server every 2 seconds
      }
    })

    // ========================================================================
    // Event Listeners - Track all node lifecycle events
    // ========================================================================

    node2.on(NodeEvent.PEER_JOINED, ({ peerId, peerOptions, direction }) => {
      console.log(`🤝 [EVENT] Peer joined: ${peerId}`)
      console.log(`   Direction: ${direction}`)
      console.log(`   Options:`, peerOptions)
      console.log('')
      
      // Once connected, start sending messages
      startSendingMessages()
    })

    node2.on(NodeEvent.PEER_LEFT, ({ peerId, direction }) => {
      console.log(`👋 [EVENT] Peer left: ${peerId} (${direction})`)
      console.log('')
    })

    node2.on(NodeEvent.ERROR, ({ code, message }) => {
      console.error(`❌ [EVENT] Error [${code}]: ${message}`)
    })

    // ========================================================================
    // Tick Handler - Receive messages from server
    // ========================================================================

    node2.onTick('server:heartbeat', ({ data }) => {
      console.log('💓 [TICK] Received heartbeat from server')
      console.log('   Count:', data.count)
      console.log('   Message:', data.message)
      console.log('   Timestamp:', new Date(data.timestamp).toISOString())
      console.log('')
    })

    // ========================================================================
    // Connect to server
    // ========================================================================

    const serverAddress = 'tcp://127.0.0.1:5000'
    console.log(`🔗 Connecting to server at ${serverAddress}...`)
    console.log('⏱️  Ping interval: 2s (sending heartbeat every 2 seconds)')
    
    await node2.connect({ address: serverAddress })
    console.log('✅ Connected to server!')
    console.log('')

    // ========================================================================
    // Message sending functions
    // ========================================================================

    async function startSendingMessages() {
      console.log('📤 Starting to send messages...\n')

      // Wait a bit before starting
      await sleep(1000)

      // Send Request/Reply messages
      await sendCalculateRequest()
      await sleep(2000)
      
      await sendUserRequest()
      await sleep(2000)

      // Send Fire-and-Forget ticks
      await sendLogTick()
      await sleep(2000)

      await sendNotificationTick()
      await sleep(2000)

      // Send multiple requests in sequence
      await sendMultipleRequests()
    }

    async function sendCalculateRequest() {
      try {
        console.log('📤 [REQUEST] Sending calculate:sum request...')
        const numbers = [1, 2, 3, 4, 5, 10, 20, 30]
        console.log('   Numbers:', numbers)
        
        const response = await node2.request({
          to: 'server-node',
          event: 'calculate:sum',
          data: { numbers },
          timeout: 5000
        })
        
        console.log('📥 [RESPONSE] Received:')
        console.log('   Result:', response.result)
        console.log('   Processed by:', response.processedBy)
        console.log('')
      } catch (err) {
        console.error('❌ Request failed:', err.message)
      }
    }

    async function sendUserRequest() {
      try {
        console.log('📤 [REQUEST] Sending user:get request...')
        console.log('   User ID: 12345')
        
        const response = await node2.request({
          to: 'server-node',
          event: 'user:get',
          data: { userId: 12345 },
          timeout: 5000
        })
        
        console.log('📥 [RESPONSE] Received user data:')
        console.log('   ID:', response.id)
        console.log('   Name:', response.name)
        console.log('   Email:', response.email)
        console.log('   Server:', response.server)
        console.log('')
      } catch (err) {
        console.error('❌ Request failed:', err.message)
      }
    }

    async function sendLogTick() {
      console.log('📤 [TICK] Sending log:info (fire-and-forget)...')
      
      node2.tick({
        to: 'server-node',
        event: 'log:info',
        data: {
          message: 'User logged in successfully',
          metadata: {
            userId: 12345,
            timestamp: Date.now(),
            ip: '192.168.1.100'
          }
        }
      })
      
      console.log('   ✅ Sent (no response expected)')
      console.log('')
    }

    async function sendNotificationTick() {
      console.log('📤 [TICK] Sending notification (fire-and-forget)...')
      
      node2.tick({
        to: 'server-node',
        event: 'notification',
        data: {
          type: 'info',
          content: 'System maintenance scheduled for tonight'
        }
      })
      
      console.log('   ✅ Sent (no response expected)')
      console.log('')
    }

    async function sendMultipleRequests() {
      console.log('📤 Sending multiple requests in sequence...\n')
      
      for (let i = 1; i <= 3; i++) {
        try {
          console.log(`📤 [REQUEST #${i}] Sending calculate:sum...`)
          
          const response = await node2.request({
            to: 'server-node',
            event: 'calculate:sum',
            data: { numbers: [i, i * 2, i * 3] },
            timeout: 5000
          })
          
          console.log(`📥 [RESPONSE #${i}] Result: ${response.result}`)
          console.log('')
          
          await sleep(1000)
        } catch (err) {
          console.error(`❌ Request #${i} failed:`, err.message)
        }
      }

      console.log('✨ All messages sent! Client will continue listening for heartbeats...')
      console.log('   Press Ctrl+C to exit\n')
    }

    // Helper function
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    // ========================================================================
    // Graceful shutdown
    // ========================================================================

    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down client node...')
      process.exit(0)
    })

  } catch (err) {
    console.error('❌ Fatal error:', err)
    process.exit(1)
  }
}())

