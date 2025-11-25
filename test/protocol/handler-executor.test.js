/**
 * Handler Executor Tests
 * Testing middleware execution logic with mock socket
 */

import { expect } from 'chai'
import { HandlerExecutor } from '../../src/protocol/handler-executor.js'
import { ProtocolContext } from '../../src/protocol/protocol-context.js'
import { Envelope, EnvelopType } from '../../src/protocol/envelope.js'

describe('Handler Executor', () => {
  
  let executor
  let sentBuffers
  let mockSocket
  let context
  
  beforeEach(() => {
    sentBuffers = []
    
    // Mock socket
    mockSocket = {
      getId: () => 'test-socket',
      sendBuffer: (buffer, recipient) => {
        sentBuffers.push({ buffer, recipient })
      },
      logger: null
    }
    
    const mockConfig = { 
      BUFFER_STRATEGY: 'msgpack', 
      DEBUG: false 
    }
    
    context = new ProtocolContext({}, mockSocket, mockConfig)
    executor = new HandlerExecutor(context)
  })
  
  // Helper: Create test envelope
  function createRequestEnvelope(event = 'test:event') {
    const buffer = Envelope.createBuffer({
      type: EnvelopType.REQUEST,
      id: BigInt(123),
      event,
      data: { test: 'data' },
      owner: 'client-1',
      recipient: 'test-socket'
    }, 'msgpack')
    
    return new Envelope(buffer)
  }
  
  // ==========================================================================
  // SINGLE HANDLER (FAST PATH)
  // ==========================================================================
  
  describe('Single Handler (Fast Path)', () => {
    it('should execute single handler with sync return', async () => {
      const envelope = createRequestEnvelope()
      const handler = (env, reply) => {
        expect(env.event).to.equal('test:event')
        return { result: 'success' }
      }
      
      executor.execute(envelope, [handler])
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // Should send response
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.type).to.equal(EnvelopType.RESPONSE)
      expect(responseEnv.data).to.deep.equal({ result: 'success' })
    })
    
    it('should execute single handler with async return', async () => {
      const envelope = createRequestEnvelope()
      const handler = async (env, reply) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { async: true }
      }
      
      executor.execute(envelope, [handler])
      
      // Wait for async
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.data).to.deep.equal({ async: true })
    })
    
    it('should handle reply() callback', async () => {
      const envelope = createRequestEnvelope()
      const handler = (env, reply) => {
        reply({ callback: 'style' })
      }
      
      executor.execute(envelope, [handler])
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.data).to.deep.equal({ callback: 'style' })
    })
    
    it('should handle reply.error()', () => {
      const envelope = createRequestEnvelope()
      const handler = (env, reply) => {
        reply.error(new Error('Test error'))
      }
      
      executor.execute(envelope, [handler])
      
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.type).to.equal(EnvelopType.ERROR)
      expect(responseEnv.data.message).to.equal('Test error')
    })
    
    it('should handle sync errors', () => {
      const envelope = createRequestEnvelope()
      const handler = () => {
        throw new Error('Sync error')
      }
      
      executor.execute(envelope, [handler])
      
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.type).to.equal(EnvelopType.ERROR)
      expect(responseEnv.data.message).to.equal('Sync error')
    })
    
    it('should prevent duplicate replies', async () => {
      const envelope = createRequestEnvelope()
      const handler = (env, reply) => {
        reply({ first: true })
        reply({ second: true }) // Should be ignored
        return { third: true }  // Should be ignored
      }
      
      executor.execute(envelope, [handler])
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Only first reply should be sent
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.data).to.deep.equal({ first: true })
    })
  })
  
  // ==========================================================================
  // NO HANDLERS
  // ==========================================================================
  
  describe('No Handlers', () => {
    it('should send error when no handlers registered', () => {
      const envelope = createRequestEnvelope('unknown:event')
      
      executor.execute(envelope, [])
      
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.type).to.equal(EnvelopType.ERROR)
      expect(responseEnv.data.message).to.include('No handler')
    })
  })
  
  // ==========================================================================
  // MIDDLEWARE CHAIN (MULTIPLE HANDLERS)
  // ==========================================================================
  
  describe('Middleware Chain', () => {
    it('should execute 2-param handlers in sequence (auto-continue)', async () => {
      const envelope = createRequestEnvelope()
      const executionOrder = []
      
      const handler1 = (env, reply) => {
        executionOrder.push(1)
      }
      
      const handler2 = (env, reply) => {
        executionOrder.push(2)
      }
      
      const handler3 = (env, reply) => {
        executionOrder.push(3)
        return { done: true }
      }
      
      executor.execute(envelope, [handler1, handler2, handler3])
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(executionOrder).to.deep.equal([1, 2, 3])
      expect(sentBuffers).to.have.lengthOf(1)
    })
    
    it('should support 3-param handlers with manual next()', async () => {
      const envelope = createRequestEnvelope()
      const executionOrder = []
      
      const handler1 = (env, reply, next) => {
        executionOrder.push(1)
        next()
      }
      
      const handler2 = (env, reply, next) => {
        executionOrder.push(2)
        next()
      }
      
      const handler3 = (env, reply) => {
        executionOrder.push(3)
        return { final: true }
      }
      
      executor.execute(envelope, [handler1, handler2, handler3])
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(executionOrder).to.deep.equal([1, 2, 3])
    })
    
    it('should handle next(error)', async () => {
      const envelope = createRequestEnvelope()
      
      const handler1 = (env, reply, next) => {
        next(new Error('Validation failed'))
      }
      
      const errorHandler = (error, env, reply, next) => {
        expect(error.message).to.equal('Validation failed')
        reply.error(error)
      }
      
      executor.execute(envelope, [handler1, errorHandler])
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.type).to.equal(EnvelopType.ERROR)
    })
    
    it('should send error if no handler replies', async () => {
      const envelope = createRequestEnvelope()
      
      const handler1 = (env, reply, next) => next()
      const handler2 = (env, reply, next) => next()
      
      executor.execute(envelope, [handler1, handler2])
      
      await new Promise(resolve => setTimeout(resolve, 50))
      
      expect(sentBuffers).to.have.lengthOf(1)
      const responseEnv = new Envelope(sentBuffers[0].buffer)
      expect(responseEnv.type).to.equal(EnvelopType.ERROR)
      expect(responseEnv.data.message).to.include('No handler sent a response')
    })
  })
})

