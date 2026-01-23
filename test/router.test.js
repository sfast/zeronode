/**
 * Router Tests - Comprehensive Coverage
 * 
 * Tests for the Router class that extends Node with routing capabilities.
 * 
 * Coverage Areas:
 * - Router construction and configuration
 * - Proxy request handling (success, failure, edge cases)
 * - Proxy tick handling (fire-and-forget)
 * - Service discovery and filtering
 * - Router statistics tracking
 * - Multiple routers (cascading)
 * - Load balancing through router
 * - Error handling and timeout scenarios
 * - Integration with Node class
 * - Metadata propagation
 * - Concurrent request handling
 * - Router-to-router communication
 */

import { expect } from 'chai'
import { Node, Router } from '../src/index.js'
import { getUniquePort, wait } from './test-utils.js'

describe('Router - Comprehensive Tests', () => {
  let router, nodeA, nodeB, nodeC
  
  afterEach(async () => {
    if (nodeA) await nodeA.close()
    if (nodeB) await nodeB.close()
    if (nodeC) await nodeC.close()
    if (router) await router.close()
    // Give ZeroMQ time to fully release ports
    await wait(100)
    nodeA = nodeB = nodeC = router = null
  })
  
  // ==========================================================================
  // CONSTRUCTION & CONFIGURATION
  // ==========================================================================
  
  describe('Construction & Configuration', () => {
    it('should create a router with router: true option', async () => {
      router = new Router({
        id: 'test-router',
        bind: 'tcp://127.0.0.1:7100'
      })
      
      await router.bind()
      
      expect(router.getId()).to.equal('test-router')
      expect(router.getOptions().router).to.be.true
    })
    
    it('should force router: true even if options provided', async () => {
      router = new Router({
        id: 'test-router',
        bind: 'tcp://127.0.0.1:7101',
        options: { 
          router: false,
          custom: 'value'
        }
      })
      
      await router.bind()
      
      expect(router.getOptions().router).to.be.true
      expect(router.getOptions().custom).to.equal('value')
    })
    
    it('should preserve custom options', async () => {
      router = new Router({
        id: 'test-router',
        bind: 'tcp://127.0.0.1:7102',
        options: {
          region: 'us-east',
          tier: 'production',
          capacity: 1000
        }
      })
      
      await router.bind()
      
      expect(router.getOptions().router).to.be.true
      expect(router.getOptions().region).to.equal('us-east')
      expect(router.getOptions().tier).to.equal('production')
      expect(router.getOptions().capacity).to.equal(1000)
    })
    
    it('should inherit all Node methods', async () => {
      router = new Router({
        id: 'test-router',
        bind: 'tcp://127.0.0.1:7103'
      })
      
      await router.bind()
      
      // Check Node methods exist
      expect(router.request).to.be.a('function')
      expect(router.tick).to.be.a('function')
      expect(router.requestAny).to.be.a('function')
      expect(router.tickAny).to.be.a('function')
      expect(router.onRequest).to.be.a('function')
      expect(router.onTick).to.be.a('function')
      expect(router.connect).to.be.a('function')
      expect(router.getAddress).to.be.a('function')
      expect(router.getOptions).to.be.a('function')
    })
    
    it('should have Router-specific methods', () => {
      router = new Router({
        id: 'test-router',
        bind: 'tcp://127.0.0.1:7104'
      })
      
      expect(router.getRoutingStats).to.be.a('function')
      expect(router.resetRoutingStats).to.be.a('function')
    })
  })
  
  // ==========================================================================
  // ROUTING STATISTICS
  // ==========================================================================
  
  describe('Statistics Tracking', () => {
    it('should initialize with zero statistics', () => {
      router = new Router({
        id: 'test-router',
        bind: 'tcp://127.0.0.1:7110'
      })
      
      const stats = router.getRoutingStats()
      
      expect(stats.proxyRequests).to.equal(0)
      expect(stats.proxyTicks).to.equal(0)
      expect(stats.successfulRoutes).to.equal(0)
      expect(stats.failedRoutes).to.equal(0)
      expect(stats.totalMessages).to.equal(0)
      expect(stats.uptime).to.be.a('number')
      expect(stats.requestsPerSecond).to.equal(0)
    })
    
    it('should track uptime correctly', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7111'
      })
      
      const stats1 = router.getRoutingStats()
      expect(stats1.uptime).to.be.at.least(0)
      
      await new Promise(resolve => setTimeout(resolve, 150))
      
      const stats2 = router.getRoutingStats()
      expect(stats2.uptime).to.be.above(stats1.uptime)
      expect(stats2.uptime).to.be.above(0.1) // At least 100ms
    })
    
    it('should track proxy requests accurately', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7112'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7113',
        options: { role: 'client' }
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7114',
        options: { role: 'server' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('ping', (envelope, reply) => {
        reply({ pong: true })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Send multiple requests
      await nodeA.requestAny({ filter: { role: 'server' }, event: 'ping' })
      await nodeA.requestAny({ filter: { role: 'server' }, event: 'ping' })
      await nodeA.requestAny({ filter: { role: 'server' }, event: 'ping' })
      
      const stats = router.getRoutingStats()
      
      expect(stats.proxyRequests).to.equal(3)
      expect(stats.successfulRoutes).to.equal(3)
      expect(stats.failedRoutes).to.equal(0)
      expect(stats.totalMessages).to.equal(3)
    })
    
    it('should track proxy ticks accurately', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7115'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7116'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7117',
        options: { role: 'logger' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      let tickCount = 0
      nodeB.onTick('log', () => {
        tickCount++
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Send multiple ticks
      await nodeA.tickAny({ filter: { role: 'logger' }, event: 'log' })
      await nodeA.tickAny({ filter: { role: 'logger' }, event: 'log' })
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const stats = router.getRoutingStats()
      
      expect(stats.proxyTicks).to.equal(2)
      expect(stats.proxyRequests).to.equal(0)
      expect(stats.totalMessages).to.equal(2)
      expect(tickCount).to.equal(2)
    })
    
    it('should calculate requests per second', async () => {
      const [routerPort, nodeAPort, nodeBPort] = [getUniquePort(), getUniquePort(), getUniquePort()]
      
      router = new Router({
        id: 'router',
        bind: `tcp://127.0.0.1:${routerPort}`
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: `tcp://127.0.0.1:${nodeAPort}`
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: `tcp://127.0.0.1:${nodeBPort}`,
        options: { service: 'test' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('ping', (envelope, reply) => {
        reply({ pong: true })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Send requests
      for (let i = 0; i < 5; i++) {
        await nodeA.requestAny({ filter: { service: 'test' }, event: 'ping' })
      }
      
      const stats = router.getRoutingStats()
      
      expect(stats.requestsPerSecond).to.be.above(0)
      expect(stats.requestsPerSecond).to.be.a('number')
    })
    
    it('should reset statistics correctly', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7121'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7122'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7123',
        options: { role: 'server' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('ping', (envelope, reply) => {
        reply({ pong: true })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      await nodeA.requestAny({ filter: { role: 'server' }, event: 'ping' })
      
      let stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.equal(1)
      expect(stats.uptime).to.be.above(0)
      
      const oldUptime = stats.uptime
      router.resetRoutingStats()
      
      stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.equal(0)
      expect(stats.successfulRoutes).to.equal(0)
      expect(stats.totalMessages).to.equal(0)
      // Uptime resets but immediately starts counting again
      expect(stats.uptime).to.be.below(oldUptime)
    })
  })
  
  // ==========================================================================
  // PROXY REQUEST HANDLING - SUCCESS CASES
  // ==========================================================================
  
  describe('Proxy Request Handling - Success Cases', () => {
    it('should route request through router when no direct connection', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7130'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7131',
        options: { service: 'client' }
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7132',
        options: { service: 'auth' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      // Connect both to router (no direct connection!)
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('verify', (envelope, reply) => {
        reply({ valid: true, userId: 'user-123' })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const result = await nodeA.requestAny({
        filter: { service: 'auth' },
        event: 'verify',
        data: { token: 'abc-123' }
      })
      
      expect(result.valid).to.be.true
      expect(result.userId).to.equal('user-123')
      
      const stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.equal(1)
      expect(stats.successfulRoutes).to.equal(1)
    })
    
    it('should handle complex data in routed requests', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7133'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7134'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7135',
        options: { service: 'processor' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('process', (envelope, reply) => {
        const data = envelope.data
        reply({
          ...data,
          processed: true,
          timestamp: Date.now()
        })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const complexData = {
        id: 123,
        name: 'test',
        nested: { value: 456 },
        array: [1, 2, 3],
        bool: true,
        null: null
      }
      
      const result = await nodeA.requestAny({
        filter: { service: 'processor' },
        event: 'process',
        data: complexData
      })
      
      expect(result.id).to.equal(123)
      expect(result.name).to.equal('test')
      expect(result.nested.value).to.equal(456)
      expect(result.array).to.deep.equal([1, 2, 3])
      expect(result.processed).to.be.true
      expect(result.timestamp).to.be.a('number')
    })
    
    it('should handle multiple concurrent requests', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7136'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7137'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7138',
        options: { service: 'math' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('add', (envelope, reply) => {
        const { a, b } = envelope.data
        reply({ result: a + b })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Send 20 concurrent requests
      const promises = []
      for (let i = 0; i < 20; i++) {
        promises.push(
          nodeA.requestAny({
            filter: { service: 'math' },
            event: 'add',
            data: { a: i, b: i * 2 }
          })
        )
      }
      
      const results = await Promise.all(promises)
      
      expect(results).to.have.lengthOf(20)
      expect(results[0].result).to.equal(0)   // 0 + 0
      expect(results[10].result).to.equal(30) // 10 + 20
      expect(results[19].result).to.equal(57) // 19 + 38
      
      const stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.equal(20)
      expect(stats.successfulRoutes).to.equal(20)
    })
    
    it('should route to correct service based on filter', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7139'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7140'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7141',
        options: { service: 'auth', version: '1.0' }
      })
      
      nodeC = new Node({
        id: 'node-c',
        bind: 'tcp://127.0.0.1:7142',
        options: { service: 'payment', version: '2.0' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      await nodeC.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      await nodeC.connect({ address: router.getAddress() })
      
      nodeB.onRequest('verify', (envelope, reply) => {
        reply({ service: 'auth', result: 'auth-response' })
      })
      
      nodeC.onRequest('charge', (envelope, reply) => {
        reply({ service: 'payment', result: 'payment-response' })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Request to auth service
      const authResult = await nodeA.requestAny({
        filter: { service: 'auth' },
        event: 'verify'
      })
      
      expect(authResult.service).to.equal('auth')
      expect(authResult.result).to.equal('auth-response')
      
      // Request to payment service
      const paymentResult = await nodeA.requestAny({
        filter: { service: 'payment' },
        event: 'charge'
      })
      
      expect(paymentResult.service).to.equal('payment')
      expect(paymentResult.result).to.equal('payment-response')
      
      const stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.equal(2)
      expect(stats.successfulRoutes).to.equal(2)
    })
  })
  
  // ==========================================================================
  // PROXY TICK HANDLING
  // ==========================================================================
  
  describe('Proxy Tick Handling', () => {
    it('should route tick through router when no direct connection', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7150'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7151'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7152',
        options: { service: 'logger' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      let receivedTicks = []
      nodeB.onTick('log', (envelope) => {
        receivedTicks.push(envelope.data)
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      await nodeA.tickAny({
        filter: { service: 'logger' },
        event: 'log',
        data: { level: 'info', message: 'test log' }
      })
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(receivedTicks).to.have.lengthOf(1)
      expect(receivedTicks[0].level).to.equal('info')
      expect(receivedTicks[0].message).to.equal('test log')
      
      const stats = router.getRoutingStats()
      expect(stats.proxyTicks).to.equal(1)
      expect(stats.successfulRoutes).to.equal(1)
    })
    
    it('should handle multiple ticks to same service', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7153'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7154'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7155',
        options: { service: 'metrics' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      let tickCount = 0
      nodeB.onTick('increment', () => {
        tickCount++
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Send 10 ticks
      for (let i = 0; i < 10; i++) {
        await nodeA.tickAny({
          filter: { service: 'metrics' },
          event: 'increment'
        })
      }
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(tickCount).to.equal(10)
      
      const stats = router.getRoutingStats()
      expect(stats.proxyTicks).to.equal(10)
    })
    
    it('should route ticks to multiple services', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7156'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7157'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7158',
        options: { type: 'logger' }
      })
      
      nodeC = new Node({
        id: 'node-c',
        bind: 'tcp://127.0.0.1:7159',
        options: { type: 'metrics' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      await nodeC.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      await nodeC.connect({ address: router.getAddress() })
      
      let loggerTicks = 0
      let metricsTicks = 0
      
      nodeB.onTick('event', () => {
        loggerTicks++
      })
      
      nodeC.onTick('event', () => {
        metricsTicks++
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Send ticks to logger
      await nodeA.tickAny({ filter: { type: 'logger' }, event: 'event' })
      await nodeA.tickAny({ filter: { type: 'logger' }, event: 'event' })
      
      // Send ticks to metrics
      await nodeA.tickAny({ filter: { type: 'metrics' }, event: 'event' })
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(loggerTicks).to.equal(2)
      expect(metricsTicks).to.equal(1)
      
      const stats = router.getRoutingStats()
      expect(stats.proxyTicks).to.equal(3)
    })
  })
  
  // ==========================================================================
  // ROUTER CASCADING & MULTI-HOP
  // ==========================================================================
  
  describe('Router Cascading', () => {
    let router1, router2
    
    afterEach(async () => {
      if (router1) await router1.close()
      if (router2) await router2.close()
      router1 = router2 = null
    })
    
    it('should cascade through multiple routers', async () => {
      router1 = new Router({
        id: 'router-1',
        bind: 'tcp://127.0.0.1:7170'
      })
      
      router2 = new Router({
        id: 'router-2',
        bind: 'tcp://127.0.0.1:7171'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7172'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7173',
        options: { service: 'target' }
      })
      
      await router1.bind()
      await router2.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      // Topology: nodeA → router1 → router2 → nodeB
      await nodeA.connect({ address: router1.getAddress() })
      await router1.connect({ address: router2.getAddress() })
      await nodeB.connect({ address: router2.getAddress() })
      
      nodeB.onRequest('ping', (envelope, reply) => {
        reply({ pong: true, cascaded: true })
      })
      
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const result = await nodeA.requestAny({
        filter: { service: 'target' },
        event: 'ping'
      })
      
      expect(result.pong).to.be.true
      expect(result.cascaded).to.be.true
      
      const stats1 = router1.getRoutingStats()
      const stats2 = router2.getRoutingStats()
      
      // Both routers should have handled the request
      expect(stats1.proxyRequests).to.equal(1)
      expect(stats2.proxyRequests).to.equal(1)
    })
    
    it('should handle 3-hop routing', async () => {
      const router3 = new Router({
        id: 'router-3',
        bind: 'tcp://127.0.0.1:7174'
      })
      
      router1 = new Router({
        id: 'router-1',
        bind: 'tcp://127.0.0.1:7175'
      })
      
      router2 = new Router({
        id: 'router-2',
        bind: 'tcp://127.0.0.1:7176'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7177'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7178',
        options: { service: 'deep' }
      })
      
      await router1.bind()
      await router2.bind()
      await router3.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      // Chain: nodeA → router1 → router2 → router3 → nodeB
      await nodeA.connect({ address: router1.getAddress() })
      await router1.connect({ address: router2.getAddress() })
      await router2.connect({ address: router3.getAddress() })
      await nodeB.connect({ address: router3.getAddress() })
      
      nodeB.onRequest('test', (envelope, reply) => {
        reply({ hops: 3 })
      })
      
      await new Promise(resolve => setTimeout(resolve, 400))
      
      const result = await nodeA.requestAny({
        filter: { service: 'deep' },
        event: 'test',
        timeout: 3000
      })
      
      expect(result.hops).to.equal(3)
      
      await router3.close()
    })
  })
  
  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================
  
  describe('Error Handling', () => {
    it('should handle service not found scenario', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7180'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7181'
      })
      
      await router.bind()
      await nodeA.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await new Promise(resolve => setTimeout(resolve, 200))
      
      try {
        await nodeA.requestAny({
          filter: { service: 'nonexistent' },
          event: 'test',
          timeout: 500
        })
        expect.fail('Expected timeout or error')
      } catch (error) {
        expect(error).to.exist
      }
      
      const stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.be.at.least(1)
    })
    
    it('should handle handler errors gracefully', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7182'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7183'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7184',
        options: { service: 'faulty' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('error', (envelope, reply) => {
        reply(null, new Error('Handler failed'))
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      try {
        await nodeA.requestAny({
          filter: { service: 'faulty' },
          event: 'error'
        })
        expect.fail('Should have received error from handler')
      } catch (error) {
        expect(error).to.exist
      }
      
      const stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.be.at.least(1)
    })
    
    it('should handle timeout during routing', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7185'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7186'
      })
      
      nodeB = new Node({
        id: 'node-b',
        bind: 'tcp://127.0.0.1:7187',
        options: { service: 'slow' }
      })
      
      await router.bind()
      await nodeA.bind()
      await nodeB.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await nodeB.connect({ address: router.getAddress() })
      
      nodeB.onRequest('slow', (envelope, reply) => {
        // Never reply (simulate slow handler)
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      try {
        await nodeA.requestAny({
          filter: { service: 'slow' },
          event: 'slow',
          timeout: 300
        })
        expect.fail('Expected timeout')
      } catch (error) {
        expect(error).to.exist
        // Error code could be REQUEST_TIMEOUT or TIMEOUT depending on implementation
        expect(['TIMEOUT', 'REQUEST_TIMEOUT']).to.include(error.code)
      }
    })
  })
  
  // ==========================================================================
  // INTEGRATION WITH NODE
  // ==========================================================================
  
  describe('Integration with Node', () => {
    it('router should work as a normal Node for direct requests', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7190'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7191'
      })
      
      await router.bind()
      await nodeA.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      
      // Register handler on router itself
      router.onRequest('health', (envelope, reply) => {
        reply({ status: 'healthy', isRouter: true })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Direct request to router
      const result = await nodeA.request({
        to: router.getId(),
        event: 'health'
      })
      
      expect(result.status).to.equal('healthy')
      expect(result.isRouter).to.be.true
      
      // This shouldn't count as proxy request
      const stats = router.getRoutingStats()
      expect(stats.proxyRequests).to.equal(0)
    })
    
    it('should support router receiving ticks directly', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7192'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7193'
      })
      
      await router.bind()
      await nodeA.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      
      let tickReceived = false
      router.onTick('notify', () => {
        tickReceived = true
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      nodeA.tick({
        to: router.getId(),
        event: 'notify'
      })
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(tickReceived).to.be.true
      
      const stats = router.getRoutingStats()
      expect(stats.proxyTicks).to.equal(0)
    })
    
    it('should allow router to initiate requests', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7194'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7195',
        options: { service: 'data' }
      })
      
      await router.bind()
      await nodeA.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      
      nodeA.onRequest('get', (envelope, reply) => {
        reply({ data: 'from-service' })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Router initiates request
      const result = await router.requestAny({
        filter: { service: 'data' },
        event: 'get'
      })
      
      expect(result.data).to.equal('from-service')
    })
  })
  
  // ==========================================================================
  // LOAD BALANCING
  // ==========================================================================
  
  describe('Load Balancing Through Router', () => {
    it('should distribute requests across multiple instances', async () => {
      router = new Router({
        id: 'router',
        bind: 'tcp://127.0.0.1:7200'
      })
      
      nodeA = new Node({
        id: 'node-a',
        bind: 'tcp://127.0.0.1:7201'
      })
      
      const service1 = new Node({
        id: 'service-1',
        bind: 'tcp://127.0.0.1:7202',
        options: { service: 'api', instance: 1 }
      })
      
      const service2 = new Node({
        id: 'service-2',
        bind: 'tcp://127.0.0.1:7203',
        options: { service: 'api', instance: 2 }
      })
      
      await router.bind()
      await nodeA.bind()
      await service1.bind()
      await service2.bind()
      
      await nodeA.connect({ address: router.getAddress() })
      await service1.connect({ address: router.getAddress() })
      await service2.connect({ address: router.getAddress() })
      
      let service1Calls = 0
      let service2Calls = 0
      
      service1.onRequest('process', (envelope, reply) => {
        service1Calls++
        reply({ instance: 1 })
      })
      
      service2.onRequest('process', (envelope, reply) => {
        service2Calls++
        reply({ instance: 2 })
      })
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Send 10 requests
      for (let i = 0; i < 10; i++) {
        await nodeA.requestAny({
          filter: { service: 'api' },
          event: 'process'
        })
      }
      
      // Both services should have received requests
      expect(service1Calls + service2Calls).to.equal(10)
      expect(service1Calls).to.be.above(0)
      expect(service2Calls).to.be.above(0)
      
      await service1.close()
      await service2.close()
    })
  })
})
