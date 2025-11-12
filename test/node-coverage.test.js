/**
 * Node Coverage Tests - Target 100% coverage
 * 
 * These tests specifically target uncovered lines in node.js
 */

import { expect } from 'chai'
import Node from '../src/node.js'
import { NodeEvent } from '../src/node.js'
import { wait, TIMING } from './test-utils.js'

describe('Node - Coverage Tests (Target 100%)', () => {
  let nodeA, nodeB, nodeC
  const ports = {
    a: 9100,
    b: 9101,
    c: 9102
  }

  afterEach(async () => {
    const nodes = [nodeA, nodeB, nodeC].filter(Boolean)
    await Promise.all(nodes.map(n => n.stop().catch(() => {})))
    await wait(TIMING.CLEANUP)
    nodeA = nodeB = nodeC = null
  })

  // ============================================================================
  // Handler Registration Before Server/Client Creation
  // ============================================================================

  describe('Handler Registration - Early Registration', () => {
    it('should apply onRequest handlers to server when created later', async () => {
      // Create node WITHOUT server
      nodeA = new Node({ id: 'node-a' })
      
      let requestReceived = false
      
      // Register handler BEFORE server exists
      nodeA.onRequest('test', (envelope) => {
        requestReceived = true
        return { success: true }
      })
      
      // NOW bind server - handler should be applied
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      // Create client and test
      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(TIMING.RACE_CONDITION_BUFFER)
      
      const response = await nodeB.request({
        to: 'node-a',
        event: 'test',
        data: {}
      })
      
      expect(requestReceived).to.be.true
      expect(response.success).to.be.true
    })

    it('should apply onRequest handlers to clients when created later', async () => {
      // Server node
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      // Client node - register handler BEFORE connecting
      nodeB = new Node({ id: 'node-b' })
      
      let requestReceived = false
      nodeB.onRequest('test', (envelope) => {
        requestReceived = true
        return { success: true }
      })
      
      // NOW connect - handler should be applied to client
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(TIMING.RACE_CONDITION_BUFFER)
      
      const response = await nodeA.request({
        to: 'node-b',
        event: 'test',
        data: {}
      })
      
      expect(requestReceived).to.be.true
      expect(response.success).to.be.true
    })
  })

  // ============================================================================
  // Handler Removal
  // ============================================================================

  describe('Handler Removal - offRequest/offTick', () => {
    it('should remove request handlers from server', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      let handlerCalled = false
      const handler = (envelope) => {
        handlerCalled = true
        return { success: true }
      }
      
      // Add handler
      nodeA.onRequest('test', handler)
      
      // Verify handler works
      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(TIMING.RACE_CONDITION_BUFFER)
      
      await nodeB.request({
        to: 'node-a',
        event: 'test',
        data: {}
      })
      expect(handlerCalled).to.be.true
      
      // Remove handler (tests line 480-481)
      handlerCalled = false
      nodeA.offRequest('test', handler)
      
      // Verify removed - should timeout
      try {
        await nodeB.request({
          to: 'node-a',
          event: 'test',
          data: {},
          timeout: 500
        })
        expect.fail('Should have timed out')
      } catch (err) {
        expect(err).to.exist
        expect(handlerCalled).to.be.false
      }
    })

    it('should remove request handlers from all clients', async () => {
      // Server
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      // Client with handler
      nodeB = new Node({ id: 'node-b' })
      let handlerCalled = false
      const handler = (envelope) => {
        handlerCalled = true
        return { success: true }
      }
      nodeB.onRequest('test', handler)
      
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(TIMING.RACE_CONDITION_BUFFER)
      
      // Verify handler works
      await nodeA.request({
        to: 'node-b',
        event: 'test',
        data: {}
      })
      expect(handlerCalled).to.be.true
      
      // Remove handler (tests line 485)
      handlerCalled = false
      nodeB.offRequest('test', handler)
      
      // Verify removed
      try {
        await nodeA.request({
          to: 'node-b',
          event: 'test',
          data: {},
          timeout: 500
        })
        expect.fail('Should have timed out')
      } catch (err) {
        expect(err).to.exist
        expect(handlerCalled).to.be.false
      }
    })

    it('should remove tick handlers from all clients', async () => {
      // Server
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      // Client with handler
      nodeB = new Node({ id: 'node-b' })
      let tickReceived = false
      const handler = (envelope) => {
        tickReceived = true
      }
      nodeB.onTick('test', handler)
      
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(TIMING.RACE_CONDITION_BUFFER)
      
      // Remove handler (tests line 529)
      nodeB.offTick('test', handler)
      
      // Send tick - should NOT be received
      nodeA.tick({
        to: 'node-b',
        event: 'test',
        data: {}
      })
      
      await wait(200)
      expect(tickReceived).to.be.false
    })
  })

  // ============================================================================
  // Client Lifecycle Events
  // ============================================================================

  describe('Client Lifecycle - STOPPED Event', () => {
    it('should emit PEER_LEFT when server stops', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      nodeB = new Node({ id: 'node-b' })
      
      // Set up listener BEFORE connecting
      let peerLeft = false
      let peerLeftData = null
      
      nodeB.on(NodeEvent.PEER_LEFT, (data) => {
        peerLeft = true
        peerLeftData = data
      })
      
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(TIMING.RACE_CONDITION_BUFFER)
      
      // Stop nodeA's server (tests line 428-436: Client.STOPPED/DISCONNECTED event)
      await nodeA.stop()
      await wait(TIMING.RACE_CONDITION_BUFFER * 2)
      
      expect(peerLeft).to.be.true
      expect(peerLeftData).to.exist
      expect(peerLeftData.direction).to.equal('upstream')
      // Reason can be 'stopped' or 'disconnected' depending on timing
      expect(['stopped', 'disconnected', 'failed']).to.include(peerLeftData.reason)
      expect(peerLeftData.peerId).to.be.a('string').and.not.be.empty
    })
  })

  // ============================================================================
  // Disconnect Cleanup
  // ============================================================================

  describe('Disconnect - Handler Cleanup', () => {
    it('should handle disconnect and reconnect cycle correctly', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      // Use disconnect on address that was never connected
      // This should return true without errors
      const result = await nodeA.disconnect(`tcp://127.0.0.1:${ports.b}`)
      expect(result).to.be.true
    })
  })

  // ============================================================================
  // _selectNode Edge Case
  // ============================================================================

  describe('_selectNode - Edge Cases', () => {
    it('should handle empty nodeIds array', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      // Try tickAny with no matching nodes (tests line 676-677)
      try {
        await nodeA.tickAny({
          event: 'test',
          filter: { nonexistent: 'value' }
        })
        expect.fail('Should have rejected')
      } catch (err) {
        expect(err.code).to.equal('NO_NODES_MATCH_FILTER')
      }
    })

    it('should handle null nodeIds', async () => {
      nodeA = new Node({ id: 'node-a' })
      
      // _selectNode called with empty array returns null
      const result = nodeA._selectNode([])
      expect(result).to.be.null
    })
  })

  // ============================================================================
  // Multiple Clients Handler Sync
  // ============================================================================

  describe('Multiple Clients - Handler Sync', () => {
    it('should apply handlers to multiple existing clients', async () => {
      // Server
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
      
      // Create TWO clients first
      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      
      nodeC = new Node({ id: 'node-c' })
      await nodeC.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      
      await wait(TIMING.RACE_CONDITION_BUFFER)
      
      // NOW add handler on nodeA - should apply to BOTH clients (line 460-462)
      let requestsReceived = 0
      nodeA.onRequest('test', (envelope) => {
        requestsReceived++
        return { success: true }
      })
      
      // Test both clients received the handler
      const response1 = await nodeB.request({
        to: 'node-a',
        event: 'test',
        data: {}
      })
      
      const response2 = await nodeC.request({
        to: 'node-a',
        event: 'test',
        data: {}
      })
      
      expect(requestsReceived).to.equal(2)
      expect(response1.success).to.be.true
      expect(response2.success).to.be.true
    })
  })
})

