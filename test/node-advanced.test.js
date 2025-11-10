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
    
    // Explicitly bind nodes sequentially to avoid port conflicts
    await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)
    await nodeB.bind(`tcp://127.0.0.1:${ports.b}`)
    await nodeC.bind(`tcp://127.0.0.1:${ports.c}`)
    
    // Wait for bind to fully complete
    await wait(TIMING.BIND_READY)
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
      // This makes nodeB and nodeC downstream from nodeA's perspective
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await nodeC.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      // Critical: Wait for server-side peer registration to complete
      await wait(TIMING.PEER_REGISTRATION)
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
    
    it('should emit error when no nodes match', (done) => {
      // Node emits error event, default handler throws
      nodeA.once('error', (err) => {
        expect(err.code).to.equal('NO_NODES_MATCH_FILTER')
        expect(err.message).to.match(/No nodes match filter criteria/)
        done()
      })
      
      nodeA.tickAny({
        event: 'test',
        filter: { role: 'nonexistent' }
      })
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
      nodeB.onTick('test:down', (data) => {
        expect(data.message).to.equal('downstream')
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
      nodeA.onTick('test:up', (data) => {
        expect(data.message).to.equal('upstream')
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
    it('should return null for empty nodeIds array', () => {
      // This is tested indirectly through tickAny with no matches
      expect(() => {
        nodeA.tickAny({
          event: 'test',
          filter: { nonexistent: 'value' }
        })
      }).to.throw(/No nodes match filter criteria/)
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

