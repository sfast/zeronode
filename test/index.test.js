/**
 * Public API Tests (index.js)
 * 
 * Smoke tests to ensure all public exports are available and correct.
 * This verifies the package's main entry point is working.
 */

import { expect } from 'chai'
import zeronode, {
  // Core
  Node,
  Server,
  Client,
  
  // Events
  NodeEvent,
  ServerEvent,
  ClientEvent,
  ProtocolEvent,
  ProtocolSystemEvent,
  TransportEvent,
  
  // Errors
  NodeError,
  NodeErrorCode,
  ProtocolError,
  ProtocolErrorCode,
  TransportError,
  TransportErrorCode,
  
  // Utils
  optionsPredicateBuilder
} from '../src/index.js'

describe('Public API (index.js)', () => {
  
  // ==========================================================================
  // CORE CLASSES
  // ==========================================================================
  
  describe('Core Classes', () => {
    it('should export Node as default export', () => {
      expect(zeronode).to.equal(Node)
      expect(zeronode).to.be.a('function')
    })

    it('should export Node class', () => {
      expect(Node).to.be.a('function')
      expect(Node.name).to.equal('Node')
    })

    it('should export Server class', () => {
      expect(Server).to.be.a('function')
      expect(Server.name).to.equal('Server')
    })

    it('should export Client class', () => {
      expect(Client).to.be.a('function')
      expect(Client.name).to.equal('Client')
    })

    it('should allow creating Node instances', () => {
      const node = new Node({ id: 'test-node' })
      expect(node).to.be.instanceof(Node)
      expect(node.getId()).to.equal('test-node')
    })
  })
  
  // ==========================================================================
  // EVENTS
  // ==========================================================================
  
  describe('Event Objects', () => {
    it('should export NodeEvent', () => {
      expect(NodeEvent).to.be.an('object')
      expect(NodeEvent.READY).to.be.a('string')
      expect(NodeEvent.PEER_JOINED).to.be.a('string')
      expect(NodeEvent.PEER_LEFT).to.be.a('string')
      expect(NodeEvent.STOPPED).to.be.a('string')
    })

    it('should export ServerEvent', () => {
      expect(ServerEvent).to.be.an('object')
      expect(ServerEvent.READY).to.be.a('string')
      expect(ServerEvent.CLIENT_JOINED).to.be.a('string')
      expect(ServerEvent.CLIENT_LEFT).to.be.a('string')
    })

    it('should export ClientEvent', () => {
      expect(ClientEvent).to.be.an('object')
      expect(ClientEvent.READY).to.be.a('string')
      expect(ClientEvent.DISCONNECTED).to.be.a('string')
      expect(ClientEvent.FAILED).to.be.a('string')
      expect(ClientEvent.STOPPED).to.be.a('string')
    })

    it('should export ProtocolEvent', () => {
      expect(ProtocolEvent).to.be.an('object')
      expect(ProtocolEvent.TRANSPORT_READY).to.be.a('string')
      expect(ProtocolEvent.TRANSPORT_NOT_READY).to.be.a('string')
      expect(ProtocolEvent.TRANSPORT_CLOSED).to.be.a('string')
    })

    it('should export ProtocolSystemEvent', () => {
      expect(ProtocolSystemEvent).to.be.an('object')
    expect(ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT).to.be.a('string')
    expect(ProtocolSystemEvent.HANDSHAKE_ACK_FROM_SERVER).to.be.a('string')
      expect(ProtocolSystemEvent.CLIENT_PING).to.be.a('string')
    })

    it('should export TransportEvent', () => {
      expect(TransportEvent).to.be.an('object')
      expect(TransportEvent.READY).to.be.a('string')
      expect(TransportEvent.MESSAGE).to.be.a('string')
      expect(TransportEvent.CLOSED).to.be.a('string')
    })

    it('should have properly namespaced event names', () => {
      expect(NodeEvent.READY).to.include('node:')
      expect(ServerEvent.READY).to.include('server:')
      expect(ClientEvent.READY).to.include('client:')
      expect(ProtocolEvent.TRANSPORT_READY).to.include('protocol:')
      expect(TransportEvent.READY).to.include('transport:')
    })
  })
  
  // ==========================================================================
  // ERRORS
  // ==========================================================================
  
  describe('Error Classes & Codes', () => {
    it('should export NodeError class', () => {
      expect(NodeError).to.be.a('function')
      expect(NodeError.name).to.equal('NodeError')
    })

    it('should export NodeErrorCode', () => {
      expect(NodeErrorCode).to.be.an('object')
      expect(NodeErrorCode.NO_NODES_MATCH_FILTER).to.be.a('string')
    })

    it('should create NodeError instances', () => {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'Test error'
      })
      expect(error).to.be.instanceof(NodeError)
      expect(error).to.be.instanceof(Error)
      expect(error.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
    })

    it('should export ProtocolError class', () => {
      expect(ProtocolError).to.be.a('function')
      expect(ProtocolError.name).to.equal('ProtocolError')
    })

    it('should export ProtocolErrorCode', () => {
      expect(ProtocolErrorCode).to.be.an('object')
      expect(ProtocolErrorCode.REQUEST_TIMEOUT).to.be.a('string')
    })

    it('should export TransportError class', () => {
      expect(TransportError).to.be.a('function')
      expect(TransportError.name).to.equal('TransportError')
    })

    it('should export TransportErrorCode', () => {
      expect(TransportErrorCode).to.be.an('object')
      expect(TransportErrorCode.ALREADY_CONNECTED).to.be.a('string')
      expect(TransportErrorCode.SEND_FAILED).to.be.a('string')
    })

    it('should have error codes as strings', () => {
      expect(NodeErrorCode.NO_NODES_MATCH_FILTER).to.be.a('string')
      expect(ProtocolErrorCode.REQUEST_TIMEOUT).to.be.a('string')
      expect(TransportErrorCode.SEND_FAILED).to.be.a('string')
    })
  })
  
  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  
  describe('Utility Functions', () => {
    it('should export optionsPredicateBuilder', () => {
      expect(optionsPredicateBuilder).to.be.a('function')
    })

    it('should create predicates for filtering', () => {
      const predicate = optionsPredicateBuilder({ role: 'worker' })
      
      expect(predicate).to.be.a('function')
      expect(predicate({ role: 'worker' })).to.be.true
      expect(predicate({ role: 'master' })).to.be.false
    })

    it('should handle complex filter queries', () => {
      const predicate = optionsPredicateBuilder({ 
        priority: { $gt: 5 },
        status: 'active'
      })
      
      expect(predicate({ priority: 10, status: 'active' })).to.be.true
      expect(predicate({ priority: 3, status: 'active' })).to.be.false
    })
  })
  
  // ==========================================================================
  // INTEGRATION
  // ==========================================================================
  
  describe('Integration Smoke Test', () => {
    it('should create a working Node instance', async () => {
      const node = new Node({ id: 'smoke-test' })
      
      expect(node).to.be.instanceof(Node)
      expect(node.getId()).to.equal('smoke-test')
      
      await node.stop()
    })

    it('should create a working Server instance', async () => {
      const server = new Server({ id: 'smoke-server' })
      
      expect(server).to.be.instanceof(Server)
      expect(server.getId()).to.equal('smoke-server')
      
      // Don't bind - just verify instance creation
    })

    it('should create a working Client instance', () => {
      const client = new Client({ id: 'smoke-client' })
      
      expect(client).to.be.instanceof(Client)
      expect(client.getId()).to.equal('smoke-client')
    })
  })
  
  // ==========================================================================
  // BACKWARD COMPATIBILITY VERIFICATION
  // ==========================================================================
  
  describe('API Stability', () => {
    it('should maintain stable event names', () => {
      // These event names should never change (breaking change)
      expect(NodeEvent.READY).to.equal('node:ready')
      expect(ServerEvent.READY).to.equal('server:ready')
      expect(ClientEvent.READY).to.equal('client:ready')
    })

    it('should maintain stable error codes', () => {
      // Error codes should be stable
      expect(NodeErrorCode.NO_NODES_MATCH_FILTER).to.equal('NO_NODES_MATCH_FILTER')
      expect(TransportErrorCode.SEND_FAILED).to.equal('TRANSPORT_SEND_FAILED')
    })
  })
})

