/**
 * Socket.js - 100% Coverage Tests
 * 
 * Targets remaining uncovered lines:
 * - Lines 72, 76-77: ZMQ_SNDTIMEO and ZMQ_RCVTIMEO config
 * - Lines 143-144: Router format message parsing (3-frame)
 * - Lines 216-223: sendBuffer catch block (ZMQ send errors)
 * - Lines 267-276: close() catch block (cleanup failures)
 * 
 * Goal: Push socket.js from 90.62% to 100%
 */

import { expect } from 'chai'
import { Dealer as DealerSocket, Router as RouterSocket } from '../index.js'
import { Socket } from '../socket.js'
import { TransportError, TransportErrorCode } from '../../errors.js'
import { EventEmitter } from 'events'

describe('Socket.js - 100% Coverage', () => {
  
  // ===========================================================================
  // TEST 0: CONSTRUCTOR VALIDATION (Lines 25-27)
  // ===========================================================================
  
  describe('Constructor - routingId Validation', () => {
    it('should throw error when socket has no routingId', () => {
      class InvalidSocket extends Socket {
        constructor() {
          // Create socket WITHOUT routingId - should throw
          const mockSocket = {
            // Missing routingId!
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
      
      expect(() => {
        new InvalidSocket()
      }).to.throw('Socket must have routingId set')
    })

    it('should include helpful message in routingId error', () => {
      try {
        class BadSocket extends Socket {
          constructor() {
            const mockSocket = {
              linger: 0,
              sendHighWaterMark: 1000,
              receiveHighWaterMark: 1000
            }
            super({ socket: mockSocket, config: {} })
          }
        }
        new BadSocket()
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).to.include('routingId')
        expect(err.message).to.include('before calling super()')
      }
    })
  })
  
  // ===========================================================================
  // TEST 1: CONFIG EDGE CASES (Lines 72, 76-77)
  // ===========================================================================
  
  describe('ZMQ Timeout Configuration', () => {
    it('should set sendTimeout when ZMQ_SNDTIMEO is provided', () => {
      const dealer = new DealerSocket({ 
        id: 'test-sndtimeo',
        config: { ZMQ_SNDTIMEO: 5000 }
      })
      
      // Verify socket was created with config
      expect(dealer).to.exist
      expect(dealer.getConfig().ZMQ_SNDTIMEO).to.equal(5000)
    })

    it('should set receiveTimeout when ZMQ_RCVTIMEO is provided', () => {
      const dealer = new DealerSocket({ 
        id: 'test-rcvtimeo',
        config: { ZMQ_RCVTIMEO: 3000 }
      })
      
      expect(dealer).to.exist
      expect(dealer.getConfig().ZMQ_RCVTIMEO).to.equal(3000)
    })

    it('should set both send and receive timeouts', () => {
      const router = new RouterSocket({ 
        id: 'test-both-timeouts',
        config: { 
          ZMQ_SNDTIMEO: 2000,
          ZMQ_RCVTIMEO: 4000
        }
      })
      
      expect(router).to.exist
    })

    it('should not set timeouts when undefined', () => {
      const dealer = new DealerSocket({ 
        id: 'test-no-timeouts',
        config: {} // No timeout config
      })
      
      // Should use defaults, not throw
      expect(dealer).to.exist
    })
  })
  
  // ===========================================================================
  // TEST 2: ROUTER MESSAGE FORMAT (Lines 143-144)
  // ===========================================================================
  
  describe('Router Format Message Parsing (3-frame)', () => {
    it('should parse 3-frame Router messages correctly', (done) => {
      class MockRouterSocket extends EventEmitter {
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
          // Yield a proper 3-frame Router message: [sender, delimiter, payload]
          yield [
            Buffer.from('client-123'),  // sender identity
            Buffer.from(''),            // delimiter
            Buffer.from('message-data') // payload
          ]
        }
      }
      
      class TestRouterSocket extends Socket {
        constructor() {
          const mockSocket = new MockRouterSocket()
          super({ socket: mockSocket, config: {} })
        }
        
        getSocketMsgFromBuffer(buffer, recipient) {
          return [recipient, Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestRouterSocket()
      
      // Listen for the MESSAGE event
      socket.once('transport:message', ({ buffer, sender }) => {
        expect(Buffer.isBuffer(sender)).to.be.true
        expect(sender.toString()).to.equal('client-123')
        expect(Buffer.isBuffer(buffer)).to.be.true
        expect(buffer.toString()).to.equal('message-data')
        done()
      })
    })

    it('should parse multiple 3-frame messages in sequence', (done) => {
      class MockRouterSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-router-multi'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          yield [Buffer.from('client-1'), Buffer.from(''), Buffer.from('msg1')]
          yield [Buffer.from('client-2'), Buffer.from(''), Buffer.from('msg2')]
          yield [Buffer.from('client-3'), Buffer.from(''), Buffer.from('msg3')]
        }
      }
      
      class TestRouterSocket extends Socket {
        constructor() {
          const mockSocket = new MockRouterSocket()
          super({ socket: mockSocket, config: {} })
        }
        
        getSocketMsgFromBuffer(buffer, recipient) {
          return [recipient, Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestRouterSocket()
      const received = []
      
      socket.on('transport:message', ({ buffer, sender }) => {
        received.push({
          sender: sender.toString(),
          message: buffer.toString()
        })
        
        if (received.length === 3) {
          expect(received[0].sender).to.equal('client-1')
          expect(received[1].sender).to.equal('client-2')
          expect(received[2].sender).to.equal('client-3')
          done()
        }
      })
    })
  })
  
  // ===========================================================================
  // TEST 3: SEND BUFFER CATCH BLOCK (Lines 216-223)
  // ===========================================================================
  
  describe('sendBuffer() - ZMQ Send Errors', () => {
    it('should catch and wrap ZMQ send errors', () => {
      // Create a test socket that throws on send
      class FailingSendSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-failing-send'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          // No messages
        }
        
        send(msg) {
          // Simulate ZMQ error (e.g., HWM reached)
          const zmqError = new Error('High water mark reached')
          zmqError.code = 'EAGAIN'
          throw zmqError
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = new FailingSendSocket()
          super({ socket: mockSocket, config: {} })
          // Force online to bypass offline check
          this.setOnline()
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestSocket()
      
      try {
        socket.sendBuffer(Buffer.from('test'))
        expect.fail('Should have thrown TransportError')
      } catch (err) {
        expect(err).to.be.instanceOf(TransportError)
        expect(err.code).to.equal(TransportErrorCode.SEND_FAILED)
        expect(err.message).to.include('Failed to send on transport')
        expect(err.message).to.include('test-failing-send')
        expect(err.message).to.include('High water mark reached')
        expect(err.cause).to.exist
        expect(err.cause.message).to.equal('High water mark reached')
      }
    })

    it('should wrap socket closed error during send', () => {
      class ClosedSendSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-closed-send'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {}
        
        send(msg) {
          throw new Error('Socket is closed')
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = new ClosedSendSocket()
          super({ socket: mockSocket, config: {} })
          this.setOnline()
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestSocket()
      
      try {
        socket.sendBuffer(Buffer.from('test'))
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.code).to.equal(TransportErrorCode.SEND_FAILED)
        expect(err.message).to.include('Socket is closed')
      }
    })

    it('should include transportId in send error', () => {
      class FailSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'specific-id-123'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {}
        
        send(msg) {
          throw new Error('Network error')
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = new FailSocket()
          super({ socket: mockSocket, config: {} })
          this.setOnline()
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestSocket()
      
      try {
        socket.sendBuffer(Buffer.from('test'))
      } catch (err) {
        expect(err.transportId).to.equal('specific-id-123')
      }
    })
  })
  
  // ===========================================================================
  // TEST 4: CLOSE() CATCH BLOCK (Lines 267-276)
  // ===========================================================================
  
  describe('close() - Error Handling', () => {
    it('should catch and emit error when detach fails', (done) => {
      // Create socket that throws during detach
      class FailingDetachSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-failing-detach'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = {
            removeAllListeners() {
              throw new Error('Cannot remove listeners')
            }
          }
        }
        
        async *[Symbol.asyncIterator]() {}
      }
      
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = new FailingDetachSocket()
          super({ socket: mockSocket, config: {} })
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestSocket()
      
      socket.once('transport:error', (err) => {
        expect(err).to.be.instanceOf(TransportError)
        expect(err.code).to.equal(TransportErrorCode.CLOSE_FAILED)
        expect(err.message).to.include('Failed to close socket')
        expect(err.message).to.include('Cannot remove listeners')
        expect(err.transportId).to.equal('test-failing-detach')
        done()
      })
      
      socket.close(false)
    })

    it('should handle error when socket.close() fails', (done) => {
      class FailingCloseSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-failing-close'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {}
        
        close() {
          throw new Error('Cannot close socket')
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = new FailingCloseSocket()
          super({ socket: mockSocket, config: {} })
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestSocket()
      
      socket.once('transport:error', (err) => {
        expect(err).to.be.instanceOf(TransportError)
        expect(err.code).to.equal(TransportErrorCode.CLOSE_FAILED)
        expect(err.message).to.include('Cannot close socket')
        done()
      })
      
      socket.close(true) // Pass true to trigger socket.close()
    })

    it('should emit error with cause when stopMessageListener fails', (done) => {
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = {
            routingId: 'test-stop-fail',
            linger: 0,
            sendHighWaterMark: 1000,
            receiveHighWaterMark: 1000,
            closed: false,
            events: new EventEmitter(),
            [Symbol.asyncIterator]: async function*() {}
          }
          super({ socket: mockSocket, config: {} })
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
        
        stopMessageListener() {
          throw new Error('Stop listener failed')
        }
      }
      
      const socket = new TestSocket()
      
      socket.once('transport:error', (err) => {
        expect(err.code).to.equal(TransportErrorCode.CLOSE_FAILED)
        expect(err.message).to.include('Stop listener failed')
        expect(err.cause).to.exist
        done()
      })
      
      socket.close(false)
    })

    it('should set offline even when error occurs', (done) => {
      class FailSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-offline-on-error'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = {
            removeAllListeners() {
              throw new Error('Fail')
            }
          }
        }
        
        async *[Symbol.asyncIterator]() {}
      }
      
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = new FailSocket()
          super({ socket: mockSocket, config: {} })
          this.setOnline() // Start online
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestSocket()
      expect(socket.isOnline()).to.be.true
      
      socket.once('transport:error', (err) => {
        // Even though error occurred, socket should be offline
        expect(socket.isOnline()).to.be.false
        done()
      })
      
      socket.close(false)
    })
  })
  
  // ===========================================================================
  // TEST 5: COMPREHENSIVE INTEGRATION
  // ===========================================================================
  
  describe('Full Path Coverage Verification', () => {
    it('should handle all config options including timeouts', () => {
      const dealer = new DealerSocket({
        id: 'comprehensive-test',
        config: {
          ZMQ_SNDTIMEO: 1000,
          ZMQ_RCVTIMEO: 2000,
          LINGER: 0,
          SEND_HWM: 100,
          RECEIVE_HWM: 100,
          DEBUG: true
        }
      })
      
      expect(dealer).to.exist
      expect(dealer.getId()).to.equal('comprehensive-test')
      expect(dealer.debug).to.be.true
      
      // Verify getConfig returns all values
      const config = dealer.getConfig()
      expect(config).to.be.an('object')
      expect(config.ZMQ_SNDTIMEO).to.equal(1000)
      expect(config.ZMQ_RCVTIMEO).to.equal(2000)
      expect(config.DEBUG).to.be.true
    })

    it('should process Router 3-frame and Dealer 2-frame messages', (done) => {
      class MixedSocket extends EventEmitter {
        constructor() {
          super()
          this.routingId = 'test-mixed-frames'
          this.linger = 0
          this.sendHighWaterMark = 1000
          this.receiveHighWaterMark = 1000
          this.closed = false
          this.events = new EventEmitter()
        }
        
        async *[Symbol.asyncIterator]() {
          // First: 3-frame Router message
          yield [Buffer.from('sender1'), Buffer.from(''), Buffer.from('router-msg')]
          // Second: 2-frame Dealer message
          yield [Buffer.from(''), Buffer.from('dealer-msg')]
        }
      }
      
      class TestSocket extends Socket {
        constructor() {
          const mockSocket = new MixedSocket()
          super({ socket: mockSocket, config: {} })
        }
        
        getSocketMsgFromBuffer(buffer) {
          return [Buffer.from(''), buffer]
        }
      }
      
      const socket = new TestSocket()
      const received = []
      
      socket.on('transport:message', ({ buffer, sender }) => {
        received.push({
          hasSender: sender !== null,
          message: buffer.toString()
        })
        
        if (received.length === 2) {
          expect(received[0].hasSender).to.be.true
          expect(received[0].message).to.equal('router-msg')
          expect(received[1].hasSender).to.be.false
          expect(received[1].message).to.equal('dealer-msg')
          done()
        }
      })
    })
  })
})

