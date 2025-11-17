/**
 * Node Advanced Tests - Coverage Completion
 * 
 * Tests for advanced routing, filtering, and utility methods
 * that are not covered by the basic node.test.js
 */

import { expect } from 'chai'
import Node from '../src/node.js'
import { TIMING, wait, getUniquePorts } from './test-utils.js'

// Port allocation helper
function getPortSet() {
  const [a, b, c] = getUniquePorts(3)
  return { a, b, c }
}

describe('Node - Advanced Routing & Utilities', () => {
  let nodeA, nodeB, nodeC
  let ports
  
  beforeEach(async () => {
    // Allocate unique ports for this test
    ports = getPortSet()
    
    // Create nodes WITHOUT auto-bind (to avoid constructor race conditions)
    nodeA = new Node({
      id: 'node-a',
      options: { role: 'master', priority: 10 }
    })
    
    nodeB = new Node({
      id: 'node-b',
      options: { role: 'worker', priority: 5 }
    })
    
    nodeC = new Node({
      id: 'node-c',
      options: { role: 'worker', priority: 3 }
    })
    
    // Bind nodes sequentially (bind() completes when socket is listening)
    await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
    await nodeB.bind(`tcp://127.0.0.1:${ports.b}`)
    await nodeC.bind(`tcp://127.0.0.1:${ports.c}`)
  })
  
  afterEach(async () => {
    // Clean up in reverse order
    if (nodeC) await nodeC.stop()
    if (nodeB) await nodeB.stop()
    if (nodeA) await nodeA.stop()
    
    // Critical: Wait for ports to be released by OS
    await wait(TIMING.PORT_RELEASE)
    
    // Clear references
    nodeA = nodeB = nodeC = null
  })
  
  // ============================================================================
  // tickAny() - Line 736-747
  // ============================================================================
  
  describe('tickAny() - Advanced Routing', () => {
    beforeEach(async () => {
      // For downstream routing: workers connect TO master (nodeA)
      // connect() completes when handshake is done and peer is registered
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await nodeC.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      
      // Small wait for ZMQ internal state to stabilize
      await wait(TIMING.RACE_CONDITION_BUFFER)
    })
    
    afterEach(async () => {
      // Disconnect to prevent ZeroMQ crashes during cleanup
      if (nodeB) await nodeB.disconnect(`tcp://127.0.0.1:${ports.a}`).catch(() => {})
      if (nodeC) await nodeC.disconnect(`tcp://127.0.0.1:${ports.a}`).catch(() => {})
      await wait(TIMING.DISCONNECT_COMPLETE)
    })
    
    it('should send tick to any matching node with filter', (done) => {
      let tickReceived = false
      
      // Register handler on both workers
      nodeB.onTick('test:any', () => {
        tickReceived = true
        done()
      })
      
      nodeC.onTick('test:any', () => {
        tickReceived = true
        done()
      })
      
      // Send to any worker (downstream)
      nodeA.tickAny({
        event: 'test:any',
        data: { message: 'hello' },
        filter: { role: 'worker' }
      })
    })
    
    it('should emit error when no nodes match', async () => {
      // tickAny now rejects when no nodes match (consistent with requestAny)
      const error = await nodeA.tickAny({
        event: 'test',
        filter: { role: 'nonexistent' }
      }).catch(e => e)
      
      expect(error.code).to.equal('NO_NODES_MATCH_FILTER')
      expect(error.message).to.match(/No nodes match filter criteria/)
    })
    
    it('should support down and up filtering', (done) => {
      nodeB.onTick('test:direction', () => {
        done()
      })
      
      nodeC.onTick('test:direction', () => {
        done()
      })
      
      // Increased delay to ensure peers are fully registered on server side
      setTimeout(() => {
        // Should send to downstream nodes only
        nodeA.tickAny({
          event: 'test:direction',
          down: true,
          up: false
        })
      }, 500)
    })
  })
  
  // ============================================================================
  // tickDownAny() - Line 753-755
  // ============================================================================
  
  describe('tickDownAny() - Downstream Routing', () => {
    beforeEach(async () => {
      // For downstream: nodeB connects TO nodeA (making nodeB downstream)
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
    })
    
    it('should send tick to any downstream node', (done) => {
      nodeB.onTick('test:down', (envelope) => {
        expect(envelope.data.message).to.equal('downstream')
        done()
      })
      
      nodeA.tickDownAny({
        event: 'test:down',
        data: { message: 'downstream' }
      })
    })
    
    it('should respect filter for downstream nodes', (done) => {
      nodeB.onTick('test:filtered', () => {
        done()
      })
      
      nodeA.tickDownAny({
        event: 'test:filtered',
        filter: { role: 'worker' }
      })
    })
  })
  
  // ============================================================================
  // tickUpAny() - Line 760-762
  // ============================================================================
  
  describe('tickUpAny() - Upstream Routing', () => {
    beforeEach(async () => {
      // connect() already waits for handshake completion
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
    })
    
    it('should send tick to any upstream node', (done) => {
      nodeA.onTick('test:up', (envelope) => {
        expect(envelope.data.message).to.equal('upstream')
        done()
      })
      
      nodeB.tickUpAny({
        event: 'test:up',
        data: { message: 'upstream' }
      })
    })
    
    it('should respect filter for upstream nodes', (done) => {
      nodeA.onTick('test:master', () => {
        done()
      })
      
      nodeB.tickUpAny({
        event: 'test:master',
        filter: { role: 'master' }
      })
    })
  })
  
  // ============================================================================
  // tick() with no route - Line 685
  // ============================================================================
  
  describe('tick() - Error Handling', () => {
    it('should throw NODE_NOT_FOUND when route does not exist', () => {
      expect(() => {
        nodeA.tick({
          to: 'nonexistent-node',
          event: 'test'
        })
      }).to.throw(/No route to node 'nonexistent-node'/)
    })
    
    it('should provide context in error', () => {
      try {
        nodeA.tick({
          to: 'missing-node',
          event: 'important:event'
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.context).to.exist
        expect(err.context.event).to.equal('important:event')
      }
    })
  })
  
  // ============================================================================
  // _selectNode() with empty array - Line 641
  // ============================================================================
  
  describe('_selectNode() - Edge Cases', () => {
    it('should return null for empty nodeIds array', async () => {
      // _selectNode returns null for empty arrays, tickAny rejects with error
      const error = await nodeA.tickAny({
        event: 'test',
        filter: { nonexistent: 'value' }
      }).catch(e => e)
      
      expect(error).to.be.an('error')
      expect(error.message).to.match(/No nodes match filter criteria/)
    })
  })
  
  // ============================================================================
  // offTick() with RegExp - Line 551
  // ============================================================================
  
  describe('offTick() - RegExp Patterns', () => {
    beforeEach(async () => {
      // connect() already waits for handshake completion
      await nodeA.connect({ address: `tcp://127.0.0.1:${ports.b}` })
    })
    
    it('should unregister tick handler with RegExp pattern', (done) => {
      let callCount = 0
      
      const handler = () => {
        callCount++
      }
      
      // Register with string pattern
      nodeB.onTick(/test:regex.*/, handler)
      
      // Send tick - should be received
      nodeA.tick({ to: 'node-b', event: 'test:regex:1' })
      
      setTimeout(() => {
        expect(callCount).to.equal(1)
        
        // Unregister
        nodeB.offTick(/test:regex.*/, handler)
        
        // Send again - should NOT be received
        nodeA.tick({ to: 'node-b', event: 'test:regex:2' })
        
        setTimeout(() => {
          expect(callCount).to.equal(1) // Still 1, not incremented
          done()
        }, 100)
      }, 100)
    })
  })
  
  // ============================================================================
  // getServerInfo() - Line 843-861
  // ============================================================================
  
  describe('getServerInfo() - Server Information', () => {
    beforeEach(async () => {
      // connect() already waits for handshake - peer info is ready
      await nodeA.connect({ address: `tcp://127.0.0.1:${ports.b}` })
    })
    
    it('should get server info by address', () => {
      const info = nodeA.getServerInfo({
        address: `tcp://127.0.0.1:${ports.b}`
      })
      
      expect(info).to.exist
      expect(info.id).to.equal('node-b')
    })
    
    it('should get server info by id', () => {
      const info = nodeA.getServerInfo({ id: 'node-b' })
      
      expect(info).to.exist
      expect(info.id).to.equal('node-b')
    })
    
    it('should return null for nonexistent address', () => {
      const info = nodeA.getServerInfo({
        address: 'tcp://127.0.0.1:9999'
      })
      
      expect(info).to.be.null
    })
    
    it('should return null for nonexistent id', () => {
      const info = nodeA.getServerInfo({ id: 'nonexistent' })
      
      expect(info).to.be.null
    })
  })
  
  // ============================================================================
  // getClientInfo() - Line 866-875
  // ============================================================================
  
  describe('getClientInfo() - Client Information', () => {
    beforeEach(async () => {
      // connect() already waits for handshake - peer info is ready
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
    })
    
    it('should get client info by id', () => {
      const info = nodeA.getClientInfo({ id: 'node-b' })
      
      expect(info).to.exist
      expect(info.id).to.equal('node-b')
    })
    
    it('should return null for nonexistent client', () => {
      const info = nodeA.getClientInfo({ id: 'nonexistent' })
      
      expect(info).to.be.null
    })
    
    it('should return null when no server exists', () => {
      const nodeD = new Node({ id: 'node-d' })
      
      const info = nodeD.getClientInfo({ id: 'some-id' })
      
      expect(info).to.be.null
    })
  })
  
  // ============================================================================
  // Complex Integration Scenarios
  // ============================================================================
  
  describe('Complex Routing Scenarios', () => {
    beforeEach(async () => {
      // Create full mesh - each connect() waits for its handshake
      await Promise.all([
        nodeA.connect({ address: `tcp://127.0.0.1:${ports.b}` }),
        nodeA.connect({ address: `tcp://127.0.0.1:${ports.c}` }),
        nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` }),
        nodeC.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      ])
      // All handshakes complete - mesh is ready!
    })
    
    it('should route ticks through complex mesh', (done) => {
      let receivedCount = 0
      
      nodeB.onTick('broadcast', () => {
        receivedCount++
        if (receivedCount === 2) done()
      })
      
      nodeC.onTick('broadcast', () => {
        receivedCount++
        if (receivedCount === 2) done()
      })
      
      // Broadcast to all workers
      nodeA.tickAll({
        event: 'broadcast',
        filter: { role: 'worker' }
      })
    })
    
    it('should handle tickAny with priority-based selection', (done) => {
      let received = false
      
      nodeB.onTick('priority', () => {
        if (!received) {
          received = true
          done()
        }
      })
      
      nodeC.onTick('priority', () => {
        if (!received) {
          received = true
          done()
        }
      })
      
      // Should randomly select one worker
      nodeA.tickAny({
        event: 'priority',
        filter: { role: 'worker' }
      })
    })
  })
})

// ==============================================================================
// ADDITIONAL NODE TESTS (Isolated - No Shared Setup)
// ==============================================================================

describe('Node - Additional Coverage', () => {
  let testNodes = []
  
  // Generic cleanup for all tests in this suite
  afterEach(async () => {
    // Stop all nodes in reverse order
    for (let i = testNodes.length - 1; i >= 0; i--) {
      if (testNodes[i]) {
        await testNodes[i].stop().catch(() => {})
      }
    }
    
    // Wait for ports to be released
    await wait(TIMING.PORT_RELEASE)
    
    // Clear array
    testNodes = []
  })
  
  describe('offTick() - Advanced Cases', () => {
    it('should remove all listeners when handler not provided', async () => {
      const [portA] = getUniquePorts(1)
      const nodeA = new Node({ id: 'node-A' })
      const nodeB = new Node({ id: 'node-B' })
      testNodes.push(nodeA, nodeB)
      
      // Setup: bind() returns address when complete
      const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
      await nodeB.connect({ address: addressA })
      
      // Register multiple handlers for same pattern
      const handler1 = () => {}
      const handler2 = () => {}
      nodeA.onTick('test:event', handler1)
      nodeA.onTick('test:event', handler2)
      
      // Remove all handlers for pattern (no handler specified)
      nodeA.offTick('test:event')
      
      // Verify handlers were removed (no error on duplicate removal)
      nodeA.offTick('test:event', handler1) // Should not throw
    })

    it('should remove handlers from multiple clients', async () => {
      const [portA] = getUniquePorts(1)
      const nodeA = new Node({ id: 'node-A' })
      const nodeB = new Node({ id: 'node-B' })
      const nodeC = new Node({ id: 'node-C' })
      testNodes.push(nodeA, nodeB, nodeC)
      
      // Setup: bind returns address, connect waits for handshake
      const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
      await nodeB.connect({ address: addressA })
      await nodeC.connect({ address: addressA })
      
      const handler = () => {}
      nodeA.onTick('test:multi', handler)
      
      // offTick should propagate to all connected clients
      nodeA.offTick('test:multi', handler)
      
      // Clean up: disconnect clients from server (pass address string)
      await nodeB.disconnect(addressA)
      await nodeC.disconnect(addressA)
      await nodeA.unbind()
      await wait(TIMING.DISCONNECT_COMPLETE)  // Wait for graceful disconnect to complete
    })
  })

  describe('tickUpAll()', () => {
    it('should send tick to upstream nodes only', async () => {
      const [portA, portB] = getUniquePorts(2)
      const nodeA = new Node({ id: 'node-A' })
      const nodeB = new Node({ id: 'node-B' })
      const nodeC = new Node({ id: 'node-C' })
      testNodes.push(nodeA, nodeB, nodeC)
      
      // Topology: B ← A → C (B=upstream, C=downstream from A's perspective)
      const addressB = await nodeB.bind(`tcp://127.0.0.1:${portB}`)
      const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
      
      await nodeA.connect({ address: addressB }) // A → B (upstream)
      await nodeC.connect({ address: addressA }) // C → A (A is downstream)
      
      let receivedB = false
      let receivedC = false
      
      nodeB.onTick('upstream:test', () => { receivedB = true })
      nodeC.onTick('upstream:test', () => { receivedC = true })
      
      // tickUpAll should only send to upstream (B), not downstream (C)
      nodeA.tickUpAll({ event: 'upstream:test' })
      await wait(TIMING.MESSAGE_PROPAGATION)
      
      expect(receivedB).to.be.true
      expect(receivedC).to.be.false
    })
  })

  describe('Empty Filter Results', () => {
    it('should handle requestAny with no matching nodes', async () => {
      const [portA] = getUniquePorts(1)
      const nodeA = new Node({ id: 'node-A' })
      const nodeB = new Node({ id: 'node-B', options: { type: 'worker' } })
      testNodes.push(nodeA, nodeB)
      
      // Setup
      const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
      await nodeB.connect({ address: addressA })
      
      nodeB.onRequest('test:request', () => ({ result: 'ok' }))
      
      // Filter that matches no nodes (nodeB has type: 'worker', but we filter for type: 'manager')
      const error = await nodeA.requestAny({
        event: 'test:request',
        data: {},
        filter: { options: { type: 'manager' } } // No node has this type
      }).catch(e => e)
      
      expect(error).to.be.an('error')
      expect(error.code).to.equal('NO_NODES_MATCH_FILTER')
    })

    it('should handle tickAny with no matching nodes', async () => {
      const [portA] = getUniquePorts(1)
      const nodeA = new Node({ id: 'node-A' })
      const nodeB = new Node({ id: 'node-B', options: { region: 'us' } })
      testNodes.push(nodeA, nodeB)
      
      // Setup
      const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
      await nodeB.connect({ address: addressA })
      
      let received = false
      nodeB.onTick('test:tick', () => { received = true })
      
      // Filter that matches no nodes - tickAny rejects like requestAny
      const error = await nodeA.tickAny({
        event: 'test:tick',
        data: {},
        filter: { options: { region: 'eu' } } // No node has this region
      }).catch(e => e)
      
      expect(error).to.be.an('error')
      expect(error.code).to.equal('NO_NODES_MATCH_FILTER')
      expect(received).to.be.false
    })

    it('should handle tickAll with filter that matches no nodes', async () => {
      const [portA] = getUniquePorts(1)
      const nodeA = new Node({ id: 'node-A' })
      const nodeB = new Node({ id: 'node-B', options: { env: 'prod' } })
      testNodes.push(nodeA, nodeB)
      
      // Setup
      const addressA = await nodeA.bind(`tcp://127.0.0.1:${portA}`)
      await nodeB.connect({ address: addressA })
      
      let received = false
      nodeB.onTick('test:broadcast', () => { received = true })
      
      // Filter that matches no nodes - tickAll doesn't throw, just sends to 0 nodes
      const result = await nodeA.tickAll({
        event: 'test:broadcast',
        data: {},
        filter: { options: { env: 'staging' } } // No node has this env
      })
      
      await wait(TIMING.MESSAGE_PROPAGATION)
      
      expect(result).to.be.an('array')
      expect(result).to.have.lengthOf(0) // No nodes matched
      expect(received).to.be.false
    })
  })  
})


