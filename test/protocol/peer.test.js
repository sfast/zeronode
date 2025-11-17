/**
 * PeerInfo Tests
 * 
 * Tests for peer state management, heartbeat tracking, and identity management
 */

import { expect } from 'chai'
import PeerInfo, { PeerState } from '../../src/protocol/peer.js'

describe('PeerInfo', function () {
  describe('Constructor', () => {
    it('should create peer with provided id', () => {
      const peer = new PeerInfo({ id: 'test-peer' })
      expect(peer.getId()).to.equal('test-peer')
    })

    it('should initialize with IDLE state', () => {
      const peer = new PeerInfo({ id: 'test' })
      expect(peer.getState()).to.equal(PeerState.IDLE)
      expect(peer.isConnected()).to.be.false
    })

    it('should accept address and options', () => {
      const peer = new PeerInfo({ 
        id: 'test', 
        address: 'tcp://127.0.0.1:5000',
        options: { role: 'worker' }
      })
      expect(peer.getAddress()).to.equal('tcp://127.0.0.1:5000')
      expect(peer.getOptions()).to.deep.equal({ role: 'worker' })
    })

    it('should initialize with empty options if not provided', () => {
      const peer = new PeerInfo({ id: 'test' })
      expect(peer.getOptions()).to.deep.equal({})
    })

    it('should set connectedAt timestamp when transitioning to CONNECTED', () => {
      const before = Date.now()
      const peer = new PeerInfo({ id: 'test' })
      expect(peer.connectedAt).to.equal(null)
      peer.setState(PeerState.CONNECTED)
      const after = Date.now()
      expect(peer.connectedAt).to.be.at.least(before)
      expect(peer.connectedAt).to.be.at.most(after)
    })

    it('should initialize lastSeen timestamp', () => {
      const peer = new PeerInfo({ id: 'test' })
      expect(peer.getLastSeen()).to.be.a('number')
      expect(peer.getLastSeen()).to.be.at.most(Date.now())
    })
  })

  describe('State Queries', () => {
    it('isConnected() should return true when state is CONNECTED', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.CONNECTED)
      expect(peer.isConnected()).to.be.true
      expect(peer.isHealthy()).to.be.false
    })

    it('isHealthy() should return true when state is HEALTHY', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.HEALTHY)
      expect(peer.isHealthy()).to.be.true
      expect(peer.isConnected()).to.be.false
    })

    it('isGhost() should return true when state is GHOST', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.GHOST)
      expect(peer.isGhost()).to.be.true
      expect(peer.isHealthy()).to.be.false
    })

    it('isFailed() should return true when state is FAILED', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.FAILED)
      expect(peer.isFailed()).to.be.true
      expect(peer.isOnline()).to.be.false
    })

    it('isStopped() should return true when state is STOPPED', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.STOPPED)
      expect(peer.isStopped()).to.be.true
      expect(peer.isOnline()).to.be.false
    })

    it('isOnline() should return false for FAILED state', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.FAILED)
      expect(peer.isOnline()).to.be.false
    })

    it('isOnline() should return false for STOPPED state', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.STOPPED)
      expect(peer.isOnline()).to.be.false
    })

    it('isOnline() should return true for all other states', () => {
      const peer = new PeerInfo({ id: 'test' })
      
      peer.setState(PeerState.CONNECTED)
      expect(peer.isOnline()).to.be.true
      
      peer.setState(PeerState.HEALTHY)
      expect(peer.isOnline()).to.be.true
      
      peer.setState(PeerState.GHOST)
      expect(peer.isOnline()).to.be.true
    })
  })

  describe('State Transitions', () => {
    it('setOnline() should transition to HEALTHY', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setOnline()
      expect(peer.getState()).to.equal(PeerState.HEALTHY)
      expect(peer.isHealthy()).to.be.true
    })

    it('setOnline() should reset missed pings', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.missedPings = 5
      peer.setOnline()
      expect(peer.missedPings).to.equal(0)
    })

    it('setOffline() should transition to FAILED', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setOffline()
      expect(peer.getState()).to.equal(PeerState.FAILED)
      expect(peer.isFailed()).to.be.true
    })

    it('setOffline() should preserve STOPPED state', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.STOPPED)
      peer.setOffline()
      expect(peer.getState()).to.equal(PeerState.STOPPED)
    })

    it('markGhost() should transition to GHOST', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.markGhost()
      expect(peer.getState()).to.equal(PeerState.GHOST)
      expect(peer.isGhost()).to.be.true
    })

    it('markGhost() should increment missed pings', () => {
      const peer = new PeerInfo({ id: 'test' })
      expect(peer.missedPings).to.equal(0)
      peer.markGhost()
      expect(peer.missedPings).to.equal(1)
      peer.markGhost()
      expect(peer.missedPings).to.equal(2)
    })

    it('markFailed() should transition to FAILED', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.markFailed()
      expect(peer.getState()).to.equal(PeerState.FAILED)
      expect(peer.isFailed()).to.be.true
    })

    it('markFailed() should reset missed pings', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.missedPings = 5
      peer.markFailed()
      expect(peer.missedPings).to.equal(0)
    })

    it('markStopped() should transition to STOPPED', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.markStopped()
      expect(peer.getState()).to.equal(PeerState.STOPPED)
      expect(peer.isStopped()).to.be.true
    })

    it('markStopped() should reset missed pings', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.missedPings = 3
      peer.markStopped()
      expect(peer.missedPings).to.equal(0)
    })

    it('transition() should update lastStateChange timestamp', () => {
      const peer = new PeerInfo({ id: 'test' })
      const before = Date.now()
      peer.transition(PeerState.HEALTHY)
      const after = Date.now()
      expect(peer.lastStateChange).to.be.at.least(before)
      expect(peer.lastStateChange).to.be.at.most(after)
    })

    it('setState() should call transition()', () => {
      const peer = new PeerInfo({ id: 'test' })
      const before = peer.lastStateChange
      peer.setState(PeerState.HEALTHY)
      expect(peer.getState()).to.equal(PeerState.HEALTHY)
      expect(peer.lastStateChange).to.be.at.least(before)
    })
  })

  describe('Heartbeat Tracking', () => {
    it('updateLastSeen() should update lastSeen timestamp', () => {
      const peer = new PeerInfo({ id: 'test' })
      const initial = peer.getLastSeen()
      
      // Wait a bit
      const now = Date.now() + 100
      peer.updateLastSeen(now)
      
      expect(peer.getLastSeen()).to.equal(now)
      expect(peer.getLastSeen()).to.be.greaterThan(initial)
    })

    it('updateLastSeen() should use current time if no timestamp provided', () => {
      const peer = new PeerInfo({ id: 'test' })
      const before = Date.now()
      peer.updateLastSeen()
      const after = Date.now()
      expect(peer.getLastSeen()).to.be.at.least(before)
      expect(peer.getLastSeen()).to.be.at.most(after)
    })

    it('getLastSeen() should return lastSeen value', () => {
      const peer = new PeerInfo({ id: 'test' })
      const timestamp = Date.now()
      peer.lastSeen = timestamp
      expect(peer.getLastSeen()).to.equal(timestamp)
    })

    it('ping() should update lastPing timestamp', () => {
      const peer = new PeerInfo({ id: 'test' })
      const timestamp = Date.now()
      peer.ping(timestamp)
      expect(peer.lastPing).to.equal(timestamp)
    })

    it('ping() should update lastSeen to lastPing value', () => {
      const peer = new PeerInfo({ id: 'test' })
      const timestamp = Date.now()
      peer.ping(timestamp)
      expect(peer.getLastSeen()).to.equal(timestamp)
      expect(peer.lastPing).to.equal(peer.getLastSeen())
    })

    it('ping() should reset missed pings counter', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.missedPings = 3
      peer.ping()
      expect(peer.missedPings).to.equal(0)
    })

    it('ping() should transition GHOST to HEALTHY', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.GHOST)
      peer.ping()
      expect(peer.getState()).to.equal(PeerState.HEALTHY)
      expect(peer.isHealthy()).to.be.true
    })

    it('ping() should transition CONNECTED to HEALTHY', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.CONNECTED)
      peer.ping()
      expect(peer.getState()).to.equal(PeerState.HEALTHY)
    })

    it('ping() should keep HEALTHY state', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.HEALTHY)
      peer.ping()
      expect(peer.getState()).to.equal(PeerState.HEALTHY)
    })

    it('ping() should use current time if no timestamp provided', () => {
      const peer = new PeerInfo({ id: 'test' })
      const before = Date.now()
      peer.ping()
      const after = Date.now()
      expect(peer.lastPing).to.be.at.least(before)
      expect(peer.lastPing).to.be.at.most(after)
    })
  })

  describe('Identity Management', () => {
    it('getId() should return peer id', () => {
      const peer = new PeerInfo({ id: 'my-peer' })
      expect(peer.getId()).to.equal('my-peer')
    })

    it('setId() should update peer id', () => {
      const peer = new PeerInfo({ id: 'old-id' })
      peer.setId('new-id')
      expect(peer.getId()).to.equal('new-id')
    })

    it('getAddress() should return peer address', () => {
      const peer = new PeerInfo({ id: 'test', address: 'tcp://127.0.0.1:5000' })
      expect(peer.getAddress()).to.equal('tcp://127.0.0.1:5000')
    })

    it('setAddress() should update peer address', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setAddress('tcp://192.168.1.1:8000')
      expect(peer.getAddress()).to.equal('tcp://192.168.1.1:8000')
    })
  })

  describe('Options Management', () => {
    it('getOptions() should return peer options', () => {
      const options = { role: 'worker', region: 'us-east' }
      const peer = new PeerInfo({ id: 'test', options })
      expect(peer.getOptions()).to.deep.equal(options)
    })

    it('setOptions() should replace options entirely', () => {
      const peer = new PeerInfo({ id: 'test', options: { role: 'worker' } })
      peer.setOptions({ region: 'eu-west', priority: 1 })
      expect(peer.getOptions()).to.deep.equal({ region: 'eu-west', priority: 1 })
    })

    it('mergeOptions() should merge new options with existing', () => {
      const peer = new PeerInfo({ id: 'test', options: { role: 'worker', region: 'us-east' } })
      peer.mergeOptions({ priority: 1, region: 'eu-west' })
      expect(peer.getOptions()).to.deep.equal({
        role: 'worker',
        region: 'eu-west',
        priority: 1
      })
    })

    it('mergeOptions() should not mutate original options', () => {
      const original = { role: 'worker' }
      const peer = new PeerInfo({ id: 'test', options: original })
      peer.mergeOptions({ region: 'us-east' })
      expect(original).to.deep.equal({ role: 'worker' })
    })

    it('mergeOptions() should return merged options', () => {
      const peer = new PeerInfo({ id: 'test', options: { role: 'worker' } })
      const result = peer.mergeOptions({ region: 'us-east' })
      expect(result).to.deep.equal({ role: 'worker', region: 'us-east' })
    })
  })

  describe('Serialization', () => {
    it('toJSON() should include all peer metadata', () => {
      const peer = new PeerInfo({ 
        id: 'test-peer',
        address: 'tcp://127.0.0.1:5000',
        options: { role: 'worker' },
        role: 'client'
      })
      peer.setState(PeerState.HEALTHY)
      peer.ping()
      
      const json = peer.toJSON()
      expect(json).to.have.property('id', 'test-peer')
      expect(json).to.have.property('address', 'tcp://127.0.0.1:5000')
      expect(json).to.have.property('options')
      expect(json.options).to.deep.equal({ role: 'worker' })
      expect(json).to.have.property('role', 'client')
      expect(json).to.have.property('state', PeerState.HEALTHY)
    })

    it('toJSON() should include legacy fields (ghost, fail, stop)', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.setState(PeerState.GHOST)
      
      const json = peer.toJSON()
      expect(json).to.have.property('ghost', true)
      expect(json).to.have.property('fail', false)
      expect(json).to.have.property('stop', false)
    })

    it('toJSON() should compute online status correctly', () => {
      const peer = new PeerInfo({ id: 'test' })
      
      peer.setState(PeerState.HEALTHY)
      expect(peer.toJSON().online).to.be.true
      
      peer.setState(PeerState.FAILED)
      expect(peer.toJSON().online).to.be.false
      
      peer.setState(PeerState.STOPPED)
      expect(peer.toJSON().online).to.be.false
    })

    it('toJSON() should include heartbeat metadata', () => {
      const peer = new PeerInfo({ id: 'test' })
      peer.missedPings = 2
      peer.ping(12345)
      
      const json = peer.toJSON()
      expect(json).to.have.property('connectedAt')
      expect(json).to.have.property('lastPing', 12345)
      expect(json).to.have.property('missedPings', 0) // Reset by ping()
    })
  })
})

