/**
 * Dealer Client - Pure ZeroMQ Native Reconnection
 * 
 * This example demonstrates ZeroMQ's NATIVE reconnection features:
 * - ZMQ_RECONNECT_IVL: Initial reconnection interval
 * - ZMQ_RECONNECT_IVL_MAX: Max reconnection interval (exponential backoff)
 * 
 * NO application-level timeout - relies purely on ZeroMQ!
 */

import { Dealer as DealerSocket } from '../index.js'
import { TransportEvent } from '../../events.js'

const ROUTER_ADDRESS = 'tcp://127.0.0.1:5555'
const INFINITY = -1  // Infinite timeout

async function runDealer() {
  console.log('='.repeat(60))
  console.log('DEALER - PURE ZEROMQ NATIVE RECONNECTION')
  console.log('='.repeat(60))

  // Test different ZeroMQ reconnection strategies:
  
  // STRATEGY 1: Fast, constant retry (no backoff)
  const RECONNECT_IVL = 100        // Try every 100ms
  const RECONNECT_IVL_MAX = 0      // 0 = no exponential backoff
  
  // STRATEGY 2: Exponential backoff (uncomment to test)
  // const RECONNECT_IVL = 100        // Start at 100ms
  // const RECONNECT_IVL_MAX = 30000  // Max out at 30 seconds
  
  // STRATEGY 3: Slow, constant retry (uncomment to test)
  // const RECONNECT_IVL = 5000       // Try every 5 seconds
  // const RECONNECT_IVL_MAX = 0      // No backoff

  const dealer = new DealerSocket({ 
    id: 'NativeReconnectDealer',
    config: {
      ZMQ_LINGER: 0,
      ZMQ_RECONNECT_IVL: RECONNECT_IVL,        // ZeroMQ native!
      ZMQ_RECONNECT_IVL_MAX: RECONNECT_IVL_MAX, // ZeroMQ native!
      ZMQ_SNDHWM: 1000,
      ZMQ_RCVHWM: 1000,
      CONNECTION_TIMEOUT: 5000,
      RECONNECTION_TIMEOUT: INFINITY  // NO app timeout, pure ZeroMQ!
    }
  })

  console.log(`\n⚙️  ZeroMQ Native Configuration:`)
  console.log(`   ZMQ_RECONNECT_IVL: ${RECONNECT_IVL}ms`)
  console.log(`   ZMQ_RECONNECT_IVL_MAX: ${RECONNECT_IVL_MAX === 0 ? 'NONE (constant interval)' : `${RECONNECT_IVL_MAX}ms`}`)
  console.log(`   Application timeout: INFINITY (disabled - pure ZeroMQ)\n`)

  if (RECONNECT_IVL_MAX > 0) {
    console.log(`   📊 Exponential Backoff Enabled:`)
    console.log(`      - Start: ${RECONNECT_IVL}ms`)
    console.log(`      - Doubles each failure`)
    console.log(`      - Max: ${RECONNECT_IVL_MAX}ms`)
    console.log(`      - Example: 100ms → 200ms → 400ms → 800ms → ... → ${RECONNECT_IVL_MAX}ms\n`)
  } else {
    console.log(`   📊 Constant Retry Interval:`)
    console.log(`      - Always tries every ${RECONNECT_IVL}ms`)
    console.log(`      - No exponential backoff\n`)
  }

  // Track connection state
  let disconnectTime = null
  let reconnectAttempts = 0
  let sendInterval = null

  dealer.on(TransportEvent.READY, () => {
    console.log('✅ Connected to router!')
    reconnectAttempts = 0
  })

  dealer.on(TransportEvent.NOT_READY, () => {
    disconnectTime = Date.now()
    reconnectAttempts = 0
    console.log('\n❌ Disconnected from router')
    console.log('🔄 ZeroMQ native reconnection started...')
    console.log(`   (Will retry forever until router comes back)\n`)
  })

  // Note: CONNECT_RETRY is a lower-level ZMQ event, not in TransportEvent
  dealer.on('connect:retry', ({ endpoint }) => {
    reconnectAttempts++
    const elapsed = disconnectTime ? Math.round((Date.now() - disconnectTime) / 1000) : 0
    console.log(`🔄 Retry #${reconnectAttempts} (${elapsed}s elapsed)${endpoint ? ` to ${endpoint}` : ''}`)
  })

  // Note: CONNECT_DELAY is a lower-level ZMQ event, not in TransportEvent
  dealer.on('connect:delay', ({ endpoint }) => {
    const elapsed = disconnectTime ? Math.round((Date.now() - disconnectTime) / 1000) : 0
    console.log(`⏳ Connection delayed (${elapsed}s elapsed)${endpoint ? ` for ${endpoint}` : ''}`)
  })

  dealer.on(TransportEvent.READY, () => {  // Second READY = Reconnection
    const downtime = disconnectTime ? Math.round((Date.now() - disconnectTime) / 1000) : 0
    console.log(`\n✅ Reconnected to router!`)
    console.log(`   Downtime: ${downtime} seconds`)
    console.log(`   Attempts: ${reconnectAttempts}`)
    console.log(`   ZeroMQ never gave up!\n`)
    disconnectTime = null
    reconnectAttempts = 0
  })

  // Listen to incoming messages
  dealer.on(TransportEvent.MESSAGE, ({ buffer }) => {
    console.log(`📨 Received response: ${buffer.length} bytes`)
  })

  try {
    // Connect to router
    console.log(`🚀 Connecting to ${ROUTER_ADDRESS}...`)
    await dealer.connect(ROUTER_ADDRESS)
    
    console.log('\n✅ Connected! Starting to send messages...\n')

    // Send messages periodically
    let messageCount = 0
    sendInterval = setInterval(() => {
      if (!dealer.isOnline()) {
        // Just wait silently (ZeroMQ is reconnecting in background)
        return
      }

      messageCount++
      const message = Buffer.from(`Hello from Native Dealer! Message #${messageCount}`)
      
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

