/**
 * Router Server Example
 * Run this first in one terminal: node dist/sockets/example/router-server.js
 * 
 * Router socket acts as a server that:
 * - Binds to an address
 * - Receives messages from multiple Dealer clients
 * - Can send messages back to specific clients
 */

import { Router as RouterSocket } from '../index.js'
import { TransportEvent } from '../../events.js'

const ADDRESS = 'tcp://127.0.0.1:5555'

async function runRouter() {
  console.log('='.repeat(60))
  console.log('ROUTER SERVER EXAMPLE')
  console.log('='.repeat(60))

  // Create router with configuration
  const router = new RouterSocket({ 
    id: 'ExampleRouter',
    config: {
      ZMQ_LINGER: 0,           // Fast shutdown
      ZMQ_SNDHWM: 1000,        // Max 1000 queued messages
      ZMQ_RCVHWM: 1000
    }
  })

  // Listen to socket events
  router.on(TransportEvent.READY, ({ endpoint }) => {
    console.log(`✅ Router is listening on ${endpoint}`)
  })

  // Note: Router doesn't have a specific ACCEPT event in TransportEvent
  // Connection is implicit when messages arrive
  router.on('accept', ({ fd, endpoint }) => {
    const fdStr = fd ? ` (fd: ${typeof fd === 'object' ? JSON.stringify(fd) : fd})` : ''
    console.log(`🔌 Client connected${endpoint ? ` from ${endpoint}` : ''}${fdStr}`)
  })

  // Note: In ZMQ, DISCONNECT is a lower-level event not in TransportEvent
  router.on('disconnect', ({ fd, endpoint }) => {
    const fdStr = fd ? ` (fd: ${typeof fd === 'object' ? JSON.stringify(fd) : fd})` : ''
    console.log(`❌ Client disconnected${endpoint ? ` from ${endpoint}` : ''}${fdStr}`)
  })

  // Track connected clients
  const clients = new Set()

  // Listen to incoming messages
  router.on(TransportEvent.MESSAGE, ({ buffer }) => {
    // Router receives raw buffer (ZeroMQ frames already processed)
    // In a real app, you'd parse using your protocol (envelope, etc.)
    
    // For Router sockets, ZeroMQ automatically extracts the client ID
    // from the message frames. To track clients, we'd need to parse
    // the envelope or use socket.lastEndpoint (if available)
    
    console.log(`📨 Received message: ${buffer.length} bytes`)
    console.log(`   Data: ${buffer.toString()}`)
    console.log(`   Buffer (hex): ${buffer.toString('hex').substring(0, 60)}...`)
  })

  try {
    // Bind to address
    console.log(`\n🚀 Binding to ${ADDRESS}...`)
    await router.bind(ADDRESS)
    
    console.log('\n📡 Router is ready! Waiting for clients...')
    console.log('   Press Ctrl+C to stop\n')

    // Keep running
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...')
      await router.close()
      console.log('✅ Router closed')
      process.exit(0)
    })

  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

runRouter()

