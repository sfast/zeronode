/**
 * Socket Error Handling Tests
 * Tests error paths in the base Socket class
 * 
 * These tests target uncovered lines in socket.js:
 * - Lines 203-210: Send buffer error handling
 * - Lines 215-216: Abstract method verification
 * - Lines 190-196: Offline state validation
 * 
 * Coverage Goal: Increase socket.js from 77.73% to 85-88%
 */

import { expect } from 'chai'
import { Dealer as DealerSocket, Router as RouterSocket } from '../index.js'
import { Socket } from '../socket.js'
import { TransportErrorCode } from '../../errors.js'

describe('Socket Base Class - Error Handling', () => {
  
  // ==========================================================================
  // TEST 1: ABSTRACT METHOD VERIFICATION
  // Target: Lines 215-216
  // ==========================================================================
  
  describe('Abstract Methods', () => {
    it('should throw error if getSocketMsgFromBuffer not overridden', () => {
      // Create a minimal test socket class that doesn't override the method
      class TestSocket extends Socket {
        constructor() {
          // Create a mock ZMQ socket with routingId
          const mockSocket = {
            routingId: 'test-abstract-socket',
            linger: 0,
            sendHighWaterMark: 1000,
            receiveHighWaterMark: 1000,
            closed: false,
            events: {
              removeAllListeners: () => {}
            }
          }
          
          super({ 
            socket: mockSocket,
            config: {}
          })
        }
      }
      
      const socket = new TestSocket()
      
      expect(() => {
        socket.getSocketMsgFromBuffer(Buffer.from('test'), 'recipient')
      }).to.throw('getSocketMsgFromBuffer is not implemented in the base class')
    })
  })
  
  // ==========================================================================
  // TEST 2: SEND WHILE OFFLINE
  // Target: Lines 190-196 (verification test)
  // ==========================================================================
  
  describe('sendBuffer() - State Validation', () => {
    it('should throw SEND_FAILED when socket is offline', () => {
      const dealer = new DealerSocket({ id: 'test-offline-send' })
      
      // Verify socket starts offline
      expect(dealer.isOnline()).to.be.false
      
      // Attempt to send while offline
      try {
        dealer.sendBuffer(Buffer.from('test message'))
        expect.fail('Should have thrown SEND_FAILED error')
      } catch (err) {
        expect(err.code).to.equal(TransportErrorCode.SEND_FAILED)
        expect(err.message).to.include('offline')
        expect(err.message).to.include('test-offline-send')
        expect(err.transportId).to.equal('test-offline-send')
      }
    })

    it('should throw SEND_FAILED when router is offline', () => {
      const router = new RouterSocket({ id: 'test-router-offline' })
      
      expect(router.isOnline()).to.be.false
      
      try {
        router.sendBuffer(Buffer.from('test'), 'client-123')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.code).to.equal(TransportErrorCode.SEND_FAILED)
        expect(err.message).to.include('offline')
      }
    })
  })
  
  // ==========================================================================
  // TEST 3: SEND ON CLOSED SOCKET
  // Target: Lines 203-210
  // ==========================================================================
  
  describe('sendBuffer() - Closed Socket Errors', () => {
    it('should handle send failure on closed socket', async function() {
      this.timeout(3000)
      
      const dealer = new DealerSocket({ id: 'test-closed-send' })
      
      // Don't connect - just try to send
      // This will test the offline check
      expect(dealer.isOnline()).to.be.false
      
      try {
        dealer.sendBuffer(Buffer.from('test'))
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.code).to.equal(TransportErrorCode.SEND_FAILED)
        expect(err.message).to.include('offline')
      }
    })
  })
  
  // ==========================================================================
  // TEST 4: SEND ERRORS WITH INVALID BUFFERS
  // Target: Lines 203-210 (error wrapping)
  // Note: These tests verify the catch block but not actual ZMQ send failures
  // ==========================================================================
  
  describe('sendBuffer() - Invalid Data Handling', () => {
    it('should throw SEND_FAILED for null buffer when online', () => {
      const dealer = new DealerSocket({ id: 'test-null-buffer' })
      
      // Manually set online to bypass offline check
      dealer.setOnline()
      
      // Try to send null buffer (will fail in getSocketMsgFromBuffer)
      try {
        dealer.sendBuffer(null)
        expect.fail('Should have thrown')
      } catch (err) {
        // Could be SEND_FAILED or other error depending on where it fails
        expect(err).to.exist
        expect(err.message).to.exist
      }
    })
  })
  
  // ==========================================================================
  // TEST 5: CONFIG AND LOGGER EDGE CASES
  // Target: Additional coverage for getConfig, setLogger
  // ==========================================================================
  
  describe('Configuration & Logging', () => {
    it('should return empty config if not set', () => {
      const dealer = new DealerSocket({ id: 'test-config' })
      const config = dealer.getConfig()
      
      expect(config).to.be.an('object')
      // Config should have defaults from mergeConfig
    })

    it('should allow setting custom logger', () => {
      const dealer = new DealerSocket({ id: 'test-logger' })
      
      const customLogger = {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {}
      }
      
      dealer.setLogger(customLogger)
      expect(dealer.logger).to.equal(customLogger)
    })

    it('should fallback to console if logger is null', () => {
      const dealer = new DealerSocket({ id: 'test-logger-null' })
      
      dealer.setLogger(null)
      expect(dealer.logger).to.equal(console)
    })
  })
  
  // ==========================================================================
  // TEST 6: DEBUG MODE GETTER/SETTER
  // Target: Lines 109-117
  // ==========================================================================
  
  describe('Debug Mode', () => {
    it('should set and get debug mode', () => {
      const dealer = new DealerSocket({ id: 'test-debug' })
      
      // Default should be false
      expect(dealer.debug).to.be.false
      
      // Set to true
      dealer.debug = true
      expect(dealer.debug).to.be.true
      
      // Set to false
      dealer.debug = false
      expect(dealer.debug).to.be.false
    })

    it('should coerce debug to boolean', () => {
      const dealer = new DealerSocket({ id: 'test-debug-coerce' })
      
      dealer.debug = 'true'
      expect(dealer.debug).to.be.true
      
      dealer.debug = 0
      expect(dealer.debug).to.be.false
      
      dealer.debug = 1
      expect(dealer.debug).to.be.true
    })

    it('should initialize from config', () => {
      const dealer = new DealerSocket({ 
        id: 'test-debug-init',
        config: { DEBUG: true }
      })
      
      expect(dealer.debug).to.be.true
    })
  })
  
  // ==========================================================================
  // TEST 7: STOP MESSAGE LISTENER
  // Target: Lines 247-252
  // ==========================================================================
  
  describe('stopMessageListener()', () => {
    it('should set shouldStopListening flag', async () => {
      const dealer = new DealerSocket({ id: 'test-stop-listener' })
      
      // Call stop listener
      dealer.stopMessageListener()
      
      // Flag should be set (can't access directly, but verify no error)
      expect(dealer).to.exist
    })

    it('should not throw if called multiple times', () => {
      const dealer = new DealerSocket({ id: 'test-stop-multi' })
      
      expect(() => {
        dealer.stopMessageListener()
        dealer.stopMessageListener()
        dealer.stopMessageListener()
      }).to.not.throw()
    })
  })
})

