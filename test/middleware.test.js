/**
 * Middleware Chain Tests
 * 
 * Tests Express-style middleware chain execution for request handlers
 */

import { expect } from 'chai'
import { describe, it, beforeEach } from 'mocha'

import Node from '../src/node.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

describe('Middleware - Express-style chain execution', () => {
  let nodeA, nodeB
  const ports = {
    a: 9200,
    b: 9201
  }

  afterEach(async () => {
    if (nodeA) await nodeA.stop()
    if (nodeB) await nodeB.stop()
    nodeA = null
    nodeB = null
  })

  // ============================================================================
  // BASIC MIDDLEWARE CHAIN
  // ============================================================================

  describe('Basic Middleware Chain', () => {
    it('should execute multiple 2-param handlers in sequence (auto-continue)', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      const executionOrder = []

      // Middleware 1 (logging) - Use RegExp for wildcard matching
      nodeA.onRequest(/^api:/, (envelope, reply) => {
        executionOrder.push('middleware-1')
        // No return, no reply → auto-continues
      })

      // Middleware 2 (validation)
      nodeA.onRequest(/^api:/, (envelope, reply) => {
        executionOrder.push('middleware-2')
        // No return, no reply → auto-continues
      })

      // Business logic
      nodeA.onRequest('api:test', (envelope, reply) => {
        executionOrder.push('handler')
        return { success: true }
      })

      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:test',
        data: {}
      })

      expect(response.success).to.be.true
      expect(executionOrder).to.deep.equal(['middleware-1', 'middleware-2', 'handler'])
    })

    it('should execute 3-param handlers with manual next() control', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      const executionOrder = []

      // Middleware with manual control - Use RegExp
      nodeA.onRequest(/^api:/, (envelope, reply, next) => {
        executionOrder.push('middleware-1')
        next()  // Must call next()
      })

      nodeA.onRequest(/^api:/, (envelope, reply, next) => {
        executionOrder.push('middleware-2')
        next()
      })

      nodeA.onRequest('api:test', (envelope, reply, next) => {
        executionOrder.push('handler')
        reply({ success: true })
      })

      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:test',
        data: {}
      })

      expect(response.success).to.be.true
      expect(executionOrder).to.deep.equal(['middleware-1', 'middleware-2', 'handler'])
    })

    it('should support mixed 2-param and 3-param handlers', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      const executionOrder = []

      // 2-param (auto-continue) - Use RegExp
      nodeA.onRequest(/^api:/, (envelope, reply) => {
        executionOrder.push('auto-continue')
      })

      // 3-param (manual)
      nodeA.onRequest(/^api:/, (envelope, reply, next) => {
        executionOrder.push('manual')
        next()
      })

      // 2-param (return value)
      nodeA.onRequest('api:test', (envelope, reply) => {
        executionOrder.push('handler')
        return { success: true }
      })

      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:test',
        data: {}
      })

      expect(response.success).to.be.true
      expect(executionOrder).to.deep.equal(['auto-continue', 'manual', 'handler'])
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle next(error) and route to error handler', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      const executionOrder = []

      // Middleware that throws error - Use RegExp
      nodeA.onRequest(/^api:/, (envelope, reply, next) => {
        executionOrder.push('middleware')
        if (!envelope.data.token) {
          return next(new Error('Missing token'))
        }
        next()
      })

      // This should NOT execute
      nodeA.onRequest('api:test', (envelope, reply) => {
        executionOrder.push('handler')
        return { success: true }
      })

      // Error handler (4 params) - Use wildcard RegExp to catch all
      nodeA.onRequest(/.*/, (error, envelope, reply, next) => {
        executionOrder.push('error-handler')
        reply.error({
          message: error.message,
          code: 'AUTH_ERROR'
        })
      })

      try {
        await nodeB.request({
          to: 'node-a',
          event: 'api:test',
          data: {}  // No token
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err.message).to.equal('Missing token')
        expect(err.code).to.equal('AUTH_ERROR')
        expect(executionOrder).to.deep.equal(['middleware', 'error-handler'])
      }
    })

    it('should handle sync errors with try/catch', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      const executionOrder = []

      // Handler that throws sync error
      nodeA.onRequest('api:test', (envelope, reply) => {
        executionOrder.push('handler')
        throw new Error('Sync error')
      })

      // Error handler - Use wildcard RegExp
      nodeA.onRequest(/.*/, (error, envelope, reply, next) => {
        executionOrder.push('error-handler')
        reply.error({
          message: error.message,
          code: 'SYNC_ERROR'
        })
      })

      try {
        await nodeB.request({
          to: 'node-a',
          event: 'api:test',
          data: {}
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err.message).to.equal('Sync error')
        expect(err.code).to.equal('SYNC_ERROR')
        expect(executionOrder).to.deep.equal(['handler', 'error-handler'])
      }
    })

    it('should handle async errors with promise rejection', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      const executionOrder = []

      // Handler that returns rejected promise
      nodeA.onRequest('api:test', async (envelope, reply) => {
        executionOrder.push('handler')
        await wait(10)
        throw new Error('Async error')
      })

      // Error handler - Use wildcard RegExp
      nodeA.onRequest(/.*/, (error, envelope, reply, next) => {
        executionOrder.push('error-handler')
        reply.error({
          message: error.message,
          code: 'ASYNC_ERROR'
        })
      })

      try {
        await nodeB.request({
          to: 'node-a',
          event: 'api:test',
          data: {}
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err.message).to.equal('Async error')
        expect(err.code).to.equal('ASYNC_ERROR')
        expect(executionOrder).to.deep.equal(['handler', 'error-handler'])
      }
    })

    it('should send error response if no error handler found', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      // Handler that throws error (no error handler)
      nodeA.onRequest('api:test', (envelope, reply) => {
        throw new Error('Unhandled error')
      })

      try {
        await nodeB.request({
          to: 'node-a',
          event: 'api:test',
          data: {}
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err.message).to.equal('Unhandled error')
        expect(err.code).to.equal('HANDLER_ERROR')
      }
    })
  })

  // ============================================================================
  // REPLY BEHAVIOR
  // ============================================================================

  describe('Reply Behavior', () => {
    it('should support callback-style reply()', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      nodeA.onRequest('api:test', (envelope, reply) => {
        reply({ result: 'callback' })
      })

      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:test',
        data: {}
      })

      expect(response.result).to.equal('callback')
    })

    it('should support return value style', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      nodeA.onRequest('api:test', (envelope, reply) => {
        return { result: 'return-value' }
      })

      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:test',
        data: {}
      })

      expect(response.result).to.equal('return-value')
    })

    it('should support async return value', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      nodeA.onRequest('api:test', async (envelope, reply) => {
        await wait(10)
        return { result: 'async' }
      })

      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:test',
        data: {}
      })

      expect(response.result).to.equal('async')
    })

    it('should prevent duplicate replies', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      let replyCount = 0

      nodeA.onRequest('api:test', (envelope, reply) => {
        reply({ attempt: 1 })
        replyCount++
        
        reply({ attempt: 2 })  // Should be ignored
        replyCount++
        
        reply({ attempt: 3 })  // Should be ignored
        replyCount++
      })

      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:test',
        data: {}
      })

      expect(response.attempt).to.equal(1)
      expect(replyCount).to.equal(3)  // All calls happened, but only first sent
    })
  })

  // ============================================================================
  // REAL-WORLD PATTERNS
  // ============================================================================

  describe('Real-world Patterns', () => {
    it('should implement auth + validation + business logic pattern', async () => {
      nodeA = new Node({ id: 'node-a' })
      await nodeA.bind(`tcp://127.0.0.1:${ports.a}`)

      nodeB = new Node({ id: 'node-b' })
      await nodeB.connect({ address: `tcp://127.0.0.1:${ports.a}` })
      await wait(50)

      const executionLog = []

      // Auth middleware - Use RegExp
      nodeA.onRequest(/^api:/, (envelope, reply, next) => {
        executionLog.push('auth')
        if (!envelope.data.token) {
          return next(new Error('Unauthorized'))
        }
        if (envelope.data.token !== 'valid-token') {
          return next(new Error('Invalid token'))
        }
        next()
      })

      // Validation middleware - Use more specific RegExp
      nodeA.onRequest(/^api:user:/, (envelope, reply, next) => {
        executionLog.push('validation')
        if (!envelope.data.userId) {
          return next(new Error('userId is required'))
        }
        next()
      })

      // Business logic
      nodeA.onRequest('api:user:get', async (envelope, reply) => {
        executionLog.push('business-logic')
        // Simulate DB call
        await wait(10)
        return {
          user: {
            id: envelope.data.userId,
            name: 'John Doe'
          }
        }
      })

      // Error handler - Use wildcard RegExp
      nodeA.onRequest(/.*/, (error, envelope, reply, next) => {
        executionLog.push('error-handler')
        reply.error({
          message: error.message,
          code: 'API_ERROR'
        })
      })

      // Valid request
      const response = await nodeB.request({
        to: 'node-a',
        event: 'api:user:get',
        data: { token: 'valid-token', userId: 123 }
      })

      expect(response.user.name).to.equal('John Doe')
      expect(executionLog).to.deep.equal(['auth', 'validation', 'business-logic'])

      // Invalid request (no token)
      executionLog.length = 0
      try {
        await nodeB.request({
          to: 'node-a',
          event: 'api:user:get',
          data: { userId: 123 }
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err.message).to.equal('Unauthorized')
        expect(executionLog).to.deep.equal(['auth', 'error-handler'])
      }

      // Invalid request (no userId)
      executionLog.length = 0
      try {
        await nodeB.request({
          to: 'node-a',
          event: 'api:user:get',
          data: { token: 'valid-token' }
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err.message).to.equal('userId is required')
        expect(executionLog).to.deep.equal(['auth', 'validation', 'error-handler'])
      }
    })
  })
})

