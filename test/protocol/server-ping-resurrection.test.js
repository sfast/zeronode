/**
 * Ping Resurrection Test
 * 
 * Tests the fix for ghost state when a client times out but continues pinging.
 * This test simulates:
 * 1. Client connects and handshakes successfully
 * 2. Server times out the client (removes from clientLastSeen)
 * 3. Client sends ping after timeout
 * 4. Server should request fresh handshake (REQUEST_HANDSHAKE)
 * 5. Client responds with handshake including full options
 * 6. Server re-emits CLIENT_JOINED with full options
 */

import { expect } from 'chai'
import Server, { ServerEvent } from '../../src/protocol/server.js'
import Client, { ClientEvent } from '../../src/protocol/client.js'
import { ProtocolSystemEvent } from '../../src/protocol/protocol.js'
import { TIMING, wait } from '../test-utils.js'

describe('Server - Ping Resurrection Fix', () => {
  let server
  let client
  let serverAddress

  beforeEach(async () => {
    // Create server with short timeouts for faster testing
    server = new Server({
      id: 'test-server',
      config: {
        CLIENT_HEALTH_CHECK_INTERVAL: 500,  // Check every 500ms (faster than default 30s)
        CLIENT_GHOST_TIMEOUT: 1000,         // Timeout after 1s (faster than default 60s)
        logger: {
          warn: () => {},  // Silent logger for tests
          error: () => {},
          info: () => {}
        }
      }
    })

    await server.bind('tcp://127.0.0.1:0')
    serverAddress = server.getAddress()
    await wait(TIMING.BIND_READY)
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

    await wait(TIMING.AFTER_EACH_CLEANUP)
  })

  describe('Resurrection Detection', () => {
    it('should request fresh handshake when client pings after timeout', async function() {
      this.timeout(10000)  // This test takes a while due to timeout simulation

      // Track events
      const events = {
        clientJoined: [],
        clientLeft: [],
        systemMessages: []
      }

      server.on(ServerEvent.CLIENT_JOINED, ({ clientId, clientOptions }) => {
        events.clientJoined.push({ clientId, clientOptions, timestamp: Date.now() })
      })

      server.on(ServerEvent.CLIENT_LEFT, ({ clientId, reason }) => {
        events.clientLeft.push({ clientId, reason, timestamp: Date.now() })
      })

      // Create client with options and short ping interval for faster testing
      client = new Client({
        id: 'test-client',
        options: { role: 'service', name: 'test-service', version: '1.0.0' },  // ← Full options
        config: {
          PING_INTERVAL: 200,  // Ping every 200ms (faster than default 10s)
          logger: {
            warn: () => {},
            error: () => {},
            info: () => {}
          }
        }
      })

      // Step 1: Client connects normally
      await client.connect(serverAddress)
      await wait(TIMING.CONNECT_READY)

      // Verify initial CLIENT_JOINED was emitted with full options
      expect(events.clientJoined).to.have.lengthOf(1)
      expect(events.clientJoined[0].clientId).to.equal('test-client')
      expect(events.clientJoined[0].clientOptions).to.deep.equal({
        role: 'service',
        name: 'test-service',
        version: '1.0.0'
      })

      console.log('✅ Step 1: Initial handshake complete with full options')

      // Step 2: Stop client pings to simulate network failure
      const originalIsOnline = client.isOnline.bind(client)
      client.isOnline = () => false  // Client will stop sending pings

      // Wait for health check to time out the client
      // CLIENT_HEALTH_CHECK_INTERVAL=500ms + CLIENT_GHOST_TIMEOUT=1000ms = ~1.5s
      await wait(2000)

      // Verify CLIENT_LEFT was emitted with TIMEOUT reason
      expect(events.clientLeft).to.have.lengthOf(1)
      expect(events.clientLeft[0].clientId).to.equal('test-client')
      expect(events.clientLeft[0].reason).to.equal('TIMEOUT')

      console.log('✅ Step 2: Client timed out')

      // Step 3: Resume client pings (simulate network recovery)
      client.isOnline = originalIsOnline

      // Wait for at least one ping to be sent and REQUEST_HANDSHAKE to be processed
      await wait(800)

      // 🔥 CRITICAL: Verify CLIENT_JOINED was re-emitted with FULL options
      // The client should have responded to REQUEST_HANDSHAKE with full handshake
      expect(events.clientJoined.length).to.be.at.least(2)
      
      const resurrectionJoin = events.clientJoined[events.clientJoined.length - 1]
      expect(resurrectionJoin.clientId).to.equal('test-client')
      
      // Verify full options were restored (not empty!)
      expect(resurrectionJoin.clientOptions).to.deep.equal({
        role: 'service',
        name: 'test-service',
        version: '1.0.0'
      })

      // Verify the resurrection happened AFTER the timeout
      expect(resurrectionJoin.timestamp).to.be.greaterThan(events.clientLeft[0].timestamp)

      console.log('✅ Step 3: Client resurrected with FULL options!')
      console.log(`   - Initial join: ${new Date(events.clientJoined[0].timestamp).toISOString()}`)
      console.log(`   - Timeout: ${new Date(events.clientLeft[0].timestamp).toISOString()}`)
      console.log(`   - Resurrection: ${new Date(resurrectionJoin.timestamp).toISOString()}`)
      console.log(`   - Options restored:`, resurrectionJoin.clientOptions)
    })

    it('should handle multiple pings without duplicate handshake requests', async function() {
      this.timeout(10000)

      let requestHandshakeCount = 0
      const events = {
        clientJoined: [],
        clientLeft: []
      }

      server.on(ServerEvent.CLIENT_JOINED, ({ clientId, clientOptions }) => {
        events.clientJoined.push({ clientId, clientOptions })
      })

      server.on(ServerEvent.CLIENT_LEFT, ({ clientId }) => {
        events.clientLeft.push(clientId)
      })

      client = new Client({
        id: 'test-client',
        options: { role: 'service', name: 'test-service' },
        config: {
          PING_INTERVAL: 100,  // Ping very frequently
          logger: { warn: () => {}, error: () => {}, info: () => {} }
        }
      })

      // Count REQUEST_HANDSHAKE messages sent by server
      const originalSendSystemTick = server._sendSystemTick.bind(server)
      server._sendSystemTick = function(opts) {
        if (opts.event === ProtocolSystemEvent.REQUEST_HANDSHAKE) {
          requestHandshakeCount++
          console.log(`   → REQUEST_HANDSHAKE sent (count: ${requestHandshakeCount})`)
        }
        return originalSendSystemTick(opts)
      }

      await client.connect(serverAddress)
      await wait(TIMING.CONNECT_READY)

      const originalIsOnline = client.isOnline.bind(client)

      // Cause timeout
      client.isOnline = () => false
      await wait(2000)
      expect(events.clientLeft).to.have.lengthOf(1)

      console.log('✅ Client timed out')

      // Resume pings - many will be sent in quick succession
      client.isOnline = originalIsOnline
      
      // Wait for multiple ping cycles
      await wait(1000)  // 10+ pings will be sent

      // 🔥 CRITICAL: Only ONE REQUEST_HANDSHAKE should have been sent
      expect(requestHandshakeCount).to.equal(1)
      
      // And full handshake should have completed
      expect(events.clientJoined.length).to.be.at.least(2)
      const resurrectionJoin = events.clientJoined[events.clientJoined.length - 1]
      expect(resurrectionJoin.clientOptions).to.deep.equal({
        role: 'service',
        name: 'test-service'
      })

      console.log('✅ Test passed: Only ONE REQUEST_HANDSHAKE sent despite multiple pings!')
      console.log(`   - REQUEST_HANDSHAKE count: ${requestHandshakeCount}`)
      console.log(`   - CLIENT_JOINED count: ${events.clientJoined.length}`)
    })

    it('should not request handshake for normal pings', async function() {
      this.timeout(5000)

      let requestHandshakeCount = 0
      const events = []

      server.on(ServerEvent.CLIENT_JOINED, ({ clientId }) => {
        events.push(clientId)
      })

      client = new Client({
        id: 'test-client',
        options: { role: 'service' },
        config: {
          PING_INTERVAL: 100,  // Ping frequently
          logger: { warn: () => {}, error: () => {}, info: () => {} }
        }
      })

      // Count REQUEST_HANDSHAKE messages
      const originalSendSystemTick = server._sendSystemTick.bind(server)
      server._sendSystemTick = function(opts) {
        if (opts.event === ProtocolSystemEvent.REQUEST_HANDSHAKE) {
          requestHandshakeCount++
        }
        return originalSendSystemTick(opts)
      }

      await client.connect(serverAddress)
      await wait(TIMING.CONNECT_READY)

      // Verify initial CLIENT_JOINED
      expect(events).to.have.lengthOf(1)

      // Wait for several ping cycles (should NOT trigger additional CLIENT_JOINED or REQUEST_HANDSHAKE)
      await wait(1000)  // 10 pings will be sent

      // Should still only have one CLIENT_JOINED (no false positives)
      expect(events).to.have.lengthOf(1)
      
      // Should have ZERO REQUEST_HANDSHAKE messages
      expect(requestHandshakeCount).to.equal(0)

      console.log('✅ Test passed: Normal pings do not trigger resurrection or handshake requests')
    })
  })
})
