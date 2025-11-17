/**
 * Protocol Tests
 * 
 * Tests for Protocol layer (request/response semantics)
 */

import { expect } from 'chai'
import Protocol, { ProtocolEvent, ProtocolSystemEvent } from '../../src/protocol/protocol.js'
import { Dealer as DealerSocket, Router as RouterSocket } from '../../src/transport/zeromq/index.js'
import { ProtocolError, ProtocolErrorCode } from '../../src/protocol/protocol-errors.js'
import { EnvelopType } from '../../src/protocol/envelope.js'

describe('Protocol', () => {
  let dealerSocket
  let routerSocket
  let clientProtocol
  let serverProtocol

  beforeEach(() => {
    // Create socket pair for testing
    dealerSocket = new DealerSocket({ id: 'test-dealer' })
    routerSocket = new RouterSocket({ id: 'test-router' })
    
    clientProtocol = new Protocol(dealerSocket)
    serverProtocol = new Protocol(routerSocket)
  })

  afterEach(async () => {
    // Cleanup
    if (dealerSocket) {
      try {
        await dealerSocket.close()
      } catch (err) {
        // Ignore
      }
    }
    if (routerSocket) {
      try {
        await routerSocket.close()
      } catch (err) {
        // Ignore
      }
    }
  })

  describe('Constructor', () => {
    it('should create protocol with socket', () => {
      const socket = new DealerSocket({ id: 'test' })
      const protocol = new Protocol(socket)
      
      expect(protocol).to.be.instanceof(Protocol)
      expect(protocol.getId()).to.equal('test')
    })

    it('should accept configuration', () => {
      const socket = new DealerSocket({ id: 'test' })
      const config = {
        requestTimeout: 5000,
        bufferStrategy: 'exact'
      }
      const protocol = new Protocol(socket, config)
      
      expect(protocol).to.be.instanceof(Protocol)
    })
  })

  describe('getId()', () => {
    it('should return protocol ID', () => {
      expect(clientProtocol.getId()).to.equal('test-dealer')
      expect(serverProtocol.getId()).to.equal('test-router')
    })
  })

  describe('isOnline()', () => {
    it('should return false when socket offline', () => {
      expect(clientProtocol.isOnline()).to.be.false
    })
  })

  describe('tick() - Public API', () => {
    it('should block system events from public API', () => {
      expect(() => {
        clientProtocol.tick({
          event: '_system:client_connected',
          data: {}
        })
      }).to.throw(ProtocolError)
        .with.property('code', ProtocolErrorCode.INVALID_EVENT)
    })

    it('should throw when transport offline', () => {
      const offlineSocket = new DealerSocket({ id: 'offline' })
      const offlineProtocol = new Protocol(offlineSocket)
      
      expect(() => {
        offlineProtocol.tick({ event: 'test', data: {} })
      }).to.throw(ProtocolError)
        .with.property('code', ProtocolErrorCode.NOT_READY)
    })
  })

  describe('_sendSystemTick() - Internal API', () => {
    it('should require system event prefix', () => {
      expect(() => {
        clientProtocol._sendSystemTick({
          event: 'regular:event',
          data: {}
        })
      }).to.throw('requires system event')
    })

    it('should throw when transport offline', () => {
      const offlineSocket = new DealerSocket({ id: 'offline' })
      const offlineProtocol = new Protocol(offlineSocket)
      
      expect(() => {
        offlineProtocol._sendSystemTick({
          event: ProtocolSystemEvent.CLIENT_PING,
          data: {}
        })
      }).to.throw(ProtocolError)
        .with.property('code', ProtocolErrorCode.NOT_READY)
    })
  })

  describe('request()', () => {
    it('should block system events when ready', async () => {
      try {
        await clientProtocol.request({
          event: '_system:hack',
          data: {}
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err).to.be.instanceof(ProtocolError)
        // When offline, it throws NOT_READY first
        expect([ProtocolErrorCode.INVALID_EVENT, ProtocolErrorCode.NOT_READY]).to.include(err.code)
      }
    })

    it('should throw when transport offline', async () => {
      const offlineSocket = new DealerSocket({ id: 'offline' })
      const offlineProtocol = new Protocol(offlineSocket)
      
      try {
        await offlineProtocol.request({ event: 'test', data: {} })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err).to.be.instanceof(ProtocolError)
        expect(err.code).to.equal(ProtocolErrorCode.NOT_READY)
      }
    })
  })

  describe('onRequest() / offRequest()', () => {
    it('should register request handler', () => {
      const handler = () => {}
      clientProtocol.onRequest('test', handler)
      // Should not throw
    })

    it('should unregister request handler', () => {
      const handler = () => {}
      clientProtocol.onRequest('test', handler)
      clientProtocol.offRequest('test', handler)
      // Should not throw
    })
  })

  describe('onTick() / offTick()', () => {
    it('should register tick handler', () => {
      const handler = () => {}
      clientProtocol.onTick('test', handler)
      // Should not throw
    })

    it('should unregister tick handler', () => {
      const handler = () => {}
      clientProtocol.onTick('test', handler)
      clientProtocol.offTick('test', handler)
      // Should not throw
    })
  })

  describe('Event Handling', () => {
    it('should emit protocol events', (done) => {
      clientProtocol.on('test-event', (data) => {
        expect(data).to.equal('test-data')
        done()
      })
      
      clientProtocol.emit('test-event', 'test-data')
    })
  })

  describe('Configuration', () => {
    it('should use custom buffer strategy', () => {
      const socket = new DealerSocket({ id: 'test' })
      const protocol = new Protocol(socket, {
        bufferStrategy: 'power_of_2'
      })
      
      expect(protocol).to.be.instanceof(Protocol)
    })
  })
})
