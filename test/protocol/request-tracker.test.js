/**
 * Request Tracker Tests
 * Testing request/response state management with minimal mocking
 */

import { expect } from 'chai'
import { RequestTracker } from '../../src/protocol/request-tracker.js'
import { ProtocolContext } from '../../src/protocol/protocol-context.js'
import { ProtocolError, ProtocolErrorCode } from '../../src/protocol/protocol-errors.js'

describe('Request Tracker', () => {
  
  let tracker
  let context
  
  beforeEach(() => {
    // Create mock context
    const mockSocket = {
      getId: () => 'test-protocol',
      logger: null
    }
    const mockProtocol = {}
    const mockConfig = { 
      PROTOCOL_REQUEST_TIMEOUT: 1000,
      DEBUG: false
    }
    
    context = new ProtocolContext(mockProtocol, mockSocket, mockConfig)
    tracker = new RequestTracker(context)
  })
  
  afterEach(() => {
    // Cleanup any pending requests
    if (tracker) {
      tracker.rejectAll('Test cleanup')
    }
  })
  
  // ==========================================================================
  // BASIC TRACKING
  // ==========================================================================
  
  describe('track()', () => {
    it('should track a new request', () => {
      const handlers = {
        resolve: () => {},
        reject: () => {}
      }
      
      const requestId = tracker.track('req-1', handlers)
      
      expect(requestId).to.equal('req-1')
      expect(tracker.pendingCount).to.equal(1)
      expect(tracker.hasPending('req-1')).to.be.true
    })
    
    it('should use config timeout by default', (done) => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-timeout', { resolve, reject })
      })
      
      promise.catch((err) => {
        expect(err).to.be.instanceof(ProtocolError)
        expect(err.code).to.equal(ProtocolErrorCode.REQUEST_TIMEOUT)
        expect(tracker.pendingCount).to.equal(0)
        done()
      })
    })
    
    it('should allow timeout override', (done) => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-custom-timeout', { resolve, reject, timeout: 50 })
      })
      
      promise.catch((err) => {
        expect(err.message).to.include('50ms')
        done()
      })
    })
    
    it('should track multiple concurrent requests', () => {
      tracker.track('req-1', { resolve: () => {}, reject: () => {} })
      tracker.track('req-2', { resolve: () => {}, reject: () => {} })
      tracker.track('req-3', { resolve: () => {}, reject: () => {} })
      
      expect(tracker.pendingCount).to.equal(3)
      expect(tracker.hasPending('req-1')).to.be.true
      expect(tracker.hasPending('req-2')).to.be.true
      expect(tracker.hasPending('req-3')).to.be.true
    })
  })
  
  // ==========================================================================
  // RESPONSE MATCHING
  // ==========================================================================
  
  describe('match()', () => {
    it('should match response and resolve promise', async () => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-success', { resolve, reject })
      })
      
      expect(tracker.pendingCount).to.equal(1)
      
      const matched = tracker.match('req-success', { result: 'success' })
      
      expect(matched).to.be.true
      expect(tracker.pendingCount).to.equal(0)
      
      const result = await promise
      expect(result).to.deep.equal({ result: 'success' })
    })
    
    it('should match error response and reject promise', async () => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-error', { resolve, reject })
      })
      
      const matched = tracker.match('req-error', { error: 'failed' }, true)
      
      expect(matched).to.be.true
      expect(tracker.pendingCount).to.equal(0)
      
      try {
        await promise
        expect.fail('Should have rejected')
      } catch (err) {
        expect(err).to.deep.equal({ error: 'failed' })
      }
    })
    
    it('should return false for unknown request ID', () => {
      const matched = tracker.match('unknown-req', { data: 'test' })
      
      expect(matched).to.be.false
    })
    
    it('should clear timeout timer on match', (done) => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-clear-timer', { resolve, reject, timeout: 100 })
      })
      
      // Match immediately
      tracker.match('req-clear-timer', { result: 'ok' })
      
      // Wait longer than timeout
      setTimeout(() => {
        // If timer wasn't cleared, test would fail
        expect(tracker.pendingCount).to.equal(0)
        done()
      }, 150)
      
      promise.catch(() => {})
    })
    
    it('should handle multiple responses correctly', async () => {
      const promises = []
      
      for (let i = 0; i < 5; i++) {
        promises.push(new Promise((resolve, reject) => {
          tracker.track(`req-${i}`, { resolve, reject })
        }))
      }
      
      expect(tracker.pendingCount).to.equal(5)
      
      // Match in random order
      tracker.match('req-2', { id: 2 })
      tracker.match('req-0', { id: 0 })
      tracker.match('req-4', { id: 4 })
      tracker.match('req-1', { id: 1 })
      tracker.match('req-3', { id: 3 })
      
      expect(tracker.pendingCount).to.equal(0)
      
      const results = await Promise.all(promises)
      expect(results).to.have.lengthOf(5)
      expect(results[2]).to.deep.equal({ id: 2 })
    })
  })
  
  // ==========================================================================
  // TIMEOUT HANDLING
  // ==========================================================================
  
  describe('Timeout Handling', () => {
    it('should reject request on timeout', (done) => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-timeout', { resolve, reject, timeout: 50 })
      })
      
      promise.catch((err) => {
        expect(err).to.be.instanceof(ProtocolError)
        expect(err.code).to.equal(ProtocolErrorCode.REQUEST_TIMEOUT)
        expect(err.message).to.include('timed out')
        expect(err.message).to.include('50ms')
        expect(err.protocolId).to.equal('test-protocol')
        expect(err.envelopeId).to.equal('req-timeout')
        expect(tracker.pendingCount).to.equal(0)
        done()
      })
    })
    
    it('should include timeout context in error', (done) => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-context', { resolve, reject, timeout: 75 })
      })
      
      promise.catch((err) => {
        expect(err.context).to.deep.equal({ timeout: 75 })
        done()
      })
    })
    
    it('should handle timeout for already matched request (no-op)', (done) => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-already-matched', { resolve, reject, timeout: 100 })
      })
      
      // Match immediately
      tracker.match('req-already-matched', { result: 'success' })
      
      // Wait for timeout period
      setTimeout(() => {
        // Should not have any effect
        expect(tracker.pendingCount).to.equal(0)
        done()
      }, 150)
      
      promise.catch(() => {})
    })
    
    it('should handle multiple timeouts concurrently', async () => {
      const results = await Promise.allSettled([
        new Promise((resolve, reject) => {
          tracker.track('req-t1', { resolve, reject, timeout: 50 })
        }),
        new Promise((resolve, reject) => {
          tracker.track('req-t2', { resolve, reject, timeout: 75 })
        }),
        new Promise((resolve, reject) => {
          tracker.track('req-t3', { resolve, reject, timeout: 100 })
        })
      ])
      
      expect(results.every(r => r.status === 'rejected')).to.be.true
      expect(tracker.pendingCount).to.equal(0)
    })
  })
  
  // ==========================================================================
  // REJECT ALL
  // ==========================================================================
  
  describe('rejectAll()', () => {
    it('should reject all pending requests', async () => {
      const promises = []
      
      for (let i = 0; i < 10; i++) {
        promises.push(new Promise((resolve, reject) => {
          tracker.track(`req-${i}`, { resolve, reject })
        }))
      }
      
      expect(tracker.pendingCount).to.equal(10)
      
      tracker.rejectAll('Protocol closed')
      
      expect(tracker.pendingCount).to.equal(0)
      
      const results = await Promise.allSettled(promises)
      
      expect(results.every(r => r.status === 'rejected')).to.be.true
      results.forEach(r => {
        expect(r.reason).to.be.instanceof(ProtocolError)
        expect(r.reason.message).to.equal('Protocol closed')
      })
    })
    
    it('should clear all timeout timers', (done) => {
      for (let i = 0; i < 5; i++) {
        new Promise((resolve, reject) => {
          tracker.track(`req-${i}`, { resolve, reject, timeout: 100 })
        }).catch(() => {})
      }
      
      tracker.rejectAll('Cleanup')
      
      // Wait longer than timeout
      setTimeout(() => {
        expect(tracker.pendingCount).to.equal(0)
        done()
      }, 150)
    })
    
    it('should be idempotent (safe to call multiple times)', () => {
      new Promise((resolve, reject) => {
        tracker.track('req-1', { resolve, reject })
      }).catch(() => {})
      
      tracker.rejectAll('First call')
      tracker.rejectAll('Second call')
      tracker.rejectAll('Third call')
      
      expect(tracker.pendingCount).to.equal(0)
    })
    
    it('should do nothing when no pending requests', () => {
      expect(() => {
        tracker.rejectAll('No requests')
      }).to.not.throw()
      
      expect(tracker.pendingCount).to.equal(0)
    })
  })
  
  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================
  
  describe('Utility Methods', () => {
    it('pendingCount should return correct count', () => {
      expect(tracker.pendingCount).to.equal(0)
      
      tracker.track('req-1', { resolve: () => {}, reject: () => {} })
      expect(tracker.pendingCount).to.equal(1)
      
      tracker.track('req-2', { resolve: () => {}, reject: () => {} })
      expect(tracker.pendingCount).to.equal(2)
      
      tracker.match('req-1', {})
      expect(tracker.pendingCount).to.equal(1)
      
      tracker.rejectAll('cleanup')
      expect(tracker.pendingCount).to.equal(0)
    })
    
    it('hasPending should check existence correctly', () => {
      expect(tracker.hasPending('req-1')).to.be.false
      
      tracker.track('req-1', { resolve: () => {}, reject: () => {} })
      
      expect(tracker.hasPending('req-1')).to.be.true
      expect(tracker.hasPending('req-2')).to.be.false
      
      tracker.match('req-1', {})
      
      expect(tracker.hasPending('req-1')).to.be.false
    })
  })
  
  // ==========================================================================
  // DEBUG MODE
  // ==========================================================================
  
  describe('Debug Mode', () => {
    it('should log when debug enabled', () => {
      const logs = []
      const mockSocket = {
        getId: () => 'test',
        logger: {
          debug: (msg) => logs.push(msg),
          warn: (msg) => logs.push(msg)
        }
      }
      const mockConfig = {
        PROTOCOL_REQUEST_TIMEOUT: 1000,
        DEBUG: true
      }
      const debugContext = new ProtocolContext({}, mockSocket, mockConfig)
      const debugTracker = new RequestTracker(debugContext)
      
      debugTracker.track('req-debug', { resolve: () => {}, reject: () => {} })
      
      expect(logs).to.have.lengthOf.at.least(1)
      expect(logs.some(log => log.includes('Tracking request'))).to.be.true
      
      debugTracker.rejectAll('cleanup')
    })
    
    it('should not log when debug disabled', () => {
      const logs = []
      const mockSocket = {
        getId: () => 'test',
        logger: {
          debug: (msg) => logs.push(msg),
          warn: (msg) => logs.push(msg)
        }
      }
      const mockConfig = {
        PROTOCOL_REQUEST_TIMEOUT: 1000,
        DEBUG: false
      }
      const noDebugContext = new ProtocolContext({}, mockSocket, mockConfig)
      const noDebugTracker = new RequestTracker(noDebugContext)
      
      noDebugTracker.track('req-no-debug', { resolve: () => {}, reject: () => {} })
      
      expect(logs).to.have.lengthOf(0)
      
      noDebugTracker.rejectAll('cleanup')
    })
  })
  
  // ==========================================================================
  // EDGE CASES
  // ==========================================================================
  
  describe('Edge Cases', () => {
    it('should handle extremely short timeouts', (done) => {
      const promise = new Promise((resolve, reject) => {
        tracker.track('req-short', { resolve, reject, timeout: 1 })
      })
      
      promise.catch((err) => {
        expect(err).to.be.instanceof(ProtocolError)
        done()
      })
    })
    
    it('should handle matching after tracker is recreated', () => {
      tracker.track('req-1', { resolve: () => {}, reject: () => {} })
      
      // Simulate tracker recreation
      tracker.rejectAll('cleanup')
      
      // Try to match old request
      const matched = tracker.match('req-1', { data: 'test' })
      
      expect(matched).to.be.false
    })
    
    it('should handle BigInt request IDs', async () => {
      const bigIntId = '12345678901234567890'
      
      const promise = new Promise((resolve, reject) => {
        tracker.track(bigIntId, { resolve, reject })
      })
      
      tracker.match(bigIntId, { result: 'success' })
      
      const result = await promise
      expect(result).to.deep.equal({ result: 'success' })
    })
  })
})

