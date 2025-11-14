/**
 * ZeroMQ Reconnection Tests
 * 
 * Comprehensive testing of reconnection behavior at both:
 * 1. Native ZMQ level (ZMQ_RECONNECT_IVL, ZMQ_RECONNECT_IVL_MAX)
 * 2. Application level (RECONNECTION_TIMEOUT, state management)
 * 
 * Based on ZeroMQ documentation:
 * - ZeroMQ automatically reconnects in background
 * - Reconnection interval controls retry frequency
 * - Exponential backoff can be configured
 * - Socket events notify application of connection state
 */

import { expect } from 'chai'
import { Router as RouterSocket, Dealer as DealerSocket, TIMEOUT_INFINITY, ZMQConfigDefaults } from '../index.js'
import { TransportEvent } from '../../events.js'

// Helper: Wait for dealer to be ready after connect()
async function waitForReady(socket, timeoutMs = 5000) {
  if (socket.isOnline()) return
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Socket did not become ready within ${timeoutMs}ms`))
    }, timeoutMs)
    
    socket.once(TransportEvent.READY, () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

describe('ZeroMQ Transport Reconnection', () => {
  
  // ============================================================================
  // AUTOMATIC RECONNECTION (Native ZMQ)
  // ============================================================================
  
  describe('Native ZMQ Auto-Reconnection', () => {
    const routerAddress = 'tcp://127.0.0.1:7001'
    
    it('should auto-reconnect when router restarts (ZMQ_RECONNECT_IVL)', async function() {
      this.timeout(5000)
      
      // Start router
      let router = new RouterSocket({ id: 'router-v1' })
      await router.bind(routerAddress)
      
      // Connect dealer with fast reconnection interval
      const dealer = new DealerSocket({ 
        id: 'dealer-reconnect',
        config: {
          ZMQ_RECONNECT_IVL: 50,          // Retry every 50ms
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY  // Never give up
        }
      })
      
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      expect(dealer.isOnline()).to.be.true
      
      // Track events
      const events = []
      dealer.on(TransportEvent.NOT_READY, () => events.push('NOT_READY'))
      dealer.on(TransportEvent.READY, () => events.push('READY'))
      
      // Kill router
      await router.close()
      
      // Wait for disconnect detection
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(dealer.isOnline()).to.be.false
      expect(events).to.include('NOT_READY')
      
      // Start new router
      router = new RouterSocket({ id: 'router-v2' })
      await router.bind(routerAddress)
      
      // Wait for auto-reconnect (should be fast with 50ms interval)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      expect(dealer.isOnline()).to.be.true
      expect(events).to.include('READY')
      
      await dealer.close()
      await router.close()
    })

    it('should handle multiple consecutive reconnection cycles', async function() {
      this.timeout(10000)
      
      const routerAddress = 'tcp://127.0.0.1:7002'
      let router = new RouterSocket({ id: 'router-cycle-1' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'resilient-dealer',
        config: {
          ZMQ_RECONNECT_IVL: 50,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      expect(dealer.isOnline()).to.be.true
      
      // Track reconnection count
      let reconnectCount = 0
      dealer.on(TransportEvent.READY, () => reconnectCount++)
      
      // Cycle 1: Router restart
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(dealer.isOnline()).to.be.false
      
      router = new RouterSocket({ id: 'router-cycle-2' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(dealer.isOnline()).to.be.true
      
      // Cycle 2: Router restart
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(dealer.isOnline()).to.be.false
      
      router = new RouterSocket({ id: 'router-cycle-3' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(dealer.isOnline()).to.be.true
      
      // Cycle 3: Router restart
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(dealer.isOnline()).to.be.false
      
      router = new RouterSocket({ id: 'router-cycle-4' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(dealer.isOnline()).to.be.true
      
      // Should have reconnected at least 3 times (after initial connection)
      expect(reconnectCount).to.be.at.least(3)
      
      await dealer.close()
      await router.close()
    })

    it('should maintain connection through brief router downtime', async function() {
      this.timeout(5000)
      
      const routerAddress = 'tcp://127.0.0.1:7003'
      let router = new RouterSocket({ id: 'router-brief' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-patient',
        config: {
          ZMQ_RECONNECT_IVL: 100,  // Standard interval
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      await dealer.connect(routerAddress)
      
      // Kill router
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(dealer.isOnline()).to.be.false
      
      // Quick restart (< 500ms downtime)
      router = new RouterSocket({ id: 'router-brief-2' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 400))
      
      // Should have reconnected
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })
  })

  // ============================================================================
  // EXPONENTIAL BACKOFF (ZMQ_RECONNECT_IVL_MAX)
  // ============================================================================
  
  describe('Exponential Backoff', () => {
    it('should use constant interval when ZMQ_RECONNECT_IVL_MAX = 0', async function() {
      this.timeout(5000)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-constant',
        config: {
          ZMQ_RECONNECT_IVL: 100,
          ZMQ_RECONNECT_IVL_MAX: 0  // No backoff
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_RECONNECT_IVL).to.equal(100)
      expect(config.ZMQ_RECONNECT_IVL_MAX).to.equal(0)
      
      await dealer.close()
    })

    it('should support exponential backoff when ZMQ_RECONNECT_IVL_MAX > 0', async function() {
      this.timeout(5000)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-backoff',
        config: {
          ZMQ_RECONNECT_IVL: 100,       // Start: 100ms
          ZMQ_RECONNECT_IVL_MAX: 10000  // Max: 10s (100→200→400→800→1600→3200→6400→10000)
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_RECONNECT_IVL).to.equal(100)
      expect(config.ZMQ_RECONNECT_IVL_MAX).to.equal(10000)
      
      // Note: Actual backoff behavior is tested via integration
      // This test validates configuration is applied
      
      await dealer.close()
    })
  })

  // ============================================================================
  // APPLICATION-LEVEL RECONNECTION TIMEOUT
  // ============================================================================
  
  describe('Reconnection Timeout (Application Level)', () => {
    it('should reconnect indefinitely when RECONNECTION_TIMEOUT = -1', async function() {
      this.timeout(8000)
      
      const routerAddress = 'tcp://127.0.0.1:7004'
      let router = new RouterSocket({ id: 'router-infinite' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-infinite',
        config: {
          ZMQ_RECONNECT_IVL: 50,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY  // Never give up
        }
      })
      
      await dealer.connect(routerAddress)
      
      // Kill router for extended period
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 2000))  // 2 seconds downtime
      
      // Dealer should still be trying to reconnect
      expect(dealer.isOnline()).to.be.false
      
      // Restart router
      router = new RouterSocket({ id: 'router-infinite-2' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Should have reconnected
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })
  })

  // ============================================================================
  // STATE MANAGEMENT DURING RECONNECTION
  // ============================================================================
  
  describe('State Management', () => {
    it('should track transitions via events: READY → NOT_READY → READY', async function() {
      this.timeout(5000)
      
      const routerAddress = 'tcp://127.0.0.1:7007'
      let router = new RouterSocket({ id: 'router-state' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-state',
        config: {
          ZMQ_RECONNECT_IVL: 50,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      
      // Initial: READY received implies online
      expect(dealer.isOnline()).to.be.true
      
      // Kill router
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // After router close, dealer should be offline (NOT_READY path)
      expect(dealer.isOnline()).to.be.false
      
      // Restart router
      router = new RouterSocket({ id: 'router-state-2' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // After router restarts, dealer should come online again
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })

    it('should allow message sending only when online', async function() {
      this.timeout(5000)
      
      const routerAddress = 'tcp://127.0.0.1:7008'
      let router = new RouterSocket({ id: 'router-send' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-send',
        config: {
          ZMQ_RECONNECT_IVL: 50,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      
      // Can send when online
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.not.throw()
      
      // Kill router
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Cannot send when offline
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.throw('offline')
      
      // Restart router
      router = new RouterSocket({ id: 'router-send-2' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Can send again when reconnected
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.not.throw()
      
      await dealer.close()
      await router.close()
    })
  })

  // ============================================================================
  // EVENT SEQUENCE VALIDATION
  // ============================================================================
  
  describe('Event Sequence', () => {
    it('should emit events in correct order during reconnection', async function() {
      this.timeout(5000)
      
      const routerAddress = 'tcp://127.0.0.1:7009'
      let router = new RouterSocket({ id: 'router-events' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-events',
        config: {
          ZMQ_RECONNECT_IVL: 50,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      const events = []
      dealer.on(TransportEvent.READY, () => events.push('READY'))
      dealer.on(TransportEvent.NOT_READY, () => events.push('NOT_READY'))
      dealer.on(TransportEvent.CLOSED, () => events.push('CLOSED'))
      
      // Connect
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Expected: [READY]
      expect(events).to.deep.equal(['READY'])
      
      // Disconnect
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Expected: [READY, NOT_READY]
      expect(events).to.deep.equal(['READY', 'NOT_READY'])
      
      // Reconnect
      router = new RouterSocket({ id: 'router-events-2' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Expected: [READY, NOT_READY, READY]
      expect(events).to.deep.equal(['READY', 'NOT_READY', 'READY'])
      
      await dealer.close()
      await router.close()
    })
  })

  // ============================================================================
  // CONFIGURATION VALIDATION
  // ============================================================================
  
  describe('Configuration', () => {
    it('should use default reconnection config when not provided', () => {
      const dealer = new DealerSocket({ id: 'dealer-defaults' })
      const config = dealer.getConfig()
      
      expect(config.ZMQ_RECONNECT_IVL).to.equal(ZMQConfigDefaults.ZMQ_RECONNECT_IVL)
      expect(config.ZMQ_RECONNECT_IVL_MAX).to.equal(ZMQConfigDefaults.ZMQ_RECONNECT_IVL_MAX)
      expect(config.RECONNECTION_TIMEOUT).to.equal(TIMEOUT_INFINITY)
      
      dealer.close()
    })

    it('should allow custom reconnection config', () => {
      const dealer = new DealerSocket({ 
        id: 'dealer-custom',
        config: {
          ZMQ_RECONNECT_IVL: 500,
          ZMQ_RECONNECT_IVL_MAX: 30000,
          RECONNECTION_TIMEOUT: 60000
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_RECONNECT_IVL).to.equal(500)
      expect(config.ZMQ_RECONNECT_IVL_MAX).to.equal(30000)
      expect(config.RECONNECTION_TIMEOUT).to.equal(60000)
      
      dealer.close()
    })

    it('should respect INFINITY constant for timeouts', () => {
      const dealer = new DealerSocket({ 
        id: 'dealer-infinity',
        config: {
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      const config = dealer.getConfig()
      expect(config.RECONNECTION_TIMEOUT).to.equal(-1)
      
      dealer.close()
    })
  })
})

