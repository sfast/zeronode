/**
 * Socket Base Class Tests
 * 
 * **What**: Comprehensive tests for the Socket base class (socket.js)
 * **Why**: Socket is the foundation for Dealer and Router - must be bulletproof
 * **Coverage**: Targets 100% coverage with edge cases and error paths
 * 
 * Test Groups:
 * - Constructor & Validation
 * - Configuration & Options
 * - State Management
 * - Message Listener (async iterator)
 * - Send Buffer
 * - Error Handling
 * - Lifecycle & Cleanup
 */

import { expect } from 'chai'
import { Dealer as DealerSocket, Router as RouterSocket } from '../index.js'
import { Socket } from '../socket.js'
import { TransportError, TransportErrorCode } from '../../errors.js'
import { TransportEvent } from '../../events.js'
import { EventEmitter } from 'events'

describe('Socket Base Class', () => {
  
  // ==========================================================================
  // CONSTRUCTOR & VALIDATION
  // ==========================================================================
  
  describe('Constructor & Validation', () => {
    it('should throw error when socket has no routingId', () => {
      class InvalidSocket extends Socket {
        constructor() {
          const mockSocket = {
            // Missing routingId - should throw
            linger: 0,
            sendHighWaterMark: 1000,
            receiveHighWaterMark: 1000,
            closed: false,
            events: new EventEmitter(),
            [Symbol.asyncIterator]: async function*() {}
          }
          
          super({ socket: mockSocket, config: {} })
        }
      }
      
      expect(() => new InvalidSocket()).to.throw('Socket must have routingId set')
    })

    it('should include helpful message in routingId error', () => {
      try {
        class TestSocket extends Socket {
          constructor() {
            super({ socket: {}, config: {} })
          }
        }
        new TestSocket()
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).to.include('routingId')
        expect(err.message).to.include('Set socket.routingId in subclass constructor')
      }
    })
  })

  // ==========================================================================
  // CONFIGURATION & OPTIONS
  // ==========================================================================
  
  describe('Configuration & Options', () => {
    it('should configure common ZMQ options', () => {
      const dealer = new DealerSocket({ 
        id: 'test-config',
        config: {
          ZMQ_LINGER: 500,
          ZMQ_SNDHWM: 5000,
          ZMQ_RCVHWM: 5000
        }
      })
      
      const config = dealer.getConfig()
      expect(config.ZMQ_LINGER).to.equal(500)
      expect(config.ZMQ_SNDHWM).to.equal(5000)
      expect(config.ZMQ_RCVHWM).to.equal(5000)
      
      dealer.close()
    })

    it('should configure ZMQ_SNDTIMEO when provided', () => {
      const dealer = new DealerSocket({
        id: 'test-sndtimeo',
        config: { ZMQ_SNDTIMEO: 3000 }
      })
      
      expect(dealer.getConfig().ZMQ_SNDTIMEO).to.equal(3000)
      dealer.close()
    })

    it('should configure ZMQ_RCVTIMEO when provided', () => {
      const dealer = new DealerSocket({
        id: 'test-rcvtimeo',
        config: { ZMQ_RCVTIMEO: 2000 }
      })
      
      expect(dealer.getConfig().ZMQ_RCVTIMEO).to.equal(2000)
      dealer.close()
    })

    it('should not set ZMQ_SNDTIMEO if undefined', () => {
      const dealer = new DealerSocket({
        id: 'test-no-sndtimeo',
        config: {}
      })
      
      // Should not throw, config should be valid
      expect(dealer.getConfig()).to.exist
      dealer.close()
    })

    it('should not set ZMQ_RCVTIMEO if undefined', () => {
      const dealer = new DealerSocket({
        id: 'test-no-rcvtimeo',
        config: {}
      })
      
      expect(dealer.getConfig()).to.exist
      dealer.close()
    })
  })

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================
  
  describe('State Management', () => {
    it('should return socket ID', () => {
      const dealer = new DealerSocket({ id: 'test-id-123' })
      expect(dealer.getId()).to.equal('test-id-123')
      dealer.close()
    })

    it('should start offline', () => {
      const dealer = new DealerSocket({ id: 'test-offline' })
      expect(dealer.isOnline()).to.be.false
      dealer.close()
    })

    it('should set online state', () => {
      const dealer = new DealerSocket({ id: 'test-online' })
      dealer.setOnline()
      expect(dealer.isOnline()).to.be.true
      dealer.close()
    })

    it('should set offline state', () => {
      const dealer = new DealerSocket({ id: 'test-setoffline' })
      dealer.setOnline()
      expect(dealer.isOnline()).to.be.true
      
      dealer.setOffline()
      expect(dealer.isOnline()).to.be.false
      
      dealer.close()
    })

    it('should return config object', () => {
      const dealer = new DealerSocket({ 
        id: 'test-getconfig',
        config: { DEBUG: true }
      })
      
      const config = dealer.getConfig()
      expect(config).to.be.an('object')
      expect(config.DEBUG).to.equal(true)
      
      dealer.close()
    })

    it('should return empty config if not set', () => {
      const dealer = new DealerSocket({ id: 'test-empty-config' })
      const config = dealer.getConfig()
      
      expect(config).to.be.an('object')
      dealer.close()
    })

    it('should set and get logger', () => {
      const dealer = new DealerSocket({ id: 'test-logger' })
      const customLogger = { log: () => {}, info: () => {} }
      
      dealer.setLogger(customLogger)
      expect(dealer.logger).to.equal(customLogger)
      
      dealer.close()
    })

    it('should fallback to console if logger is null', () => {
      const dealer = new DealerSocket({ id: 'test-console-logger' })
      dealer.setLogger(null)
      
      expect(dealer.logger).to.equal(console)
      dealer.close()
    })
  })

  // ==========================================================================
  // DEBUG MODE
  // ==========================================================================
  
  describe('Debug Mode', () => {
    it('should set and get debug mode', () => {
      const dealer = new DealerSocket({ id: 'test-debug' })
      
      expect(dealer.debug).to.be.false
      
      dealer.debug = true
      expect(dealer.debug).to.be.true
      
      dealer.debug = false
      expect(dealer.debug).to.be.false
      
      dealer.close()
    })

    it('should coerce debug to boolean', () => {
      const dealer = new DealerSocket({ id: 'test-debug-coerce' })
      
      dealer.debug = 'yes'
      expect(dealer.debug).to.be.true
      
      dealer.debug = 0
      expect(dealer.debug).to.be.false
      
      dealer.debug = null
      expect(dealer.debug).to.be.false
      
      dealer.close()
    })

    it('should initialize from config', () => {
      const dealer = new DealerSocket({ 
        id: 'test-debug-init',
        config: { DEBUG: true }
      })
      
      expect(dealer.debug).to.be.true
      dealer.close()
    })
  })

  // ==========================================================================
  // MESSAGE LISTENER
  // ==========================================================================
  
  describe('Message Listener (Async Iterator)', () => {
    it('should emit error for malformed message (1 frame)', (done) => {
      class MockSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-malformed-1'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          yield [Buffer.from('single-frame')]
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          super({ socket: new MockSocket(), config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      socket.once(TransportEvent.ERROR, (error) => {
        expect(error).to.be.instanceof(TransportError)
        expect(error.code).to.equal(TransportErrorCode.RECEIVE_FAILED)
        expect(error.message).to.include('Unexpected message format')
        expect(error.message).to.include('1 frames')
        socket.stopMessageListener()
        socket.close()
        done()
      })
    })

    it('should emit error for malformed message (4 frames)', (done) => {
      class MockSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-malformed-4'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          yield [
            Buffer.from('frame1'),
            Buffer.from('frame2'),
            Buffer.from('frame3'),
            Buffer.from('frame4')
          ]
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          super({ socket: new MockSocket(), config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      socket.once(TransportEvent.ERROR, (error) => {
        expect(error).to.be.instanceof(TransportError)
        expect(error.code).to.equal(TransportErrorCode.RECEIVE_FAILED)
        expect(error.message).to.include('4 frames')
        socket.stopMessageListener()
        socket.close()
        done()
      })
    })

    it('should handle EAGAIN error gracefully (normal shutdown)', (done) => {
      class MockSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-eagain'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          const err = new Error('EAGAIN')
          err.code = 'EAGAIN'
          throw err
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          super({ socket: new MockSocket(), config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      // EAGAIN should NOT emit error event (it's expected during shutdown)
      socket.once(TransportEvent.ERROR, () => {
        done(new Error('Should not emit ERROR for EAGAIN'))
      })
      
      // Give it time to process
      setTimeout(() => {
        socket.close()
        done()
      }, 100)
    })

    it('should emit error for unexpected message listener errors', (done) => {
      class MockSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-unexpected-error'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          throw new Error('Unexpected socket error')
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          super({ socket: new MockSocket(), config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      socket.once(TransportEvent.ERROR, (error) => {
        expect(error).to.be.instanceof(TransportError)
        expect(error.code).to.equal(TransportErrorCode.RECEIVE_FAILED)
        expect(error.message).to.include('Unexpected socket error')
        socket.close()
        done()
      })
    })

    it('should parse 3-frame Router messages correctly', (done) => {
      class MockSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-router-3frame'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          yield [
            Buffer.from('sender-id'),
            Buffer.from(''),  // Empty delimiter
            Buffer.from('message-data')
          ]
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          super({ socket: new MockSocket(), config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      socket.once(TransportEvent.MESSAGE, ({ buffer, sender }) => {
        expect(sender).to.exist
        expect(sender.toString()).to.equal('sender-id')
        expect(buffer).to.exist
        expect(buffer.toString()).to.equal('message-data')
        socket.stopMessageListener()
        socket.close()
        done()
      })
    })

    it('should parse 2-frame Dealer messages correctly', (done) => {
      class MockSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-dealer-2frame'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          yield [
            Buffer.from(''),  // Empty frame
            Buffer.from('message-data')
          ]
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          super({ socket: new MockSocket(), config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      socket.once(TransportEvent.MESSAGE, ({ buffer, sender }) => {
        expect(sender).to.be.null
        expect(buffer).to.exist
        expect(buffer.toString()).to.equal('message-data')
        socket.stopMessageListener()
        socket.close()
        done()
      })
    })
  })

  // ==========================================================================
  // SEND BUFFER
  // ==========================================================================
  
  describe('Send Buffer', () => {
    it('should throw SEND_FAILED when socket is offline', () => {
      const dealer = new DealerSocket({ id: 'test-send-offline' })
      
      expect(() => {
        dealer.sendBuffer(Buffer.from('test'))
      }).to.throw(TransportError)
        .with.property('code', TransportErrorCode.SEND_FAILED)
      
      dealer.close()
    })

    it('should throw SEND_FAILED when router is offline', () => {
      const router = new RouterSocket({ id: 'test-router-offline' })
      
      expect(() => {
        router.sendBuffer(Buffer.from('test'), 'recipient-id')
      }).to.throw(TransportError)
        .with.property('code', TransportErrorCode.SEND_FAILED)
      
      router.close()
    })

    it('should handle send failure on closed socket', async () => {
      const router = new RouterSocket({ id: 'test-send-closed' })
      await router.bind('tcp://127.0.0.1:45001')
      
      // Close the socket
      await router.close()
      
      // Try to send - should throw
      expect(() => {
        router.sendBuffer(Buffer.from('test'), 'some-client')
      }).to.throw(TransportError)
        .with.property('code', TransportErrorCode.SEND_FAILED)
    })
  })

  // ==========================================================================
  // ABSTRACT METHODS
  // ==========================================================================
  
  describe('Abstract Methods', () => {
    it('should throw error if getSocketMsgFromBuffer not overridden', () => {
      class TestSocket extends Socket {
        constructor() {
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
          
          super({ socket: mockSocket, config: {} })
        }
      }
      
      const socket = new TestSocket()
      socket.setOnline()
      
      expect(() => {
        socket.sendBuffer(Buffer.from('test'))
      }).to.throw('getSocketMsgFromBuffer is not implemented in the base class')
      
      socket.close()
    })
  })

  // ==========================================================================
  // STOP MESSAGE LISTENER
  // ==========================================================================
  
  describe('stopMessageListener()', () => {
    it('should set shouldStopListening flag', () => {
      const dealer = new DealerSocket({ id: 'test-stop-listener' })
      
      // Should not throw
      dealer.stopMessageListener()
      
      dealer.close()
    })

    it('should not throw if called multiple times', () => {
      const dealer = new DealerSocket({ id: 'test-stop-multiple' })
      
      dealer.stopMessageListener()
      dealer.stopMessageListener()
      dealer.stopMessageListener()
      
      dealer.close()
    })
  })

  // ==========================================================================
  // DETACH SOCKET EVENT LISTENERS
  // ==========================================================================
  
  describe('detachSocketEventListeners()', () => {
    it('should handle null socket gracefully', () => {
      const dealer = new DealerSocket({ id: 'test-detach-null' })
      
      // Should not throw even if socket is null/undefined
      expect(() => {
        dealer.detachSocketEventListeners()
      }).to.not.throw()
      
      dealer.close()
    })

    it('should handle socket without events property', () => {
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = {
            routingId: 'test-no-events',
            linger: 0,
            sendHighWaterMark: 1000,
            receiveHighWaterMark: 1000,
            closed: false
            // No events property
          }
          
          super({ socket: mockSocket, config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      expect(() => {
        socket.detachSocketEventListeners()
      }).to.not.throw()
      
      socket.close()
    })

    it('should handle closed socket during detach', () => {
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = {
            routingId: 'test-closed-detach',
            linger: 0,
            sendHighWaterMark: 1000,
            receiveHighWaterMark: 1000,
            closed: true,  // Already closed
            events: {
              removeAllListeners: () => {}
            }
          }
          
          super({ socket: mockSocket, config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      expect(() => {
        socket.detachSocketEventListeners()
      }).to.not.throw()
      
      socket.close()
    })
  })

  // ==========================================================================
  // LIFECYCLE & CLEANUP
  // ==========================================================================
  
  describe('Lifecycle & Cleanup', () => {
    it('should emit CLOSED event on close', (done) => {
      const dealer = new DealerSocket({ id: 'test-close-event' })
      
      dealer.once(TransportEvent.CLOSED, () => {
        done()
      })
      
      dealer.close()
    })

    it('should handle errors during close gracefully', (done) => {
      class MockSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-close-error'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = {
            removeAllListeners: () => {
              throw new Error('Cleanup failed')
            }
          }
        }
        
        async *[Symbol.asyncIterator]() {}
        
        close() {
          throw new Error('Close failed')
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          super({ socket: new MockSocket(), config: {} })
        }
        getSocketMsgFromBuffer() { return Buffer.from('test') }
      }
      
      const socket = new TestSocket()
      
      // Should emit ERROR event for close failures
      socket.once(TransportEvent.ERROR, (error) => {
        expect(error).to.be.instanceof(TransportError)
        expect(error.code).to.equal(TransportErrorCode.CLOSE_FAILED)
        expect(error.message).to.include('Failed to close socket')
        done()
      })
      
      socket.close(true)  // Try to close socket
    })

    it('should set offline state during close', () => {
      const dealer = new DealerSocket({ id: 'test-close-offline' })
      dealer.setOnline()
      
      expect(dealer.isOnline()).to.be.true
      dealer.close()
      expect(dealer.isOnline()).to.be.false
    })

    it('should stop message listener during close', () => {
      const dealer = new DealerSocket({ id: 'test-close-stop-listener' })
      
      // Should not throw
      dealer.close()
    })
  })
})

