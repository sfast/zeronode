/**
 * Tests for ZeroMQ Configuration Module
 * Testing: config validation, merging, and factory functions
 */

import { expect } from 'chai'
import {
  TIMEOUT_INFINITY,
  ZMQConfigDefaults,
  mergeConfig,
  createDealerConfig,
  createRouterConfig,
  validateConfig
} from '../config.js'

describe('ZMQ Configuration Module', () => {
  
  // ============================================================================
  // CONSTANTS
  // ============================================================================
  
  describe('TIMEOUT_INFINITY', () => {
    it('should be -1', () => {
      expect(TIMEOUT_INFINITY).to.equal(-1)
    })
  })

  describe('ZMQConfigDefaults', () => {
    it('should have all required properties', () => {
      expect(ZMQConfigDefaults).to.have.property('DEALER_IO_THREADS')
      expect(ZMQConfigDefaults).to.have.property('ROUTER_IO_THREADS')
      expect(ZMQConfigDefaults).to.have.property('DEBUG')
      expect(ZMQConfigDefaults).to.have.property('ZMQ_LINGER')
      expect(ZMQConfigDefaults).to.have.property('ZMQ_SNDHWM')
      expect(ZMQConfigDefaults).to.have.property('ZMQ_RCVHWM')
      expect(ZMQConfigDefaults).to.have.property('ZMQ_RECONNECT_IVL')
      expect(ZMQConfigDefaults).to.have.property('ZMQ_RECONNECT_IVL_MAX')
      expect(ZMQConfigDefaults).to.have.property('CONNECTION_TIMEOUT')
      expect(ZMQConfigDefaults).to.have.property('RECONNECTION_TIMEOUT')
    })

    it('should have sensible default values', () => {
      expect(ZMQConfigDefaults.DEALER_IO_THREADS).to.equal(1)
      expect(ZMQConfigDefaults.ROUTER_IO_THREADS).to.equal(2)  // Router uses 2 threads by default
      expect(ZMQConfigDefaults.DEBUG).to.equal(false)
      expect(ZMQConfigDefaults.ZMQ_LINGER).to.equal(0)
      expect(ZMQConfigDefaults.ZMQ_SNDHWM).to.equal(10000)
      expect(ZMQConfigDefaults.ZMQ_RCVHWM).to.equal(10000)
    })
  })

  // ============================================================================
  // mergeConfig()
  // ============================================================================

  describe('mergeConfig()', () => {
    it('should return defaults when no user config provided', () => {
      const config = mergeConfig()
      expect(config).to.deep.equal(ZMQConfigDefaults)
    })

    it('should return defaults when empty object provided', () => {
      const config = mergeConfig({})
      expect(config).to.deep.equal(ZMQConfigDefaults)
    })

    it('should merge user config with defaults', () => {
      const userConfig = {
        DEALER_IO_THREADS: 4,
        DEBUG: true
      }
      const config = mergeConfig(userConfig)
      
      expect(config.DEALER_IO_THREADS).to.equal(4)
      expect(config.DEBUG).to.equal(true)
      expect(config.ROUTER_IO_THREADS).to.equal(ZMQConfigDefaults.ROUTER_IO_THREADS)
    })

    it('should override defaults with user values', () => {
      const userConfig = {
        ZMQ_LINGER: 5000,
        ZMQ_SNDHWM: 2000,
        CONNECTION_TIMEOUT: 10000
      }
      const config = mergeConfig(userConfig)
      
      expect(config.ZMQ_LINGER).to.equal(5000)
      expect(config.ZMQ_SNDHWM).to.equal(2000)
      expect(config.CONNECTION_TIMEOUT).to.equal(10000)
    })

    it('should not mutate the original defaults', () => {
      const originalDefaults = { ...ZMQConfigDefaults }
      mergeConfig({ DEALER_IO_THREADS: 8 })
      
      expect(ZMQConfigDefaults).to.deep.equal(originalDefaults)
    })

    it('should not validate by default', () => {
      // Should not throw even with invalid config
      expect(() => {
        mergeConfig({ DEALER_IO_THREADS: 999 })
      }).to.not.throw()
    })

    it('should validate when validate=true', () => {
      expect(() => {
        mergeConfig({ DEALER_IO_THREADS: 999 }, true)
      }).to.throw(/Invalid DEALER_IO_THREADS/)
    })

    it('should pass validation with valid config', () => {
      expect(() => {
        mergeConfig({ DEALER_IO_THREADS: 4, DEBUG: true }, true)
      }).to.not.throw()
    })
  })

  // ============================================================================
  // createDealerConfig()
  // ============================================================================

  describe('createDealerConfig()', () => {
    it('should create dealer config with defaults', () => {
      const config = createDealerConfig()
      expect(config).to.deep.equal(ZMQConfigDefaults)
    })

    it('should merge user config', () => {
      const userConfig = { DEALER_IO_THREADS: 2, DEBUG: true }
      const config = createDealerConfig(userConfig)
      
      expect(config.DEALER_IO_THREADS).to.equal(2)
      expect(config.DEBUG).to.equal(true)
    })

    it('should return a new object each time', () => {
      const config1 = createDealerConfig()
      const config2 = createDealerConfig()
      
      expect(config1).to.not.equal(config2)
      expect(config1).to.deep.equal(config2)
    })
  })

  // ============================================================================
  // createRouterConfig()
  // ============================================================================

  describe('createRouterConfig()', () => {
    it('should create router config with defaults', () => {
      const config = createRouterConfig()
      expect(config).to.deep.equal(ZMQConfigDefaults)
    })

    it('should merge user config', () => {
      const userConfig = { ROUTER_IO_THREADS: 3, ZMQ_SNDHWM: 5000 }
      const config = createRouterConfig(userConfig)
      
      expect(config.ROUTER_IO_THREADS).to.equal(3)
      expect(config.ZMQ_SNDHWM).to.equal(5000)
    })

    it('should return a new object each time', () => {
      const config1 = createRouterConfig()
      const config2 = createRouterConfig()
      
      expect(config1).to.not.equal(config2)
      expect(config1).to.deep.equal(config2)
    })
  })

  // ============================================================================
  // validateConfig() - DEALER_IO_THREADS
  // ============================================================================

  describe('validateConfig() - DEALER_IO_THREADS', () => {
    it('should accept valid DEALER_IO_THREADS (1-16)', () => {
      expect(() => validateConfig({ DEALER_IO_THREADS: 1 })).to.not.throw()
      expect(() => validateConfig({ DEALER_IO_THREADS: 8 })).to.not.throw()
      expect(() => validateConfig({ DEALER_IO_THREADS: 16 })).to.not.throw()
    })

    it('should reject DEALER_IO_THREADS < 1', () => {
      expect(() => validateConfig({ DEALER_IO_THREADS: 0 }))
        .to.throw(/Invalid DEALER_IO_THREADS.*Must be integer between 1 and 16/)
      
      expect(() => validateConfig({ DEALER_IO_THREADS: -1 }))
        .to.throw(/Invalid DEALER_IO_THREADS/)
    })

    it('should reject DEALER_IO_THREADS > 16', () => {
      expect(() => validateConfig({ DEALER_IO_THREADS: 17 }))
        .to.throw(/Invalid DEALER_IO_THREADS.*Must be integer between 1 and 16/)
      
      expect(() => validateConfig({ DEALER_IO_THREADS: 100 }))
        .to.throw(/Invalid DEALER_IO_THREADS/)
    })

    it('should reject non-integer DEALER_IO_THREADS', () => {
      expect(() => validateConfig({ DEALER_IO_THREADS: 2.5 }))
        .to.throw(/Invalid DEALER_IO_THREADS/)
      
      expect(() => validateConfig({ DEALER_IO_THREADS: '4' }))
        .to.throw(/Invalid DEALER_IO_THREADS/)
    })

    it('should allow undefined DEALER_IO_THREADS', () => {
      expect(() => validateConfig({ DEALER_IO_THREADS: undefined })).to.not.throw()
      expect(() => validateConfig({})).to.not.throw()
    })
  })

  // ============================================================================
  // validateConfig() - ROUTER_IO_THREADS
  // ============================================================================

  describe('validateConfig() - ROUTER_IO_THREADS', () => {
    it('should accept valid ROUTER_IO_THREADS (1-16)', () => {
      expect(() => validateConfig({ ROUTER_IO_THREADS: 1 })).to.not.throw()
      expect(() => validateConfig({ ROUTER_IO_THREADS: 8 })).to.not.throw()
      expect(() => validateConfig({ ROUTER_IO_THREADS: 16 })).to.not.throw()
    })

    it('should reject ROUTER_IO_THREADS < 1', () => {
      expect(() => validateConfig({ ROUTER_IO_THREADS: 0 }))
        .to.throw(/Invalid ROUTER_IO_THREADS.*Must be integer between 1 and 16/)
      
      expect(() => validateConfig({ ROUTER_IO_THREADS: -5 }))
        .to.throw(/Invalid ROUTER_IO_THREADS/)
    })

    it('should reject ROUTER_IO_THREADS > 16', () => {
      expect(() => validateConfig({ ROUTER_IO_THREADS: 20 }))
        .to.throw(/Invalid ROUTER_IO_THREADS.*Must be integer between 1 and 16/)
    })

    it('should reject non-integer ROUTER_IO_THREADS', () => {
      expect(() => validateConfig({ ROUTER_IO_THREADS: 3.7 }))
        .to.throw(/Invalid ROUTER_IO_THREADS/)
      
      expect(() => validateConfig({ ROUTER_IO_THREADS: 'high' }))
        .to.throw(/Invalid ROUTER_IO_THREADS/)
    })

    it('should allow undefined ROUTER_IO_THREADS', () => {
      expect(() => validateConfig({ ROUTER_IO_THREADS: undefined })).to.not.throw()
    })
  })

  // ============================================================================
  // validateConfig() - DEBUG
  // ============================================================================

  describe('validateConfig() - DEBUG', () => {
    it('should accept boolean DEBUG values', () => {
      expect(() => validateConfig({ DEBUG: true })).to.not.throw()
      expect(() => validateConfig({ DEBUG: false })).to.not.throw()
    })

    it('should reject non-boolean DEBUG values', () => {
      expect(() => validateConfig({ DEBUG: 1 }))
        .to.throw(/Invalid DEBUG.*Must be boolean/)
      
      expect(() => validateConfig({ DEBUG: 'true' }))
        .to.throw(/Invalid DEBUG.*Must be boolean/)
      
      expect(() => validateConfig({ DEBUG: null }))
        .to.throw(/Invalid DEBUG.*Must be boolean/)
    })

    it('should allow undefined DEBUG', () => {
      expect(() => validateConfig({ DEBUG: undefined })).to.not.throw()
    })
  })

  // ============================================================================
  // validateConfig() - ZMQ_LINGER
  // ============================================================================

  describe('validateConfig() - ZMQ_LINGER', () => {
    it('should accept -1 (infinite linger)', () => {
      expect(() => validateConfig({ ZMQ_LINGER: -1 })).to.not.throw()
    })

    it('should accept 0 (no linger)', () => {
      expect(() => validateConfig({ ZMQ_LINGER: 0 })).to.not.throw()
    })

    it('should accept positive linger values', () => {
      expect(() => validateConfig({ ZMQ_LINGER: 1000 })).to.not.throw()
      expect(() => validateConfig({ ZMQ_LINGER: 5000 })).to.not.throw()
    })

    it('should reject values < -1', () => {
      expect(() => validateConfig({ ZMQ_LINGER: -2 }))
        .to.throw(/Invalid ZMQ_LINGER.*Must be -1 \(infinite\) or >= 0/)
      
      expect(() => validateConfig({ ZMQ_LINGER: -100 }))
        .to.throw(/Invalid ZMQ_LINGER/)
    })

    it('should reject non-numeric ZMQ_LINGER', () => {
      expect(() => validateConfig({ ZMQ_LINGER: '1000' }))
        .to.throw(/Invalid ZMQ_LINGER/)
    })

    it('should allow undefined ZMQ_LINGER', () => {
      expect(() => validateConfig({ ZMQ_LINGER: undefined })).to.not.throw()
    })
  })

  // ============================================================================
  // validateConfig() - HWM (High Water Mark)
  // ============================================================================

  describe('validateConfig() - ZMQ_SNDHWM', () => {
    it('should accept positive HWM values', () => {
      expect(() => validateConfig({ ZMQ_SNDHWM: 1 })).to.not.throw()
      expect(() => validateConfig({ ZMQ_SNDHWM: 1000 })).to.not.throw()
      expect(() => validateConfig({ ZMQ_SNDHWM: 10000 })).to.not.throw()
    })

    it('should reject ZMQ_SNDHWM <= 0', () => {
      expect(() => validateConfig({ ZMQ_SNDHWM: 0 }))
        .to.throw(/Invalid ZMQ_SNDHWM.*Must be > 0/)
      
      expect(() => validateConfig({ ZMQ_SNDHWM: -1 }))
        .to.throw(/Invalid ZMQ_SNDHWM/)
    })

    it('should reject non-numeric ZMQ_SNDHWM', () => {
      expect(() => validateConfig({ ZMQ_SNDHWM: '1000' }))
        .to.throw(/Invalid ZMQ_SNDHWM/)
    })

    it('should allow undefined ZMQ_SNDHWM', () => {
      expect(() => validateConfig({ ZMQ_SNDHWM: undefined })).to.not.throw()
    })
  })

  describe('validateConfig() - ZMQ_RCVHWM', () => {
    it('should accept positive HWM values', () => {
      expect(() => validateConfig({ ZMQ_RCVHWM: 1 })).to.not.throw()
      expect(() => validateConfig({ ZMQ_RCVHWM: 2000 })).to.not.throw()
    })

    it('should reject ZMQ_RCVHWM <= 0', () => {
      expect(() => validateConfig({ ZMQ_RCVHWM: 0 }))
        .to.throw(/Invalid ZMQ_RCVHWM.*Must be > 0/)
      
      expect(() => validateConfig({ ZMQ_RCVHWM: -5 }))
        .to.throw(/Invalid ZMQ_RCVHWM/)
    })

    it('should reject non-numeric ZMQ_RCVHWM', () => {
      expect(() => validateConfig({ ZMQ_RCVHWM: 'high' }))
        .to.throw(/Invalid ZMQ_RCVHWM/)
    })

    it('should allow undefined ZMQ_RCVHWM', () => {
      expect(() => validateConfig({ ZMQ_RCVHWM: undefined })).to.not.throw()
    })
  })

  // ============================================================================
  // validateConfig() - Reconnection Interval
  // ============================================================================

  describe('validateConfig() - ZMQ_RECONNECT_IVL', () => {
    it('should accept positive intervals', () => {
      expect(() => validateConfig({ ZMQ_RECONNECT_IVL: 1 })).to.not.throw()
      expect(() => validateConfig({ ZMQ_RECONNECT_IVL: 100 })).to.not.throw()
      expect(() => validateConfig({ ZMQ_RECONNECT_IVL: 5000 })).to.not.throw()
    })

    it('should reject ZMQ_RECONNECT_IVL <= 0', () => {
      expect(() => validateConfig({ ZMQ_RECONNECT_IVL: 0 }))
        .to.throw(/Invalid ZMQ_RECONNECT_IVL.*Must be > 0/)
      
      expect(() => validateConfig({ ZMQ_RECONNECT_IVL: -1 }))
        .to.throw(/Invalid ZMQ_RECONNECT_IVL/)
    })

    it('should reject non-numeric ZMQ_RECONNECT_IVL', () => {
      expect(() => validateConfig({ ZMQ_RECONNECT_IVL: '100' }))
        .to.throw(/Invalid ZMQ_RECONNECT_IVL/)
    })

    it('should allow undefined ZMQ_RECONNECT_IVL', () => {
      expect(() => validateConfig({ ZMQ_RECONNECT_IVL: undefined })).to.not.throw()
    })
  })

  // ============================================================================
  // validateConfig() - Timeouts
  // ============================================================================

  describe('validateConfig() - CONNECTION_TIMEOUT', () => {
    it('should accept -1 (infinite timeout)', () => {
      expect(() => validateConfig({ CONNECTION_TIMEOUT: -1 })).to.not.throw()
    })

    it('should accept 0', () => {
      expect(() => validateConfig({ CONNECTION_TIMEOUT: 0 })).to.not.throw()
    })

    it('should accept positive timeouts', () => {
      expect(() => validateConfig({ CONNECTION_TIMEOUT: 1000 })).to.not.throw()
      expect(() => validateConfig({ CONNECTION_TIMEOUT: 30000 })).to.not.throw()
    })

    it('should reject values < -1', () => {
      expect(() => validateConfig({ CONNECTION_TIMEOUT: -2 }))
        .to.throw(/Invalid CONNECTION_TIMEOUT.*Must be -1 \(infinite\) or >= 0/)
      
      expect(() => validateConfig({ CONNECTION_TIMEOUT: -100 }))
        .to.throw(/Invalid CONNECTION_TIMEOUT/)
    })

    it('should reject non-numeric CONNECTION_TIMEOUT', () => {
      expect(() => validateConfig({ CONNECTION_TIMEOUT: 'never' }))
        .to.throw(/Invalid CONNECTION_TIMEOUT/)
    })

    it('should allow undefined CONNECTION_TIMEOUT', () => {
      expect(() => validateConfig({ CONNECTION_TIMEOUT: undefined })).to.not.throw()
    })
  })

  describe('validateConfig() - RECONNECTION_TIMEOUT', () => {
    it('should accept -1 (infinite reconnection)', () => {
      expect(() => validateConfig({ RECONNECTION_TIMEOUT: -1 })).to.not.throw()
    })

    it('should accept 0', () => {
      expect(() => validateConfig({ RECONNECTION_TIMEOUT: 0 })).to.not.throw()
    })

    it('should accept positive timeouts', () => {
      expect(() => validateConfig({ RECONNECTION_TIMEOUT: 5000 })).to.not.throw()
      expect(() => validateConfig({ RECONNECTION_TIMEOUT: 60000 })).to.not.throw()
    })

    it('should reject values < -1', () => {
      expect(() => validateConfig({ RECONNECTION_TIMEOUT: -3 }))
        .to.throw(/Invalid RECONNECTION_TIMEOUT.*Must be -1 \(infinite\) or >= 0/)
    })

    it('should reject non-numeric RECONNECTION_TIMEOUT', () => {
      expect(() => validateConfig({ RECONNECTION_TIMEOUT: null }))
        .to.throw(/Invalid RECONNECTION_TIMEOUT/)
    })

    it('should allow undefined RECONNECTION_TIMEOUT', () => {
      expect(() => validateConfig({ RECONNECTION_TIMEOUT: undefined })).to.not.throw()
    })
  })

  // ============================================================================
  // validateConfig() - Multiple Properties
  // ============================================================================

  describe('validateConfig() - Multiple Properties', () => {
    it('should validate all properties in one call', () => {
      const validConfig = {
        DEALER_IO_THREADS: 4,
        ROUTER_IO_THREADS: 2,
        DEBUG: true,
        ZMQ_LINGER: 1000,
        ZMQ_SNDHWM: 5000,
        ZMQ_RCVHWM: 5000,
        ZMQ_RECONNECT_IVL: 100,
        CONNECTION_TIMEOUT: 30000,
        RECONNECTION_TIMEOUT: -1
      }
      
      expect(() => validateConfig(validConfig)).to.not.throw()
    })

    it('should fail on first invalid property', () => {
      const invalidConfig = {
        DEALER_IO_THREADS: 20, // Invalid!
        DEBUG: true,
        ZMQ_LINGER: 0
      }
      
      expect(() => validateConfig(invalidConfig))
        .to.throw(/Invalid DEALER_IO_THREADS/)
    })

    it('should return true when all valid', () => {
      const result = validateConfig({ DEALER_IO_THREADS: 4, DEBUG: false })
      expect(result).to.equal(true)
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: mergeConfig + validate', () => {
    it('should merge and validate in one operation', () => {
      const userConfig = {
        DEALER_IO_THREADS: 8,
        CONNECTION_TIMEOUT: 15000
      }
      
      expect(() => mergeConfig(userConfig, true)).to.not.throw()
      
      const config = mergeConfig(userConfig, true)
      expect(config.DEALER_IO_THREADS).to.equal(8)
      expect(config.CONNECTION_TIMEOUT).to.equal(15000)
    })

    it('should throw on invalid merged config', () => {
      const userConfig = {
        DEALER_IO_THREADS: 999 // Invalid!
      }
      
      expect(() => mergeConfig(userConfig, true))
        .to.throw(/Invalid DEALER_IO_THREADS/)
    })
  })
})

