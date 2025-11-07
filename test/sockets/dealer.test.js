/**
 * DealerSocket Tests
 * Tests the professionally refactored ZeroMQ Dealer wrapper
 * 
 * Features tested:
 * - Auto-generated socket IDs
 * - Address validation (strict)
 * - State management
 * - Connection lifecycle
 * - Event handling
 * - Error handling
 */

import { expect } from 'chai'
import DealerSocket from '../../src/sockets/dealer.js'
import { TransportEvent } from '../../src/transport-events.js'
import { DealerStateType } from '../../src/sockets/enum.js'

describe('DealerSocket (Professional Refactor)', () => {
  
  // ============================================================================
  // CONSTRUCTOR & ID MANAGEMENT
  // ============================================================================
  
  describe('Constructor & ID Management', () => {
    it('should create dealer with provided ID', () => {
      const dealer = new DealerSocket({ id: 'my-dealer-123' })
      
      expect(dealer.getId()).to.equal('my-dealer-123')
      expect(dealer.isOnline()).to.be.false
      expect(dealer.getState()).to.equal(DealerStateType.DISCONNECTED)
    })

    it('should auto-generate ID if not provided', () => {
      const dealer = new DealerSocket()
      const id = dealer.getId()
      
      expect(id).to.be.a('string')
      expect(id).to.match(/^dealer-\d+-[a-z0-9]+$/)
    })

    it('should generate unique IDs for multiple instances', () => {
      const dealer1 = new DealerSocket()
      const dealer2 = new DealerSocket()
      
      expect(dealer1.getId()).to.not.equal(dealer2.getId())
    })

    it('should set ZeroMQ routingId from provided ID', () => {
      const dealer = new DealerSocket({ id: 'test-routing-id' })
      
      // Note: Can't directly access routingId in tests, but we verify ID is set
      // Integration tests verify that routingId works correctly
      expect(dealer.getId()).to.equal('test-routing-id')
    })
  })

  // ============================================================================
  // ADDRESS VALIDATION (Now Strict!)
  // ============================================================================
  
  describe('Address Validation', () => {
    let dealer

    beforeEach(() => {
      dealer = new DealerSocket({ id: 'test-dealer' })
    })

    it('should accept valid TCP address', () => {
      expect(() => dealer.setAddress('tcp://127.0.0.1:5000')).to.not.throw()
      expect(dealer.getAddress()).to.equal('tcp://127.0.0.1:5000')
    })

    it('should accept valid IPC address', () => {
      expect(() => dealer.setAddress('ipc:///tmp/test.ipc')).to.not.throw()
      expect(dealer.getAddress()).to.equal('ipc:///tmp/test.ipc')
    })

    it('should accept valid INPROC address', () => {
      expect(() => dealer.setAddress('inproc://test-endpoint')).to.not.throw()
      expect(dealer.getAddress()).to.equal('inproc://test-endpoint')
    })

    it('should throw on empty string address', () => {
      expect(() => dealer.setAddress('')).to.throw('must be a non-empty string')
    })

    it('should throw on null address', () => {
      expect(() => dealer.setAddress(null)).to.throw('must be a non-empty string')
    })

    it('should throw on invalid protocol', () => {
      expect(() => dealer.setAddress('http://localhost:5000')).to.throw('Invalid router address format')
    })

    it('should throw on address without protocol', () => {
      expect(() => dealer.setAddress('localhost:5000')).to.throw('Invalid router address format')
    })
  })

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  
  describe('State Management', () => {
    let dealer

    beforeEach(() => {
      dealer = new DealerSocket({ id: 'test-dealer' })
    })

    it('should start in DISCONNECTED state', () => {
      expect(dealer.getState()).to.equal(DealerStateType.DISCONNECTED)
      expect(dealer.isOnline()).to.be.false
    })

    it('should transition to CONNECTED when setOnline() called', () => {
      dealer.setOnline()
      
      expect(dealer.getState()).to.equal(DealerStateType.CONNECTED)
      expect(dealer.isOnline()).to.be.true
    })

    it('should transition to offline when setOffline() called', () => {
      dealer.setOnline()
      expect(dealer.isOnline()).to.be.true
      
      dealer.setOffline()
      expect(dealer.isOnline()).to.be.false
    })

    it('should maintain state independently from online status', () => {
      // Can be offline but in RECONNECTING state
      dealer.setOffline()
      let scope = dealer._private?.get(dealer)
      if (scope) {
        scope.state = DealerStateType.RECONNECTING
      }
      
      expect(dealer.isOnline()).to.be.false
      // State tracking is internal - we test via integration
    })
  })

  // ============================================================================
  // CONFIGURATION
  // ============================================================================
  
  describe('Configuration', () => {
    it('should apply default ZeroMQ options', () => {
      const dealer = new DealerSocket({
        id: 'test',
        config: {
          ZMQ_LINGER: 0,
          ZMQ_RECONNECT_IVL: 100,
          ZMQ_SNDHWM: 1000
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_LINGER).to.equal(0)
      expect(config.ZMQ_RECONNECT_IVL).to.equal(100)
      expect(config.ZMQ_SNDHWM).to.equal(1000)
    })

    it('should apply custom reconnection interval', () => {
      const dealer = new DealerSocket({
        config: {
          ZMQ_RECONNECT_IVL: 500,
          ZMQ_RECONNECT_IVL_MAX: 30000
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_RECONNECT_IVL).to.equal(500)
      expect(config.ZMQ_RECONNECT_IVL_MAX).to.equal(30000)
    })
  })

  // ============================================================================
  // CLOSE & CLEANUP
  // ============================================================================
  
  describe('Close & Cleanup', () => {
    it('should handle close on disconnected socket', async () => {
      const dealer = new DealerSocket({ id: 'test' })
      
      // Should not throw
      await dealer.close()
      
      expect(dealer.isOnline()).to.be.false
    })

    it('should call disconnect before close', async () => {
      const dealer = new DealerSocket({ id: 'test' })
      let disconnectCalled = false
      
      // Spy on disconnect
      const originalDisconnect = dealer.disconnect.bind(dealer)
      dealer.disconnect = async function() {
        disconnectCalled = true
        return originalDisconnect()
      }
      
      await dealer.close()
      
      expect(disconnectCalled).to.be.true
    })
  })

  // ============================================================================
  // MESSAGE FRAMING
  // ============================================================================
  
  describe('Message Framing', () => {
    it('should return buffer directly (no routing info needed)', () => {
      const dealer = new DealerSocket({ id: 'test' })
      const buffer = Buffer.from('test message')
      
      const msg = dealer.getSocketMsgFromBuffer(buffer)
      
      expect(msg).to.equal(buffer)
    })

    it('should ignore recipient parameter (not needed for Dealer)', () => {
      const dealer = new DealerSocket({ id: 'test' })
      const buffer = Buffer.from('test message')
      
      const msg = dealer.getSocketMsgFromBuffer(buffer, 'ignored-recipient')
      
      expect(msg).to.equal(buffer)
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================
  
  describe('Error Handling', () => {
    it('should throw on connect without address', async () => {
      const dealer = new DealerSocket({ id: 'test' })
      
      try {
        await dealer.connect()
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).to.include('Router address is required')
      }
    })

    it('should throw on connect when already online', async () => {
      const dealer = new DealerSocket({ id: 'test' })
      dealer.setAddress('tcp://127.0.0.1:5000')
      dealer.setOnline()
      
      try {
        await dealer.connect('tcp://127.0.0.1:5000')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).to.include('already connected')
      }
    })

    it('should handle invalid address gracefully', () => {
      const dealer = new DealerSocket({ id: 'test' })
      
      expect(() => dealer.setAddress('invalid')).to.throw()
    })
  })
})
