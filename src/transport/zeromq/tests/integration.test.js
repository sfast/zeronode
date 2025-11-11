/**
 * Integration Tests - DealerSocket & RouterSocket
 * Tests real communication between Dealer and Router
 * 
 * Scenarios tested:
 * - Basic message exchange
 * - Connection lifecycle
 * - Reconnection (automatic)
 * - Multiple clients
 * - Error handling
 * - Resource cleanup
 */

import { expect } from 'chai'
import { Dealer as DealerSocket, Router as RouterSocket, TIMEOUT_INFINITY } from '../index.js'
import { TransportEvent } from '../../events.js'

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
// Alias for backward compatibility with tests
const Timeouts = { INFINITY: TIMEOUT_INFINITY }

describe('Integration: Dealer ↔ Router', () => {
  
  // ============================================================================
  // BASIC MESSAGE EXCHANGE
  // ============================================================================
  
  describe('Basic Message Exchange', () => {
    let router, dealer
    const routerAddress = 'tcp://127.0.0.1:6001'

    beforeEach(async () => {
      router = new RouterSocket({ id: 'router-test' })
      dealer = new DealerSocket({ 
        id: 'dealer-test',
        config: {
          CONNECTION_TIMEOUT: 5000,
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY
        }
      })
      
      await router.bind(routerAddress)
    })

    afterEach(async () => {
      await dealer.close()
      await router.close()
    })

    it('should establish connection between dealer and router', async () => {
      let dealerConnected = false
      
      dealer.once(TransportEvent.READY, () => {
        dealerConnected = true
      })
      
      await dealer.connect(routerAddress)
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(dealerConnected).to.be.true
      expect(dealer.isOnline()).to.be.true
      expect(router.isOnline()).to.be.true  // Router already ready from beforeEach
    })

    it('should send message from dealer to router', async () => {
      await dealer.connect(routerAddress)
      
      const testMessage = Buffer.from('Hello Router!')
      let receivedMessage = null
      
      router.once(TransportEvent.MESSAGE, ({ buffer }) => {
        receivedMessage = buffer
      })
      
      dealer.sendBuffer(testMessage)
      
      // Wait for message
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(receivedMessage).to.not.be.null
      expect(receivedMessage.toString()).to.equal('Hello Router!')
    })

    it('should send message from router to dealer', async () => {
      await dealer.connect(routerAddress)
      
      // Wait for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const testMessage = Buffer.from('Hello Dealer!')
      let receivedMessage = null
      
      dealer.once(TransportEvent.MESSAGE, ({ buffer }) => {
        receivedMessage = buffer
      })
      
      // Router needs to know dealer's identity (from first message)
      // So dealer sends first
      dealer.sendBuffer(Buffer.from('init'))
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Now router can reply (using dealer's ID)
      router.sendBuffer(testMessage, dealer.getId())
      
      // Wait for message
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(receivedMessage).to.not.be.null
      expect(receivedMessage.toString()).to.equal('Hello Dealer!')
    })

    it('should handle bidirectional message exchange', async () => {
      await dealer.connect(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 200))
      
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
      await new Promise(resolve => setTimeout(resolve, 100))
      
      dealer.sendBuffer(Buffer.from('msg-2'))
      await new Promise(resolve => setTimeout(resolve, 100))
      
      dealer.sendBuffer(Buffer.from('msg-3'))
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(messages).to.have.lengthOf(6) // 3 messages + 3 acks
      expect(messages.filter(m => m.from === 'dealer')).to.have.lengthOf(3)
      expect(messages.filter(m => m.from === 'router')).to.have.lengthOf(3)
    })
  })

  // ============================================================================
  // CONNECTION LIFECYCLE
  // ============================================================================
  
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
      const connectPromise = dealer.connect(routerAddress)
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Now bind router
      const router = new RouterSocket({ id: 'late-router' })
      await router.bind(routerAddress)
      
      // Connection should eventually succeed due to auto-retry
      await new Promise(resolve => setTimeout(resolve, 500))
      
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })

    it('should handle router unbind and rebind', async () => {
      const router = new RouterSocket({ id: 'router' })
      const dealer = new DealerSocket({ 
        id: 'dealer',
        config: {
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,
          ZMQ_RECONNECT_IVL: 100
        }
      })
      
      // First bind
      await router.bind(routerAddress)
      await dealer.connect(routerAddress)
      
      expect(dealer.isOnline()).to.be.true
      
      // Unbind router
      await router.unbind()
      
      // Wait for disconnect
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(dealer.isOnline()).to.be.false
      
      // Rebind router
      await router.bind(routerAddress)
      
      // Wait for auto-reconnect
      await new Promise(resolve => setTimeout(resolve, 500))
      
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })
  })

  // ============================================================================
  // MULTIPLE CLIENTS
  // ============================================================================
  
  describe('Multiple Clients', () => {
    let router
    const routerAddress = 'tcp://127.0.0.1:6003'

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
      await wait(200)
      
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
      
      // Close dealers and wait for cleanup
      await dealer1.close()
      await dealer2.close()
      await wait(200) // Critical: Wait for dealer disconnect to propagate
    })
  })

  // ============================================================================
  // AUTOMATIC RECONNECTION
  // ============================================================================
  
  describe('Automatic Reconnection', () => {
    const routerAddress = 'tcp://127.0.0.1:6004'

    it('should auto-reconnect when router restarts', async () => {
      let router = new RouterSocket({ id: 'router-v1' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'persistent-dealer',
        config: {
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,
          ZMQ_RECONNECT_IVL: 100
        }
      })
      
      await dealer.connect(routerAddress)
      expect(dealer.isOnline()).to.be.true
      
      // Track reconnection
      let reconnected = false
      let disconnected = false
      
      dealer.once(TransportEvent.NOT_READY, () => {
        disconnected = true
        dealer.once(TransportEvent.READY, () => {
          reconnected = true
        })
      })
      
      // Kill router
      await router.close()
      
      // Wait for disconnect
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(dealer.isOnline()).to.be.false
      
      // Start new router
      router = new RouterSocket({ id: 'router-v2' })
      await router.bind(routerAddress)
      
      // Wait for auto-reconnect
      await new Promise(resolve => setTimeout(resolve, 500))
      
      expect(dealer.isOnline()).to.be.true
      expect(reconnected).to.be.true
      
      await dealer.close()
      await router.close()
    })

    it('should handle multiple reconnection cycles', async () => {
      let router = new RouterSocket({ id: 'router-cycle' })
      await router.bind(routerAddress)
      
      const dealer = new DealerSocket({ 
        id: 'resilient-dealer',
        config: {
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,
          ZMQ_RECONNECT_IVL: 50
        }
      })
      
      await dealer.connect(routerAddress)
      
      // Cycle 1
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 200))
      
      router = new RouterSocket({ id: 'router-cycle-2' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 300))
      
      expect(dealer.isOnline()).to.be.true
      
      // Cycle 2
      await router.close()
      await new Promise(resolve => setTimeout(resolve, 200))
      
      router = new RouterSocket({ id: 'router-cycle-3' })
      await router.bind(routerAddress)
      await new Promise(resolve => setTimeout(resolve, 300))
      
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
    })
  })

  // ============================================================================
  // ERROR SCENARIOS
  // ============================================================================
  
  describe('Error Scenarios', () => {
    it('should timeout if router never appears', async () => {
      const dealer = new DealerSocket({ 
        id: 'lonely-dealer',
        config: {
          CONNECTION_TIMEOUT: 500
        }
      })
      
      try {
        await dealer.connect('tcp://127.0.0.1:6005')
        expect.fail('Should have timed out')
      } catch (err) {
        expect(err.message).to.include('timeout')
      }
    })

    it('should throw when sending on offline dealer', async () => {
      const dealer = new DealerSocket({ id: 'offline-dealer' })
      
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.throw('offline')
    })

    it('should handle router closing with connected dealers', async () => {
      const router = new RouterSocket({ id: 'router' })
      await router.bind('tcp://127.0.0.1:6006')
      
      const dealer = new DealerSocket({ 
        id: 'dealer',
        config: {
          RECONNECTION_TIMEOUT: 1000,
          ZMQ_RECONNECT_IVL: 100
        }
      })
      
      await dealer.connect('tcp://127.0.0.1:6006')
      
      let disconnected = false
      dealer.once(TransportEvent.NOT_READY, () => {
        disconnected = true
      })
      
      // Close router abruptly
      await router.close()
      
      // Wait for dealer to notice
      await new Promise(resolve => setTimeout(resolve, 300))
      
      expect(disconnected).to.be.true
      expect(dealer.isOnline()).to.be.false
      
      await dealer.close()
    })
  })

  // ============================================================================
  // RESOURCE CLEANUP
  // ============================================================================
  
  describe('Resource Cleanup', () => {
    it('should cleanup resources on close', async () => {
      const router = new RouterSocket({ id: 'cleanup-router' })
      const dealer = new DealerSocket({ 
        id: 'cleanup-dealer',
        config: { RECONNECTION_TIMEOUT: Timeouts.INFINITY }
      })
      
      await router.bind('tcp://127.0.0.1:6007')
      await dealer.connect('tcp://127.0.0.1:6007')
      
      expect(router.isOnline()).to.be.true
      expect(dealer.isOnline()).to.be.true
      
      await dealer.close()
      await router.close()
      
      expect(router.isOnline()).to.be.false
      expect(dealer.isOnline()).to.be.false
    })

    it('should allow rebinding after close', async () => {
      const address = 'tcp://127.0.0.1:6008'
      
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

  // ============================================================================
  // STRESS TEST
  // ============================================================================
  
  describe('Stress Test', () => {
    it('should handle high message throughput', async function() {
      this.timeout(10000) // 10s timeout for stress test
      
      const router = new RouterSocket({ id: 'stress-router' })
      const dealer = new DealerSocket({ 
        id: 'stress-dealer',
        config: { 
          RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,
          ZMQ_SNDHWM: 10000,
          ZMQ_RCVHWM: 10000
        }
      })
      
      await router.bind('tcp://127.0.0.1:6009')
      await dealer.connect('tcp://127.0.0.1:6009')
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const messageCount = 500
      let receivedCount = 0
      
      router.on(TransportEvent.MESSAGE, () => {
        receivedCount++
      })
      
      // Send messages with proper throttling to respect ZeroMQ send limits
      // ZeroMQ can only have one send() in flight at a time
      for (let i = 0; i < messageCount; i++) {
        dealer.sendBuffer(Buffer.from(`msg-${i}`))
        // Small delay every 50 messages to prevent buffer overflow
        if (i % 50 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
      
      // Wait for messages to arrive
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      expect(receivedCount).to.be.at.least(messageCount * 0.95) // Allow 5% loss
      
      await dealer.close()
      await router.close()
    })
  })
})
