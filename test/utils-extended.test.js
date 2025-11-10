/**
 * Utils Extended Tests - Coverage Completion
 * 
 * These tests target uncovered code paths in utils.js
 * to achieve higher test coverage
 */

import { expect } from 'chai'
import utils from '../src/utils.js'

const { optionsPredicateBuilder, checkNodeReducer } = utils

describe('Utils - Extended Coverage', () => {
  
  // ============================================================================
  // checkNodeReducer - Edge Cases (Lines 5-7)
  // ============================================================================
  
  describe('checkNodeReducer - Edge Cases', () => {
    it('should not add node ID when predicate is not a function', () => {
      const node = {
        getId: () => 'node-1',
        getOptions: () => ({ role: 'worker' })
      }
      const accumulatorSet = new Set()
      
      // Pass a non-function predicate
      checkNodeReducer(node, 'not-a-function', accumulatorSet)
      
      expect(accumulatorSet.size).to.equal(0)
      expect(accumulatorSet.has('node-1')).to.be.false
    })

    it('should not add node ID when predicate returns false', () => {
      const node = {
        getId: () => 'node-2',
        getOptions: () => ({ role: 'worker' })
      }
      const accumulatorSet = new Set()
      
      // Predicate that returns false
      const falsePredicate = () => false
      checkNodeReducer(node, falsePredicate, accumulatorSet)
      
      expect(accumulatorSet.size).to.equal(0)
      expect(accumulatorSet.has('node-2')).to.be.false
    })

    it('should add node ID when predicate returns true', () => {
      const node = {
        getId: () => 'node-3',
        getOptions: () => ({ role: 'master' })
      }
      const accumulatorSet = new Set()
      
      // Predicate that returns true
      const truePredicate = (opts) => opts.role === 'master'
      checkNodeReducer(node, truePredicate, accumulatorSet)
      
      expect(accumulatorSet.size).to.equal(1)
      expect(accumulatorSet.has('node-3')).to.be.true
    })
  })

  // ============================================================================
  // optionsPredicateBuilder - null/undefined nodeOptions (Line 21)
  // ============================================================================
  
  describe('optionsPredicateBuilder - null/undefined nodeOptions fallback', () => {
    it('should convert null nodeOptions to empty object', () => {
      const predicate = optionsPredicateBuilder({ role: 'worker' })
      
      // This should use the fallback nodeOptions = {}
      const result = predicate(null)
      
      expect(result).to.be.false // No match because nodeOptions is empty
    })

    it('should convert undefined nodeOptions to empty object', () => {
      const predicate = optionsPredicateBuilder({ region: /^us-/ })
      
      // This should use the fallback nodeOptions = {}
      const result = predicate(undefined)
      
      expect(result).to.be.false
    })

    it('should handle non-object nodeOptions', () => {
      const predicate = optionsPredicateBuilder({ role: 'worker' })
      
      // Pass a string instead of object
      const result = predicate('invalid')
      
      expect(result).to.be.false
    })
  })

  // ============================================================================
  // RegExp Negative Path (Line 34)
  // ============================================================================
  
  describe('optionsPredicateBuilder - RegExp negative matching', () => {
    it('should return false when RegExp does not match', () => {
      const predicate = optionsPredicateBuilder({ region: /^us-/ })
      
      // Test the path where RegExp.test returns false
      expect(predicate({ region: 'eu-west' })).to.be.false
      expect(predicate({ region: 'asia-pacific' })).to.be.false
      expect(predicate({ region: 'ca-central' })).to.be.false
    })

    it('should return true when RegExp matches', () => {
      const predicate = optionsPredicateBuilder({ region: /^us-/ })
      
      expect(predicate({ region: 'us-east' })).to.be.true
      expect(predicate({ region: 'us-west' })).to.be.true
    })
  })

  // ============================================================================
  // Query Operators - Negative Paths (Lines 41-77)
  // ============================================================================
  
  describe('Query Operators - Negative Paths', () => {
    // $gt operator - Line 50-51
    it('$gt should reject values NOT greater than threshold', () => {
      const predicate = optionsPredicateBuilder({ priority: { $gt: 5 } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ priority: 5 })).to.be.false // Equal, not greater
      expect(predicate({ priority: 4 })).to.be.false // Less than
      expect(predicate({ priority: 3 })).to.be.false
    })

    // $gte operator - Line 52-53
    it('$gte should reject values NOT greater than or equal', () => {
      const predicate = optionsPredicateBuilder({ priority: { $gte: 5 } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ priority: 4 })).to.be.false
      expect(predicate({ priority: 3 })).to.be.false
      expect(predicate({ priority: 0 })).to.be.false
    })

    // $lt operator - Line 54-55
    it('$lt should reject values NOT less than threshold', () => {
      const predicate = optionsPredicateBuilder({ priority: { $lt: 5 } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ priority: 5 })).to.be.false // Equal, not less
      expect(predicate({ priority: 6 })).to.be.false // Greater
      expect(predicate({ priority: 10 })).to.be.false
    })

    // $lte operator - Line 56-57
    it('$lte should reject values NOT less than or equal', () => {
      const predicate = optionsPredicateBuilder({ priority: { $lte: 5 } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ priority: 6 })).to.be.false
      expect(predicate({ priority: 7 })).to.be.false
      expect(predicate({ priority: 100 })).to.be.false
    })

    // $between operator - Line 58-59
    it('$between should reject values outside range', () => {
      const predicate = optionsPredicateBuilder({ priority: { $between: [3, 7] } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ priority: 2 })).to.be.false // Below min
      expect(predicate({ priority: 8 })).to.be.false // Above max
      expect(predicate({ priority: 0 })).to.be.false
      expect(predicate({ priority: 10 })).to.be.false
    })

    it('$between should handle edge cases at boundaries', () => {
      const predicate = optionsPredicateBuilder({ priority: { $between: [3, 7] } })
      
      // $between has EXCLUSIVE boundaries (value[0] < node < value[1])
      expect(predicate({ priority: 3 })).to.be.false // Min boundary is EXCLUSIVE
      expect(predicate({ priority: 7 })).to.be.false // Max boundary is EXCLUSIVE
      expect(predicate({ priority: 5 })).to.be.true // Middle is INCLUSIVE
      expect(predicate({ priority: 4 })).to.be.true // Within range
      expect(predicate({ priority: 6 })).to.be.true // Within range
    })

    // $regex operator - Line 60-61
    it('$regex should reject values that do not match pattern', () => {
      const predicate = optionsPredicateBuilder({ email: { $regex: /@example\.com$/ } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ email: 'user@other.com' })).to.be.false
      expect(predicate({ email: 'invalid' })).to.be.false
      expect(predicate({ email: '@wrong.com' })).to.be.false
    })

    it('$regex should accept values that match pattern', () => {
      const predicate = optionsPredicateBuilder({ email: { $regex: /@example\.com$/ } })
      
      expect(predicate({ email: 'user@example.com' })).to.be.true
      expect(predicate({ email: 'admin@example.com' })).to.be.true
    })

    // $in operator - Line 62-63
    it('$in should reject values not in array', () => {
      const predicate = optionsPredicateBuilder({ role: { $in: ['admin', 'moderator'] } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ role: 'user' })).to.be.false
      expect(predicate({ role: 'guest' })).to.be.false
      expect(predicate({ role: 'worker' })).to.be.false
    })

    // $nin operator - Line 64-65
    it('$nin should reject values that ARE in array', () => {
      const predicate = optionsPredicateBuilder({ role: { $nin: ['banned', 'suspended'] } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ role: 'banned' })).to.be.false
      expect(predicate({ role: 'suspended' })).to.be.false
    })

    // $contains operator - Line 66-67
    it('$contains should reject strings without substring', () => {
      const predicate = optionsPredicateBuilder({ message: { $contains: 'error' } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ message: 'success' })).to.be.false
      expect(predicate({ message: 'info message' })).to.be.false
      expect(predicate({ message: 'warning' })).to.be.false
    })

    // $containsAny operator - Line 68-69
    it('$containsAny should reject when no values are contained', () => {
      const predicate = optionsPredicateBuilder({ tags: { $containsAny: ['urgent', 'critical'] } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ tags: 'normal,info' })).to.be.false
      expect(predicate({ tags: 'debug,trace' })).to.be.false
    })

    it('$containsAny should accept when at least one value is contained', () => {
      const predicate = optionsPredicateBuilder({ tags: { $containsAny: ['urgent', 'critical'] } })
      
      expect(predicate({ tags: 'normal,urgent,info' })).to.be.true
      expect(predicate({ tags: 'critical' })).to.be.true
    })

    // $containsNone operator - Line 70-71
    it('$containsNone should reject when any value is contained', () => {
      const predicate = optionsPredicateBuilder({ tags: { $containsNone: ['banned', 'spam'] } })
      
      // Test the "return true" path (not satisfying)
      expect(predicate({ tags: 'normal,banned' })).to.be.false
      expect(predicate({ tags: 'spam' })).to.be.false
      expect(predicate({ tags: 'info,spam,debug' })).to.be.false
    })

    it('$containsNone should accept when no values are contained', () => {
      const predicate = optionsPredicateBuilder({ tags: { $containsNone: ['banned', 'spam'] } })
      
      expect(predicate({ tags: 'normal,info' })).to.be.true
      expect(predicate({ tags: 'debug,trace' })).to.be.true
    })
  })

  // ============================================================================
  // Complex Multi-Operator Scenarios
  // ============================================================================
  
  describe('Complex Multi-Operator Scenarios', () => {
    it('should handle multiple operators with all passing', () => {
      const predicate = optionsPredicateBuilder({
        priority: { $gte: 3, $lte: 7 },
        region: { $in: ['us-east', 'us-west'] }
      })
      
      expect(predicate({ priority: 5, region: 'us-east' })).to.be.true
      expect(predicate({ priority: 3, region: 'us-west' })).to.be.true
    })

    it('should handle multiple operators with some failing', () => {
      const predicate = optionsPredicateBuilder({
        priority: { $gte: 3, $lte: 7 },
        region: { $in: ['us-east', 'us-west'] }
      })
      
      expect(predicate({ priority: 2, region: 'us-east' })).to.be.false // priority fails
      expect(predicate({ priority: 5, region: 'eu-west' })).to.be.false // region fails
      expect(predicate({ priority: 8, region: 'eu-west' })).to.be.false // both fail
    })

    it('should handle operator on missing nodeOption key', () => {
      const predicate = optionsPredicateBuilder({ 
        priority: { $gt: 5 },
        region: 'us-east'
      })
      
      // Missing priority key should fail (line 77 - return true)
      expect(predicate({ region: 'us-east' })).to.be.false
      expect(predicate({ other: 'value' })).to.be.false
    })
  })

  // ============================================================================
  // Integration with checkNodeReducer
  // ============================================================================
  
  describe('checkNodeReducer + optionsPredicateBuilder Integration', () => {
    it('should work together with complex predicates', () => {
      const nodes = [
        { getId: () => 'node-1', getOptions: () => ({ priority: 5, role: 'worker' }) },
        { getId: () => 'node-2', getOptions: () => ({ priority: 8, role: 'master' }) },
        { getId: () => 'node-3', getOptions: () => ({ priority: 3, role: 'worker' }) }
      ]
      
      const predicate = optionsPredicateBuilder({
        priority: { $gte: 5 },
        role: 'worker'
      })
      
      const accumulatorSet = new Set()
      nodes.forEach(node => checkNodeReducer(node, predicate, accumulatorSet))
      
      expect(accumulatorSet.size).to.equal(1)
      expect(accumulatorSet.has('node-1')).to.be.true
      expect(accumulatorSet.has('node-2')).to.be.false // role doesn't match
      expect(accumulatorSet.has('node-3')).to.be.false // priority too low
    })
  })
})

