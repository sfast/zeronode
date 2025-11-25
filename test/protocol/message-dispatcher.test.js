/**
 * Message Dispatcher Tests
 * Testing message routing and handler registration
 */

import { expect } from 'chai'
import { MessageDispatcher } from '../../src/protocol/message-dispatcher.js'
import { ProtocolContext } from '../../src/protocol/protocol-context.js'
import { Envelope, EnvelopType } from '../../src/protocol/envelope.js'

describe('Message Dispatcher', () => {
  
  let dispatcher
  let mockSocket
  let mockRequestTracker
  let mockHandlerExecutor
  let context
  
  beforeEach(() => {
    mockSocket = {
      getId: () => 'test-socket',
      logger: null
    }
    
    mockRequestTracker = {
      match: (id, data, isError) => {
        mockRequestTracker.lastMatch = { id, data, isError }
        return true
      }
    }
    
    mockHandlerExecutor = {
      execute: (envelope, handlers) => {
        mockHandlerExecutor.lastExecution = { envelope, handlers }
      }
    }
    
    const mockConfig = {
      DEBUG: false
    }
    
    context = new ProtocolContext({}, mockSocket, mockConfig)
    dispatcher = new MessageDispatcher(context, mockRequestTracker, mockHandlerExecutor)
  })
  
  // ==========================================================================
  // HANDLER REGISTRATION
  // ==========================================================================
  
  describe('Handler Registration', () => {
    it('should register request handler', () => {
      const handler = () => {}
      dispatcher.onRequest('test:event', handler)
      
      const handlers = dispatcher.getRequestHandlers('test:event')
      expect(handlers).to.include(handler)
    })
    
    it('should register tick handler', () => {
      const handler = () => {}
      dispatcher.onTick('test:tick', handler)
      
      const handlers = dispatcher.getTickHandlers('test:tick')
      expect(handlers).to.include(handler)
    })
    
    it('should support pattern matching with RegExp', () => {
      const handler1 = () => {}
      const handler2 = () => {}
      
      dispatcher.onRequest(/^user:.*$/, handler1) // RegExp pattern instead of wildcard
      dispatcher.onRequest('user:login', handler2)
      
      const handlers = dispatcher.getRequestHandlers('user:login')
      expect(handlers).to.have.lengthOf(2)
      expect(handlers).to.include(handler1)
      expect(handlers).to.include(handler2)
    })
    
    it('should support RegExp patterns', () => {
      const handler = () => {}
      dispatcher.onRequest(/^test:.*$/, handler)
      
      const handlers = dispatcher.getRequestHandlers('test:anything')
      expect(handlers).to.include(handler)
    })
    
    it('should unregister request handler', () => {
      const handler = () => {}
      dispatcher.onRequest('test:event', handler)
      
      dispatcher.offRequest('test:event', handler)
      
      const handlers = dispatcher.getRequestHandlers('test:event')
      expect(handlers).to.not.include(handler)
    })
    
    it('should unregister tick handler', () => {
      const handler = () => {}
      dispatcher.onTick('test:tick', handler)
      
      dispatcher.offTick('test:tick', handler)
      
      const handlers = dispatcher.getTickHandlers('test:tick')
      expect(handlers).to.not.include(handler)
    })
    
    it('should unregister all tick handlers for pattern', () => {
      const handler1 = () => {}
      const handler2 = () => {}
      
      dispatcher.onTick('test:tick', handler1)
      dispatcher.onTick('test:tick', handler2)
      
      // Remove all (no handler specified)
      dispatcher.offTick('test:tick')
      
      const handlers = dispatcher.getTickHandlers('test:tick')
      expect(handlers).to.be.empty
    })
  })
  
  // ==========================================================================
  // MESSAGE DISPATCHING
  // ==========================================================================
  
  describe('Message Dispatching', () => {
    it('should dispatch REQUEST to handler executor', () => {
      const handler = () => {}
      dispatcher.onRequest('test:request', handler)
      
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: BigInt(1),
        event: 'test:request',
        data: { test: 'data' },
        owner: 'client-1',
        recipient: 'test-socket'
      }, 'msgpack')
      
      dispatcher.dispatch(buffer)
      
      expect(mockHandlerExecutor.lastExecution).to.exist
      expect(mockHandlerExecutor.lastExecution.envelope.event).to.equal('test:request')
      expect(mockHandlerExecutor.lastExecution.handlers).to.have.lengthOf(1)
    })
    
    it('should dispatch TICK to tick handlers', (done) => {
      dispatcher.onTick('test:tick', (envelope) => {
        expect(envelope.event).to.equal('test:tick')
        expect(envelope.data).to.deep.equal({ tick: 'data' })
        done()
      })
      
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: BigInt(1),
        event: 'test:tick',
        data: { tick: 'data' },
        owner: 'client-1'
      }, 'msgpack')
      
      dispatcher.dispatch(buffer)
    })
    
    it('should dispatch RESPONSE to request tracker', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.RESPONSE,
        id: BigInt(1),
        data: { result: 'success' },
        owner: 'server-1',
        recipient: 'client-1'
      }, 'msgpack')
      
      dispatcher.dispatch(buffer)
      
      expect(mockRequestTracker.lastMatch).to.exist
      expect(mockRequestTracker.lastMatch.data).to.deep.equal({ result: 'success' })
      expect(mockRequestTracker.lastMatch.isError).to.be.false
    })
    
    it('should dispatch ERROR to request tracker', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.ERROR,
        id: BigInt(1),
        data: { error: 'failed' },
        owner: 'server-1',
        recipient: 'client-1'
      }, 'msgpack')
      
      dispatcher.dispatch(buffer)
      
      expect(mockRequestTracker.lastMatch).to.exist
      expect(mockRequestTracker.lastMatch.isError).to.be.true
    })
  })
  
  // ==========================================================================
  // CLEANUP
  // ==========================================================================
  
  describe('Cleanup', () => {
    it('should remove all handlers', () => {
      dispatcher.onRequest('test:event', () => {})
      dispatcher.onTick('test:tick', () => {})
      
      expect(dispatcher.getRequestHandlers('test:event')).to.not.be.empty
      expect(dispatcher.getTickHandlers('test:tick')).to.not.be.empty
      
      dispatcher.removeAllHandlers()
      
      expect(dispatcher.getRequestHandlers('test:event')).to.be.empty
      expect(dispatcher.getTickHandlers('test:tick')).to.be.empty
    })
  })
  
  // ==========================================================================
  // MULTIPLE HANDLERS
  // ==========================================================================
  
  describe('Multiple Handlers', () => {
    it('should pass all matching handlers to executor', () => {
      const handler1 = () => {}
      const handler2 = () => {}
      const handler3 = () => {}
      
      dispatcher.onRequest(/^user:.*$/, handler1) // RegExp pattern instead of wildcard
      dispatcher.onRequest('user:login', handler2)
      dispatcher.onRequest(/user:.*/, handler3)
      
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: BigInt(1),
        event: 'user:login',
        data: {},
        owner: 'client-1',
        recipient: 'test-socket'
      }, 'msgpack')
      
      dispatcher.dispatch(buffer)
      
      expect(mockHandlerExecutor.lastExecution.handlers).to.have.lengthOf(3)
    })
    
    it('should handle multiple tick subscribers', (done) => {
      let count = 0
      
      const done3 = () => {
        count++
        if (count === 3) done()
      }
      
      dispatcher.onTick('event', () => done3())
      dispatcher.onTick('event', () => done3())
      dispatcher.onTick('event', () => done3())
      
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: BigInt(1),
        event: 'event',
        data: {},
        owner: 'client-1'
      }, 'msgpack')
      
      dispatcher.dispatch(buffer)
    })
  })
})

