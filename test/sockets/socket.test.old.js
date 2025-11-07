/**
 * Socket Transport Layer Tests
 * Tests pure transport functionality: message I/O, request/response tracking
 */

import { expect } from 'chai'
import { EventEmitter } from 'events'
import { Socket } from '../../src/sockets/socket.js'
import { EnvelopType } from '../../src/sockets/enum.js'
import { serializeEnvelope } from '../../src/envelope.js'

describe('Socket (Transport Layer)', () => {
  describe('Constructor & ID', () => {
    it('should generate unique socket ID if not provided', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket1 = new Socket({ socket: mockZmqSocket })
      const socket2 = new Socket({ socket: createMockZmqSocket() })
      
      expect(socket1.getId()).to.be.a('string')
      expect(socket2.getId()).to.be.a('string')
      expect(socket1.getId()).to.not.equal(socket2.getId())
    })

    it('should use provided ID', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ id: 'test-socket-123', socket: mockZmqSocket })
      
      expect(socket.getId()).to.equal('test-socket-123')
    })

    it('should set routingId on ZeroMQ socket', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ id: 'test-id', socket: mockZmqSocket })
      
      expect(mockZmqSocket.routingId).to.equal('test-id')
    })
  })

  describe('Online/Offline State', () => {
    it('should start offline', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      
      expect(socket.isOnline()).to.be.false
    })

    it('should go online when setOnline() is called', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      
      socket.setOnline()
      expect(socket.isOnline()).to.be.true
    })

    it('should go offline when setOffline() is called', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      
      socket.setOnline()
      expect(socket.isOnline()).to.be.true
      
      socket.setOffline()
      expect(socket.isOnline()).to.be.false
    })
  })

  describe('Config & Options', () => {
    it('should store and retrieve config', () => {
      const mockZmqSocket = createMockZmqSocket()
      const config = { REQUEST_TIMEOUT: 5000, custom: 'value' }
      const socket = new Socket({ socket: mockZmqSocket, config })
      
      expect(socket.getConfig()).to.deep.equal(config)
    })

    it('should store and retrieve options', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      
      const options = { version: '1.0', env: 'test' }
      socket.setOptions(options)
      
      expect(socket.getOptions()).to.deep.equal(options)
    })
  })

  describe('Message Reception', () => {
    it('should emit "message" event for TICK messages', (done) => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      
      socket.on('message', ({ type, buffer }) => {
        expect(type).to.equal('incoming')
        expect(buffer).to.be.instanceOf(Buffer)
        expect(buffer[1]).to.equal(EnvelopType.TICK)
        done()
      })
      
      // Simulate receiving a TICK message
      const tickBuffer = serializeEnvelope({
        type: EnvelopType.TICK,
        id: '123',
        tag: 'test-event',
        owner: 'sender',
        recipient: 'receiver',
        data: { hello: 'world' }
      })
      
      mockZmqSocket.simulateIncomingMessage(['', tickBuffer])
    })

    it('should emit "message" event for REQUEST messages', (done) => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      
      socket.on('message', ({ type, buffer }) => {
        expect(type).to.equal('incoming')
        expect(buffer[1]).to.equal(EnvelopType.REQUEST)
        done()
      })
      
      const requestBuffer = serializeEnvelope({
        type: EnvelopType.REQUEST,
        id: '456',
        tag: 'getData',
        owner: 'client',
        recipient: 'server',
        data: { query: 'test' }
      })
      
      mockZmqSocket.simulateIncomingMessage(['', requestBuffer])
    })
  })

  describe('Request/Response Tracking', () => {
    it('should track pending requests', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      socket.setOnline()
      
      const buffer = serializeEnvelope({
        type: EnvelopType.REQUEST,
        id: 'req-123',
        tag: 'test',
        owner: socket.getId(),
        recipient: 'server',
        data: {}
      })
      
      const promise = socket.requestBuffer(buffer, 'server', 1000)
      
      expect(promise).to.be.instanceOf(Promise)
    })

    it('should resolve request when response arrives', (done) => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      socket.setOnline()
      
      const buffer = serializeEnvelope({
        type: EnvelopType.REQUEST,
        id: 'req-456',
        tag: 'test',
        owner: socket.getId(),
        recipient: 'server',
        data: { input: 'test' }
      })
      
      const promise = socket.requestBuffer(buffer, 'server', 5000)
      
      // Simulate response after listener starts
      setTimeout(() => {
        const responseBuffer = serializeEnvelope({
          type: EnvelopType.RESPONSE,
          id: 'req-456',
          tag: 'test',
          owner: 'server',
          recipient: socket.getId(),
          data: { result: 'success' }
        })
        mockZmqSocket.simulateIncomingMessage(['', responseBuffer])
      }, 50)
      
      promise
        .then((result) => {
          try {
            expect(result).to.deep.equal({ result: 'success' })
            done()
          } catch (err) {
            done(err)
          }
        })
        .catch(done)
    })

    it('should reject request when error response arrives', (done) => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      socket.setOnline()
      
      const buffer = serializeEnvelope({
        type: EnvelopType.REQUEST,
        id: 'req-error',
        tag: 'test',
        owner: socket.getId(),
        recipient: 'server',
        data: {}
      })
      
      const promise = socket.requestBuffer(buffer, 'server', 5000)
      
      // Give message listener time to start
      setTimeout(() => {
        const errorBuffer = serializeEnvelope({
          type: EnvelopType.ERROR,
          id: 'req-error',
          tag: 'test',
          owner: 'server',
          recipient: socket.getId(),
          data: { message: 'Something went wrong' }
        })
        mockZmqSocket.simulateIncomingMessage(['', errorBuffer])
      }, 50)
      
      promise
        .then(() => {
          done(new Error('Should have rejected'))
        })
        .catch((err) => {
          try {
            expect(err.message).to.equal('Something went wrong')
            done()
          } catch (assertErr) {
            done(assertErr)
          }
        })
    })

    it('should timeout request if no response', async () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      socket.setOnline()
      
      const buffer = serializeEnvelope({
        type: EnvelopType.REQUEST,
        id: 'req-timeout',
        tag: 'test',
        owner: socket.getId(),
        recipient: 'server',
        data: {}
      })
      
      try {
        await socket.requestBuffer(buffer, 'server', 50) // Short timeout
        throw new Error('Should have timed out')
      } catch (err) {
        expect(err.message).to.include('timeouted')
      }
    })
  })

  describe('Message Sending', () => {
    it('should reject request if socket is offline', async () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      // socket is offline
      
      const buffer = serializeEnvelope({
        type: EnvelopType.REQUEST,
        id: 'req-offline',
        tag: 'test',
        owner: socket.getId(),
        recipient: 'server',
        data: {}
      })
      
      try {
        await socket.requestBuffer(buffer, 'server', 1000)
        throw new Error('Should have rejected')
      } catch (err) {
        expect(err.message).to.include('is not online')
      }
    })

    it('should throw error for tick if socket is offline', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      
      const buffer = serializeEnvelope({
        type: EnvelopType.TICK,
        id: 'tick-offline',
        tag: 'event',
        owner: socket.getId(),
        recipient: 'server',
        data: {}
      })
      
      expect(() => {
        socket.tickBuffer(buffer, 'server')
      }).to.throw('is not online')
    })

    it('should send tick successfully when online', () => {
      const mockZmqSocket = createMockZmqSocket()
      const socket = new Socket({ socket: mockZmqSocket })
      socket.setOnline()
      
      const buffer = serializeEnvelope({
        type: EnvelopType.TICK,
        id: 'tick-ok',
        tag: 'event',
        owner: socket.getId(),
        recipient: 'server',
        data: { msg: 'hello' }
      })
      
      expect(() => {
        socket.tickBuffer(buffer, 'server')
      }).to.not.throw()
      
      expect(mockZmqSocket.sentMessages).to.have.lengthOf(1)
    })
  })
})

// ============================================================================
// Mock ZeroMQ Socket
// ============================================================================

function createMockZmqSocket() {
  const emitter = new EventEmitter()
  const sentMessages = []
  const messageQueue = []
  const pendingResolves = []
  
  const mockSocket = {
    routingId: null,
    sentMessages,
    events: emitter,
    
    send(msg) {
      sentMessages.push(msg)
    },
    
    bind(address) {
      return Promise.resolve()
    },
    
    connect(address) {
      return Promise.resolve()
    },
    
    disconnect(address) {
      return Promise.resolve()
    },
    
    unbind(address) {
      return Promise.resolve()
    },
    
    close() {
      // Cleanup
    },
    
    // Async iterator for message reception
    [Symbol.asyncIterator]() {
      const self = this
      return {
        next() {
          return new Promise((resolve) => {
            // If there's already a message in queue, resolve immediately
            if (messageQueue.length > 0) {
              const msg = messageQueue.shift()
              // Use setImmediate to simulate async behavior
              setImmediate(() => resolve({ value: msg, done: false }))
            } else {
              // Otherwise, queue the resolve for later
              pendingResolves.push(resolve)
            }
          })
        }
      }
    },
    
    // Helper to simulate incoming messages
    simulateIncomingMessage(msg) {
      if (pendingResolves.length > 0) {
        // If there's a pending next() call, resolve it
        const resolve = pendingResolves.shift()
        setImmediate(() => resolve({ value: msg, done: false }))
      } else {
        // Otherwise, queue the message
        messageQueue.push(msg)
      }
    }
  }
  
  return mockSocket
}

