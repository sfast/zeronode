/**
 * Protocol Configuration Tests
 * Testing pure functions - no mocking needed
 */

import { expect } from 'chai'
import {
  ProtocolConfigDefaults,
  ProtocolEvent,
  ProtocolSystemEvent,
  mergeProtocolConfig,
  validateEventName,
  isSystemEvent
} from '../../src/protocol/config.js'

describe('Protocol Configuration', () => {
  
  // ==========================================================================
  // CONSTANTS
  // ==========================================================================
  
  describe('ProtocolConfigDefaults', () => {
    it('should export PROTOCOL_REQUEST_TIMEOUT', () => {
      expect(ProtocolConfigDefaults.PROTOCOL_REQUEST_TIMEOUT).to.equal(10000)
    })
    
    it('should export INFINITY constant', () => {
      expect(ProtocolConfigDefaults.INFINITY).to.equal(-1)
    })
  })
  
  describe('ProtocolEvent', () => {
    it('should define TRANSPORT_READY', () => {
      expect(ProtocolEvent.TRANSPORT_READY).to.equal('protocol:transport_ready')
    })
    
    it('should define TRANSPORT_NOT_READY', () => {
      expect(ProtocolEvent.TRANSPORT_NOT_READY).to.equal('protocol:transport_not_ready')
    })
    
    it('should define TRANSPORT_CLOSED', () => {
      expect(ProtocolEvent.TRANSPORT_CLOSED).to.equal('protocol:transport_closed')
    })
    
    it('should define ERROR', () => {
      expect(ProtocolEvent.ERROR).to.equal('protocol:error')
    })
  })
  
  describe('ProtocolSystemEvent', () => {
    it('should define HANDSHAKE_INIT_FROM_CLIENT', () => {
      expect(ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT)
        .to.equal('_system:handshake_init_from_client')
    })
    
    it('should define HANDSHAKE_ACK_FROM_SERVER', () => {
      expect(ProtocolSystemEvent.HANDSHAKE_ACK_FROM_SERVER)
        .to.equal('_system:handshake_ack_from_server')
    })
    
    it('should define CLIENT_PING', () => {
      expect(ProtocolSystemEvent.CLIENT_PING).to.equal('_system:client_ping')
    })
    
    it('should define CLIENT_STOP', () => {
      expect(ProtocolSystemEvent.CLIENT_STOP).to.equal('_system:client_stop')
    })
    
    it('should define SERVER_STOP', () => {
      expect(ProtocolSystemEvent.SERVER_STOP).to.equal('_system:server_stop')
    })
    
    it('should use _system: prefix for all events', () => {
      const events = Object.values(ProtocolSystemEvent)
      events.forEach(event => {
        expect(event).to.match(/^_system:/)
      })
    })
  })
  
  // ==========================================================================
  // MERGE CONFIGURATION
  // ==========================================================================
  
  describe('mergeProtocolConfig()', () => {
    it('should return defaults when no config provided', () => {
      const config = mergeProtocolConfig()
      
      expect(config).to.have.property('BUFFER_STRATEGY')
      expect(config).to.have.property('PROTOCOL_REQUEST_TIMEOUT')
      expect(config.DEBUG).to.be.false
    })
    
    it('should return defaults with empty config', () => {
      const config = mergeProtocolConfig({})
      
      expect(config).to.have.property('BUFFER_STRATEGY')
      expect(config).to.have.property('PROTOCOL_REQUEST_TIMEOUT')
      expect(config.DEBUG).to.be.false
    })
    
    it('should override DEBUG flag', () => {
      const config = mergeProtocolConfig({ DEBUG: true })
      
      expect(config.DEBUG).to.be.true
    })
    
    it('should override BUFFER_STRATEGY', () => {
      const config = mergeProtocolConfig({ BUFFER_STRATEGY: 'json' })
      
      expect(config.BUFFER_STRATEGY).to.equal('json')
    })
    
    it('should override PROTOCOL_REQUEST_TIMEOUT', () => {
      const config = mergeProtocolConfig({ PROTOCOL_REQUEST_TIMEOUT: 5000 })
      
      expect(config.PROTOCOL_REQUEST_TIMEOUT).to.equal(5000)
    })
    
    it('should merge multiple overrides', () => {
      const config = mergeProtocolConfig({
        DEBUG: true,
        BUFFER_STRATEGY: 'json',
        PROTOCOL_REQUEST_TIMEOUT: 3000
      })
      
      expect(config.DEBUG).to.be.true
      expect(config.BUFFER_STRATEGY).to.equal('json')
      expect(config.PROTOCOL_REQUEST_TIMEOUT).to.equal(3000)
    })
    
    it('should preserve all user config keys', () => {
      const config = mergeProtocolConfig({
        DEBUG: true,
        CUSTOM_KEY: 'should be preserved',
        PING_INTERVAL: 5000
      })
      
      expect(config).to.have.property('CUSTOM_KEY', 'should be preserved')
      expect(config).to.have.property('PING_INTERVAL', 5000)
      expect(config.DEBUG).to.be.true
    })
    
    it('should be a pure function (no side effects)', () => {
      const input = { DEBUG: true }
      mergeProtocolConfig(input)
      
      // Input should not be mutated
      expect(input).to.deep.equal({ DEBUG: true })
    })
  })
  
  // ==========================================================================
  // EVENT NAME VALIDATION
  // ==========================================================================
  
  describe('validateEventName()', () => {
    it('should allow normal event names', () => {
      expect(() => validateEventName('user:login')).to.not.throw()
      expect(() => validateEventName('system:update')).to.not.throw()
      expect(() => validateEventName('app:notification')).to.not.throw()
    })
    
    it('should block system events by default', () => {
      expect(() => validateEventName('_system:ping'))
        .to.throw('Cannot send system event')
    })
    
    it('should allow system events when explicitly flagged', () => {
      expect(() => validateEventName('_system:ping', true)).to.not.throw()
      expect(() => validateEventName('_system:handshake', true)).to.not.throw()
    })
    
    it('should return true for valid events', () => {
      const result = validateEventName('user:login')
      expect(result).to.be.true
    })
    
    it('should throw descriptive error for system events', () => {
      try {
        validateEventName('_system:ping')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err.message).to.include('_system:ping')
        expect(err.message).to.include('reserved')
      }
    })
    
    it('should handle edge cases', () => {
      expect(() => validateEventName('_system_without_colon')).to.not.throw()
      expect(() => validateEventName('prefix_system:event')).to.not.throw()
      expect(() => validateEventName('user:_system')).to.not.throw()
    })
  })
  
  // ==========================================================================
  // SYSTEM EVENT CHECK
  // ==========================================================================
  
  describe('isSystemEvent()', () => {
    it('should return true for system events', () => {
      expect(isSystemEvent('_system:ping')).to.be.true
      expect(isSystemEvent('_system:handshake')).to.be.true
      expect(isSystemEvent('_system:anything')).to.be.true
    })
    
    it('should return false for normal events', () => {
      expect(isSystemEvent('user:login')).to.be.false
      expect(isSystemEvent('app:notification')).to.be.false
      expect(isSystemEvent('system:update')).to.be.false
    })
    
    it('should return false for non-string values', () => {
      expect(isSystemEvent(null)).to.be.false
      expect(isSystemEvent(undefined)).to.be.false
      expect(isSystemEvent(123)).to.be.false
      expect(isSystemEvent({})).to.be.false
    })
    
    it('should handle edge cases', () => {
      expect(isSystemEvent('_system')).to.be.false
      expect(isSystemEvent('_system_')).to.be.false
      expect(isSystemEvent('prefix_system:event')).to.be.false
    })
    
    it('should be case-sensitive', () => {
      expect(isSystemEvent('_SYSTEM:PING')).to.be.false
      expect(isSystemEvent('_System:ping')).to.be.false
    })
  })
})

