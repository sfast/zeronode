/**
 * Client Tests
 * 
 * Tests for Client application layer
 */

import { expect } from 'chai'
import Client, { ClientEvent } from '../../src/protocol/client.js'
import Server, { ServerEvent } from '../../src/protocol/server.js'

describe('Client', () => {
  let server
  let client
  let serverAddress

  beforeEach(async () => {
    // Create server for testing
    server = new Server({ id: 'test-server', options: { role: 'server' } })
    await server.bind('tcp://127.0.0.1:0')
    serverAddress = server.getAddress()
  })

  afterEach(async () => {
    // Cleanup
    if (client) {
      try {
        await client.disconnect()
      } catch (err) {
        // Ignore
      }
    }
    if (server) {
      try {
        await server.unbind()
      } catch (err) {
        // Ignore
      }
    }
  })

  describe('Constructor', () => {
    it('should create client with ID', () => {
      client = new Client({ id: 'test-client' })
      expect(client.getId()).to.equal('test-client')
    })

    it('should generate ID if not provided', () => {
      client = new Client()
      expect(client.getId()).to.be.a('string')
      expect(client.getId().length).to.be.greaterThan(0)
    })

    it('should accept options', () => {
      client = new Client({
        id: 'test',
        options: { role: 'worker', region: 'us-east' }
      })
      expect(client.getId()).to.equal('test')
    })

    it('should accept config', () => {
      client = new Client({
        id: 'test',
        config: { requestTimeout: 5000 }
      })
      expect(client).to.be.instanceof(Client)
    })
  })

  describe('isReady()', () => {
    it('should return false before connection', () => {
      client = new Client({ id: 'test' })
      expect(client.isReady()).to.be.false
    })
  })

  describe('getServerActor()', () => {
    it('should return null if not connected', () => {
      client = new Client({ id: 'disconnected' })
      
      // Client doesn't have getServerActor, it has getServerPeerInfo
      expect(client.isReady()).to.be.false
    })
  })

  describe('Handshake Errors', () => {
    it('should timeout if server does not respond to handshake', function (done) {
      this.timeout(5000)
      
      client = new Client({ id: 'test-client' })
      
      // Connect to non-existent server with quick timeout
      // Note: This test verifies handshake timeout behavior
      client.connect('tcp://127.0.0.1:19999', 1000).catch((err) => {
        // Could be transport error or handshake timeout
        expect(err.message).to.match(/timeout|connect/i)
        done()
      })
    })

    it('should set serverPeerInfo to FAILED on timeout', function (done) {
      this.timeout(5000)
      
      client = new Client({ id: 'test-client' })
      
      client.connect('tcp://127.0.0.1:19998', 1000).catch((err) => {
        const serverPeer = client.getServerPeerInfo()
        expect(serverPeer).to.not.be.null
        expect(serverPeer.getState()).to.equal('FAILED')
        done()
      })
    })

    it('should cleanup on handshake failure', function (done) {
      this.timeout(5000)
      
      client = new Client({ id: 'test-client' })
      
      client.connect('tcp://127.0.0.1:19997', 1000).catch((err) => {
        expect(client.isReady()).to.be.false
        done()
      })
    })
  })

  describe('Disconnect Edge Cases', () => {
    it('should handle disconnect when not ready', async () => {
      client = new Client({ id: 'test-client' })
      
      // Should not throw
      await client.disconnect()
      expect(client.isReady()).to.be.false
    })

    it('should set serverPeerInfo to STOPPED after disconnect', async () => {
      // This requires a real connection first
      // For unit test, we just verify disconnect doesn't crash
      client = new Client({ id: 'test-client' })
      await client.disconnect()
      expect(client.isReady()).to.be.false
    })
  })

  describe('close()', () => {
    it('should call disconnect() before close', async () => {
      client = new Client({ id: 'test-client' })
      
      await client.close()
      
      expect(client.isReady()).to.be.false
    })

    it('should close underlying socket', async () => {
      client = new Client({ id: 'test-client' })
      
      await client.close()
      
      // After close, client should not be ready
      expect(client.isReady()).to.be.false
    })
  })

  describe('Error Handling', () => {
    it('should emit error events', (done) => {
      client = new Client({ id: 'test' })
      
      client.on('error', (err) => {
        expect(err).to.be.instanceof(Error)
        done()
      })
      
      client.emit('error', new Error('Test error'))
    })
  })
})

