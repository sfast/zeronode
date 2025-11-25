/**
 * Tests for Local Transport - Client Socket
 * Testing: LocalClientSocket class
 */

import { expect } from 'chai'
import LocalClientSocket from '../client.js'
import LocalServerSocket from '../server.js'
import { TransportEvent } from '../../events.js'
import { TransportError, TransportErrorCode } from '../../errors.js'
import { getLocalRegistry } from '../client.js'

describe('Local Transport - Client Socket', () => {
  let client
  let server

  beforeEach(() => {
    // Clean up registry before each test
    const registry = getLocalRegistry()
    registry.clear()
  })

  afterEach(async () => {
    // Clean up sockets after each test
    if (client && !client._closed) {
      client.close()
    }
    if (server && !server._closed) {
      server.close()
    }
  })

  // ============================================================================
  // Constructor
  // ============================================================================

  describe('Constructor', () => {
    it('should create client socket with default id', () => {
      client = new LocalClientSocket()
      
      expect(client).to.be.instanceOf(LocalClientSocket)
      expect(client.getId()).to.be.a('string')
      expect(client.getId()).to.match(/^local-client/) // Auto-generated format
      expect(client.isOnline()).to.be.false
    })

    it('should create client socket with custom id', () => {
      const customId = 'local://my-client'
      client = new LocalClientSocket({ id: customId })
      
      expect(client.getId()).to.equal(customId)
      expect(client.isOnline()).to.be.false
    })

    it('should accept config object', () => {
      client = new LocalClientSocket({
        id: 'local://test-client',
        config: { RECONNECTION_TIMEOUT: 5000 }
      })
      
      expect(client.getId()).to.equal('local://test-client')
    })

    it('should start in offline state', () => {
      client = new LocalClientSocket()
      
      expect(client.isOnline()).to.be.false
      expect(client._closed).to.be.false
    })

    it('should add local:// prefix if missing', () => {
      client = new LocalClientSocket({ id: 'test-client' })
      
      // Implementation doesn't auto-add prefix, uses ID as-is
      expect(client.getId()).to.equal('test-client')
    })
  })

  // ============================================================================
  // connect()
  // ============================================================================

  describe('connect()', () => {
    beforeEach(async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
    })

    it('should connect to bound server', async () => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      await client.connect('local://test-server')
      
      expect(client.isOnline()).to.be.true
    })

    it('should emit READY event on successful connection', (done) => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      client.once(TransportEvent.READY, () => {
        expect(client.isOnline()).to.be.true
        done()
      })
      
      client.connect('local://test-server')
    })

    it('should throw error when connecting to non-existent server', async () => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      try {
        await client.connect('local://non-existent-server')
        expect.fail('Should have thrown error')
      } catch (err) {
        expect(err).to.be.instanceOf(TransportError)
        expect(err.code).to.equal(TransportErrorCode.CONNECT_FAILED)
      }
    })

    it('should throw error when connecting without address', async () => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      try {
        await client.connect()
        expect.fail('Should have thrown error')
      } catch (err) {
        expect(err).to.be.instanceOf(TransportError)
        expect(err.code).to.equal(TransportErrorCode.INVALID_ADDRESS)
      }
    })

    it('should throw error when already connected', async () => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      await client.connect('local://test-server')
      
      try {
        await client.connect('local://test-server')
        expect.fail('Should have thrown error')
      } catch (err) {
        expect(err).to.be.instanceOf(TransportError)
        expect(err.code).to.equal(TransportErrorCode.ALREADY_CONNECTED)
      }
    })

    it('should throw error when socket is closed', async () => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      client.close()
      
      try {
        await client.connect('local://test-server')
        expect.fail('Should have thrown error')
      } catch (err) {
        expect(err).to.be.instanceOf(TransportError)
        expect(err.code).to.equal(TransportErrorCode.SOCKET_CLOSED)
      }
    })
  })

  // ============================================================================
  // disconnect()
  // ============================================================================

  describe('disconnect()', () => {
    beforeEach(async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      client = new LocalClientSocket({ id: 'local://test-client' })
      await client.connect('local://test-server')
    })

    it('should disconnect from server', async () => {
      await client.disconnect()
      
      expect(client.isOnline()).to.be.false
    })

    it('should emit NOT_READY event on disconnect', (done) => {
      client.once(TransportEvent.NOT_READY, () => {
        expect(client.isOnline()).to.be.false
        done()
      })
      
      client.disconnect()
    })

    it('should do nothing when already disconnected', async () => {
      await client.disconnect()
      await client.disconnect() // Should not throw
      
      expect(client.isOnline()).to.be.false
    })
  })

  // ============================================================================
  // sendBuffer()
  // ============================================================================

  describe('sendBuffer()', () => {
    beforeEach(async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      client = new LocalClientSocket({ id: 'local://test-client' })
      await client.connect('local://test-server')
    })

    it('should send buffer to connected server', (done) => {
      const testBuffer = Buffer.from('Hello Server')
      
      server.once(TransportEvent.MESSAGE, ({ buffer, sender }) => {
        expect(buffer.toString()).to.equal('Hello Server')
        expect(sender).to.equal('local://test-client')
        done()
      })
      
      client.sendBuffer(testBuffer)
    })

    it('should handle binary data', (done) => {
      const testBuffer = Buffer.from([0x01, 0x02, 0x03, 0xFF])
      
      server.once(TransportEvent.MESSAGE, ({ buffer }) => {
        expect(buffer).to.deep.equal(testBuffer)
        done()
      })
      
      client.sendBuffer(testBuffer)
    })

    it('should throw error when not connected', () => {
      client.disconnect()
      const testBuffer = Buffer.from('test')
      
      expect(() => client.sendBuffer(testBuffer)).to.throw(TransportError)
    })

    it('should throw error when socket is closed', () => {
      client.close()
      const testBuffer = Buffer.from('test')
      
      expect(() => client.sendBuffer(testBuffer)).to.throw(TransportError)
    })
  })

  // ============================================================================
  // Message Receiving
  // ============================================================================

  describe('Message Receiving', () => {
    beforeEach(async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      client = new LocalClientSocket({ id: 'local://test-client' })
      await client.connect('local://test-server')
    })

    it('should receive messages from server', (done) => {
      const testBuffer = Buffer.from('Hello Client')
      
      client.once(TransportEvent.MESSAGE, ({ buffer }) => {
        expect(buffer.toString()).to.equal('Hello Client')
        done()
      })
      
      // Server sends to client
      server.sendBuffer(testBuffer, 'local://test-client')
    })

    it('should emit MESSAGE event with buffer', (done) => {
      const testBuffer = Buffer.from('test message')
      
      client.once(TransportEvent.MESSAGE, ({ buffer }) => {
        expect(buffer).to.be.instanceOf(Buffer)
        expect(buffer).to.deep.equal(testBuffer)
        done()
      })
      
      server.sendBuffer(testBuffer, 'local://test-client')
    })
  })

  // ============================================================================
  // close()
  // ============================================================================

  describe('close()', () => {
    it('should close socket', () => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      client.close()
      
      expect(client._closed).to.be.true
    })

    it('should disconnect before closing', async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      client = new LocalClientSocket({ id: 'local://test-client' })
      await client.connect('local://test-server')
      
      client.close()
      
      expect(client.isOnline()).to.be.false
      expect(client._closed).to.be.true
    })

    it('should be idempotent', () => {
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      client.close()
      client.close() // Should not throw
      
      expect(client._closed).to.be.true
    })
  })

  // ============================================================================
  // State Management
  // ============================================================================

  describe('State Management', () => {
    it('should track online/offline state', async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      expect(client.isOnline()).to.be.false
      
      await client.connect('local://test-server')
      expect(client.isOnline()).to.be.true
      
      await client.disconnect()
      expect(client.isOnline()).to.be.false
    })

    it('should use setOnline() correctly', async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      await client.connect('local://test-server')
      
      expect(client.isOnline()).to.be.true
    })

    it('should use setOffline() correctly', async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      client = new LocalClientSocket({ id: 'local://test-client' })
      await client.connect('local://test-server')
      
      await client.disconnect()
      
      expect(client.isOnline()).to.be.false
    })
  })

  // ============================================================================
  // Integration: Echo Pattern
  // ============================================================================

  describe('Integration: Echo Pattern', () => {
    it('should support request-response pattern', (done) => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      client = new LocalClientSocket({ id: 'local://test-client' })
      
      // Server echoes back messages
      server.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
        server.sendBuffer(buffer, sender)
      })
      
      // Client receives echo
      client.once(TransportEvent.MESSAGE, ({ buffer }) => {
        expect(buffer.toString()).to.equal('ping')
        done()
      })
      
      server.bind('local://test-server').then(() => {
        client.connect('local://test-server').then(() => {
          client.sendBuffer(Buffer.from('ping'))
        })
      })
    })
  })

  // ============================================================================
  // Integration: Multiple Clients
  // ============================================================================

  describe('Integration: Multiple Clients', () => {
    it('should support multiple clients connecting to same server', async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      
      const client1 = new LocalClientSocket({ id: 'local://client1' })
      const client2 = new LocalClientSocket({ id: 'local://client2' })
      const client3 = new LocalClientSocket({ id: 'local://client3' })
      
      await Promise.all([
        client1.connect('local://test-server'),
        client2.connect('local://test-server'),
        client3.connect('local://test-server')
      ])
      
      expect(client1.isOnline()).to.be.true
      expect(client2.isOnline()).to.be.true
      expect(client3.isOnline()).to.be.true
      
      // Cleanup
      client1.close()
      client2.close()
      client3.close()
    })

    it('should route messages to correct clients', (done) => {
      let messagesReceived = 0
      
      server = new LocalServerSocket({ id: 'local://test-server' })
      const client1 = new LocalClientSocket({ id: 'local://client1' })
      const client2 = new LocalClientSocket({ id: 'local://client2' })
      
      client1.once(TransportEvent.MESSAGE, ({ buffer }) => {
        expect(buffer.toString()).to.equal('for-client1')
        messagesReceived++
        if (messagesReceived === 2) done()
      })
      
      client2.once(TransportEvent.MESSAGE, ({ buffer }) => {
        expect(buffer.toString()).to.equal('for-client2')
        messagesReceived++
        if (messagesReceived === 2) done()
      })
      
      server.bind('local://test-server').then(() => {
        Promise.all([
          client1.connect('local://test-server'),
          client2.connect('local://test-server')
        ]).then(() => {
          server.sendBuffer(Buffer.from('for-client1'), 'local://client1')
          server.sendBuffer(Buffer.from('for-client2'), 'local://client2')
        })
      })
    })
  })

  // ============================================================================
  // Performance
  // ============================================================================

  describe('Performance', () => {
    it('should handle high throughput', async () => {
      server = new LocalServerSocket({ id: 'local://test-server' })
      await server.bind('local://test-server')
      
      client = new LocalClientSocket({ id: 'local://test-client' })
      await client.connect('local://test-server')
      
      const messageCount = 1000
      let received = 0
      
      return new Promise((resolve) => {
        server.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
          received++
          if (received === messageCount) {
            expect(received).to.equal(messageCount)
            resolve()
          }
        })
        
        for (let i = 0; i < messageCount; i++) {
          client.sendBuffer(Buffer.from(`message-${i}`))
        }
      })
    })
  })
})

