/**
 * Transport Abstraction Tests
 * 
 * Tests for Transport factory, registry, and plugin system
 */

import { expect } from 'chai'
import { Transport } from '../src/transport/transport.js'
import { ZeroMQTransport } from '../src/transport/zeromq/zeromq-transport.js'
import { Dealer, Router } from '../src/transport/zeromq/index.js'

describe('Transport Factory & Registry', () => {
  
  // ============================================================================
  // SETUP & CLEANUP
  // ============================================================================
  
  let originalRegistry
  let originalDefault
  
  beforeEach(() => {
    // Save original state
    originalRegistry = new Map(Transport.registry)
    originalDefault = Transport.defaultTransport
  })
  
  afterEach(() => {
    // Restore original state
    Transport.registry = originalRegistry
    Transport.defaultTransport = originalDefault
  })
  
  // ============================================================================
  // REGISTRATION
  // ============================================================================
  
  describe('Transport Registration', () => {
    
    it('should register a transport implementation', () => {
      const mockTransport = {
        createClientSocket: () => {},
        createServerSocket: () => {}
      }
      
      Transport.register('mock', mockTransport)
      
      expect(Transport.registry.has('mock')).to.be.true
      expect(Transport.registry.get('mock')).to.equal(mockTransport)
    })
    
    it('should register ZeroMQ transport by default', () => {
      expect(Transport.registry.has('zeromq')).to.be.true
      expect(Transport.registry.get('zeromq')).to.equal(ZeroMQTransport)
    })
    
    it('should throw error if name is not a string', () => {
      const mockTransport = {
        createClientSocket: () => {},
        createServerSocket: () => {}
      }
      
      expect(() => Transport.register(null, mockTransport)).to.throw('Transport name must be a non-empty string')
      expect(() => Transport.register(123, mockTransport)).to.throw('Transport name must be a non-empty string')
      expect(() => Transport.register('', mockTransport)).to.throw('Transport name must be a non-empty string')
    })
    
    it('should throw error if implementation is missing', () => {
      expect(() => Transport.register('test', null)).to.throw('Transport implementation is required')
      expect(() => Transport.register('test', undefined)).to.throw('Transport implementation is required')
    })
    
    it('should throw error if createClientSocket is missing', () => {
      const badTransport = {
        createServerSocket: () => {}
      }
      
      expect(() => Transport.register('bad', badTransport))
        .to.throw('Transport implementation must have createClientSocket method')
    })
    
    it('should throw error if createServerSocket is missing', () => {
      const badTransport = {
        createClientSocket: () => {}
      }
      
      expect(() => Transport.register('bad', badTransport))
        .to.throw('Transport implementation must have createServerSocket method')
    })
    
    it('should accept class-based transport implementation', () => {
      class MyTransport {
        static createClientSocket() {}
        static createServerSocket() {}
      }
      
      expect(() => Transport.register('myclass', MyTransport)).to.not.throw()
      expect(Transport.registry.get('myclass')).to.equal(MyTransport)
    })
    
    it('should accept object-based transport implementation', () => {
      const myTransport = {
        createClientSocket: () => {},
        createServerSocket: () => {}
      }
      
      expect(() => Transport.register('myobj', myTransport)).to.not.throw()
      expect(Transport.registry.get('myobj')).to.equal(myTransport)
    })
  })
  
  // ============================================================================
  // DEFAULT TRANSPORT
  // ============================================================================
  
  describe('Default Transport', () => {
    
    it('should have zeromq as default', () => {
      expect(Transport.getDefault()).to.equal('zeromq')
      expect(Transport.defaultTransport).to.equal('zeromq')
    })
    
    it('should set default transport', () => {
      const mockTransport = {
        createClientSocket: () => {},
        createServerSocket: () => {}
      }
      
      Transport.register('custom', mockTransport)
      Transport.setDefault('custom')
      
      expect(Transport.getDefault()).to.equal('custom')
    })
    
    it('should throw error when setting unregistered transport as default', () => {
      expect(() => Transport.setDefault('nonexistent'))
        .to.throw("Transport 'nonexistent' is not registered")
    })
    
    it('should list registered transports in error message', () => {
      try {
        Transport.setDefault('missing')
      } catch (err) {
        expect(err.message).to.include('zeromq')
        expect(err.message).to.include('Available:')
      }
    })
  })
  
  // ============================================================================
  // FACTORY METHODS
  // ============================================================================
  
  describe('Factory Methods', () => {
    
    it('should create client socket using default transport', () => {
      const socket = Transport.createClientSocket({ id: 'test-client' })
      
      expect(socket).to.be.instanceOf(Dealer)
      expect(socket.getId()).to.equal('test-client')
    })
    
    it('should create server socket using default transport', () => {
      const socket = Transport.createServerSocket({ id: 'test-server' })
      
      expect(socket).to.be.instanceOf(Router)
      expect(socket.getId()).to.equal('test-server')
    })
    
    it('should create socket with custom transport', () => {
      let clientCreated = false
      let serverCreated = false
      
      const mockTransport = {
        createClientSocket: (config) => {
          clientCreated = true
          return { type: 'mock-client', ...config }
        },
        createServerSocket: (config) => {
          serverCreated = true
          return { type: 'mock-server', ...config }
        }
      }
      
      Transport.register('mock', mockTransport)
      Transport.setDefault('mock')
      
      const client = Transport.createClientSocket({ id: 'client1' })
      const server = Transport.createServerSocket({ id: 'server1' })
      
      expect(clientCreated).to.be.true
      expect(serverCreated).to.be.true
      expect(client.type).to.equal('mock-client')
      expect(server.type).to.equal('mock-server')
    })
    
    it('should pass configuration to socket factory', () => {
      let receivedConfig = null
      
      const mockTransport = {
        createClientSocket: (config) => {
          receivedConfig = config
          return { id: config.id }
        },
        createServerSocket: () => ({ id: 'server' })
      }
      
      Transport.register('mock', mockTransport)
      Transport.setDefault('mock')
      
      const config = { 
        id: 'test-id',
        config: { 
          timeout: 5000,
          debug: true 
        }
      }
      
      Transport.createClientSocket(config)
      
      expect(receivedConfig).to.deep.equal(config)
    })
    
    it('should throw error if default transport is not registered', () => {
      // Clear registry
      Transport.registry.clear()
      Transport.defaultTransport = 'missing'
      
      expect(() => Transport.createClientSocket({ id: 'test' }))
        .to.throw("Default transport 'missing' is not registered")
      
      expect(() => Transport.createServerSocket({ id: 'test' }))
        .to.throw("Default transport 'missing' is not registered")
    })
  })
  
  // ============================================================================
  // TRANSPORT USAGE
  // ============================================================================
  
  describe('Transport Usage', () => {
    
    it('should get transport implementation by name', () => {
      const transport = Transport.use('zeromq')
      
      expect(transport).to.equal(ZeroMQTransport)
      expect(typeof transport.createClientSocket).to.equal('function')
      expect(typeof transport.createServerSocket).to.equal('function')
    })
    
    it('should throw error when getting unregistered transport', () => {
      expect(() => Transport.use('nonexistent'))
        .to.throw("Transport 'nonexistent' is not registered")
    })
    
    it('should list available transports in error message', () => {
      try {
        Transport.use('missing')
      } catch (err) {
        expect(err.message).to.include('Available:')
        expect(err.message).to.include('zeromq')
      }
    })
  })
  
  // ============================================================================
  // REGISTRY MANAGEMENT
  // ============================================================================
  
  describe('Registry Management', () => {
    
    it('should list registered transport names', () => {
      const registered = Transport.getRegistered()
      
      expect(registered).to.be.an('array')
      expect(registered).to.include('zeromq')
    })
    
    it('should update registered list when adding transports', () => {
      const mockTransport = {
        createClientSocket: () => {},
        createServerSocket: () => {}
      }
      
      const before = Transport.getRegistered()
      Transport.register('custom', mockTransport)
      const after = Transport.getRegistered()
      
      expect(after.length).to.equal(before.length + 1)
      expect(after).to.include('custom')
    })
    
    it('should allow overwriting existing transport', () => {
      const transport1 = {
        createClientSocket: () => ({ version: 1 }),
        createServerSocket: () => ({ version: 1 })
      }
      
      const transport2 = {
        createClientSocket: () => ({ version: 2 }),
        createServerSocket: () => ({ version: 2 })
      }
      
      Transport.register('test', transport1)
      Transport.register('test', transport2)
      Transport.setDefault('test')
      
      const socket = Transport.createClientSocket({})
      expect(socket.version).to.equal(2)
    })
  })
  
  // ============================================================================
  // ZEROMQ TRANSPORT INTEGRATION
  // ============================================================================
  
  describe('ZeroMQ Transport Integration', () => {
    
    it('should create functional Dealer socket', async () => {
      const socket = Transport.createClientSocket({ 
        id: 'dealer-test',
        config: {}
      })
      
      expect(socket).to.be.instanceOf(Dealer)
      expect(socket.getId()).to.equal('dealer-test')
      expect(typeof socket.connect).to.equal('function')
      expect(typeof socket.disconnect).to.equal('function')
      expect(typeof socket.sendBuffer).to.equal('function')
      
      await socket.close()
    })
    
    it('should create functional Router socket', async () => {
      const socket = Transport.createServerSocket({ 
        id: 'router-test',
        config: {}
      })
      
      expect(socket).to.be.instanceOf(Router)
      expect(socket.getId()).to.equal('router-test')
      expect(typeof socket.bind).to.equal('function')
      expect(typeof socket.unbind).to.equal('function')
      expect(typeof socket.sendBuffer).to.equal('function')
      
      await socket.close()
    })
    
    it('should pass config to ZeroMQ sockets', async () => {
      const config = {
        RECONNECT_INTERVAL_MS: 100,
        RECONNECT_MAX_INTERVAL_MS: 500
      }
      
      const socket = Transport.createClientSocket({ 
        id: 'config-test',
        config 
      })
      
      expect(socket).to.be.instanceOf(Dealer)
      
      await socket.close()
    })
  })
  
  // ============================================================================
  // MULTIPLE TRANSPORT SCENARIO
  // ============================================================================
  
  describe('Multiple Transport Scenario', () => {
    
    it('should support multiple registered transports', () => {
      const transport1 = {
        createClientSocket: () => ({ type: 'transport1' }),
        createServerSocket: () => ({ type: 'transport1' })
      }
      
      const transport2 = {
        createClientSocket: () => ({ type: 'transport2' }),
        createServerSocket: () => ({ type: 'transport2' })
      }
      
      Transport.register('t1', transport1)
      Transport.register('t2', transport2)
      
      expect(Transport.getRegistered()).to.include('zeromq')
      expect(Transport.getRegistered()).to.include('t1')
      expect(Transport.getRegistered()).to.include('t2')
    })
    
    it('should switch between transports', () => {
      const transport1 = {
        createClientSocket: () => ({ type: 'type1' }),
        createServerSocket: () => ({ type: 'type1' })
      }
      
      const transport2 = {
        createClientSocket: () => ({ type: 'type2' }),
        createServerSocket: () => ({ type: 'type2' })
      }
      
      Transport.register('t1', transport1)
      Transport.register('t2', transport2)
      
      Transport.setDefault('t1')
      let socket = Transport.createClientSocket({})
      expect(socket.type).to.equal('type1')
      
      Transport.setDefault('t2')
      socket = Transport.createClientSocket({})
      expect(socket.type).to.equal('type2')
      
      Transport.setDefault('zeromq')
      socket = Transport.createClientSocket({ id: 'zmq-test' })
      expect(socket).to.be.instanceOf(Dealer)
      
      socket.close()
    })
  })
})

