/**
 * ZeroMQ Context Tests
 * 
 * Tests for context creation and caching.
 * Note: ZeroMQ v6 auto-manages context lifecycle - no explicit termination needed.
 */

import { expect } from 'chai'
import * as zmq from 'zeromq'
import { createContext } from '../context.js'

describe('ZeroMQ Context Management', () => {
  
  // ============================================================================
  // createContext() - Basic Functionality
  // ============================================================================
  
  describe('createContext() - Basic Functionality', () => {
    it('should create a new context with specified I/O threads', () => {
      const context = createContext(2)
      
      expect(context).to.exist
      expect(context).to.be.an.instanceof(zmq.Context)
    })

    it('should create context with ioThreads = 1', () => {
      const context = createContext(1)
      
      expect(context).to.exist
      expect(context).to.be.an.instanceof(zmq.Context)
    })

    it('should create context with ioThreads = 16', () => {
      const context = createContext(16)
      
      expect(context).to.exist
      expect(context).to.be.an.instanceof(zmq.Context)
    })

    it('should create contexts with different ioThreads', () => {
      const context1 = createContext(3)
      const context2 = createContext(4)
      
      expect(context1).to.exist
      expect(context2).to.exist
      expect(context1).to.not.equal(context2) // Different ioThreads = different contexts
    })
  })

  // ============================================================================
  // Context Caching (Lines 23-38)
  // ============================================================================
  
  describe('Context Caching', () => {
    it('should return cached context on subsequent calls with same ioThreads', () => {
      const ioThreads = 5
      
      const context1 = createContext(ioThreads)
      const context2 = createContext(ioThreads)
      
      // Should return the SAME cached instance
      expect(context1).to.equal(context2)
    })

    it('should cache contexts independently for different ioThreads', () => {
      const context6 = createContext(6)
      const context7 = createContext(7)
      const context6Again = createContext(6)
      
      // Same ioThreads should return cached instance
      expect(context6).to.equal(context6Again)
      
      // Different ioThreads should be different instances
      expect(context6).to.not.equal(context7)
    })

    it('should reuse cached contexts across multiple calls', () => {
      const ioThreads = 8
      
      const calls = [
        createContext(ioThreads),
        createContext(ioThreads),
        createContext(ioThreads)
      ]
      
      // All calls should return the same instance
      expect(calls[0]).to.equal(calls[1])
      expect(calls[1]).to.equal(calls[2])
      expect(calls[0]).to.equal(calls[2])
    })
  })

  // ============================================================================
  // Integration - Context Usage Lifecycle
  // ============================================================================
  
  describe('Integration - Context Usage Lifecycle', () => {
    it('should support full lifecycle: create → use', () => {
      const ioThreads = 15
      
      // Create
      const context = createContext(ioThreads)
      expect(context).to.exist
      
      // Use (create a socket with this context)
      const dealer = new zmq.Dealer({ context })
      expect(dealer).to.exist
      
      // Close socket (context remains and is auto-managed by ZMQ v6)
      dealer.close()
    })

    it('should allow reusing same context for multiple sockets', () => {
      const ioThreads = 99
      
      // Create context once
      const context = createContext(ioThreads)
      
      // Create multiple sockets with same context
      const dealer1 = new zmq.Dealer({ context })
      const dealer2 = new zmq.Dealer({ context })
      
      expect(dealer1).to.exist
      expect(dealer2).to.exist
      
      // Cleanup sockets (context is auto-managed)
      dealer1.close()
      dealer2.close()
    })

    it('should handle multiple independent contexts', () => {
      const ctx1 = createContext(20)
      const ctx2 = createContext(21)
      const ctx3 = createContext(22)
      
      // All contexts should be valid and different
      expect(ctx1).to.exist
      expect(ctx2).to.exist
      expect(ctx3).to.exist
      expect(ctx1).to.not.equal(ctx2)
      expect(ctx2).to.not.equal(ctx3)
      
      // ZMQ v6 auto-manages cleanup when contexts go out of scope
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================
  
  describe('Edge Cases', () => {
    it('should handle concurrent context creation with same ioThreads', () => {
      const ioThreads = 40
      
      // Create multiple contexts "concurrently" (synchronously)
      const contexts = Array.from({ length: 10 }, () => createContext(ioThreads))
      
      // All should be the same cached instance
      contexts.forEach(ctx => {
        expect(ctx).to.equal(contexts[0])
      })
    })

    it('should preserve independent caches for different ioThreads', () => {
      const ctx60 = createContext(60)
      const ctx61 = createContext(61)
      const ctx62 = createContext(62)
      
      // Get the cached contexts again
      const ctx60Again = createContext(60)
      const ctx61Again = createContext(61)
      const ctx62Again = createContext(62)
      
      // Each should return its cached instance
      expect(ctx60Again).to.equal(ctx60)
      expect(ctx61Again).to.equal(ctx61)
      expect(ctx62Again).to.equal(ctx62)
    })
  })

  // ============================================================================
  // Configuration Verification
  // ============================================================================
  
  describe('Configuration Verification', () => {
    it('should create contexts with varying I/O threads', () => {
      const testCases = [1, 2, 4, 8, 16]
      
      testCases.forEach(ioThreads => {
        const context = createContext(ioThreads)
        expect(context).to.be.an.instanceof(zmq.Context)
      })
    })

    it('should handle boundary I/O thread values', () => {
      // Min boundary (1)
      const minContext = createContext(1)
      expect(minContext).to.exist
      
      // Max boundary (16)
      const maxContext = createContext(16)
      expect(maxContext).to.exist
    })
  })
})
