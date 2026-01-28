/**
 * Dealer ↔ Router Integration Tests
 * 
 * **What**: End-to-end tests for DealerSocket and RouterSocket communication
 * **Why**: Verify real-world ZeroMQ transport behavior across all scenarios
 * **Coverage**: Connection, messaging, reconnection, multi-client, errors, cleanup
 * 
 * Test Groups:
 * - Basic Communication (request/response patterns)
 * - Connection Lifecycle (bind/unbind, connect/disconnect)
 * - Automatic Reconnection (ZeroMQ native retry logic)
 * - Exponential Backoff (ZMQ_RECONNECT_IVL_MAX configuration)
 * - Multiple Clients (router fan-out patterns)
 * - State Management (online/offline transitions)
 * - Event Sequences (READY → NOT_READY → READY)
 * - Error Scenarios (offline sends, abrupt closures)
 * - Resource Cleanup (proper teardown)
 * - High Throughput (stress testing)
 */

import { expect } from 'chai'
import { Dealer as DealerSocket, Router as RouterSocket, TIMEOUT_INFINITY } from '../index.js'
import { TransportEvent } from '../../events.js'
import { wait, waitForReady, waitForNotReady, getAvailablePort, TestTimeouts } from './helpers.js'

// Alias for backward compatibility
const Timeouts = { INFINITY: TIMEOUT_INFINITY }

describe('Dealer ↔ Router Integration', () => {
  
  // ==========================================================================
  // BASIC COMMUNICATION
  // ==========================================================================
  
  describe('Basic Communication', () => {
    let router, dealer
    let routerAddress

    beforeEach(async () => {
      const port = getAvailablePort()
      routerAddress = `tcp://127.0.0.1:${port}`
      
      router = new RouterSocket({ id: 'router-basic' })
      dealer = new DealerSocket({ 
        id: 'dealer-basic',
        config: { RECONNECTION_TIMEOUT: TIMEOUT_INFINITY }
      })
      
      await router.bind(routerAddress)
    })

    afterEach(async () => {
      await dealer.close()
      await router.close()
      // Give ZeroMQ time to fully release ports
      await wait(100)
    })

    it('should establish connection', async () => {
      let dealerConnected = false
      
      dealer.once(TransportEvent.READY, () => {
        dealerConnected = true
      })
      
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      await wait(100)
      
      expect(dealerConnected).to.be.true
      expect(dealer.isOnline()).to.be.true
      expect(router.isOnline()).to.be.true
    })

    it('should send message from dealer to router', async () => {
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      
      const testMessage = Buffer.from('Hello Router!')
      let receivedMessage = null
      
      router.once(TransportEvent.MESSAGE, ({ buffer }) => {
        receivedMessage = buffer
      })
      
      dealer.sendBuffer(testMessage)
      await wait(200)
      
      expect(receivedMessage).to.not.be.null
      expect(receivedMessage.toString()).to.equal('Hello Router!')
    })

    it('should send message from router to dealer', async () => {
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      await wait(100)
      
      const testMessage = Buffer.from('Hello Dealer!')
      let receivedMessage = null
      
      dealer.once(TransportEvent.MESSAGE, ({ buffer }) => {
        receivedMessage = buffer
      })
      
      // Router needs dealer's identity (from first message)
      dealer.sendBuffer(Buffer.from('init'))
      await wait(100)
      
      // Now router can reply
      router.sendBuffer(testMessage, dealer.getId())
      await wait(200)
      
      expect(receivedMessage).to.not.be.null
      expect(receivedMessage.toString()).to.equal('Hello Dealer!')
    })

    it('should handle bidirectional message exchange', async () => {
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      await wait(100)
      
      const messages = []
      
      router.on(TransportEvent.MESSAGE, ({ buffer }) => {
        messages.push({ from: 'dealer', data: buffer.toString() })
        // Echo back
        router.sendBuffer(Buffer.from('ACK: ' + buffer.toString()), dealer.getId())
      })
      
      dealer.on(TransportEvent.MESSAGE, ({ buffer }) => {
        messages.push({ from: 'router', data: buffer.toString() })
      })
      
      // Send multiple messages
      dealer.sendBuffer(Buffer.from('msg-1'))
      await wait(100)
      
      dealer.sendBuffer(Buffer.from('msg-2'))
      await wait(100)
      
      dealer.sendBuffer(Buffer.from('msg-3'))
      await wait(100)
      
      expect(messages).to.have.lengthOf(6) // 3 messages + 3 acks
      expect(messages.filter(m => m.from === 'dealer')).to.have.lengthOf(3)
      expect(messages.filter(m => m.from === 'router')).to.have.lengthOf(3)
    })
  })

  // ==========================================================================
  // CONNECTION LIFECYCLE
  // ==========================================================================
  
  describe('Connection Lifecycle', () => {
    const routerAddress = 'tcp://127.0.0.1:6002'

    it('should handle dealer connecting before router binds', async () => {
      const dealer = new DealerSocket({ 
        id: 'early-dealer',
        config: {
          CONNECTION_TIMEOUT: 1000,
          ZMQ_RECONNECT_IVL: 100
        }
      })
      
      // Dealer connects but router isn't bound yet
      await dealer.connect(routerAddress)
      await wait(300)
      
      // Now bind router
      const router = new RouterSocket({ id: 'late-router' })
      await router.bind(routerAddress)
      
      // Connection should eventually succeed
      await wait(400)
      
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })

    it('should handle router unbind and rebind', async () => {
      const router = new RouterSocket({ id: 'router-unbind' })
      const dealer = new DealerSocket({ 
        id: 'dealer-unbind',
        config: {
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,
          ZMQ_RECONNECT_IVL: 100
        }
      })
      
      // First bind
      await router.bind(routerAddress)
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      
      expect(dealer.isOnline()).to.be.true
      
      // Unbind router
      await router.unbind()
      await wait(200)
      
      expect(dealer.isOnline()).to.be.false
      
      // Rebind router
      await router.bind(routerAddress)
      await wait(400)
      
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })
  })

  // ==========================================================================
  // AUTOMATIC RECONNECTION (Native ZMQ)
  // ==========================================================================
  
  describe('Automatic Reconnection', () => {
    it('should auto-reconnect when router restarts (ZMQ_RECONNECT_IVL)', async function() {
      this.timeout(5000)
      
      const port = getAvailablePort()
      const routerAddress = `tcp://127.0.0.1:${port}`
      
      // Start router
      let router = new RouterSocket({ id: 'router-v1' })
      await router.bind(routerAddress)
      
      // Connect dealer with fast reconnection
      const dealer = new DealerSocket({ 
        id: 'dealer-reconnect',
        config: {
          ZMQ_RECONNECT_IVL: 50,  // Retry every 50ms
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
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
      
      // Wait for dealer to detect disconnect (ZeroMQ needs time)
      await waitForNotReady(dealer, 1000)
      expect(dealer.isOnline()).to.be.false
      expect(events).to.include('NOT_READY')
      
      // Start new router
      router = new RouterSocket({ id: 'router-v2' })
      await router.bind(routerAddress)
      await wait(400)
      
      expect(dealer.isOnline()).to.be.true
      expect(events).to.include('READY')
      
      await dealer.close()
      await router.close()
      // Give ZeroMQ time to fully release ports
      await wait(100)
    })

    it('should handle multiple consecutive reconnection cycles', async function() {
      this.timeout(10000)
      
      const routerAddress = 'tcp://127.0.0.1:6004'
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
      
      // Cycle 1
      await router.close()
      await wait(200)
      expect(dealer.isOnline()).to.be.false
      
      router = new RouterSocket({ id: 'router-cycle-2' })
      await router.bind(routerAddress)
      await wait(300)
      expect(dealer.isOnline()).to.be.true
      
      // Cycle 2
      await router.close()
      await wait(200)
      expect(dealer.isOnline()).to.be.false
      
      router = new RouterSocket({ id: 'router-cycle-3' })
      await router.bind(routerAddress)
      await wait(300)
      expect(dealer.isOnline()).to.be.true
      
      // Cycle 3
      await router.close()
      await wait(200)
      expect(dealer.isOnline()).to.be.false
      
      router = new RouterSocket({ id: 'router-cycle-4' })
      await router.bind(routerAddress)
      await wait(300)
      expect(dealer.isOnline()).to.be.true
      
      // Should have reconnected at least 3 times
      expect(reconnectCount).to.be.at.least(3)
      
      await dealer.close()
      await router.close()
    })

    it('should maintain connection through brief router downtime', async function() {
      this.timeout(5000)
      
      const routerAddress = 'tcp://127.0.0.1:6005'
      let router = new RouterSocket({ id: 'router-brief' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-patient',
        config: {
          ZMQ_RECONNECT_IVL: 100,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      
      // Kill router
      await router.close()
      await wait(200)
      expect(dealer.isOnline()).to.be.false
      
      // Quick restart (< 500ms downtime)
      router = new RouterSocket({ id: 'router-brief-2' })
      await router.bind(routerAddress)
      await wait(400)
      
      // Should have reconnected
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })

    it('should reconnect indefinitely when RECONNECTION_TIMEOUT = -1', async function() {
      this.timeout(8000)
      
      const routerAddress = 'tcp://127.0.0.1:6006'
      let router = new RouterSocket({ id: 'router-infinite' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-infinite',
        config: {
          ZMQ_RECONNECT_IVL: 50,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      await dealer.connect(routerAddress)
      await waitForReady(dealer)
      
      // Kill router for extended period
      await router.close()
      await wait(2000)  // 2 seconds downtime
      
      // Dealer should still be trying to reconnect
      expect(dealer.isOnline()).to.be.false
      
      // Restart router
      router = new RouterSocket({ id: 'router-infinite-2' })
      await router.bind(routerAddress)
      await wait(500)
      
      // Should have reconnected
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })
  })

  // ==========================================================================
  // EXPONENTIAL BACKOFF
  // ==========================================================================
  
  describe('Exponential Backoff', () => {
    it('should use constant interval when ZMQ_RECONNECT_IVL_MAX = 0', () => {
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
      
      dealer.close()
    })

    it('should support exponential backoff when ZMQ_RECONNECT_IVL_MAX > 0', () => {
      const dealer = new DealerSocket({ 
        id: 'dealer-backoff',
        config: {
          ZMQ_RECONNECT_IVL: 100,       // Start: 100ms
          ZMQ_RECONNECT_IVL_MAX: 10000  // Max: 10s
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_RECONNECT_IVL).to.equal(100)
      expect(config.ZMQ_RECONNECT_IVL_MAX).to.equal(10000)
      
      dealer.close()
    })
  })

  // ==========================================================================
  // MULTIPLE CLIENTS
  // ==========================================================================
  
  describe('Multiple Clients', () => {
    let router
    const routerAddress = 'tcp://127.0.0.1:6007'

    beforeEach(async () => {
      router = new RouterSocket({ id: 'multi-router' })
      await router.bind(routerAddress)
    })

    afterEach(async () => {
      await router.close()
    })

    it('should handle multiple dealers connecting', async () => {
      const dealer1 = new DealerSocket({ 
        id: 'dealer-1',
        config: { RECONNECTION_TIMEOUT: Timeouts.INFINITY }
      })
      const dealer2 = new DealerSocket({ 
        id: 'dealer-2',
        config: { RECONNECTION_TIMEOUT: Timeouts.INFINITY }
      })
      const dealer3 = new DealerSocket({ 
        id: 'dealer-3',
        config: { RECONNECTION_TIMEOUT: Timeouts.INFINITY }
      })
      
      await Promise.all([
        dealer1.connect(routerAddress),
        dealer2.connect(routerAddress),
        dealer3.connect(routerAddress)
      ])
      
      await Promise.all([
        waitForReady(dealer1),
        waitForReady(dealer2),
        waitForReady(dealer3)
      ])
      
      expect(dealer1.isOnline()).to.be.true
      expect(dealer2.isOnline()).to.be.true
      expect(dealer3.isOnline()).to.be.true
      
      await Promise.all([
        dealer1.close(),
        dealer2.close(),
        dealer3.close()
      ])
    })

    it('should route messages to correct dealer', async () => {
      const dealer1 = new DealerSocket({ 
        id: 'dealer-A',
        config: { RECONNECTION_TIMEOUT: Timeouts.INFINITY }
      })
      const dealer2 = new DealerSocket({ 
        id: 'dealer-B',
        config: { RECONNECTION_TIMEOUT: Timeouts.INFINITY }
      })
      
      await dealer1.connect(routerAddress)
      await dealer2.connect(routerAddress)
      await waitForReady(dealer1)
      await waitForReady(dealer2)
      await wait(100)
      
      let dealer1Received = []
      let dealer2Received = []
      
      dealer1.on(TransportEvent.MESSAGE, ({ buffer }) => {
        dealer1Received.push(buffer.toString())
      })
      
      dealer2.on(TransportEvent.MESSAGE, ({ buffer }) => {
        dealer2Received.push(buffer.toString())
      })
      
      // Both dealers send init message
      dealer1.sendBuffer(Buffer.from('init'))
      dealer2.sendBuffer(Buffer.from('init'))
      await wait(100)
      
      // Router sends specific messages
      router.sendBuffer(Buffer.from('for-A'), 'dealer-A')
      router.sendBuffer(Buffer.from('for-B'), 'dealer-B')
      router.sendBuffer(Buffer.from('also-for-A'), 'dealer-A')
      await wait(200)
      
      expect(dealer1Received).to.include('for-A')
      expect(dealer1Received).to.include('also-for-A')
      expect(dealer1Received).to.not.include('for-B')
      
      expect(dealer2Received).to.include('for-B')
      expect(dealer2Received).to.not.include('for-A')
      
      await dealer1.close()
      await dealer2.close()
      await wait(200) // Wait for cleanup
    })
  })

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================
  
  describe('State Management', () => {
    it('should track transitions: READY → NOT_READY → READY', async function() {
      this.timeout(5000)
      
      const routerAddress = 'tcp://127.0.0.1:6008'
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
      
      expect(dealer.isOnline()).to.be.true
      
      // Kill router
      await router.close()
      await wait(200)
      
      expect(dealer.isOnline()).to.be.false
      
      // Restart router
      router = new RouterSocket({ id: 'router-state-2' })
      await router.bind(routerAddress)
      await wait(400)
      
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })

    it('should allow message sending only when online', async function() {
      this.timeout(5000)
      
      const port = getAvailablePort()
      const routerAddress = `tcp://127.0.0.1:${port}`
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
      
      // Wait for dealer to detect disconnect
      await waitForNotReady(dealer, 1000)
      
      // Cannot send when offline
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.throw('offline')
      
      // Restart router
      router = new RouterSocket({ id: 'router-send-2' })
      await router.bind(routerAddress)
      await waitForReady(dealer, 1000)
      
      // Can send again when reconnected
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.not.throw()
      
      await dealer.close()
      await router.close()
      // Give ZeroMQ time to fully release ports
      await wait(100)
    })
  })

  // ==========================================================================
  // EVENT SEQUENCES
  // ==========================================================================
  
  describe('Event Sequences', () => {
    it('should emit events in correct order during reconnection', async function() {
      this.timeout(5000)
      
      const routerAddress = 'tcp://127.0.0.1:6010'
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
      await wait(100)
      
      expect(events).to.deep.equal(['READY'])
      
      // Disconnect
      await router.close()
      await wait(200)
      
      expect(events).to.deep.equal(['READY', 'NOT_READY'])
      
      // Reconnect
      router = new RouterSocket({ id: 'router-events-2' })
      await router.bind(routerAddress)
      await wait(400)
      
      expect(events).to.deep.equal(['READY', 'NOT_READY', 'READY'])
      
      await dealer.close()
      await router.close()
    })
  })

  // ==========================================================================
  // ERROR SCENARIOS
  // ==========================================================================
  
  describe('Error Scenarios', () => {
    it('should throw when sending on offline dealer', () => {
      const dealer = new DealerSocket({ id: 'offline-dealer' })
      
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.throw('offline')
      
      dealer.close()
    })

    it('should handle router closing with connected dealers', async () => {
      const port = getAvailablePort()
      const router = new RouterSocket({ id: 'router-close' })
      await router.bind(`tcp://127.0.0.1:${port}`)
      
      const dealer = new DealerSocket({ 
        id: 'dealer-close',
        config: {
          RECONNECTION_TIMEOUT: 1000,
          ZMQ_RECONNECT_IVL: 100
        }
      })
      
      await dealer.connect(`tcp://127.0.0.1:${port}`)
      await waitForReady(dealer)
      
      let disconnected = false
      dealer.once(TransportEvent.NOT_READY, () => {
        disconnected = true
      })
      
      // Close router abruptly
      await router.close()
      
      // Wait for dealer to detect disconnect (ZeroMQ needs time)
      await waitForNotReady(dealer, 1000)
      
      expect(disconnected).to.be.true
      expect(dealer.isOnline()).to.be.false
      
      await dealer.close()
      // Give ZeroMQ time to fully release ports
      await wait(100)
    })
  })

  // ==========================================================================
  // RESOURCE CLEANUP
  // ==========================================================================
  
  describe('Resource Cleanup', () => {
    it('should cleanup resources on close', async () => {
      const router = new RouterSocket({ id: 'cleanup-router' })
      const dealer = new DealerSocket({ 
        id: 'cleanup-dealer',
        config: { RECONNECTION_TIMEOUT: Timeouts.INFINITY }
      })
      
      await router.bind('tcp://127.0.0.1:6012')
      await dealer.connect('tcp://127.0.0.1:6012')
      await waitForReady(dealer)
      
      expect(router.isOnline()).to.be.true
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
      
      expect(router.isOnline()).to.be.false
      expect(dealer.isOnline()).to.be.false
    })

    it('should allow rebinding after close', async () => {
      const address = 'tcp://127.0.0.1:6013'
      
      const router1 = new RouterSocket({ id: 'router-1' })
      await router1.bind(address)
      await router1.close()
      
      // Should be able to rebind to same address
      const router2 = new RouterSocket({ id: 'router-2' })
      await router2.bind(address)
      
      expect(router2.isOnline()).to.be.true
      
      await router2.close()
    })
  })

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================
  
  describe('Configuration', () => {
    it('should allow custom reconnection config', () => {
      const dealer = new DealerSocket({ 
        id: 'dealer-custom',
        config: {
          ZMQ_RECONNECT_IVL: 500,
          ZMQ_RECONNECT_IVL_MAX: 30000
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_RECONNECT_IVL).to.equal(500)
      expect(config.ZMQ_RECONNECT_IVL_MAX).to.equal(30000)
      
      dealer.close()
    })
  })

  // ==========================================================================
  // HIGH THROUGHPUT (Stress Test)
  // ==========================================================================
  
  describe('High Throughput', () => {
    it('should handle high message throughput', async function() {
      this.timeout(10000)
      
      const router = new RouterSocket({ id: 'stress-router' })
      const dealer = new DealerSocket({ 
        id: 'stress-dealer',
        config: { 
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,
          ZMQ_SNDHWM: 10000,
          ZMQ_RCVHWM: 10000
        }
      })
      
      await router.bind('tcp://127.0.0.1:6014')
      await dealer.connect('tcp://127.0.0.1:6014')
      await waitForReady(dealer)
      await wait(200)
      
      const messageCount = 500
      let receivedCount = 0
      
      router.on(TransportEvent.MESSAGE, () => {
        receivedCount++
      })
      
      // Send messages with throttling to prevent buffer overflow
      for (let i = 0; i < messageCount; i++) {
        dealer.sendBuffer(Buffer.from(`msg-${i}`))
        // Small delay every 50 messages
        if (i % 50 === 0 && i > 0) {
          await wait(10)
        }
      }
      
      // Wait for messages to arrive
      await wait(2000)
      
      expect(receivedCount).to.be.at.least(messageCount * 0.95) // Allow 5% loss
      
      await dealer.close()
      await router.close()
    })
  })
})
