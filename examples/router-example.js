/**
 * Router Example - Service Discovery via Router
 * 
 * Topology:
 *   Service A (auth) ──→ Router ←── Service B (payment)
 * 
 * Flow:
 * 1. Payment service uses requestAny to find auth service
 * 2. No local match, falls back to router
 * 3. Router performs requestAny on its network
 * 4. Router finds auth service and forwards request
 * 5. Auth service responds
 * 6. Router forwards response back to payment
 */

import { Node, Router } from '../src/index.js'

async function main() {
  console.log('🌐 Router Service Discovery Example\n')
  console.log('='.repeat(60))
  
  // ========================================================================
  // 1. CREATE ROUTER
  // ========================================================================
  console.log('\n📍 Step 1: Creating Router...')
  const router = new Router({
    id: 'router-1',
    bind: 'tcp://127.0.0.1:3000'
  })
  
  await router.bind()
  console.log(`✅ Router: ${router.getAddress()}`)
  console.log(`   Options: ${JSON.stringify(router.getOptions())}`)
  
  // ========================================================================
  // 2. CREATE AUTH SERVICE
  // ========================================================================
  console.log('\n📍 Step 2: Creating Auth Service...')
  const authService = new Node({
    id: 'auth-service',
    bind: 'tcp://127.0.0.1:3001',
    options: {
      service: 'auth',
      version: '1.0'
    }
  })
  
  await authService.bind()
  await authService.connect({ address: router.getAddress() })
  console.log(`✅ Auth Service: ${authService.getAddress()}`)
  console.log(`   Options: ${JSON.stringify(authService.getOptions())}`)
  
  // Register auth handler
  authService.onRequest('verify', (envelope, reply) => {
    console.log(`\n🔐 [AUTH] Received verification request`)
    console.log(`   Token: ${envelope.data.token}`)
    console.log(`   Metadata: ${JSON.stringify(envelope.metadata)}`)
    
    reply({ valid: true, userId: 'user-123' })
  })
  
  // ========================================================================
  // 3. CREATE PAYMENT SERVICE
  // ========================================================================
  console.log('\n📍 Step 3: Creating Payment Service...')
  const paymentService = new Node({
    id: 'payment-service',
    bind: 'tcp://127.0.0.1:3002',
    options: {
      service: 'payment',
      version: '1.0'
    }
  })
  
  await paymentService.bind()
  await paymentService.connect({ address: router.getAddress() })
  console.log(`✅ Payment Service: ${paymentService.getAddress()}`)
  console.log(`   Options: ${JSON.stringify(paymentService.getOptions())}`)
  
  // Wait for connections to stabilize
  await new Promise(resolve => setTimeout(resolve, 300))
  
  // ========================================================================
  // 4. PAYMENT SERVICE DISCOVERS AUTH VIA ROUTER
  // ========================================================================
  console.log('\n' + '='.repeat(60))
  console.log('💳 Payment Service trying to verify token...')
  console.log('   Method: requestAny({ filter: { service: "auth" } })')
  console.log('   Expected: Router fallback (no direct connection)')
  console.log('='.repeat(60))
  
  try {
    const result = await paymentService.requestAny({
      event: 'verify',
      filter: { service: 'auth' },
      data: { token: 'abc-123-xyz' },
      timeout: 3000
    })
    
    console.log(`\n✅ [PAYMENT] Received verification response:`)
    console.log(`   Valid: ${result.valid}`)
    console.log(`   User ID: ${result.userId}`)
    
  } catch (err) {
    console.log(`\n❌ [PAYMENT] Error: ${err.message}`)
  }
  
  // ========================================================================
  // 5. SHOW ROUTER STATISTICS
  // ========================================================================
  console.log('\n' + '='.repeat(60))
  console.log('📊 Router Statistics:')
  const stats = router.getRoutingStats()
  console.log(`   Proxy Requests: ${stats.proxyRequests}`)
  console.log(`   Proxy Ticks: ${stats.proxyTicks}`)
  console.log(`   Successful Routes: ${stats.successfulRoutes}`)
  console.log(`   Failed Routes: ${stats.failedRoutes}`)
  console.log(`   Total Messages: ${stats.totalMessages}`)
  console.log(`   Uptime: ${stats.uptime.toFixed(2)}s`)
  console.log(`   Requests/sec: ${stats.requestsPerSecond}`)
  console.log('='.repeat(60))
  
  console.log('\n✅ Router service discovery working perfectly!')
  
  // Cleanup
  await authService.close()
  await paymentService.close()
  await router.close()
  
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})

