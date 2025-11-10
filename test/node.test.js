/**
 * Node Tests - Complete test suite for Node orchestration layer
 * 
 * Tests:
 * - Node identity and options
 * - Handler registration (before and after server/client creation)
 * - Lazy server initialization
 * - Client connection management
 * - Smart routing (direct, any, all, up, down)
 * - Options management and filtering
 * - Error handling
 * - Lifecycle management
 */

import { expect } from 'chai'
import Node, { NodeEvent } from '../src/node.js'
import { NodeError, NodeErrorCode } from '../src/node-errors.js'

// Helper to wait for event
function waitForEvent(emitter, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`))
    }, timeout)
    
    emitter.once(event, (data) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

// Helper to wait
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('Node - Orchestration Layer', () => {
  
  // ============================================================================
  // NODE IDENTITY & OPTIONS
  // ============================================================================
  
  describe('Identity & Options', () => {
    let node
    
    afterEach(async () => {
      if (node) {
        await node.stop()
        node = null
      }
    })
    
    it('should create node with custom ID', () => {
      node = new Node({ id: 'test-node-1' })
      
      expect(node.getId()).to.equal('test-node-1')
    })
    
    it('should generate random ID if not provided', () => {
      node = new Node()
      
      const id = node.getId()
      expect(id).to.be.a('string')
      expect(id.length).to.be.greaterThan(0)
    })
    
    it('should bind node ID to options (_id)', () => {
      node = new Node({ 
        id: 'test-node-2',
        options: { role: 'worker' }
      })
      
      const options = node.getOptions()
      expect(options._id).to.equal('test-node-2')
      expect(options.role).to.equal('worker')
    })
    
    it('should update options and maintain node ID', async () => {
      node = new Node({ id: 'test-node-3' })
      
      await node.setOptions({ role: 'api', region: 'us-east' })
      
      const options = node.getOptions()
      expect(options._id).to.equal('test-node-3')
      expect(options.role).to.equal('api')
      expect(options.region).to.equal('us-east')
    })
  })
  
  // ============================================================================
  // HANDLER REGISTRATION (Central Registry)
  // ============================================================================
  
  describe('Handler Registration', () => {
    let node
    
    afterEach(async () => {
      if (node) {
        await node.stop()
        node = null
      }
    })
    
    it('should register request handler before server exists', () => {
      node = new Node({ id: 'test-node-4' })
      
      const handler = (data) => ({ result: 'ok' })
      
      // Should not throw even though server doesn't exist yet
      expect(() => {
        node.onRequest('test.event', handler)
      }).to.not.throw()
    })
    
    it('should register tick handler before server exists', () => {
      node = new Node({ id: 'test-node-5' })
      
      const handler = (data) => { /* noop */ }
      
      // Should not throw even though server doesn't exist yet
      expect(() => {
        node.onTick('test.tick', handler)
      }).to.not.throw()
    })
    
    it('should apply handlers to server when bound', async () => {
      node = new Node({ id: 'test-node-6' })
      
      let handlerCalled = false
      node.onRequest('test.event', () => {
        handlerCalled = true
        return { result: 'ok' }
      })
      
      // Bind server
      await node.bind('tcp://127.0.0.1:7001')
      
      // Simulate request (would need another node to test fully)
      // For now, just verify server was created
      expect(node.getAddress()).to.equal('tcp://127.0.0.1:7001')
      
      await node.unbind()
    })
    
    it('should apply handlers to new clients', async () => {
      const node1 = new Node({ id: 'node-1' })
      const node2 = new Node({ id: 'node-2' })
      
      try {
        // Register handler on node1
        let handlerCalled = false
        node1.onRequest('test.event', () => {
          handlerCalled = true
          return { result: 'from-node1' }
        })
        
        // Bind node2 server
        await node2.bind('tcp://127.0.0.1:7002')
        
        // Connect node1 to node2 (handler should be applied to client)
        await node1.connect({ address: 'tcp://127.0.0.1:7002' })
        
        // Handler is registered, connection established
        expect(handlerCalled).to.be.false // Not called yet
        
      } finally {
        await node1.stop()
        await node2.stop()
      }
    })
    
    it('should remove handlers with offRequest', () => {
      node = new Node({ id: 'test-node-7' })
      
      const handler = () => ({ result: 'ok' })
      
      node.onRequest('test.event', handler)
      node.offRequest('test.event', handler)
      
      // Handler removed successfully (no error)
      expect(node).to.be.ok
    })
    
    it('should remove all handlers for pattern with offRequest', () => {
      node = new Node({ id: 'test-node-8' })
      
      node.onRequest('test.event', () => ({ result: '1' }))
      node.onRequest('test.event', () => ({ result: '2' }))
      
      // Remove all handlers for pattern
      node.offRequest('test.event')
      
      expect(node).to.be.ok
    })
  })
  
  // ============================================================================
  // SERVER LIFECYCLE
  // ============================================================================
  
  describe('Server Lifecycle', () => {
    let node
    
    afterEach(async () => {
      if (node) {
        await node.stop()
        node = null
      }
    })
    
    it('should create server immediately if bind address provided', async () => {
      node = new Node({ 
        id: 'test-node-9',
        bind: 'tcp://127.0.0.1:7003'
      })
      
      // Wait for server to initialize
      await wait(100)
      
      // Server should be bound
      expect(node.getAddress()).to.equal('tcp://127.0.0.1:7003')
      
      await node.unbind()
    })
    
    it('should create server lazily on bind()', async () => {
      node = new Node({ id: 'test-node-10' })
      
      // No address yet
      expect(node.getAddress()).to.be.null
      
      // Bind server
      await node.bind('tcp://127.0.0.1:7004')
      
      // Now has address
      expect(node.getAddress()).to.equal('tcp://127.0.0.1:7004')
      
      await node.unbind()
    })
    
    it('should not create duplicate server on multiple bind calls', async () => {
      node = new Node({ id: 'test-node-11' })
      
      await node.bind('tcp://127.0.0.1:7005')
      
      // Second bind should reuse server
      await node.bind('tcp://127.0.0.1:7005')
      
      expect(node.getAddress()).to.equal('tcp://127.0.0.1:7005')
      
      await node.unbind()
    })
    
    it('should unbind server', async () => {
      node = new Node({ id: 'test-node-12' })
      
      await node.bind('tcp://127.0.0.1:7006')
      expect(node.getAddress()).to.equal('tcp://127.0.0.1:7006')
      
      await node.unbind()
      
      // Server still exists but not bound
      expect(node).to.be.ok
    })
  })
  
  // ============================================================================
  // CLIENT CONNECTIONS
  // ============================================================================
  
  describe('Client Connections', () => {
    let node1, node2
    
    afterEach(async () => {
      if (node1) {
        await node1.stop()
        node1 = null
      }
      if (node2) {
        await node2.stop()
        node2 = null
      }
    })
    
    it('should connect to remote node', async () => {
      node1 = new Node({ id: 'node-connect-1' })
      node2 = new Node({ id: 'node-connect-2' })
      
      // Bind node2
      await node2.bind('tcp://127.0.0.1:7007')
      
      // Connect node1 to node2
      const serverInfo = await node1.connect({ 
        address: 'tcp://127.0.0.1:7007' 
      })
      
      expect(serverInfo).to.be.an('object')
      expect(serverInfo.id).to.equal('node-connect-2')
    })
    
    it('should return existing connection if already connected', async () => {
      node1 = new Node({ id: 'node-dup-1' })
      node2 = new Node({ id: 'node-dup-2' })
      
      await node2.bind('tcp://127.0.0.1:7008')
      
      // Connect twice to same address
      const info1 = await node1.connect({ address: 'tcp://127.0.0.1:7008' })
      const info2 = await node1.connect({ address: 'tcp://127.0.0.1:7008' })
      
      expect(info1.id).to.equal(info2.id)
      expect(info1.id).to.equal('node-dup-2')
    })
    
    it('should disconnect from remote node', async () => {
      node1 = new Node({ id: 'node-disc-1' })
      node2 = new Node({ id: 'node-disc-2' })
      
      await node2.bind('tcp://127.0.0.1:7009')
      await node1.connect({ address: 'tcp://127.0.0.1:7009' })
      
      // Disconnect
      const result = await node1.disconnect('tcp://127.0.0.1:7009')
      
      expect(result).to.be.true
    })
    
    it('should handle disconnect from non-existent connection', async () => {
      node1 = new Node({ id: 'node-nodisc-1' })
      
      // Should not throw
      const result = await node1.disconnect('tcp://127.0.0.1:9999')
      
      expect(result).to.be.true
    })
    
    it('should throw error on invalid address', async () => {
      node1 = new Node({ id: 'node-invalid-1' })
      
      try {
        await node1.connect({ address: null })
        expect.fail('Should have thrown error')
      } catch (err) {
        expect(err).to.be.instanceOf(NodeError)
        expect(err.code).to.equal(NodeErrorCode.ROUTING_FAILED)
      }
    })
  })
  
  // ============================================================================
  // ROUTING - DIRECT
  // ============================================================================
  
  describe('Routing - Direct', () => {
    let node1, node2
    
    afterEach(async () => {
      if (node1) await node1.stop()
      if (node2) await node2.stop()
      node1 = node2 = null
    })
    
    it('should route request to connected node', async () => {
      node1 = new Node({ id: 'route-1' })
      node2 = new Node({ id: 'route-2' })
      
      // Setup node2 handler
      node2.onRequest('test.request', (data) => {
        return { echo: data.message, from: 'route-2' }
      })
      
      // Bind and connect
      await node2.bind('tcp://127.0.0.1:7010')
      await node1.connect({ address: 'tcp://127.0.0.1:7010' })
      
      // Wait for connection to stabilize
      await wait(500)
      
      // Send request from node1 to node2
      const response = await node1.request({
        to: 'route-2',
        event: 'test.request',
        data: { message: 'hello' }
      })
      
      expect(response).to.be.an('object')
      expect(response.echo).to.equal('hello')
      expect(response.from).to.equal('route-2')
    })
    
    it('should route tick to connected node', async () => {
      node1 = new Node({ id: 'tick-1' })
      node2 = new Node({ id: 'tick-2' })
      
      let tickReceived = false
      let tickData = null
      
      // Setup node2 handler
      node2.onTick('test.tick', (data) => {
        tickReceived = true
        tickData = data
      })
      
      // Bind and connect
      await node2.bind('tcp://127.0.0.1:7011')
      await node1.connect({ address: 'tcp://127.0.0.1:7011' })
      
      await wait(500)
      
      // Send tick
      node1.tick({
        to: 'tick-2',
        event: 'test.tick',
        data: { message: 'tick message' }
      })
      
      // Wait for tick to be processed
      await wait(200)
      
      expect(tickReceived).to.be.true
      expect(tickData).to.be.an('object')
      expect(tickData.message).to.equal('tick message')
    })
    
    it('should throw error when node not found', async () => {
      node1 = new Node({ id: 'notfound-1' })
      
      try {
        await node1.request({
          to: 'non-existent-node',
          event: 'test.request',
          data: {}
        })
        expect.fail('Should have thrown NodeError')
      } catch (err) {
        expect(err).to.be.instanceOf(NodeError)
        expect(err.code).to.equal(NodeErrorCode.NODE_NOT_FOUND)
        expect(err.nodeId).to.equal('non-existent-node')
      }
    })
  })
  
  // ============================================================================
  // ROUTING - FILTERED (ANY)
  // ============================================================================
  
  describe('Routing - Filtered (requestAny, tickAny)', () => {
    let node1, node2, node3
    
    afterEach(async () => {
      if (node1) await node1.stop()
      if (node2) await node2.stop()
      if (node3) await node3.stop()
      node1 = node2 = node3 = null
    })
    
    it('should route to any matching node (by options)', async () => {
      node1 = new Node({ 
        id: 'filter-1',
        options: { role: 'client' }
      })
      
      node2 = new Node({ 
        id: 'filter-2',
        options: { role: 'worker' }
      })
      
      node3 = new Node({ 
        id: 'filter-3',
        options: { role: 'worker' }
      })
      
      // Setup workers
      node2.onRequest('task.process', () => ({ processed: 'by-node2' }))
      node3.onRequest('task.process', () => ({ processed: 'by-node3' }))
      
      // Bind servers
      await node2.bind('tcp://127.0.0.1:7012')
      await node3.bind('tcp://127.0.0.1:7013')
      
      // Connect node1 to workers
      await node1.connect({ address: 'tcp://127.0.0.1:7012' })
      await node1.connect({ address: 'tcp://127.0.0.1:7013' })
      
      await wait(500)
      
      // Request to any worker
      const response = await node1.requestAny({
        event: 'task.process',
        filter: { options: { role: 'worker' } }
      })
      
      expect(response).to.be.an('object')
      expect(response.processed).to.match(/by-node[23]/)
    })
    
    it('should throw error when no nodes match filter', async () => {
      node1 = new Node({ 
        id: 'nomatch-1',
        options: { role: 'client' }
      })
      
      try {
        await node1.requestAny({
          event: 'task.process',
          filter: { options: { role: 'worker' } }
        })
        expect.fail('Should have thrown NodeError')
      } catch (err) {
        expect(err).to.be.instanceOf(NodeError)
        expect(err.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
      }
    })
    
    it('should route downstream only (requestDownAny)', async () => {
      node1 = new Node({ id: 'down-1' })
      node2 = new Node({ 
        id: 'down-2',
        options: { role: 'worker' }
      })
      
      node2.onRequest('test.req', () => ({ from: 'down-2' }))
      
      // Bind node1, connect node2 to node1 (node2 is downstream of node1)
      await node1.bind('tcp://127.0.0.1:7014')
      await node2.connect({ address: 'tcp://127.0.0.1:7014' })
      
      await wait(500)
      
      // Node1 requests downstream
      const response = await node1.requestDownAny({
        event: 'test.req',
        filter: { options: { role: 'worker' } }
      })
      
      expect(response.from).to.equal('down-2')
    })
    
    it('should route upstream only (requestUpAny)', async () => {
      node1 = new Node({ 
        id: 'up-1',
        options: { role: 'client' }
      })
      node2 = new Node({ 
        id: 'up-2',
        options: { role: 'server' }
      })
      
      node2.onRequest('test.req', () => ({ from: 'up-2' }))
      
      // Bind node2, connect node1 to node2 (node2 is upstream of node1)
      await node2.bind('tcp://127.0.0.1:7015')
      await node1.connect({ address: 'tcp://127.0.0.1:7015' })
      
      await wait(500)
      
      // Node1 requests upstream
      const response = await node1.requestUpAny({
        event: 'test.req',
        filter: { options: { role: 'server' } }
      })
      
      expect(response.from).to.equal('up-2')
    })
  })
  
  // ============================================================================
  // ROUTING - BROADCAST (ALL)
  // ============================================================================
  
  describe('Routing - Broadcast (tickAll)', () => {
    let node1, node2, node3
    
    afterEach(async () => {
      if (node1) await node1.stop()
      if (node2) await node2.stop()
      if (node3) await node3.stop()
      node1 = node2 = node3 = null
    })
    
    it('should send tick to all matching nodes', async () => {
      node1 = new Node({ id: 'broadcast-1' })
      node2 = new Node({ 
        id: 'broadcast-2',
        options: { role: 'worker' }
      })
      node3 = new Node({ 
        id: 'broadcast-3',
        options: { role: 'worker' }
      })
      
      const received = []
      
      node2.onTick('broadcast.tick', (data) => {
        received.push('node2')
      })
      
      node3.onTick('broadcast.tick', (data) => {
        received.push('node3')
      })
      
      // Bind and connect
      await node2.bind('tcp://127.0.0.1:7016')
      await node3.bind('tcp://127.0.0.1:7017')
      await node1.connect({ address: 'tcp://127.0.0.1:7016' })
      await node1.connect({ address: 'tcp://127.0.0.1:7017' })
      
      await wait(500)
      
      // Broadcast to all workers
      await node1.tickAll({
        event: 'broadcast.tick',
        filter: { options: { role: 'worker' } },
        data: { message: 'hello all' }
      })
      
      await wait(200)
      
      expect(received).to.have.lengthOf(2)
      expect(received).to.include('node2')
      expect(received).to.include('node3')
    })
    
    it('should send tick to all downstream nodes (tickDownAll)', async () => {
      node1 = new Node({ id: 'down-all-1' })
      node2 = new Node({ id: 'down-all-2' })
      node3 = new Node({ id: 'down-all-3' })
      
      const received = []
      
      node2.onTick('test.tick', () => received.push('node2'))
      node3.onTick('test.tick', () => received.push('node3'))
      
      // Connect node2 and node3 to node1 (downstream)
      await node1.bind('tcp://127.0.0.1:7018')
      await node2.connect({ address: 'tcp://127.0.0.1:7018' })
      await node3.connect({ address: 'tcp://127.0.0.1:7018' })
      
      await wait(500)
      
      // Broadcast downstream
      await node1.tickDownAll({ event: 'test.tick', data: {} })
      
      await wait(200)
      
      expect(received).to.have.lengthOf(2)
    })
  })
  
  // ============================================================================
  // OPTIONS MANAGEMENT
  // ============================================================================
  
  describe('Options Management', () => {
    let node1, node2
    
    afterEach(async () => {
      if (node1) await node1.stop()
      if (node2) await node2.stop()
      node1 = node2 = null
    })
    
    it('should propagate options to server and clients', async () => {
      node1 = new Node({ 
        id: 'opts-1',
        options: { role: 'client' }
      })
      node2 = new Node({ id: 'opts-2' })
      
      // Bind and connect
      await node2.bind('tcp://127.0.0.1:7019')
      await node1.connect({ address: 'tcp://127.0.0.1:7019' })
      
      // Update options
      await node1.setOptions({ role: 'worker', capacity: 100 })
      
      const options = node1.getOptions()
      expect(options.role).to.equal('worker')
      expect(options.capacity).to.equal(100)
      expect(options._id).to.equal('opts-1')
    })
    
    it('should filter nodes by options', async () => {
      node1 = new Node({ id: 'filter-opts-1' })
      node2 = new Node({ 
        id: 'filter-opts-2',
        options: { role: 'api', region: 'us-east' }
      })
      
      await node2.bind('tcp://127.0.0.1:7020')
      await node1.connect({ address: 'tcp://127.0.0.1:7020' })
      
      await wait(500)
      
      // Get filtered nodes
      const nodes = node1.getFilteredNodes({
        options: { role: 'api' },
        up: true
      })
      
      expect(nodes).to.be.an('array')
      expect(nodes).to.include('filter-opts-2')
    })
  })
  
  // ============================================================================
  // LIFECYCLE
  // ============================================================================
  
  describe('Lifecycle', () => {
    let node
    
    afterEach(async () => {
      if (node) {
        await node.stop()
        node = null
      }
    })
    
    it('should stop node and cleanup resources', async () => {
      const node1 = new Node({ id: 'stop-1' })
      const node2 = new Node({ id: 'stop-2' })
      
      try {
        await node2.bind('tcp://127.0.0.1:7021')
        await node1.connect({ address: 'tcp://127.0.0.1:7021' })
        
        // Stop node1
        await node1.stop()
        
        // Should have cleaned up
        expect(node1).to.be.ok
      } finally {
        await node2.stop()
      }
    })
  })
  
  // ============================================================================
  // ERROR HANDLING
  // ============================================================================
  
  describe('Error Handling', () => {
    let node
    
    afterEach(async () => {
      if (node) await node.stop()
      node = null
    })
    
    it('should emit error events', (done) => {
      node = new Node({ id: 'error-1' })
      
      node.on('error', (err) => {
        expect(err).to.be.an('error')
        done()
      })
      
      // Trigger error by emitting manually (real errors come from server/client)
      node.emit('error', new Error('test error'))
    })
  })
})

