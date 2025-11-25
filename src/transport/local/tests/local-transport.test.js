/**
 * Tests for Local Transport - Factory & Integration
 * Testing: LocalTransport factory and Transport integration
 */

import { expect } from 'chai'
import { Transport } from '../../transport.js'
import { LocalTransport } from '../index.js'
import LocalClientSocket from '../client.js'
import LocalServerSocket from '../server.js'
import { TransportEvent } from '../../events.js'
import { getLocalRegistry } from '../client.js'

describe('Local Transport - Factory & Integration', () => {
  
  beforeEach(() => {
    // Clean up registry before each test
    const registry = getLocalRegistry()
    registry.clear()
  })

  afterEach(() => {
    // Reset transport to default after tests
    if (Transport.registry.has('zeromq')) {
      Transport.setDefault('zeromq')
    }
  })

  // ============================================================================
  // LocalTransport Export
  // ============================================================================

  describe('LocalTransport Export', () => {
    it('should export LocalTransport factory', () => {
      expect(LocalTransport).to.be.an('object')
      expect(LocalTransport).to.have.property('createClientSocket')
      expect(LocalTransport).to.have.property('createServerSocket')
    })

    it('should have factory methods', () => {
      expect(LocalTransport.createClientSocket).to.be.a('function')
      expect(LocalTransport.createServerSocket).to.be.a('function')
    })
  })

  // ============================================================================
  // createClientSocket()
  // ============================================================================

  describe('createClientSocket()', () => {
    it('should create client socket instance', () => {
      const client = LocalTransport.createClientSocket({
        id: 'local://test-client'
      })
      
      expect(client).to.be.instanceOf(LocalClientSocket)
      expect(client.getId()).to.equal('local://test-client')
      
      client.close()
    })

    it('should create client with auto-generated id', () => {
      const client = LocalTransport.createClientSocket()
      
      expect(client).to.be.instanceOf(LocalClientSocket)
      expect(client.getId()).to.be.a('string')
      expect(client.getId()).to.match(/^local-client/) // Auto-generated format
      
      client.close()
    })

    it('should pass config to socket', () => {
      const config = { RECONNECTION_TIMEOUT: 3000 }
      const client = LocalTransport.createClientSocket({
        id: 'local://test',
        config
      })
      
      expect(client).to.be.instanceOf(LocalClientSocket)
      
      client.close()
    })

    it('should create functional client socket', async () => {
      const server = LocalTransport.createServerSocket({
        id: 'local://test-server'
      })
      await server.bind('local://test-server')
      
      const client = LocalTransport.createClientSocket({
        id: 'local://test-client'
      })
      await client.connect('local://test-server')
      
      expect(client.isOnline()).to.be.true
      
      client.close()
      server.close()
    })
  })

  // ============================================================================
  // createServerSocket()
  // ============================================================================

  describe('createServerSocket()', () => {
    it('should create server socket instance', () => {
      const server = LocalTransport.createServerSocket({
        id: 'local://test-server'
      })
      
      expect(server).to.be.instanceOf(LocalServerSocket)
      expect(server.getId()).to.equal('local://test-server')
      
      server.close()
    })

    it('should create server with auto-generated id', () => {
      const server = LocalTransport.createServerSocket()
      
      expect(server).to.be.instanceOf(LocalServerSocket)
      expect(server.getId()).to.be.a('string')
      expect(server.getId()).to.match(/^local-server/) // Auto-generated format
      
      server.close()
    })

    it('should pass config to socket', () => {
      const config = { MAX_CLIENTS: 100 }
      const server = LocalTransport.createServerSocket({
        id: 'local://test',
        config
      })
      
      expect(server).to.be.instanceOf(LocalServerSocket)
      
      server.close()
    })

    it('should create functional server socket', async () => {
      const server = LocalTransport.createServerSocket({
        id: 'local://test-server'
      })
      await server.bind('local://test-server')
      
      expect(server.isOnline()).to.be.true
      
      server.close()
    })
  })

  // ============================================================================
  // Transport Registry Integration
  // ============================================================================

  describe('Transport Registry Integration', () => {
    it('should register with Transport', () => {
      Transport.register('local', LocalTransport)
      
      expect(Transport.registry.has('local')).to.be.true
    })

    it('should create client via Transport.createClientSocket()', () => {
      Transport.register('local', LocalTransport)
      Transport.setDefault('local')
      
      const client = Transport.createClientSocket({
        id: 'local://test-client'
      })
      
      expect(client).to.be.instanceOf(LocalClientSocket)
      
      client.close()
    })

    it('should create server via Transport.createServerSocket()', () => {
      Transport.register('local', LocalTransport)
      Transport.setDefault('local')
      
      const server = Transport.createServerSocket({
        id: 'local://test-server'
      })
      
      expect(server).to.be.instanceOf(LocalServerSocket)
      
      server.close()
    })

    it('should work as default transport', async () => {
      Transport.register('local', LocalTransport)
      Transport.setDefault('local')
      
      const server = Transport.createServerSocket({
        id: 'local://test-server'
      })
      await server.bind('local://test-server')
      
      const client = Transport.createClientSocket({
        id: 'local://test-client'
      })
      await client.connect('local://test-server')
      
      expect(server.isOnline()).to.be.true
      expect(client.isOnline()).to.be.true
      
      client.close()
      server.close()
    })
  })

  // ============================================================================
  // Integration: Full Communication
  // ============================================================================

  describe('Integration: Full Communication', () => {
    it('should support full request-response cycle via factory', async () => {
      Transport.register('local', LocalTransport)
      Transport.setDefault('local')
      
      const server = Transport.createServerSocket({
        id: 'local://echo-server'
      })
      
      const client = Transport.createClientSocket({
        id: 'local://echo-client'
      })
      
      await server.bind('local://echo-server')
      await client.connect('local://echo-server')
      
      return new Promise((resolve) => {
        // Server echoes
        server.on(TransportEvent.MESSAGE, ({ buffer, sender }) => {
          server.sendBuffer(buffer, sender)
        })
        
        // Client receives echo
        client.once(TransportEvent.MESSAGE, ({ buffer }) => {
          expect(buffer.toString()).to.equal('hello')
          client.close()
          server.close()
          resolve()
        })
        
        client.sendBuffer(Buffer.from('hello'))
      })
    })

    it('should handle multiple clients via factory', async () => {
      Transport.register('local', LocalTransport)
      Transport.setDefault('local')
      
      const server = Transport.createServerSocket({
        id: 'local://multi-server'
      })
      await server.bind('local://multi-server')
      
      const clients = []
      for (let i = 0; i < 5; i++) {
        const client = Transport.createClientSocket({
          id: `local://client${i}`
        })
        await client.connect('local://multi-server')
        clients.push(client)
      }
      
      expect(clients).to.have.length(5)
      clients.forEach(c => {
        expect(c.isOnline()).to.be.true
        c.close()
      })
      
      server.close()
    })
  })

  // ============================================================================
  // Transport Interface Compliance
  // ============================================================================

  describe('Transport Interface Compliance', () => {
    it('should emit standard TransportEvent.READY on connect', (done) => {
      const server = LocalTransport.createServerSocket({
        id: 'local://test-server'
      })
      server.bind('local://test-server')
      
      const client = LocalTransport.createClientSocket({
        id: 'local://test-client'
      })
      
      client.once(TransportEvent.READY, () => {
        client.close()
        server.close()
        done()
      })
      
      client.connect('local://test-server')
    })

    it('should emit standard TransportEvent.NOT_READY on disconnect', (done) => {
      const server = LocalTransport.createServerSocket({
        id: 'local://test-server'
      })
      server.bind('local://test-server')
      
      const client = LocalTransport.createClientSocket({
        id: 'local://test-client'
      })
      
      client.connect('local://test-server').then(() => {
        client.once(TransportEvent.NOT_READY, () => {
          client.close()
          server.close()
          done()
        })
        
        client.disconnect()
      })
    })

    it('should emit standard TransportEvent.MESSAGE with correct payload', (done) => {
      const server = LocalTransport.createServerSocket({
        id: 'local://test-server'
      })
      server.bind('local://test-server')
      
      const client = LocalTransport.createClientSocket({
        id: 'local://test-client'
      })
      client.connect('local://test-server')
      
      server.once(TransportEvent.MESSAGE, ({ buffer, sender }) => {
        expect(buffer).to.be.instanceOf(Buffer)
        expect(sender).to.be.a('string')
        expect(sender).to.equal('local://test-client')
        
        client.close()
        server.close()
        done()
      })
      
      setTimeout(() => {
        client.sendBuffer(Buffer.from('test'))
      }, 10)
    })
  })

  // ============================================================================
  // Performance via Factory
  // ============================================================================

  describe('Performance via Factory', () => {
    it('should handle rapid socket creation', () => {
      Transport.register('local', LocalTransport)
      Transport.setDefault('local')
      
      const sockets = []
      for (let i = 0; i < 100; i++) {
        const client = Transport.createClientSocket({
          id: `local://perf-client${i}`
        })
        sockets.push(client)
      }
      
      expect(sockets).to.have.length(100)
      sockets.forEach(s => {
        expect(s).to.be.instanceOf(LocalClientSocket)
        s.close()
      })
    })

    it('should handle rapid connect/disconnect cycles', async () => {
      Transport.register('local', LocalTransport)
      Transport.setDefault('local')
      
      const server = Transport.createServerSocket({
        id: 'local://cycle-server'
      })
      await server.bind('local://cycle-server')
      
      for (let i = 0; i < 10; i++) {
        const client = Transport.createClientSocket({
          id: `local://cycle-client${i}`
        })
        
        await client.connect('local://cycle-server')
        expect(client.isOnline()).to.be.true
        
        await client.disconnect()
        expect(client.isOnline()).to.be.false
        
        client.close()
      }
      
      server.close()
    })
  })
})

