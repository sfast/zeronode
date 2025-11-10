/**
 * Dealer Client Example
 * Run this after router-server.js: node dist/sockets/example/dealer-client.js
 * 
 * Dealer socket acts as a client that:
 * - Connects to a Router server
 * - Sends messages to the server
 * - Receives responses from the server
 * - Automatically reconnects if connection is lost
 */

import { Dealer as DealerSocket } from '../index.js'
import { TransportEvent } from '../../events.js'

const ROUTER_ADDRESS = 'tcp://127.0.0.1:5555'
const INFINITY = -1  // Infinite timeout

async function runDealer() {
  console.log('='.repeat(60))
  console.log('DEALER CLIENT EXAMPLE')
  console.log('='.repeat(60))

  // Create dealer with configuration
  // 
  // To test timeout behavior, set RECONNECTION_TIMEOUT to 20000 (20 seconds)
  // To test infinite reconnection, set it to INFINITY
  const RECONNECTION_TIMEOUT = 20000  // Give up after 20 seconds (for testing)
  // const RECONNECTION_TIMEOUT = INFINITY  // Never give up (production)

  const dealer = new DealerSocket({ 
    id: 'ExampleDealer',
    config: {
      ZMQ_LINGER: 0,                        // Fast shutdown
      ZMQ_RECONNECT_IVL: 100,               // Retry every 100ms
      ZMQ_SNDHWM: 1000,
      ZMQ_RCVHWM: 1000,
      CONNECTION_TIMEOUT: 5000,             // 5s initial connection timeout
      RECONNECTION_TIMEOUT: RECONNECTION_TIMEOUT
    }
  })

  console.log(`\n⚙️  Configuration:`)
  console.log(`   Reconnection timeout: ${RECONNECTION_TIMEOUT === -1 ? 'INFINITY (never give up)' : `${RECONNECTION_TIMEOUT}ms`}`)
  console.log(`   Reconnection interval: 100ms\n`)

  // Listen to connection events
  dealer.on(TransportEvent.READY, () => {
    console.log('✅ Connected to router!')
  })

  let disconnectTime = null
  let sendInterval = null  // Store interval reference

  dealer.on(TransportEvent.NOT_READY, () => {
    disconnectTime = Date.now()
    console.log('\n❌ Disconnected from router')
    console.log('🔄 ZeroMQ will automatically attempt to reconnect...')
    console.log(`   Will give up after ${RECONNECTION_TIMEOUT === -1 ? 'NEVER' : `${RECONNECTION_TIMEOUT}ms (${RECONNECTION_TIMEOUT / 1000}s)`}`)
  })

  dealer.on(TransportEvent.READY, () => {  // RECONNECT → READY (after disconnect)
    const downtime = disconnectTime ? Math.round((Date.now() - disconnectTime) / 1000) : 0
    console.log(`\n✅ Reconnected to router!`)
    console.log(`   Downtime: ${downtime} seconds\n`)
    disconnectTime = null
  })

  dealer.on(TransportEvent.CLOSED, () => {  // RECONNECT_FAILURE → CLOSED
    const downtime = disconnectTime ? Math.round((Date.now() - disconnectTime) / 1000) : 0
    console.log(`\n❌ Reconnection failed (gave up after ${downtime}s timeout)`)
    console.log('   Socket is now DISCONNECTED and will NOT reconnect')
    console.log('   Stopping message sender...\n')
    
    // Stop the send interval - no point trying to send anymore!
    if (sendInterval) {
      clearInterval(sendInterval)
      sendInterval = null
    }
    
    disconnectTime = null
  })

  // Listen to incoming messages
  dealer.on(TransportEvent.MESSAGE, ({ buffer }) => {
    console.log(`📨 Received response: ${buffer.length} bytes`)
    console.log(`   Buffer (hex): ${buffer.toString('hex').substring(0, 100)}...`)
  })

  try {
    // Connect to router
    console.log(`\n🚀 Connecting to ${ROUTER_ADDRESS}...`)
    await dealer.connect(ROUTER_ADDRESS)
    
    console.log('\n✅ Connected! Starting to send messages...\n')

    // Send messages periodically
    let messageCount = 0
    sendInterval = setInterval(() => {
      if (!dealer.isOnline()) {
        console.log('⏸️  Waiting for connection...')
        return
      }

      messageCount++
      const message = Buffer.from(`Hello from Dealer! Message #${messageCount}`)
      
      try {
        dealer.sendBuffer(message)
        console.log(`📤 Sent message #${messageCount}`)
      } catch (err) {
        console.error(`❌ Send error: ${err.message}`)
      }
    }, 2000) // Send every 2 seconds

    // Cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...')
      if (sendInterval) {
        clearInterval(sendInterval)
      }
      await dealer.close()
      console.log('✅ Dealer closed')
      process.exit(0)
    })

  } catch (err) {
    console.error('❌ Connection error:', err.message)
    process.exit(1)
  }
}

runDealer()

