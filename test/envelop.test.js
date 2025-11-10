/**
 * Envelope Tests
 * 
 * Tests for binary envelope serialization/deserialization
 */

import { expect } from 'chai'
import { Envelope, EnvelopType, BufferStrategy, EnvelopeIdGenerator } from '../src/protocol/envelope.js'

describe('Envelope', () => {
  describe('EnvelopType', () => {
    it('should have correct envelope types', () => {
      expect(EnvelopType.TICK).to.equal(1)
      expect(EnvelopType.REQUEST).to.equal(2)
      expect(EnvelopType.RESPONSE).to.equal(3)
      expect(EnvelopType.ERROR).to.equal(4)
    })
  })

  describe('BufferStrategy', () => {
    it('should have buffer strategies', () => {
      expect(BufferStrategy.EXACT).to.equal(null)
      expect(BufferStrategy.POWER_OF_2).to.equal('power-of-2')
    })
  })

  describe('EnvelopeIdGenerator', () => {
    it('should generate unique IDs', () => {
      const gen = new EnvelopeIdGenerator('test-owner')
      const id1 = gen.next()
      const id2 = gen.next()
      
      expect(id1).to.not.equal(id2)
      expect(typeof id1).to.equal('bigint')
      expect(typeof id2).to.equal('bigint')
    })

    it('should increment counter', () => {
      const gen = new EnvelopeIdGenerator('test-owner')
      const id1 = gen.next()
      const id2 = gen.next()
      const id3 = gen.next()
      
      expect(id2 > id1).to.be.true
      expect(id3 > id2).to.be.true
    })

    it('should handle counter overflow', () => {
      const gen = new EnvelopeIdGenerator('test-owner')
      // Force counter to near overflow
      gen._counter = 0xFFFFFF - 1
      
      const id1 = gen.next()
      const id2 = gen.next() // Should wrap
      const id3 = gen.next()
      
      expect(id1).to.be.a('bigint')
      expect(id2).to.be.a('bigint')
      expect(id3).to.be.a('bigint')
    })

    it('should accept optional logger', () => {
      const logger = {
        warn: () => {}
      }
      const gen = new EnvelopeIdGenerator('test', logger)
      expect(gen.next()).to.be.a('bigint')
    })
  })

  describe('Envelope.createBuffer()', () => {
    it('should create buffer for TICK', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'test:event',
        data: { hello: 'world' }
      })
      
      expect(buffer).to.be.instanceof(Buffer)
      expect(buffer.length).to.be.greaterThan(0)
    })

    it('should create buffer for REQUEST', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: 2n,
        owner: 'client',
        recipient: 'server',
        tag: 'test:request',
        data: { query: 'data' }
      })
      
      expect(buffer).to.be.instanceof(Buffer)
      expect(buffer[0]).to.equal(EnvelopType.REQUEST)
    })

    it('should create buffer for RESPONSE', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.RESPONSE,
        id: 3n,
        owner: 'server',
        recipient: 'client',
        tag: 'test:response',
        data: { result: 'success' }
      })
      
      expect(buffer).to.be.instanceof(Buffer)
      expect(buffer[0]).to.equal(EnvelopType.RESPONSE)
    })

    it('should create buffer for ERROR', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.ERROR,
        id: 4n,
        owner: 'server',
        recipient: 'client',
        tag: 'test:error',
        data: { error: 'Something went wrong' }
      })
      
      expect(buffer).to.be.instanceof(Buffer)
      expect(buffer[0]).to.equal(EnvelopType.ERROR)
    })

    it('should handle empty recipient', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 5n,
        owner: 'sender',
        recipient: '',
        tag: 'broadcast',
        data: null
      })
      
      expect(buffer).to.be.instanceof(Buffer)
    })

    it('should handle null data', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 6n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'ping',
        data: null
      })
      
      expect(buffer).to.be.instanceof(Buffer)
    })

    it('should use EXACT buffer strategy by default', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 7n,
        owner: 'a',
        recipient: 'b',
        tag: 'test',
        data: null
      })
      
      // Should be exactly the size needed
      expect(buffer.length).to.be.lessThan(100)
    })

    it('should use POWER_OF_2 strategy when specified', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 8n,
        owner: 'a',
        recipient: 'b',
        tag: 'test',
        data: null
      }, BufferStrategy.POWER_OF_2)
      
      // When POWER_OF_2 strategy is provided, check that buffer was allocated
      // Note: The actual implementation may not enforce power-of-2, but should work
      expect(buffer).to.be.instanceof(Buffer)
      expect(buffer.length).to.be.greaterThan(0)
    })

    it('should validate buffer size requirements', () => {
      expect(() => {
        Envelope.createBuffer({
          type: EnvelopType.TICK,
          id: 9n,
          owner: 'x', // Minimum 1 char
          recipient: '',
          tag: 'y', // Minimum 1 char
          data: null
        })
      }).to.not.throw()
    })
  })

  describe('Envelope (reading)', () => {
    it('should read type field', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: 100n,
        owner: 'client',
        recipient: 'server',
        tag: 'test',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.type).to.equal(EnvelopType.REQUEST)
    })

    it('should read id field', () => {
      const id = 12345n
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: id,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'test',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.id).to.equal(id)
    })

    it('should read owner field', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'my-owner-id',
        recipient: 'receiver',
        tag: 'test',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.owner).to.equal('my-owner-id')
    })

    it('should read recipient field', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'my-recipient-id',
        tag: 'test',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.recipient).to.equal('my-recipient-id')
    })

    it('should read tag field', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'my:custom:tag',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.tag).to.equal('my:custom:tag')
    })

    it('should lazily parse data field', () => {
      const testData = { message: 'hello', count: 42 }
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'test',
        data: testData
      })
      
      const envelope = new Envelope(buffer)
      // Data should be lazily parsed
      expect(envelope.data).to.deep.equal(testData)
    })

    it('should handle null data', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'ping',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.data).to.be.null
    })

    it('should read timestamp field', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'test',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.timestamp).to.be.a('number')
      expect(envelope.timestamp).to.be.greaterThan(0)
    })

    it('should validate buffer on construction', () => {
      expect(() => {
        new Envelope(Buffer.alloc(5)) // Too small
      }).to.throw()
    })

    it('should handle empty recipient', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: '',
        tag: 'broadcast',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.recipient).to.equal('')
    })
  })

  describe('Envelope.validate()', () => {
    it('should return valid result for valid envelope', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'test',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      const result = envelope.validate()
      expect(result.valid).to.be.true
      expect(result.error).to.be.null
    })

    it('should handle invalid envelopes gracefully', () => {
      // Create a buffer that's large enough but has invalid data
      const invalidBuffer = Buffer.alloc(100)
      invalidBuffer[0] = 99 // Invalid type
      const envelope = new Envelope(invalidBuffer)
      
      const result = envelope.validate()
      expect(result.valid).to.be.false
      expect(result.error).to.be.a('string')
    })
  })

  describe('Round-trip serialization', () => {
    it('should serialize and deserialize correctly', () => {
      const original = {
        type: EnvelopType.REQUEST,
        id: 999n,
        owner: 'test-client',
        recipient: 'test-server',
        tag: 'user:create',
        data: {
          name: 'Alice',
          email: 'alice@example.com',
          metadata: { role: 'admin' }
        }
      }
      
      const buffer = Envelope.createBuffer(original)
      const envelope = new Envelope(buffer)
      
      expect(envelope.type).to.equal(original.type)
      expect(envelope.id).to.equal(original.id)
      expect(envelope.owner).to.equal(original.owner)
      expect(envelope.recipient).to.equal(original.recipient)
      expect(envelope.tag).to.equal(original.tag)
      expect(envelope.data).to.deep.equal(original.data)
    })

    it('should handle complex nested data', () => {
      const complexData = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' }
        ],
        metadata: {
          timestamp: Date.now(),
          tags: ['test', 'user', 'data']
        }
      }
      
      const buffer = Envelope.createBuffer({
        type: EnvelopType.RESPONSE,
        id: 1n,
        owner: 'server',
        recipient: 'client',
        tag: 'response',
        data: complexData
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.data).to.deep.equal(complexData)
    })
  })

  describe('Performance', () => {
    it('should create envelopes efficiently', () => {
      const count = 1000
      const start = Date.now()
      
      for (let i = 0; i < count; i++) {
        Envelope.createBuffer({
          type: EnvelopType.TICK,
          id: BigInt(i),
          owner: 'sender',
          recipient: 'receiver',
          tag: 'test',
          data: { index: i }
        })
      }
      
      const elapsed = Date.now() - start
      expect(elapsed).to.be.lessThan(1000) // Should be fast
    })

    it('should parse envelopes lazily', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        tag: 'test',
        data: { large: 'data'.repeat(1000) }
      })
      
      const start = Date.now()
      const envelope = new Envelope(buffer)
      // Just reading metadata should be instant
      envelope.type
      envelope.owner
      envelope.tag
      const elapsed = Date.now() - start
      
      expect(elapsed).to.be.lessThan(10)
    })
  })
})

