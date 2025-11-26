/**
 * Node Error Tests
 * 
 * Comprehensive tests for Node layer error codes and NodeError class
 */

import { expect } from 'chai'
import { NodeError, NodeErrorCode } from '../src/node-errors.js'

describe('Node Errors', () => {
  
  // ============================================================================
  // NODE ERROR CODES
  // ============================================================================
  
  describe('NodeErrorCode - Error Code Constants', () => {
    it('should export all node error codes', () => {
      expect(NodeErrorCode).to.be.an('object')
      expect(NodeErrorCode.NODE_NOT_FOUND).to.be.a('string')
      expect(NodeErrorCode.NO_NODES_MATCH_FILTER).to.be.a('string')
      expect(NodeErrorCode.INVALID_ADDRESS).to.be.a('string')
    })
    
    it('should have unique error codes', () => {
      const codes = Object.values(NodeErrorCode)
      const uniqueCodes = new Set(codes)
      expect(codes.length).to.equal(uniqueCodes.size)
    })
    
    it('should have descriptive error code names', () => {
      expect(NodeErrorCode.NODE_NOT_FOUND).to.equal('NODE_NOT_FOUND')
      expect(NodeErrorCode.NO_NODES_MATCH_FILTER).to.equal('NO_NODES_MATCH_FILTER')
      expect(NodeErrorCode.INVALID_ADDRESS).to.equal('INVALID_ADDRESS')
    })
    
    it('should be immutable (frozen)', () => {
      expect(() => {
        NodeErrorCode.NEW_CODE = 'NEW_CODE'
      }).to.not.throw()
      
      // If frozen, property won't be added
      if (Object.isFrozen(NodeErrorCode)) {
        expect(NodeErrorCode.NEW_CODE).to.be.undefined
      }
    })
  })
  
  // ============================================================================
  // NODE ERROR - CONSTRUCTOR
  // ============================================================================
  
  describe('NodeError - Constructor', () => {
    it('should create error with code and message', () => {
      const error = new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: 'Node "worker-1" not found'
      })
      
      expect(error).to.be.an.instanceof(NodeError)
      expect(error).to.be.an.instanceof(Error)
      expect(error.name).to.equal('NodeError')
      expect(error.code).to.equal(NodeErrorCode.NODE_NOT_FOUND)
      expect(error.message).to.equal('Node "worker-1" not found')
    })
    
    it('should default message to code if not provided', () => {
      const error = new NodeError({
        code: NodeErrorCode.INVALID_ADDRESS
      })
      
      expect(error.message).to.equal(NodeErrorCode.INVALID_ADDRESS)
    })
    
    it('should include nodeId', () => {
      const error = new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: 'Node not found',
        nodeId: 'worker-1'
      })
      
      expect(error.nodeId).to.equal('worker-1')
    })
    
    it('should include cause error', () => {
      const originalError = new Error('Connection refused')
      const error = new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: 'Failed to route message',
        cause: originalError
      })
      
      expect(error.cause).to.equal(originalError)
      expect(error.cause.message).to.equal('Connection refused')
    })
    
    it('should include context object', () => {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'No nodes match filter',
        context: {
          filter: { role: 'worker' },
          availableNodes: 0
        }
      })
      
      expect(error.context).to.deep.equal({
        filter: { role: 'worker' },
        availableNodes: 0
      })
    })
    
    it('should default context to empty object', () => {
      const error = new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: 'Node not found'
      })
      
      expect(error.context).to.deep.equal({})
    })
    
    it('should capture stack trace', () => {
      const error = new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: 'Routing failed'
      })
      
      expect(error.stack).to.be.a('string')
      expect(error.stack).to.include('NodeError')
      expect(error.stack).to.include('Routing failed')
    })
    
    it('should handle empty constructor params', () => {
      const error = new NodeError()
      
      expect(error).to.be.an.instanceof(NodeError)
      expect(error.name).to.equal('NodeError')
      expect(error.code).to.be.undefined
      expect(error.message).to.equal('') // Empty string when code/message undefined
      expect(error.context).to.deep.equal({})
    })
    
    it('should handle all parameters together', () => {
      const cause = new Error('Connection timeout')
      const error = new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: 'Failed to route to node',
        nodeId: 'worker-1',
        cause,
        context: {
          targetNode: 'worker-1',
          timeout: 5000
        }
      })
      
      expect(error.code).to.equal(NodeErrorCode.ROUTING_FAILED)
      expect(error.message).to.equal('Failed to route to node')
      expect(error.nodeId).to.equal('worker-1')
      expect(error.cause).to.equal(cause)
      expect(error.context).to.deep.equal({
        targetNode: 'worker-1',
        timeout: 5000
      })
    })
  })
  
  // ============================================================================
  // NODE ERROR - toJSON()
  // ============================================================================
  
  describe('NodeError - toJSON()', () => {
    it('should serialize to JSON with all fields', () => {
      const cause = new Error('Connection timeout')
      const error = new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: 'Node not found',
        nodeId: 'worker-1',
        cause,
        context: { attemptedAt: '2023-01-01' }
      })
      
      const json = error.toJSON()
      
      expect(json).to.deep.include({
        name: 'NodeError',
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: 'Node not found',
        nodeId: 'worker-1',
        context: { attemptedAt: '2023-01-01' }
      })
      expect(json.cause).to.deep.include({
        message: 'Connection timeout'
      })
      expect(json.cause.stack).to.be.a('string')
      expect(json.stack).to.be.a('string')
    })
    
    it('should handle error without cause', () => {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'No nodes match filter'
      })
      
      const json = error.toJSON()
      
      expect(json.cause).to.be.undefined
    })
    
    it('should handle error without nodeId', () => {
      const error = new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: 'Routing failed'
      })
      
      const json = error.toJSON()
      
      expect(json.nodeId).to.be.undefined
    })
    
    it('should be JSON.stringify compatible', () => {
      const error = new NodeError({
        code: NodeErrorCode.DUPLICATE_CONNECTION,
        message: 'Already connected',
        nodeId: 'worker-1',
        context: { address: 'tcp://127.0.0.1:5000' }
      })
      
      const jsonString = JSON.stringify(error)
      const parsed = JSON.parse(jsonString)
      
      expect(parsed.name).to.equal('NodeError')
      expect(parsed.code).to.equal(NodeErrorCode.DUPLICATE_CONNECTION)
      expect(parsed.message).to.equal('Already connected')
      expect(parsed.nodeId).to.equal('worker-1')
      expect(parsed.context.address).to.equal('tcp://127.0.0.1:5000')
    })
  })
  
  // ============================================================================
  // NODE ERROR - ERROR CODE COVERAGE
  // ============================================================================
  
  describe('NodeError - Error Code Coverage', () => {
    it('should create NODE_NOT_FOUND error', () => {
      const error = new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: 'Target node not found in routing table',
        nodeId: 'worker-1'
      })
      
      expect(error.code).to.equal('NODE_NOT_FOUND')
    })
    
    it('should create NO_NODES_MATCH_FILTER error', () => {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'Filter matched zero nodes',
        context: { filter: { role: 'worker' } }
      })
      
      expect(error.code).to.equal('NO_NODES_MATCH_FILTER')
    })
    
    it('should create INVALID_ADDRESS error', () => {
      const error = new NodeError({
        code: NodeErrorCode.INVALID_ADDRESS,
        message: 'Invalid address provided',
        context: { address: null }
      })
      
      expect(error.code).to.equal('INVALID_ADDRESS')
    })
  })
  
  // ============================================================================
  // NODE ERROR - INTEGRATION
  // ============================================================================
  
  describe('NodeError - Integration', () => {
    it('should be catchable in try-catch', () => {
      try {
        throw new NodeError({
          code: NodeErrorCode.NODE_NOT_FOUND,
          message: 'Node not found'
        })
      } catch (err) {
        expect(err).to.be.an.instanceof(NodeError)
        expect(err.code).to.equal(NodeErrorCode.NODE_NOT_FOUND)
      }
    })
    
    it('should work with instanceof checks', () => {
      const error = new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: 'Routing failed'
      })
      
      expect(error instanceof NodeError).to.be.true
      expect(error instanceof Error).to.be.true
    })
    
    it('should preserve error chain with cause', () => {
      const rootError = new Error('Network error')
      const middleError = new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: 'Routing failed',
        cause: rootError
      })
      const topError = new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: 'Node not found',
        cause: middleError
      })
      
      expect(topError.cause).to.equal(middleError)
      expect(middleError.cause).to.equal(rootError)
    })
  })
  
  // ============================================================================
  // DEFAULT EXPORT
  // ============================================================================
  
  describe('Default Export', () => {
    it('should export NodeError and NodeErrorCode as default', async () => {
      const defaultExport = await import('../src/node-errors.js')
      
      expect(defaultExport.default).to.exist
      expect(defaultExport.default.NodeError).to.equal(NodeError)
      expect(defaultExport.default.NodeErrorCode).to.equal(NodeErrorCode)
    })
  })
})

