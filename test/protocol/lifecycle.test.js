/**
 * Lifecycle Manager Tests
 * Testing event translation and cleanup logic
 */

import { expect } from 'chai'
import { EventEmitter } from 'events'
import { LifecycleManager, ProtocolEvent } from '../../src/protocol/lifecycle.js'
import { TransportEvent } from '../../src/transport/events.js'
import { Envelope, EnvelopType } from '../../src/protocol/envelope.js'

describe('Lifecycle Manager', () => {
  
  let lifecycle
  let mockSocket
  let mockRequestTracker
  let mockDispatcher
  let mockProtocolEmitter
  let emittedEvents
  
  beforeEach(() => {
    emittedEvents = []
    
    // Mock socket (EventEmitter)
    mockSocket = new EventEmitter()
    mockSocket.getId = () => 'test-socket'
    mockSocket.disconnect = async () => {}
    mockSocket.unbind = async () => {}
    mockSocket.close = async () => {}
    
    // Mock request tracker
    mockRequestTracker = {
      rejectAll: (reason) => {
        mockRequestTracker.lastRejectReason = reason
      }
    }
    
    // Mock dispatcher
    mockDispatcher = {
      dispatch: (buffer, sender) => {
        mockDispatcher.lastDispatch = { buffer, sender }
      },
      removeAllHandlers: () => {
        mockDispatcher.handlersRemoved = true
      }
    }
    
    // Mock protocol emitter
    mockProtocolEmitter = new EventEmitter()
    mockProtocolEmitter.on('*', (event, ...args) => {
      emittedEvents.push({ event, args })
    })
    
    lifecycle = new LifecycleManager({
      socket: mockSocket,
      requestTracker: mockRequestTracker,
      dispatcher: mockDispatcher,
      protocolEmitter: mockProtocolEmitter,
      protocolId: 'test-protocol',
      debug: false,
      logger: null
    })
  })
  
  // ==========================================================================
  // EVENT TRANSLATION
  // ==========================================================================
  
  describe('Event Translation', () => {
    beforeEach(() => {
      lifecycle.attachSocketEventHandlers()
    })
    
    it('should translate TransportEvent.READY → ProtocolEvent.TRANSPORT_READY', (done) => {
      mockProtocolEmitter.once(ProtocolEvent.TRANSPORT_READY, () => {
        done()
      })
      
      mockSocket.emit(TransportEvent.READY)
    })
    
    it('should translate TransportEvent.NOT_READY → ProtocolEvent.TRANSPORT_NOT_READY', (done) => {
      mockProtocolEmitter.once(ProtocolEvent.TRANSPORT_NOT_READY, () => {
        done()
      })
      
      mockSocket.emit(TransportEvent.NOT_READY)
    })
    
    it('should translate TransportEvent.CLOSED → ProtocolEvent.TRANSPORT_CLOSED', (done) => {
      mockProtocolEmitter.once(ProtocolEvent.TRANSPORT_CLOSED, () => {
        done()
      })
      
      mockSocket.emit(TransportEvent.CLOSED)
    })
    
    it('should translate TransportEvent.ERROR → ProtocolEvent.ERROR', (done) => {
      const testError = new Error('Transport error')
      
      mockProtocolEmitter.once(ProtocolEvent.ERROR, (err) => {
        expect(err).to.equal(testError)
        done()
      })
      
      mockSocket.emit(TransportEvent.ERROR, testError)
    })
    
    it('should dispatch MESSAGE events to dispatcher', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: BigInt(1),
        event: 'test:event',
        data: { test: true },
        owner: 'client-1',
        recipient: 'test-socket'
      }, 'msgpack')
      
      mockSocket.emit(TransportEvent.MESSAGE, { buffer, sender: 'client-1' })
      
      expect(mockDispatcher.lastDispatch).to.exist
      expect(mockDispatcher.lastDispatch.buffer).to.equal(buffer)
      expect(mockDispatcher.lastDispatch.sender).to.equal('client-1')
    })
  })
  
  // ==========================================================================
  // CLEANUP ON CLOSED
  // ==========================================================================
  
  describe('Cleanup on CLOSED', () => {
    beforeEach(() => {
      lifecycle.attachSocketEventHandlers()
    })
    
    it('should reject pending requests on CLOSED', () => {
      mockSocket.emit(TransportEvent.CLOSED)
      
      expect(mockRequestTracker.lastRejectReason).to.equal('Transport closed')
    })
    
    it('should remove all handlers on CLOSED', () => {
      mockSocket.emit(TransportEvent.CLOSED)
      
      expect(mockDispatcher.handlersRemoved).to.be.true
    })
    
    it('should auto-detach handlers on unexpected CLOSED', () => {
      const beforeCount = mockSocket.listenerCount(TransportEvent.MESSAGE)
      expect(beforeCount).to.equal(1) // Only lifecycle listener
      
      mockSocket.emit(TransportEvent.CLOSED)
      
      const afterCount = mockSocket.listenerCount(TransportEvent.MESSAGE)
      expect(afterCount).to.equal(0) // All listeners removed
    })
  })
  
  // ==========================================================================
  // ATTACH/DETACH HANDLERS
  // ==========================================================================
  
  describe('Attach/Detach Handlers', () => {
    it('should attach all socket event handlers', () => {
      expect(mockSocket.listenerCount(TransportEvent.MESSAGE)).to.equal(0)
      expect(mockSocket.listenerCount(TransportEvent.READY)).to.equal(0)
      
      lifecycle.attachSocketEventHandlers()
      
      expect(mockSocket.listenerCount(TransportEvent.MESSAGE)).to.equal(1)
      expect(mockSocket.listenerCount(TransportEvent.READY)).to.equal(1)
      expect(mockSocket.listenerCount(TransportEvent.NOT_READY)).to.equal(1)
      expect(mockSocket.listenerCount(TransportEvent.CLOSED)).to.equal(1)
      expect(mockSocket.listenerCount(TransportEvent.ERROR)).to.equal(1)
    })
    
    it('should detach all socket event handlers', () => {
      lifecycle.attachSocketEventHandlers()
      
      expect(mockSocket.listenerCount(TransportEvent.MESSAGE)).to.equal(1)
      
      lifecycle.detachSocketEventHandlers()
      
      expect(mockSocket.listenerCount(TransportEvent.MESSAGE)).to.equal(0)
      expect(mockSocket.listenerCount(TransportEvent.READY)).to.equal(0)
      expect(mockSocket.listenerCount(TransportEvent.NOT_READY)).to.equal(0)
      expect(mockSocket.listenerCount(TransportEvent.CLOSED)).to.equal(0)
      expect(mockSocket.listenerCount(TransportEvent.ERROR)).to.equal(0)
    })
    
    it('should be idempotent (safe to detach multiple times)', () => {
      lifecycle.attachSocketEventHandlers()
      lifecycle.detachSocketEventHandlers()
      
      // Should not throw
      lifecycle.detachSocketEventHandlers()
      lifecycle.detachSocketEventHandlers()
    })
  })
  
  // ==========================================================================
  // DISCONNECT/UNBIND/CLOSE
  // ==========================================================================
  
  describe('Disconnect/Unbind/Close', () => {
    it('should call socket.disconnect()', async () => {
      let disconnectCalled = false
      mockSocket.disconnect = async () => { disconnectCalled = true }
      
      await lifecycle.disconnect()
      
      expect(disconnectCalled).to.be.true
    })
    
    it('should call socket.unbind()', async () => {
      let unbindCalled = false
      mockSocket.unbind = async () => { unbindCalled = true }
      
      await lifecycle.unbind()
      
      expect(unbindCalled).to.be.true
    })
    
    it('should close and trigger socket.close()', async () => {
      let closeCalled = false
      mockSocket.close = async () => { closeCalled = true }
      
      await lifecycle.close()
      
      expect(lifecycle.closed).to.be.true
      expect(closeCalled).to.be.true
    })
    
    it('should be idempotent (safe to close multiple times)', async () => {
      await lifecycle.close()
      
      // Should not throw or do anything
      await lifecycle.close()
      await lifecycle.close()
      
      expect(lifecycle.closed).to.be.true
    })
    
    it('should handle transport close failure gracefully', async () => {
      mockSocket.close = async () => { throw new Error('Close failed') }
      
      // Should not throw - error is caught internally
      await lifecycle.close()
      
      expect(lifecycle.closed).to.be.true
    })
  })
  
  // ==========================================================================
  // EDGE CASES
  // ==========================================================================
  
  describe('Edge Cases', () => {
    it('should handle missing socket gracefully during detach', () => {
      lifecycle.socket = null
      
      // Should not throw
      lifecycle.detachSocketEventHandlers()
    })
    
    it('should handle socket without removeAllListeners', () => {
      lifecycle.socket = { getId: () => 'test' }
      
      // Should not throw
      lifecycle.detachSocketEventHandlers()
    })
  })
})

