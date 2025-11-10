/**
 * Tests for Transport Error Module
 * Testing: TransportError class and helper methods
 */

import { expect } from 'chai'
import { TransportError, TransportErrorCode } from '../src/transport/errors.js'

describe('Transport Errors', () => {
  
  // ============================================================================
  // TransportErrorCode Constants
  // ============================================================================
  
  describe('TransportErrorCode', () => {
    it('should have all required error codes', () => {
      expect(TransportErrorCode).to.have.property('CONNECTION_TIMEOUT')
      expect(TransportErrorCode).to.have.property('ALREADY_CONNECTED')
      expect(TransportErrorCode).to.have.property('BIND_FAILED')
      expect(TransportErrorCode).to.have.property('ALREADY_BOUND')
      expect(TransportErrorCode).to.have.property('UNBIND_FAILED')
      expect(TransportErrorCode).to.have.property('SEND_FAILED')
      expect(TransportErrorCode).to.have.property('RECEIVE_FAILED')
      expect(TransportErrorCode).to.have.property('INVALID_ADDRESS')
      expect(TransportErrorCode).to.have.property('ADDRESS_REQUIRED')
      expect(TransportErrorCode).to.have.property('CLOSE_FAILED')
    })

    it('should have unique error code values', () => {
      const codes = Object.values(TransportErrorCode)
      const uniqueCodes = new Set(codes)
      expect(codes.length).to.equal(uniqueCodes.size)
    })

    it('should have TRANSPORT_ prefix for all codes', () => {
      Object.values(TransportErrorCode).forEach(code => {
        expect(code).to.match(/^TRANSPORT_/)
      })
    })
  })

  // ============================================================================
  // TransportError Constructor
  // ============================================================================

  describe('TransportError - Constructor', () => {
    it('should create error with code and message', () => {
      const error = new TransportError({
        code: TransportErrorCode.CONNECTION_TIMEOUT,
        message: 'Connection timed out'
      })

      expect(error).to.be.instanceOf(Error)
      expect(error).to.be.instanceOf(TransportError)
      expect(error.code).to.equal(TransportErrorCode.CONNECTION_TIMEOUT)
      expect(error.message).to.equal('Connection timed out')
      expect(error.name).to.equal('TransportError')
    })

    it('should include transportId when provided', () => {
      const error = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Send failed',
        transportId: 'dealer-123'
      })

      expect(error.transportId).to.equal('dealer-123')
    })

    it('should include address when provided', () => {
      const error = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Bind failed',
        address: 'tcp://127.0.0.1:5000'
      })

      expect(error.address).to.equal('tcp://127.0.0.1:5000')
    })

    it('should include cause when provided', () => {
      const originalError = new Error('EADDRINUSE: Address already in use')
      const error = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Failed to bind',
        cause: originalError
      })

      expect(error.cause).to.equal(originalError)
    })

    it('should include context object when provided', () => {
      const error = new TransportError({
        code: TransportErrorCode.RECEIVE_FAILED,
        message: 'Invalid frame count',
        context: { frameCount: 5, expected: 3 }
      })

      expect(error.context).to.deep.equal({ frameCount: 5, expected: 3 })
    })

    it('should have a stack trace', () => {
      const error = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Send failed'
      })

      expect(error.stack).to.be.a('string')
      expect(error.stack).to.include('TransportError')
    })

    it('should work with minimal options', () => {
      const error = new TransportError({
        code: TransportErrorCode.CLOSE_FAILED,
        message: 'Close failed'
      })

      expect(error.code).to.equal(TransportErrorCode.CLOSE_FAILED)
      expect(error.message).to.equal('Close failed')
      expect(error.transportId).to.be.undefined
      expect(error.address).to.be.undefined
      expect(error.cause).to.be.undefined
      expect(error.context).to.deep.equal({})  // context defaults to empty object
    })
  })

  // ============================================================================
  // toJSON()
  // ============================================================================

  describe('toJSON()', () => {
    it('should serialize error to JSON with all fields', () => {
      const error = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Failed to send message',
        transportId: 'dealer-456',
        address: 'tcp://localhost:5555'
      })

      const json = error.toJSON()

      expect(json).to.have.property('name', 'TransportError')
      expect(json).to.have.property('code', TransportErrorCode.SEND_FAILED)
      expect(json).to.have.property('message', 'Failed to send message')
      expect(json).to.have.property('transportId', 'dealer-456')
      expect(json).to.have.property('address', 'tcp://localhost:5555')
      expect(json).to.have.property('stack')
      expect(json.stack).to.be.a('string')
    })

    it('should include cause details when present', () => {
      const originalError = new Error('Socket closed')
      originalError.code = 'EAGAIN'
      
      const error = new TransportError({
        code: TransportErrorCode.RECEIVE_FAILED,
        message: 'Receive failed',
        cause: originalError
      })

      const json = error.toJSON()

      expect(json.cause).to.be.an('object')
      expect(json.cause.name).to.equal('Error')
      expect(json.cause.message).to.equal('Socket closed')
      expect(json.cause.code).to.equal('EAGAIN')
      expect(json.cause.stack).to.be.a('string')
    })

    it('should handle error without cause', () => {
      const error = new TransportError({
        code: TransportErrorCode.ADDRESS_REQUIRED,
        message: 'Address is required'
      })

      const json = error.toJSON()

      expect(json.cause).to.be.undefined
    })

    it('should include context when present', () => {
      const error = new TransportError({
        code: TransportErrorCode.RECEIVE_FAILED,
        message: 'Malformed message',
        context: {
          frameCount: 5,
          expectedFormats: ['Dealer: 2 frames', 'Router: 3 frames']
        }
      })

      const json = error.toJSON()

      expect(json.context).to.deep.equal({
        frameCount: 5,
        expectedFormats: ['Dealer: 2 frames', 'Router: 3 frames']
      })
    })

    it('should handle error without context', () => {
      const error = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Send failed'
      })

      const json = error.toJSON()

      expect(json.context).to.deep.equal({})  // context defaults to empty object
    })

    it('should be serializable with JSON.stringify', () => {
      const error = new TransportError({
        code: TransportErrorCode.CONNECTION_TIMEOUT,
        message: 'Timeout',
        transportId: 'dealer-789'
      })

      const jsonString = JSON.stringify(error)
      const parsed = JSON.parse(jsonString)

      expect(parsed.name).to.equal('TransportError')
      expect(parsed.code).to.equal(TransportErrorCode.CONNECTION_TIMEOUT)
      expect(parsed.message).to.equal('Timeout')
      expect(parsed.transportId).to.equal('dealer-789')
    })
  })

  // ============================================================================
  // isCode()
  // ============================================================================

  describe('isCode()', () => {
    it('should return true for matching code', () => {
      const error = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Bind failed'
      })

      expect(error.isCode(TransportErrorCode.BIND_FAILED)).to.be.true
    })

    it('should return false for non-matching code', () => {
      const error = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Bind failed'
      })

      expect(error.isCode(TransportErrorCode.SEND_FAILED)).to.be.false
      expect(error.isCode(TransportErrorCode.CONNECTION_TIMEOUT)).to.be.false
    })

    it('should work with all error codes', () => {
      const codes = [
        TransportErrorCode.CONNECTION_TIMEOUT,
        TransportErrorCode.ALREADY_CONNECTED,
        TransportErrorCode.BIND_FAILED,
        TransportErrorCode.ALREADY_BOUND,
        TransportErrorCode.UNBIND_FAILED,
        TransportErrorCode.SEND_FAILED,
        TransportErrorCode.RECEIVE_FAILED,
        TransportErrorCode.INVALID_ADDRESS,
        TransportErrorCode.ADDRESS_REQUIRED,
        TransportErrorCode.CLOSE_FAILED
      ]

      codes.forEach(code => {
        const error = new TransportError({ code, message: 'Test' })
        expect(error.isCode(code)).to.be.true
      })
    })
  })

  // ============================================================================
  // isConnectionError()
  // ============================================================================

  describe('isConnectionError()', () => {
    it('should return true for CONNECTION_TIMEOUT', () => {
      const error = new TransportError({
        code: TransportErrorCode.CONNECTION_TIMEOUT,
        message: 'Connection timed out'
      })

      expect(error.isConnectionError()).to.be.true
    })

    it('should return true for ALREADY_CONNECTED', () => {
      const error = new TransportError({
        code: TransportErrorCode.ALREADY_CONNECTED,
        message: 'Already connected'
      })

      expect(error.isConnectionError()).to.be.true
    })

    it('should return false for non-connection errors', () => {
      const bindError = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Bind failed'
      })

      const sendError = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Send failed'
      })

      expect(bindError.isConnectionError()).to.be.false
      expect(sendError.isConnectionError()).to.be.false
    })
  })

  // ============================================================================
  // isBindError()
  // ============================================================================

  describe('isBindError()', () => {
    it('should return true for BIND_FAILED', () => {
      const error = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Bind failed'
      })

      expect(error.isBindError()).to.be.true
    })

    it('should return true for ALREADY_BOUND', () => {
      const error = new TransportError({
        code: TransportErrorCode.ALREADY_BOUND,
        message: 'Already bound'
      })

      expect(error.isBindError()).to.be.true
    })

    it('should return true for UNBIND_FAILED', () => {
      const error = new TransportError({
        code: TransportErrorCode.UNBIND_FAILED,
        message: 'Unbind failed'
      })

      expect(error.isBindError()).to.be.true
    })

    it('should return false for non-bind errors', () => {
      const connectionError = new TransportError({
        code: TransportErrorCode.CONNECTION_TIMEOUT,
        message: 'Connection timeout'
      })

      const sendError = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Send failed'
      })

      expect(connectionError.isBindError()).to.be.false
      expect(sendError.isBindError()).to.be.false
    })
  })

  // ============================================================================
  // isSendError()
  // ============================================================================

  describe('isSendError()', () => {
    it('should return true for SEND_FAILED', () => {
      const error = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Send failed'
      })

      expect(error.isSendError()).to.be.true
    })

    it('should return false for non-send errors', () => {
      const bindError = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Bind failed'
      })

      const connectionError = new TransportError({
        code: TransportErrorCode.CONNECTION_TIMEOUT,
        message: 'Connection timeout'
      })

      const receiveError = new TransportError({
        code: TransportErrorCode.RECEIVE_FAILED,
        message: 'Receive failed'
      })

      expect(bindError.isSendError()).to.be.false
      expect(connectionError.isSendError()).to.be.false
      expect(receiveError.isSendError()).to.be.false
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: Real-world Error Scenarios', () => {
    it('should handle connection timeout scenario', () => {
      const error = new TransportError({
        code: TransportErrorCode.CONNECTION_TIMEOUT,
        message: 'Failed to connect to router within 5000ms',
        transportId: 'dealer-client-1',
        address: 'tcp://127.0.0.1:5555',
        context: { timeout: 5000 }
      })

      expect(error.isConnectionError()).to.be.true
      expect(error.isBindError()).to.be.false
      expect(error.isSendError()).to.be.false

      const json = error.toJSON()
      expect(json.transportId).to.equal('dealer-client-1')
      expect(json.address).to.equal('tcp://127.0.0.1:5555')
      expect(json.context.timeout).to.equal(5000)
    })

    it('should handle bind failure with cause', () => {
      const cause = new Error('EADDRINUSE: Address already in use')
      cause.code = 'EADDRINUSE'

      const error = new TransportError({
        code: TransportErrorCode.BIND_FAILED,
        message: 'Failed to bind to tcp://127.0.0.1:5000',
        transportId: 'router-server-1',
        address: 'tcp://127.0.0.1:5000',
        cause
      })

      expect(error.isBindError()).to.be.true
      expect(error.isConnectionError()).to.be.false
      expect(error.isSendError()).to.be.false

      const json = error.toJSON()
      expect(json.cause.code).to.equal('EADDRINUSE')
      expect(json.cause.message).to.include('Address already in use')
    })

    it('should handle send failure on offline socket', () => {
      const error = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Cannot send on offline socket',
        transportId: 'dealer-789'
      })

      expect(error.isSendError()).to.be.true
      expect(error.isConnectionError()).to.be.false
      expect(error.isBindError()).to.be.false

      expect(error.isCode(TransportErrorCode.SEND_FAILED)).to.be.true
    })

    it('should handle malformed message receive error', () => {
      const error = new TransportError({
        code: TransportErrorCode.RECEIVE_FAILED,
        message: 'Unexpected message format: received 5 frames',
        transportId: 'router-server',
        context: {
          frameCount: 5,
          expectedFormats: ['Dealer: 2 frames', 'Router: 3 frames']
        }
      })

      const json = error.toJSON()
      expect(json.code).to.equal(TransportErrorCode.RECEIVE_FAILED)
      expect(json.context.frameCount).to.equal(5)
      expect(json.context.expectedFormats).to.be.an('array').with.length(2)
    })

    it('should handle close failure during cleanup', () => {
      const cause = new Error('Socket operation on non-socket')
      
      const error = new TransportError({
        code: TransportErrorCode.CLOSE_FAILED,
        message: 'Failed to detach socket listeners',
        transportId: 'dealer-cleanup',
        cause
      })

      const json = error.toJSON()
      expect(json.code).to.equal(TransportErrorCode.CLOSE_FAILED)
      expect(json.cause.message).to.include('non-socket')
    })
  })

  // ============================================================================
  // Error Chaining
  // ============================================================================

  describe('Error Chaining', () => {
    it('should support multiple levels of error causes', () => {
      const rootCause = new Error('Network unreachable')
      rootCause.code = 'ENETUNREACH'

      const intermediateCause = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'ZMQ send failed',
        cause: rootCause
      })

      const topLevelError = new TransportError({
        code: TransportErrorCode.SEND_FAILED,
        message: 'Failed to send message to peer',
        transportId: 'dealer-client',
        cause: intermediateCause
      })

      const json = topLevelError.toJSON()
      expect(json.cause.name).to.equal('TransportError')
      expect(json.cause.code).to.equal(TransportErrorCode.SEND_FAILED)
    })
  })
})

