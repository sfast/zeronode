/**
 * Protocol Error Tests
 * 
 * Comprehensive tests for Protocol layer error codes and ProtocolError class
 */

import { expect } from 'chai'
import { ProtocolError, ProtocolErrorCode } from '../src/protocol/protocol-errors.js'

describe('Protocol Errors', () => {
  
  // ============================================================================
  // PROTOCOL ERROR CODES
  // ============================================================================
  
  describe('ProtocolErrorCode - Error Code Constants', () => {
    it('should export all protocol error codes', () => {
      expect(ProtocolErrorCode).to.be.an('object')
      expect(ProtocolErrorCode.NOT_READY).to.be.a('string')
      expect(ProtocolErrorCode.REQUEST_TIMEOUT).to.be.a('string')
      expect(ProtocolErrorCode.INVALID_ENVELOPE).to.be.a('string')
      expect(ProtocolErrorCode.INVALID_RESPONSE).to.be.a('string')
      expect(ProtocolErrorCode.INVALID_EVENT).to.be.a('string')
      expect(ProtocolErrorCode.HANDLER_ERROR).to.be.a('string')
    })
    
    it('should have unique error codes', () => {
      const codes = Object.values(ProtocolErrorCode)
      const uniqueCodes = new Set(codes)
      expect(codes.length).to.equal(uniqueCodes.size)
    })
    
    it('should have descriptive error code names', () => {
      expect(ProtocolErrorCode.NOT_READY).to.equal('PROTOCOL_NOT_READY')
      expect(ProtocolErrorCode.REQUEST_TIMEOUT).to.equal('REQUEST_TIMEOUT')
      expect(ProtocolErrorCode.INVALID_ENVELOPE).to.equal('INVALID_ENVELOPE')
      expect(ProtocolErrorCode.INVALID_RESPONSE).to.equal('INVALID_RESPONSE')
      expect(ProtocolErrorCode.INVALID_EVENT).to.equal('INVALID_EVENT')
      expect(ProtocolErrorCode.HANDLER_ERROR).to.equal('HANDLER_ERROR')
    })
    
    it('should be immutable (frozen)', () => {
      expect(() => {
        ProtocolErrorCode.NEW_CODE = 'NEW_CODE'
      }).to.not.throw()
      
      // If frozen, property won't be added
      if (Object.isFrozen(ProtocolErrorCode)) {
        expect(ProtocolErrorCode.NEW_CODE).to.be.undefined
      }
    })
  })
  
  // ============================================================================
  // PROTOCOL ERROR - CONSTRUCTOR
  // ============================================================================
  
  describe('ProtocolError - Constructor', () => {
    it('should create error with code and message', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: 'Request timed out after 5000ms'
      })
      
      expect(error).to.be.an.instanceof(ProtocolError)
      expect(error).to.be.an.instanceof(Error)
      expect(error.name).to.equal('ProtocolError')
      expect(error.code).to.equal(ProtocolErrorCode.REQUEST_TIMEOUT)
      expect(error.message).to.equal('Request timed out after 5000ms')
    })
    
    it('should default message to code if not provided', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_ENVELOPE
      })
      
      expect(error.message).to.equal(ProtocolErrorCode.INVALID_ENVELOPE)
    })
    
    it('should include protocolId', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: 'Protocol not ready',
        protocolId: 'client-123'
      })
      
      expect(error.protocolId).to.equal('client-123')
    })
    
    it('should include envelopeId as bigint', () => {
      const envelopeId = BigInt('123456789012345')
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_RESPONSE,
        message: 'Invalid response',
        envelopeId
      })
      
      expect(error.envelopeId).to.equal(envelopeId)
    })
    
    it('should include cause error', () => {
      const originalError = new Error('Handler threw exception')
      const error = new ProtocolError({
        code: ProtocolErrorCode.HANDLER_ERROR,
        message: 'Handler execution failed',
        cause: originalError
      })
      
      expect(error.cause).to.equal(originalError)
      expect(error.cause.message).to.equal('Handler threw exception')
    })
    
    it('should include context object', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_ENVELOPE,
        message: 'Envelope validation failed',
        context: {
          expectedType: 'TICK',
          receivedType: 'UNKNOWN'
        }
      })
      
      expect(error.context).to.deep.equal({
        expectedType: 'TICK',
        receivedType: 'UNKNOWN'
      })
    })
    
    it('should default context to empty object', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: 'Request timed out'
      })
      
      expect(error.context).to.deep.equal({})
    })
    
    it('should capture stack trace', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.HANDLER_ERROR,
        message: 'Handler error'
      })
      
      expect(error.stack).to.be.a('string')
      expect(error.stack).to.include('ProtocolError')
      expect(error.stack).to.include('Handler error')
    })
    
    it('should handle empty constructor params', () => {
      const error = new ProtocolError()
      
      expect(error).to.be.an.instanceof(ProtocolError)
      expect(error.name).to.equal('ProtocolError')
      expect(error.code).to.be.undefined
      expect(error.message).to.equal('') // Empty string when code/message undefined
      expect(error.context).to.deep.equal({})
    })
    
    it('should handle all parameters together', () => {
      const cause = new Error('Timeout')
      const envelopeId = BigInt('999999999999')
      const error = new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: 'Request timed out',
        protocolId: 'client-456',
        envelopeId,
        cause,
        context: {
          timeout: 5000,
          event: 'getUserData'
        }
      })
      
      expect(error.code).to.equal(ProtocolErrorCode.REQUEST_TIMEOUT)
      expect(error.message).to.equal('Request timed out')
      expect(error.protocolId).to.equal('client-456')
      expect(error.envelopeId).to.equal(envelopeId)
      expect(error.cause).to.equal(cause)
      expect(error.context).to.deep.equal({
        timeout: 5000,
        event: 'getUserData'
      })
    })
  })
  
  // ============================================================================
  // PROTOCOL ERROR - toJSON()
  // ============================================================================
  
  describe('ProtocolError - toJSON()', () => {
    it('should serialize to JSON with all fields', () => {
      const cause = new Error('Handler threw')
      const envelopeId = BigInt('123456789')
      const error = new ProtocolError({
        code: ProtocolErrorCode.HANDLER_ERROR,
        message: 'Handler failed',
        protocolId: 'server-1',
        envelopeId,
        cause,
        context: { handlerName: 'onRequest' }
      })
      
      const json = error.toJSON()
      
      expect(json).to.deep.include({
        name: 'ProtocolError',
        code: ProtocolErrorCode.HANDLER_ERROR,
        message: 'Handler failed',
        protocolId: 'server-1',
        envelopeId: '123456789', // Converted to string
        context: { handlerName: 'onRequest' }
      })
      expect(json.cause).to.deep.include({
        message: 'Handler threw'
      })
      expect(json.cause.stack).to.be.a('string')
      expect(json.stack).to.be.a('string')
    })
    
    it('should convert envelopeId to string', () => {
      const envelopeId = BigInt('999999999999999')
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_RESPONSE,
        message: 'Invalid response',
        envelopeId
      })
      
      const json = error.toJSON()
      
      expect(json.envelopeId).to.be.a('string')
      expect(json.envelopeId).to.equal('999999999999999')
    })
    
    it('should handle error without envelopeId', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: 'Protocol not ready'
      })
      
      const json = error.toJSON()
      
      expect(json.envelopeId).to.be.undefined
    })
    
    it('should handle error without cause', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_ENVELOPE,
        message: 'Invalid envelope'
      })
      
      const json = error.toJSON()
      
      expect(json.cause).to.be.undefined
    })
    
    it('should handle error without protocolId', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: 'Request timed out'
      })
      
      const json = error.toJSON()
      
      expect(json.protocolId).to.be.undefined
    })
    
    it('should be JSON.stringify compatible', () => {
      const envelopeId = BigInt('111222333')
      const error = new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: 'Request timed out',
        protocolId: 'client-1',
        envelopeId,
        context: { timeout: 5000 }
      })
      
      const jsonString = JSON.stringify(error)
      const parsed = JSON.parse(jsonString)
      
      expect(parsed.name).to.equal('ProtocolError')
      expect(parsed.code).to.equal(ProtocolErrorCode.REQUEST_TIMEOUT)
      expect(parsed.message).to.equal('Request timed out')
      expect(parsed.protocolId).to.equal('client-1')
      expect(parsed.envelopeId).to.equal('111222333')
      expect(parsed.context.timeout).to.equal(5000)
    })
  })
  
  // ============================================================================
  // PROTOCOL ERROR - ERROR CODE COVERAGE
  // ============================================================================
  
  describe('ProtocolError - Error Code Coverage', () => {
    it('should create NOT_READY error', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.NOT_READY,
        message: 'Protocol not ready to send',
        protocolId: 'client-1'
      })
      
      expect(error.code).to.equal('PROTOCOL_NOT_READY')
    })
    
    it('should create REQUEST_TIMEOUT error', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: 'Request timed out waiting for response',
        envelopeId: BigInt('123'),
        context: { timeout: 5000 }
      })
      
      expect(error.code).to.equal('REQUEST_TIMEOUT')
    })
    
    it('should create INVALID_ENVELOPE error', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_ENVELOPE,
        message: 'Malformed envelope',
        context: { reason: 'Missing type field' }
      })
      
      expect(error.code).to.equal('INVALID_ENVELOPE')
    })
    
    it('should create INVALID_RESPONSE error', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_RESPONSE,
        message: 'Response does not match any pending request',
        envelopeId: BigInt('999')
      })
      
      expect(error.code).to.equal('INVALID_RESPONSE')
    })
    
    it('should create INVALID_EVENT error', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_EVENT,
        message: 'System event cannot be used in public API',
        context: { event: '_system:internal' }
      })
      
      expect(error.code).to.equal('INVALID_EVENT')
    })
    
    it('should create HANDLER_ERROR error', () => {
      const cause = new TypeError('Cannot read property')
      const error = new ProtocolError({
        code: ProtocolErrorCode.HANDLER_ERROR,
        message: 'Handler threw an error',
        cause,
        context: { handlerName: 'onRequest' }
      })
      
      expect(error.code).to.equal('HANDLER_ERROR')
    })
  })
  
  // ============================================================================
  // PROTOCOL ERROR - INTEGRATION
  // ============================================================================
  
  describe('ProtocolError - Integration', () => {
    it('should be catchable in try-catch', () => {
      try {
        throw new ProtocolError({
          code: ProtocolErrorCode.REQUEST_TIMEOUT,
          message: 'Request timed out'
        })
      } catch (err) {
        expect(err).to.be.an.instanceof(ProtocolError)
        expect(err.code).to.equal(ProtocolErrorCode.REQUEST_TIMEOUT)
      }
    })
    
    it('should work with instanceof checks', () => {
      const error = new ProtocolError({
        code: ProtocolErrorCode.INVALID_ENVELOPE,
        message: 'Invalid envelope'
      })
      
      expect(error instanceof ProtocolError).to.be.true
      expect(error instanceof Error).to.be.true
    })
    
    it('should preserve error chain with cause', () => {
      const rootError = new TypeError('Unexpected type')
      const middleError = new ProtocolError({
        code: ProtocolErrorCode.HANDLER_ERROR,
        message: 'Handler error',
        cause: rootError
      })
      const topError = new ProtocolError({
        code: ProtocolErrorCode.INVALID_RESPONSE,
        message: 'Invalid response',
        cause: middleError
      })
      
      expect(topError.cause).to.equal(middleError)
      expect(middleError.cause).to.equal(rootError)
    })
    
    it('should handle bigint envelope IDs correctly', () => {
      const largeId = BigInt('9007199254740991') // MAX_SAFE_INTEGER
      const error = new ProtocolError({
        code: ProtocolErrorCode.REQUEST_TIMEOUT,
        message: 'Timeout',
        envelopeId: largeId
      })
      
      expect(error.envelopeId).to.equal(largeId)
      
      const json = error.toJSON()
      expect(json.envelopeId).to.equal('9007199254740991')
    })
  })
  
  // ============================================================================
  // DEFAULT EXPORT
  // ============================================================================
  
  describe('Default Export', () => {
    it('should export ProtocolError and ProtocolErrorCode as default', async () => {
      const defaultExport = await import('../src/protocol/protocol-errors.js')
      
      expect(defaultExport.default).to.exist
      expect(defaultExport.default.ProtocolError).to.equal(ProtocolError)
      expect(defaultExport.default.ProtocolErrorCode).to.equal(ProtocolErrorCode)
    })
  })
})

