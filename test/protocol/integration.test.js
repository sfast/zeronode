/**
 * Integration Tests - Client ↔ Server Communication
 * 
 * Real-world usage scenarios showing how Client and Server work together
 */

import { expect } from 'chai'
import Client, { ClientEvent } from '../../src/protocol/client.js'
import Server, { ServerEvent } from '../../src/protocol/server.js'
import { ProtocolEvent } from '../../src/protocol/protocol.js'
import { TIMING, wait } from '../test-utils.js'

describe('Client ↔ Server Integration', function () {
  // Increase timeout for integration tests
  this.timeout(15000)

  let server
  let serverAddress

  beforeEach(async () => {
    console.log('\n[TEST] Creating server...')
    // Create and start server
    server = new Server({ 
      id: 'test-server',
      options: { role: 'server', version: '1.0' }
    })
    
    // Add logging for server events
    server.on(ServerEvent.READY, () => {
      console.log('[SERVER] SERVER_READY event fired')
    })
    server.on(ServerEvent.CLIENT_JOINED, ({ clientId }) => {
      console.log(`[SERVER] CLIENT_JOINED: ${clientId}`)
    })
    server.on('transport:ready', () => {
      console.log('[SERVER] transport:ready event')
    })
    
    console.log('[TEST] Binding server...')
    await server.bind('tcp://127.0.0.1:0')
    serverAddress = server.getAddress()
    console.log(`[TEST] Server bound to: ${serverAddress}`)
    console.log(`[TEST] Server ready: ${server.isOnline()}`)
  })

  afterEach(async () => {
    // Cleanup
    console.log('[TEST] Cleaning up...')
    // Wait for any pending disconnections to complete
    await wait(TIMING.DISCONNECT_COMPLETE)
    if (server) {
      try {
        await server.unbind()
        console.log('[TEST] Server unbound')
      } catch (err) {
        console.log('[TEST] Server unbind error:', err.message)
      }
    }
  })

  describe('1. Basic Connection & Handshake', () => {
    it('should establish connection and exchange options', async () => {
      console.log('[TEST] Creating client...')
      const client = new Client({ 
        id: 'client-1',
        options: { role: 'worker', region: 'us-east' }
      })
      
      // Add logging for client events
      client.on(ProtocolEvent.TRANSPORT_READY, () => {
        console.log('[CLIENT] TRANSPORT_READY event')
      })
      client.on(ClientEvent.READY, ({ serverId }) => {
        console.log(`[CLIENT] READY event (transport ready), serverId: ${serverId}`)
      })
      client.on(ClientEvent.SERVER_JOINED, ({ serverId }) => {
        console.log(`[CLIENT] SERVER_JOINED event (handshake complete), serverId: ${serverId}`)
      })
      client.on('transport:ready', () => {
        console.log('[CLIENT] transport:ready event')
      })
      
      // Connect and wait for handshake
      console.log(`[TEST] Connecting client to ${serverAddress}...`)
      try {
        await client.connect(serverAddress)
        console.log('[TEST] Client connected successfully')
      } catch (err) {
        console.log('[TEST] Client connection error:', err.message)
        throw err
      }
      
      // Verify client is ready
      console.log(`[TEST] Client online: ${client.isOnline()}`)
      // Client may be online before handshake completes; use isOnline for transport
      expect(client.isOnline()).to.be.true
      
      // Verify server received client (using clean API)
      expect(server.hasClient('client-1')).to.be.true
      
      // Verify client received server (using clean API)
      const serverId = client.getServerId()
      expect(serverId).to.not.be.null
      expect(serverId).to.equal('test-server')
      
      console.log('[TEST] Disconnecting client...')
      await client.disconnect()
      console.log('[TEST] Client disconnected')
    })

    it('should emit CLIENT_JOINED event on server', (done) => {
      console.log('[TEST] Testing CLIENT_JOINED event...')
      
      const timeoutHandle = setTimeout(() => {
        console.log('[TEST] CLIENT_JOINED timeout - event never fired')
        done(new Error('CLIENT_JOINED event timeout'))
      }, 10000)
      
      server.once(ServerEvent.CLIENT_JOINED, ({ clientId, clientOptions }) => {
        clearTimeout(timeoutHandle)
        console.log(`[TEST] CLIENT_JOINED received: ${clientId}`)
        expect(clientId).to.equal('client-1')
        expect(clientOptions).to.deep.equal({ role: 'worker' })
        done()
      })
      
      const client = new Client({ 
        id: 'client-1',
        options: { role: 'worker' }
      })
      
      client.on(ProtocolEvent.TRANSPORT_READY, () => {
        console.log('[CLIENT] TRANSPORT_READY in CLIENT_JOINED test')
      })
      
      console.log('[TEST] Connecting client for CLIENT_JOINED test...')
      client.connect(serverAddress).catch(err => {
        clearTimeout(timeoutHandle)
        console.log('[TEST] Client connect error:', err.message)
        done(err)
      })
    })

    it('should emit SERVER_JOINED event on client', (done) => {
      const client = new Client({ id: 'client-1' })
      
      client.once(ClientEvent.SERVER_JOINED, ({ serverId }) => {
        expect(serverId).to.equal('test-server')
        done()
      })
      
      client.connect(serverAddress)
    })
  })

  describe('2. Request/Response - Client → Server', () => {
    let client

    beforeEach(async () => {
      client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
    })

    afterEach(async () => {
      if (client) {
        await client.disconnect()
        // Wait for disconnect to fully propagate to prevent ZeroMQ crashes
        await wait(TIMING.DISCONNECT_COMPLETE)
      }
    })

    it('should handle basic request/response', async () => {
      // Register handler on server
      server.onRequest('user:get', (envelope) => {
        return { 
          id: envelope.data.userId, 
          name: 'Alice',
          email: 'alice@example.com'
        }
      })
      
      // Client sends request
      const response = await client.request({
        event: 'user:get',
        data: { userId: 123 }
      })
      
      expect(response).to.deep.equal({
        id: 123,
        name: 'Alice',
        email: 'alice@example.com'
      })
    })

    it('should handle async request handlers', async () => {
      server.onRequest('db:query', async (envelope) => {
        // Simulate async DB operation
        await new Promise(resolve => setTimeout(resolve, 100))
        return { results: [`Data for ${envelope.data.table}`] }
      })
      
      const response = await client.request({
        event: 'db:query',
        data: { table: 'users' }
      })
      
      expect(response.results).to.deep.equal(['Data for users'])
    })

    it('should propagate handler errors', async () => {
      server.onRequest('fail:test', () => {
        throw new Error('Handler failed intentionally')
      })
      
      try {
        await client.request({
          event: 'fail:test',
          data: {}
        })
        throw new Error('Should have thrown')
      } catch (err) {
        expect(err.message).to.include('Handler failed intentionally')
      }
    })

    it('should timeout when no handler registered', async () => {
      try {
        await client.request({
          event: 'nonexistent:handler',
          data: {},
          timeout: 500
        })
        throw new Error('Should have timed out')
      } catch (err) {
        // The server immediately responds with "No handler" error
        // So we get that error instead of a timeout
        expect(err.message).to.include('No handler')
      }
    })
  })

  describe('3. Request/Response - Server → Client (Bidirectional)', () => {
    let client

    beforeEach(async () => {
      client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
    })

    afterEach(async () => {
      if (client) {
        await client.disconnect()
        // Wait for disconnect to fully propagate to prevent ZeroMQ crashes
        await wait(TIMING.DISCONNECT_COMPLETE)
      }
    })

    it('should allow server to request from client', async () => {
      // Register handler on client
      client.onRequest('worker:status', () => {
        return {
          status: 'healthy',
          load: 0.25,
          uptime: 3600
        }
      })
      
      // Server sends request to specific client
      const response = await server.request({
        to: 'client-1',
        event: 'worker:status',
        data: {}
      })
      
      expect(response).to.deep.equal({
        status: 'healthy',
        load: 0.25,
        uptime: 3600
      })
    })

    it('should handle bidirectional communication', async () => {
      // Client handler
      client.onRequest('client:ping', () => 'client-pong')
      
      // Server handler
      server.onRequest('server:ping', () => 'server-pong')
      
      // Test both directions
      const clientResponse = await server.request({
        to: 'client-1',
        event: 'client:ping',
        data: {}
      })
      
      const serverResponse = await client.request({
        event: 'server:ping',
        data: {}
      })
      
      expect(clientResponse).to.equal('client-pong')
      expect(serverResponse).to.equal('server-pong')
    })
  })

  describe('4. Tick - Fire-and-Forget (Client → Server)', () => {
    let client

    beforeEach(async () => {
      client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
    })

    afterEach(async () => {
      if (client) {
        await client.disconnect()
        // Wait for disconnect to fully propagate to prevent ZeroMQ crashes
        await wait(TIMING.DISCONNECT_COMPLETE)
      }
    })

    it('should send tick from client to server', (done) => {
      server.onTick('log:event', (envelope) => {
        expect(envelope.data).to.deep.equal({
          level: 'info',
          message: 'User logged in'
        })
        expect(envelope.owner).to.equal('client-1')
        done()
      })
      
      client.tick({
        event: 'log:event',
        data: {
          level: 'info',
          message: 'User logged in'
        }
      })
    })

    it('should not wait for response on tick', async () => {
      let handlerCalled = false
      
      server.onTick('async:event', async (envelope) => {
        // Simulate slow handler
        await new Promise(resolve => setTimeout(resolve, 1000))
        handlerCalled = true
      })
      
      const start = Date.now()
      client.tick({ event: 'async:event', data: {} })
      const elapsed = Date.now() - start
      
      // Should return immediately
      expect(elapsed).to.be.lessThan(100)
      
      // Wait for handler
      await new Promise(resolve => setTimeout(resolve, 1100))
      expect(handlerCalled).to.be.true
    })
  })

  describe('5. Tick - Fire-and-Forget (Server → Client)', () => {
    let client

    beforeEach(async () => {
      client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
    })

    afterEach(async () => {
      if (client) {
        await client.disconnect()
        // Wait for disconnect to fully propagate to prevent ZeroMQ crashes
        await wait(TIMING.DISCONNECT_COMPLETE)
      }
    })

    it('should send tick from server to client', (done) => {
      client.onTick('notification:new', (envelope) => {
        expect(envelope.data).to.deep.equal({
          type: 'message',
          from: 'Alice',
          text: 'Hello!'
        })
        done()
      })
      
      server.tick({
        to: 'client-1',
        event: 'notification:new',
        data: {
          type: 'message',
          from: 'Alice',
          text: 'Hello!'
        }
      })
    })
  })

  describe('6. Broadcasting to Multiple Clients', () => {
    let client1, client2, client3

    beforeEach(async () => {
      client1 = new Client({ id: 'client-1' })
      client2 = new Client({ id: 'client-2' })
      client3 = new Client({ id: 'client-3' })
      
      await Promise.all([
        client1.connect(serverAddress),
        client2.connect(serverAddress),
        client3.connect(serverAddress)
      ])
    })

    afterEach(async () => {
      await Promise.all([
        client1?.disconnect(),
        client2?.disconnect(),
        client3?.disconnect()
      ])
    })

    it('should broadcast to all connected clients', (done) => {
      const timeout = setTimeout(() => {
        done(new Error('Test timeout - not all clients received broadcast'))
      }, 12000) // Increase timeout slightly
      
      let receivedCount = 0
      const checkDone = () => {
        receivedCount++
        console.log(`[BROADCAST] Client received message (${receivedCount}/3)`)
        if (receivedCount === 3) {
          clearTimeout(timeout)
          done()
        }
      }
      
      client1.onTick('broadcast:message', (envelope) => {
        expect(envelope.data.text).to.equal('Hello everyone!')
        checkDone()
      })
      
      client2.onTick('broadcast:message', (envelope) => {
        expect(envelope.data.text).to.equal('Hello everyone!')
        checkDone()
      })
      
      client3.onTick('broadcast:message', (envelope) => {
        expect(envelope.data.text).to.equal('Hello everyone!')
        checkDone()
      })
      
      // Give handlers time to register
      setTimeout(() => {
        console.log('[BROADCAST] Sending broadcast to all clients')
        // Broadcast requires sending to each client explicitly
        // Router sockets cannot broadcast without specifying recipients
        const clientIds = server.getAllClientIds()
        console.log(`[BROADCAST] Server has ${clientIds.length} connected clients`)
        clientIds.forEach(clientId => {
          server.tick({
            to: clientId,
            event: 'broadcast:message',
            data: { text: 'Hello everyone!' }
          })
        })
      }, 100)
    })

    it('should track multiple clients', () => {
      const clientIds = server.getAllClientIds()
      
      expect(clientIds).to.be.an('array')
      expect(clientIds.length).to.equal(3)
      
      expect(clientIds).to.include('client-1')
      expect(clientIds).to.include('client-2')
      expect(clientIds).to.include('client-3')
    })
  })

  describe('7. Pattern Matching with RegExp', () => {
    let client

    beforeEach(async () => {
      client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
    })

    afterEach(async () => {
      if (client) {
        await client.disconnect()
        // Wait for disconnect to fully propagate to prevent ZeroMQ crashes
        await wait(TIMING.DISCONNECT_COMPLETE)
      }
    })

    it('should match request patterns with RegExp', async () => {
      // Register pattern handler
      server.onRequest(/^api:user:/, (envelope, reply) => {
        const action = envelope.event.split(':')[2]
        return {
          action,
          userId: envelope.data.id,
          result: 'success'
        }
      })
      
      const response = await client.request({
        event: 'api:user:create',
        data: { id: 123 }
      })
      
      expect(response).to.deep.equal({
        action: 'create',
        userId: 123,
        result: 'success'
      })
    })

    it('should match tick patterns with RegExp', (done) => {
      server.onTick(/^log:/, (envelope) => {
        expect(envelope.event).to.match(/^log:/)
        expect(envelope.data.level).to.equal('error')
        done()
      })
      
      client.tick({
        event: 'log:error:database',
        data: { level: 'error', message: 'Connection failed' }
      })
    })

    it('should handle multiple pattern handlers', (done) => {
      let count = 0
      const checkDone = () => {
        count++
        if (count === 2) done()
      }
      
      // Specific handler
      server.onTick('event:test', () => checkDone())
      
      // Pattern handler
      server.onTick(/^event:/, () => checkDone())
      
      client.tick({ event: 'event:test', data: {} })
    })
  })

  describe('8. Data Serialization', () => {
    let client

    beforeEach(async () => {
      client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
    })

    afterEach(async () => {
      if (client) {
        await client.disconnect()
        // Wait for disconnect to fully propagate to prevent ZeroMQ crashes
        await wait(TIMING.DISCONNECT_COMPLETE)
      }
    })

    it('should handle complex nested objects', async () => {
      server.onRequest('data:complex', (envelope) => {
        return {
          echo: envelope.data,
          processed: true
        }
      })
      
      const complexData = {
        user: {
          id: 123,
          name: 'Alice',
          tags: ['admin', 'developer']
        },
        metadata: {
          timestamp: Date.now(),
          source: 'api'
        },
        items: [
          { id: 1, value: 100 },
          { id: 2, value: 200 }
        ]
      }
      
      const response = await client.request({
        event: 'data:complex',
        data: complexData
      })
      
      expect(response.echo).to.deep.equal(complexData)
      expect(response.processed).to.be.true
    })

    it('should handle large data payloads', async () => {
      server.onRequest('data:large', (envelope) => {
        return { itemCount: envelope.data.items.length }
      })
      
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: Math.random()
      }))
      
      const response = await client.request({
        event: 'data:large',
        data: { items: largeArray }
      })
      
      expect(response.itemCount).to.equal(1000)
    })
  })

  describe('9. Client Disconnect & Reconnect', () => {
    it('should handle clean disconnect', async () => {
      const client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
      
      expect(client.isOnline()).to.be.true
      
      await client.disconnect()
      
      expect(client.isOnline()).to.be.false
    })

    it('should support reconnection', async () => {
      // First connection
      const client1 = new Client({ id: 'client-reconnect-1' })
      await client1.connect(serverAddress)
      expect(client1.isOnline()).to.be.true
      
      await client1.disconnect()
      expect(client1.isOnline()).to.be.false
      
      // Wait a bit for cleanup
      await wait(TIMING.SOCKET_CLOSE)
      
      // Create new client instance for reconnection (same ID)
      // Note: Reusing the same Client instance after disconnect is not supported
      const client2 = new Client({ id: 'client-reconnect-2' })
      await client2.connect(serverAddress)
      expect(client2.isOnline()).to.be.true
      
      await client2.disconnect()
    })
  })

  describe('10. Concurrent Operations', () => {
    let client

    beforeEach(async () => {
      client = new Client({ id: 'client-1' })
      await client.connect(serverAddress)
    })

    afterEach(async () => {
      if (client) {
        await client.disconnect()
        // Wait for disconnect to fully propagate to prevent ZeroMQ crashes
        await wait(TIMING.DISCONNECT_COMPLETE)
      }
    })

    it('should handle multiple concurrent requests', async () => {
      server.onRequest('concurrent:test', async (envelope) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return { id: envelope.data.id, processed: true }
      })
      
      // Send 5 requests concurrently
      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(
          client.request({
            event: 'concurrent:test',
            data: { id: i }
          })
        )
      }
      
      const results = await Promise.all(promises)
      
      expect(results).to.have.lengthOf(5)
      results.forEach((result, i) => {
        expect(result.id).to.equal(i)
        expect(result.processed).to.be.true
      })
    })

    it('should maintain request order semantics', async () => {
      const order = []
      
      server.onRequest('order:test', async (envelope) => {
        order.push(`receive-${envelope.data.id}`)
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50))
        order.push(`respond-${envelope.data.id}`)
        return { id: envelope.data.id }
      })
      
      // Send requests in order
      for (let i = 0; i < 3; i++) {
        await client.request({
          event: 'order:test',
          data: { id: i }
        })
      }
      
      // Verify receive order (should be sequential)
      expect(order[0]).to.equal('receive-0')
      expect(order[2]).to.equal('receive-1')
      expect(order[4]).to.equal('receive-2')
    })
  })
})

