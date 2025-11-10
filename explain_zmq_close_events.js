/**
 * Demo: ZeroMQ 'close' events during reconnection
 * 
 * This demonstrates why we get MULTIPLE 'close' events during reconnection
 */
import * as zmq from 'zeromq'

async function demo() {
  console.log('🔬 ZeroMQ Reconnection Event Flow Demo\n')
  console.log('='* 60)
  
  const routerAddress = 'tcp://127.0.0.1:9998'
  
  // Step 1: Start router
  const router = new zmq.Router({ routingId: 'router' })
  await router.bind(routerAddress)
  console.log('✅ Router bound to', routerAddress)
  
  // Step 2: Create dealer with reconnection settings
  const dealer = new zmq.Dealer({ 
    routingId: 'dealer',
    reconnectInterval: 100,      // Retry every 100ms
    reconnectMaxInterval: 0      // No exponential backoff
  })
  
  console.log('\n📊 Reconnection Config:')
  console.log('   - reconnectInterval: 100ms (retry every 100ms)')
  console.log('   - reconnectMaxInterval: 0 (no exponential backoff)')
  
  // Track events
  let connectCount = 0
  let disconnectCount = 0
  let closeCount = 0
  
  dealer.events.on('connect', (fd, endpoint) => {
    connectCount++
    console.log(`\n✅ CONNECT #${connectCount} - Connected to ${endpoint}`)
  })
  
  dealer.events.on('disconnect', (fd, endpoint) => {
    disconnectCount++
    console.log(`\n⚠️  DISCONNECT #${disconnectCount} - Lost connection`)
  })
  
  dealer.events.on('close', (fd, endpoint) => {
    closeCount++
    console.log(`   ❌ CLOSE #${closeCount} - Connection attempt failed`)
  })
  
  // Step 3: Connect dealer
  console.log('\n🔌 Dealer connecting...')
  dealer.connect(routerAddress)
  await new Promise(resolve => setTimeout(resolve, 300))
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 After Initial Connection:')
  console.log(`   Connect: ${connectCount}, Disconnect: ${disconnectCount}, Close: ${closeCount}`)
  
  // Step 4: Kill router (simulate network failure)
  console.log('\n' + '='.repeat(60))
  console.log('💥 KILLING ROUTER (simulating network failure)...')
  await router.close()
  
  console.log('\n⏱️  Waiting 2 seconds for reconnection attempts...')
  console.log('   (Dealer will retry every 100ms)\n')
  
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 After 2s of Failed Reconnection:')
  console.log(`   Connect: ${connectCount}`)
  console.log(`   Disconnect: ${disconnectCount}`)
  console.log(`   Close: ${closeCount} ❗ (THIS IS THE KEY!)`)
  
  console.log('\n' + '='.repeat(60))
  console.log('💡 KEY INSIGHT:')
  console.log('   ZeroMQ fires a \'close\' event for EACH failed reconnection attempt!')
  console.log(`   In 2 seconds with 100ms retry interval: ~${closeCount} close events`)
  console.log('   This is WHY we removed the \'close\' listener from our Socket class!')
  
  await dealer.close()
}

demo().catch(console.error)
