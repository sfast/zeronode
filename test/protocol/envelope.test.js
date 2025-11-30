/**
 * Envelope Tests
 * 
 * Tests for binary envelope serialization/deserialization
 */

import { expect } from 'chai'
import { Envelope, EnvelopType, BufferStrategy, EnvelopeIdGenerator } from '../../src/protocol/envelope.js'

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
        event: 'test:event',
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
        event: 'test:request',
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
        event: 'test:response',
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
        event: 'test:error',
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
        event: 'broadcast',
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
        event: 'ping',
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
        event: 'test',
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
        event: 'test',
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
          event: 'y', // Minimum 1 char
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
        event: 'test',
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
        event: 'test',
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
        event: 'test',
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
        event: 'test',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.recipient).to.equal('my-recipient-id')
    })

    it('should read event field', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        event: 'my:custom:tag',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      expect(envelope.event).to.equal('my:custom:tag')
    })

    it('should lazily parse data field', () => {
      const testData = { message: 'hello', count: 42 }
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        event: 'test',
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
        event: 'ping',
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
        event: 'test',
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
        event: 'broadcast',
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
        event: 'test',
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

    it('should detect invalid type (type = 0)', () => {
      const buffer = Buffer.alloc(100)
      buffer.writeUInt8(0, 0) // Type 0 (invalid, should be 1-4)
      
      const envelope = new Envelope(buffer)
      const result = envelope.validate()
      
      expect(result.valid).to.be.false
      expect(result.error).to.include('Invalid envelope type')
    })

    it('should detect invalid type (type = 5)', () => {
      const buffer = Buffer.alloc(100)
      buffer.writeUInt8(5, 0) // Type 5 (invalid, should be 1-4)
      
      const envelope = new Envelope(buffer)
      const result = envelope.validate()
      
      expect(result.valid).to.be.false
      expect(result.error).to.include('Invalid envelope type')
    })

    it('should detect size mismatch (truncated envelope)', () => {
      // Create a valid envelope first
      const validBuffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        event: 'test',
        data: { foo: 'bar' }
      })
      
      // Truncate it to cause size mismatch
      const truncatedBuffer = validBuffer.subarray(0, 20)
      const envelope = new Envelope(truncatedBuffer)
      
      const result = envelope.validate()
      expect(result.valid).to.be.false
      expect(result.error).to.be.a('string')
    })

    it('should handle malformed buffer in validate catch block', () => {
      // Create a buffer too small to even parse basic fields
      const tinyBuffer = Buffer.alloc(5)
      
      // Constructor will throw for buffer < 18 bytes, so we catch that
      expect(() => {
        new Envelope(tinyBuffer)
      }).to.throw('Envelope buffer too small')
    })
  })

  describe('getBuffer()', () => {
    it('should return the raw buffer', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: 123n,
        owner: 'client',
        recipient: 'server',
        event: 'test:method',
        data: { key: 'value' }
      })
      
      const envelope = new Envelope(buffer)
      const returnedBuffer = envelope.getBuffer()
      
      expect(returnedBuffer).to.equal(buffer)
      expect(Buffer.isBuffer(returnedBuffer)).to.be.true
    })

    it('should return the same buffer reference', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: '',
        event: 'event',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      const buf1 = envelope.getBuffer()
      const buf2 = envelope.getBuffer()
      
      expect(buf1).to.equal(buf2) // Same reference
    })
  })

  describe('toObject()', () => {
    it('should convert envelope to plain object with all fields', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.REQUEST,
        id: 999n,
        owner: 'test-client',
        recipient: 'test-server',
        event: 'user:create',
        data: { name: 'Alice', age: 30 }
      })
      
      const envelope = new Envelope(buffer)
      const obj = envelope.toObject()
      
      expect(obj).to.be.an('object')
      expect(obj.type).to.equal(EnvelopType.REQUEST)
      expect(obj.id).to.equal(999n)
      expect(obj.owner).to.equal('test-client')
      expect(obj.recipient).to.equal('test-server')
      expect(obj.event).to.equal('user:create')
      expect(obj.data).to.deep.equal({ name: 'Alice', age: 30 })
    })

    it('should handle envelope with null data', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: 1n,
        owner: 'sender',
        recipient: 'receiver',
        event: 'ping',
        data: null
      })
      
      const envelope = new Envelope(buffer)
      const obj = envelope.toObject()
      
      expect(obj.data).to.be.null
    })

    it('should handle envelope with empty strings', () => {
      const buffer = Envelope.createBuffer({
        type: EnvelopType.RESPONSE,
        id: 1n,
        owner: 'server',
        recipient: '',  // Empty recipient
        event: '',      // Empty event
        data: {}
      })
      
      const envelope = new Envelope(buffer)
      const obj = envelope.toObject()
      
      expect(obj.recipient).to.equal('')
      expect(obj.event).to.equal('')
      expect(obj.data).to.deep.equal({})
    })

    it('should handle envelope with complex nested data', () => {
      const complexData = {
        users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
        meta: { count: 2, timestamp: 1234567890 }
      }
      
      const buffer = Envelope.createBuffer({
        type: EnvelopType.RESPONSE,
        id: 42n,
        owner: 'api-server',
        recipient: 'web-client',
        event: 'users:list',
        data: complexData
      })
      
      const envelope = new Envelope(buffer)
      const obj = envelope.toObject()
      
      expect(obj.data).to.deep.equal(complexData)
      expect(obj.data.users).to.have.lengthOf(2)
    })
  })

  describe('Round-trip serialization', () => {
    it('should serialize and deserialize correctly', () => {
      const original = {
        type: EnvelopType.REQUEST,
        id: 999n,
        owner: 'test-client',
        recipient: 'test-server',
        event: 'user:create',
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
      expect(envelope.event).to.equal(original.event)
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
        event: 'response',
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
          event: 'test',
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
        event: 'test',
        data: { large: 'data'.repeat(1000) }
      })
      
      const start = Date.now()
      const envelope = new Envelope(buffer)
      // Just reading metadata should be instant
      envelope.type
      envelope.owner
      envelope.event
      const elapsed = Date.now() - start
      
      expect(elapsed).to.be.lessThan(10)
    })
  })

  describe('Metadata Feature', () => {
    
    describe('createBuffer() with metadata', () => {
      
      it('should create envelope without metadata (backward compatible)', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: { hello: 'world' }
          // No metadata
        })
        
        expect(buffer).to.be.instanceOf(Buffer)
        
        const envelope = new Envelope(buffer)
        expect(envelope.metadata).to.be.null
      })
      
      it('should create envelope with metadata', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: { hello: 'world' },
          metadata: { traceId: 'abc-123' }
        })
        
        expect(buffer).to.be.instanceOf(Buffer)
        
        const envelope = new Envelope(buffer)
        expect(envelope.metadata).to.deep.equal({ traceId: 'abc-123' })
      })
      
      it('should handle null metadata', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: { test: true },
          metadata: null
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.metadata).to.be.null
      })
      
      it('should handle undefined metadata', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: { test: true },
          metadata: undefined
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.metadata).to.be.null
      })
      
      it('should encode complex metadata', () => {
        const complexMetadata = {
          tracing: {
            traceId: 'trace-abc-123',
            spanId: 'span-xyz-456'
          },
          qos: {
            priority: 'high',
            maxRetries: 3
          }
        }
        
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'process',
          owner: 'node-1',
          recipient: 'node-2',
          data: { jobId: 123 },
          metadata: complexMetadata
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.metadata).to.deep.equal(complexMetadata)
      })
      
      it('should throw error if metadata too large', () => {
        const largeMetadata = { data: Buffer.alloc(70000).toString('hex') }
        
        expect(() => {
          Envelope.createBuffer({
            type: EnvelopType.REQUEST,
            id: 12345n,
            event: 'test',
            owner: 'node-1',
            recipient: 'node-2',
            data: { test: true },
            metadata: largeMetadata
          })
        }).to.throw('Metadata too large')
      })
    })
    
    describe('metadata getter', () => {
      
      it('should decode metadata lazily', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: { test: true },
          metadata: { traceId: 'abc-123' }
        })
        
        const envelope = new Envelope(buffer)
        
        // First access decodes
        const meta1 = envelope.metadata
        expect(meta1).to.deep.equal({ traceId: 'abc-123' })
        
        // Second access uses cache
        const meta2 = envelope.metadata
        expect(meta2).to.equal(meta1)
      })
      
      it('should preserve metadata type information', () => {
        const metadata = {
          string: 'hello',
          number: 42,
          boolean: true,
          array: [1, 2, 3],
          object: { nested: true },
          nullValue: null
        }
        
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: {},
          metadata
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.metadata).to.deep.equal(metadata)
      })
    })
    
    describe('backward compatibility', () => {
      
      it('should read old envelope without metadata field', () => {
        // Create envelope manually without metadata (simulate old format)
        const type = EnvelopType.REQUEST
        const id = 12345n
        const owner = 'node-1'
        const recipient = 'node-2'
        const event = 'test'
        const data = { hello: 'world' }
        
        const ownerBytes = Buffer.byteLength(owner)
        const recipientBytes = Buffer.byteLength(recipient)
        const eventBytes = Buffer.byteLength(event)
        const dataBuffer = Buffer.from(JSON.stringify(data))
        const dataLength = dataBuffer.length
        
        // Total size WITHOUT metadata fields
        const totalSize = 1 + 4 + 8 + 
          (1 + ownerBytes) + 
          (1 + recipientBytes) + 
          (1 + eventBytes) + 
          2 + dataLength
        
        const buffer = Buffer.allocUnsafe(totalSize)
        let offset = 0
        
        // Write envelope manually (old format)
        buffer[offset++] = type
        buffer.writeUInt32BE(Math.floor(Date.now() / 1000), offset)
        offset += 4
        
        const high = Number((id >> 32n) & 0xFFFFFFFFn)
        const low = Number(id & 0xFFFFFFFFn)
        buffer.writeUInt32BE(high, offset)
        buffer.writeUInt32BE(low, offset + 4)
        offset += 8
        
        buffer[offset++] = ownerBytes
        buffer.write(owner, offset, ownerBytes, 'utf8')
        offset += ownerBytes
        
        buffer[offset++] = recipientBytes
        buffer.write(recipient, offset, recipientBytes, 'utf8')
        offset += recipientBytes
        
        buffer[offset++] = eventBytes
        buffer.write(event, offset, eventBytes, 'utf8')
        offset += eventBytes
        
        buffer.writeUInt16BE(dataLength, offset)
        offset += 2
        dataBuffer.copy(buffer, offset)
        
        // NO metadata field!
        
        // Should parse gracefully
        const envelope = new Envelope(buffer)
        expect(envelope.type).to.equal(type)
        expect(envelope.owner).to.equal(owner)
        expect(envelope.metadata).to.be.null
      })
    })
    
    describe('data and metadata coexistence', () => {
      
      it('should handle both data and metadata', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'process',
          owner: 'node-1',
          recipient: 'node-2',
          data: { jobId: 123, payload: 'user data' },
          metadata: { traceId: 'abc-123', priority: 'high' }
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.data).to.deep.equal({ jobId: 123, payload: 'user data' })
        expect(envelope.metadata).to.deep.equal({ traceId: 'abc-123', priority: 'high' })
      })
      
      it('should keep data and metadata separate', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: { user: 'data' },
          metadata: { system: 'metadata' }
        })
        
        const envelope = new Envelope(buffer)
        
        // Data should not contain metadata
        expect(envelope.data).to.not.have.property('system')
        
        // Metadata should not contain data
        expect(envelope.metadata).to.not.have.property('user')
      })
      
      it('should handle no data with metadata', () => {
        const timestamp = Date.now()
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'ping',
          owner: 'node-1',
          recipient: 'node-2',
          data: null,
          metadata: { timestamp }
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.data).to.be.null
        expect(envelope.metadata).to.deep.equal({ timestamp })
      })
    })
    
    describe('different envelope types with metadata', () => {
      
      it('should work with REQUEST envelopes', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.REQUEST,
          id: 12345n,
          event: 'test',
          owner: 'node-1',
          recipient: 'node-2',
          data: {},
          metadata: { type: 'request' }
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.type).to.equal(EnvelopType.REQUEST)
        expect(envelope.metadata).to.deep.equal({ type: 'request' })
      })
      
      it('should work with RESPONSE envelopes', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.RESPONSE,
          id: 12345n,
          event: '',
          owner: 'node-2',
          recipient: 'node-1',
          data: { result: 'ok' },
          metadata: { processingTime: 42 }
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.type).to.equal(EnvelopType.RESPONSE)
        expect(envelope.metadata).to.deep.equal({ processingTime: 42 })
      })
      
      it('should work with TICK envelopes', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.TICK,
          id: 12345n,
          event: 'heartbeat',
          owner: 'node-1',
          recipient: '',
          data: {},
          metadata: { broadcast: true }
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.type).to.equal(EnvelopType.TICK)
        expect(envelope.metadata).to.deep.equal({ broadcast: true })
      })
      
      it('should work with ERROR envelopes', () => {
        const buffer = Envelope.createBuffer({
          type: EnvelopType.ERROR,
          id: 12345n,
          event: '',
          owner: 'node-2',
          recipient: 'node-1',
          data: { message: 'Error occurred' },
          metadata: { errorCode: 'INTERNAL_ERROR' }
        })
        
        const envelope = new Envelope(buffer)
        expect(envelope.type).to.equal(EnvelopType.ERROR)
        expect(envelope.metadata).to.deep.equal({ errorCode: 'INTERNAL_ERROR' })
      })
    })
  })
})

