/**
 * Utils Tests
 * 
 * Tests for optionsPredicateBuilder and checkNodeReducer
 */

import { expect } from 'chai'
import utils from '../src/utils.js'

const { optionsPredicateBuilder, checkNodeReducer } = utils

describe('Utils', function () {
  describe('optionsPredicateBuilder - Basic Matching', () => {
    it('should return predicate that matches all when options is null', () => {
      const predicate = optionsPredicateBuilder(null)
      expect(predicate({ role: 'worker' })).to.be.true
      expect(predicate({ role: 'master' })).to.be.true
      expect(predicate({})).to.be.true
    })

    it('should return predicate that matches all when options is undefined', () => {
      const predicate = optionsPredicateBuilder(undefined)
      expect(predicate({ role: 'worker' })).to.be.true
      expect(predicate({})).to.be.true
    })

    it('should return predicate that matches all when options is empty object', () => {
      const predicate = optionsPredicateBuilder({})
      expect(predicate({ role: 'worker' })).to.be.true
      expect(predicate({ anything: 'goes' })).to.be.true
    })

    it('should handle null/undefined nodeOptions gracefully', () => {
      const predicate = optionsPredicateBuilder({ role: 'worker' })
      expect(predicate(null)).to.be.false
      expect(predicate(undefined)).to.be.false
    })

    it('should match exact string values', () => {
      const predicate = optionsPredicateBuilder({ role: 'worker' })
      expect(predicate({ role: 'worker' })).to.be.true
      expect(predicate({ role: 'master' })).to.be.false
      expect(predicate({ role: 'worker', region: 'us' })).to.be.true
    })

    it('should match exact number values', () => {
      const predicate = optionsPredicateBuilder({ priority: 5 })
      expect(predicate({ priority: 5 })).to.be.true
      expect(predicate({ priority: 3 })).to.be.false
      expect(predicate({ priority: '5' })).to.be.false // Type matters
    })

    it('should match RegExp patterns', () => {
      const predicate = optionsPredicateBuilder({ region: /^us-/ })
      expect(predicate({ region: 'us-east' })).to.be.true
      expect(predicate({ region: 'us-west' })).to.be.true
      expect(predicate({ region: 'eu-west' })).to.be.false
    })

    it('should fail when nodeOption key is missing', () => {
      const predicate = optionsPredicateBuilder({ role: 'worker' })
      expect(predicate({ region: 'us-east' })).to.be.false
      expect(predicate({})).to.be.false
    })
  })

  describe('optionsPredicateBuilder - Query Operators', () => {
    it('$eq should match equal values', () => {
      const predicate = optionsPredicateBuilder({ priority: { $eq: 5 } })
      expect(predicate({ priority: 5 })).to.be.true
      expect(predicate({ priority: 6 })).to.be.false
    })

    it('$ne should match not-equal values', () => {
      const predicate = optionsPredicateBuilder({ priority: { $ne: 5 } })
      expect(predicate({ priority: 6 })).to.be.true
      expect(predicate({ priority: 5 })).to.be.false
    })

    it('$aeq should match loose equality (==)', () => {
      const predicate = optionsPredicateBuilder({ priority: { $aeq: 5 } })
      expect(predicate({ priority: 5 })).to.be.true
      expect(predicate({ priority: '5' })).to.be.true // Loose equality
      expect(predicate({ priority: 6 })).to.be.false
    })

    it('$gt should match greater than', () => {
      const predicate = optionsPredicateBuilder({ priority: { $gt: 5 } })
      expect(predicate({ priority: 6 })).to.be.true
      expect(predicate({ priority: 7 })).to.be.true
      expect(predicate({ priority: 5 })).to.be.false
      expect(predicate({ priority: 4 })).to.be.false
    })

    it('$gte should match greater than or equal', () => {
      const predicate = optionsPredicateBuilder({ priority: { $gte: 5 } })
      expect(predicate({ priority: 6 })).to.be.true
      expect(predicate({ priority: 5 })).to.be.true
      expect(predicate({ priority: 4 })).to.be.false
    })

    it('$lt should match less than', () => {
      const predicate = optionsPredicateBuilder({ priority: { $lt: 5 } })
      expect(predicate({ priority: 4 })).to.be.true
      expect(predicate({ priority: 3 })).to.be.true
      expect(predicate({ priority: 5 })).to.be.false
      expect(predicate({ priority: 6 })).to.be.false
    })

    it('$lte should match less than or equal', () => {
      const predicate = optionsPredicateBuilder({ priority: { $lte: 5 } })
      expect(predicate({ priority: 4 })).to.be.true
      expect(predicate({ priority: 5 })).to.be.true
      expect(predicate({ priority: 6 })).to.be.false
    })

    it('$between should match values in range [min, max]', () => {
      const predicate = optionsPredicateBuilder({ priority: { $between: [3, 7] } })
      expect(predicate({ priority: 4 })).to.be.true
      expect(predicate({ priority: 5 })).to.be.true
      expect(predicate({ priority: 6 })).to.be.true
      expect(predicate({ priority: 3 })).to.be.false // Exclusive
      expect(predicate({ priority: 7 })).to.be.false // Exclusive
      expect(predicate({ priority: 2 })).to.be.false
      expect(predicate({ priority: 8 })).to.be.false
    })

    it('$regex should match regex patterns', () => {
      const predicate = optionsPredicateBuilder({ region: { $regex: /^us-/ } })
      expect(predicate({ region: 'us-east' })).to.be.true
      expect(predicate({ region: 'us-west' })).to.be.true
      expect(predicate({ region: 'eu-west' })).to.be.false
    })

    it('$in should match values in array', () => {
      const predicate = optionsPredicateBuilder({ role: { $in: ['worker', 'master'] } })
      expect(predicate({ role: 'worker' })).to.be.true
      expect(predicate({ role: 'master' })).to.be.true
      expect(predicate({ role: 'admin' })).to.be.false
    })

    it('$nin should match values NOT in array', () => {
      const predicate = optionsPredicateBuilder({ role: { $nin: ['admin', 'guest'] } })
      expect(predicate({ role: 'worker' })).to.be.true
      expect(predicate({ role: 'master' })).to.be.true
      expect(predicate({ role: 'admin' })).to.be.false
      expect(predicate({ role: 'guest' })).to.be.false
    })

    it('$contains should match substring in string', () => {
      const predicate = optionsPredicateBuilder({ region: { $contains: 'east' } })
      expect(predicate({ region: 'us-east-1' })).to.be.true
      expect(predicate({ region: 'eu-east-2' })).to.be.true
      expect(predicate({ region: 'us-west' })).to.be.false
    })

    it('$containsAny should match if ANY value exists', () => {
      const predicate = optionsPredicateBuilder({ tags: { $containsAny: ['prod', 'staging'] } })
      expect(predicate({ tags: ['prod', 'web'] })).to.be.true
      expect(predicate({ tags: ['staging', 'api'] })).to.be.true
      expect(predicate({ tags: ['dev', 'test'] })).to.be.false
    })

    it('$containsNone should match if NO values exist', () => {
      const predicate = optionsPredicateBuilder({ tags: { $containsNone: ['prod', 'staging'] } })
      expect(predicate({ tags: ['dev', 'test'] })).to.be.true
      expect(predicate({ tags: ['prod', 'web'] })).to.be.false
      expect(predicate({ tags: ['staging', 'api'] })).to.be.false
    })
  })

  describe('optionsPredicateBuilder - Complex Scenarios', () => {
    it('should handle multiple filter criteria (AND logic)', () => {
      const predicate = optionsPredicateBuilder({
        role: 'worker',
        region: /^us-/,
        priority: { $gte: 3 }
      })
      
      expect(predicate({ role: 'worker', region: 'us-east', priority: 5 })).to.be.true
      expect(predicate({ role: 'worker', region: 'us-west', priority: 3 })).to.be.true
      expect(predicate({ role: 'master', region: 'us-east', priority: 5 })).to.be.false
      expect(predicate({ role: 'worker', region: 'eu-west', priority: 5 })).to.be.false
      expect(predicate({ role: 'worker', region: 'us-east', priority: 2 })).to.be.false
    })

    it('should handle missing nodeOption keys', () => {
      const predicate = optionsPredicateBuilder({
        role: 'worker',
        region: 'us-east'
      })
      
      expect(predicate({ role: 'worker' })).to.be.false // Missing region
      expect(predicate({ region: 'us-east' })).to.be.false // Missing role
    })

    it('should handle mixed types (string, number, regex, operators)', () => {
      const predicate = optionsPredicateBuilder({
        role: 'worker',
        priority: 5,
        region: /^us-/,
        version: { $gte: 2 }
      })
      
      expect(predicate({ 
        role: 'worker', 
        priority: 5, 
        region: 'us-east', 
        version: 3 
      })).to.be.true
      
      expect(predicate({ 
        role: 'worker', 
        priority: 5, 
        region: 'us-east', 
        version: 1 
      })).to.be.false
    })

    it('should handle empty string values', () => {
      const predicate = optionsPredicateBuilder({ role: '' })
      expect(predicate({ role: '' })).to.be.true
      expect(predicate({ role: 'worker' })).to.be.false
    })

    it('should handle zero values', () => {
      const predicate = optionsPredicateBuilder({ priority: 0 })
      expect(predicate({ priority: 0 })).to.be.true
      expect(predicate({ priority: 1 })).to.be.false
    })

    it('should handle boolean values', () => {
      const predicate = optionsPredicateBuilder({ active: true })
      expect(predicate({ active: true })).to.be.true
      expect(predicate({ active: false })).to.be.false
    })
  })

  describe('optionsPredicateBuilder - Edge Cases', () => {
    it('should handle operator with undefined nodeOption', () => {
      const predicate = optionsPredicateBuilder({ priority: { $gt: 5 } })
      expect(predicate({ role: 'worker' })).to.be.false // priority undefined
      expect(predicate({})).to.be.false
    })

    it('should handle multiple operators on same field (first match wins)', () => {
      const predicate = optionsPredicateBuilder({ 
        priority: { $gte: 3, $lte: 7 } 
      })
      
      expect(predicate({ priority: 5 })).to.be.true
      expect(predicate({ priority: 3 })).to.be.true
      expect(predicate({ priority: 7 })).to.be.true
      expect(predicate({ priority: 2 })).to.be.false
      expect(predicate({ priority: 8 })).to.be.false
    })

    it('should handle RegExp on non-string values gracefully', () => {
      const predicate = optionsPredicateBuilder({ priority: /^5/ })
      // RegExp.test() coerces to string
      expect(predicate({ priority: '5' })).to.be.true
      // Number gets coerced to string "5"
      expect(predicate({ priority: 5 })).to.be.true
    })
  })

  describe('checkNodeReducer', () => {
    it('should add node ID when predicate returns true', () => {
      const accumulatorSet = new Set()
      const node = {
        getId: () => 'node-1',
        getOptions: () => ({ role: 'worker' })
      }
      const predicate = (opts) => opts.role === 'worker'
      
      checkNodeReducer(node, predicate, accumulatorSet)
      
      expect(accumulatorSet.has('node-1')).to.be.true
      expect(accumulatorSet.size).to.equal(1)
    })

    it('should not add node ID when predicate returns false', () => {
      const accumulatorSet = new Set()
      const node = {
        getId: () => 'node-1',
        getOptions: () => ({ role: 'master' })
      }
      const predicate = (opts) => opts.role === 'worker'
      
      checkNodeReducer(node, predicate, accumulatorSet)
      
      expect(accumulatorSet.has('node-1')).to.be.false
      expect(accumulatorSet.size).to.equal(0)
    })

    it('should work with custom predicate functions', () => {
      const accumulatorSet = new Set()
      const node = {
        getId: () => 'node-1',
        getOptions: () => ({ priority: 5, region: 'us-east' })
      }
      const predicate = (opts) => opts.priority > 3 && opts.region.startsWith('us-')
      
      checkNodeReducer(node, predicate, accumulatorSet)
      
      expect(accumulatorSet.has('node-1')).to.be.true
    })

    it('should handle multiple nodes', () => {
      const accumulatorSet = new Set()
      const nodes = [
        { getId: () => 'node-1', getOptions: () => ({ role: 'worker' }) },
        { getId: () => 'node-2', getOptions: () => ({ role: 'master' }) },
        { getId: () => 'node-3', getOptions: () => ({ role: 'worker' }) }
      ]
      const predicate = (opts) => opts.role === 'worker'
      
      nodes.forEach(node => checkNodeReducer(node, predicate, accumulatorSet))
      
      expect(accumulatorSet.size).to.equal(2)
      expect(accumulatorSet.has('node-1')).to.be.true
      expect(accumulatorSet.has('node-2')).to.be.false
      expect(accumulatorSet.has('node-3')).to.be.true
    })

    it('should handle nodes with empty options', () => {
      const accumulatorSet = new Set()
      const node = {
        getId: () => 'node-1',
        getOptions: () => ({})
      }
      const predicate = optionsPredicateBuilder({ role: 'worker' })
      
      checkNodeReducer(node, predicate, accumulatorSet)
      
      expect(accumulatorSet.size).to.equal(0)
    })
  })
})

