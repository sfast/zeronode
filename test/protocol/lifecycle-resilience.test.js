import { expect } from 'chai'
import Server, { ServerEvent } from '../../src/protocol/server.js'
import Client, { ClientEvent } from '../../src/protocol/client.js'
import { TransportEvent } from '../../src/transport/events.js'

// Utility to wait for a single event once
function once (emitter, event) {
  return new Promise((resolve, reject) => {
    const onErr = (err) => {
      cleanup()
      reject(err)
    }
    const onEvt = (...args) => {
      cleanup()
      resolve(args)
    }
    const cleanup = () => {
      emitter.off('error', onErr)
      emitter.off(event, onEvt)
    }
    emitter.once('error', onErr)
    emitter.once(event, onEvt)
  })
}

describe('Lifecycle Resilience', function () {
  this.timeout(10000)

  describe('Server bind/unbind cycles', () => {
    let server

    afterEach(async () => {
      if (server) {
        try { await server.close() } catch {}
        server = null
      }
    })

    it('should not accumulate protocol transport listeners across bind/unbind cycles', async function () {
      this.timeout(30000)
      server = new Server({ id: 'lifecycle-server' })
      const socket = server._getSocket()

      // Initial counts (after Protocol attached its listeners once)
      const initialCounts = {
        MESSAGE: socket.listenerCount(TransportEvent.MESSAGE),
        READY: socket.listenerCount(TransportEvent.READY),
        NOT_READY: socket.listenerCount(TransportEvent.NOT_READY),
        CLOSED: socket.listenerCount(TransportEvent.CLOSED),
        ERROR: socket.listenerCount(TransportEvent.ERROR)
      }

      // Perform multiple bind/unbind cycles
      for (let i = 0; i < 2; i++) {
        // READY listener must be attached before bind to avoid race
        const readyP = once(server, ServerEvent.READY)
        await server.bind('tcp://127.0.0.1:0')
        await readyP

        // Unbind transport; NOT_READY is expected but can be timing-sensitive on CI.
        // Instead of awaiting the event, allow a short settle delay after unbind.
        await server.unbind()
        await new Promise(r => setTimeout(r, 80))
        // brief settle time between cycles to avoid OS/port churn flakiness
        await new Promise(r => setTimeout(r, 30))
      }

      // Listener counts should not increase
      expect(socket.listenerCount(TransportEvent.MESSAGE)).to.equal(initialCounts.MESSAGE)
      expect(socket.listenerCount(TransportEvent.READY)).to.equal(initialCounts.READY)
      expect(socket.listenerCount(TransportEvent.NOT_READY)).to.equal(initialCounts.NOT_READY)
      expect(socket.listenerCount(TransportEvent.CLOSED)).to.equal(initialCounts.CLOSED)
      expect(socket.listenerCount(TransportEvent.ERROR)).to.equal(initialCounts.ERROR)
    })

    it('should detach protocol listeners after close()', async function () {
      this.timeout(30000)
      server = new Server({ id: 'lifecycle-server-close' })
      const socket = server._getSocket()

      {
        const readyP = once(server, ServerEvent.READY)
        await server.bind('tcp://127.0.0.1:0')
        await readyP
      }

      // server.close() should synchronously trigger protocol teardown and detach listeners
      await server.close()
      // allow minimal microtask/tick for detach to settle
      await new Promise(r => setTimeout(r, 10))
      // After CLOSED path, Protocol detaches its socket listeners
      expect(socket.listenerCount(TransportEvent.MESSAGE)).to.equal(0)
      expect(socket.listenerCount(TransportEvent.READY)).to.equal(0)
      expect(socket.listenerCount(TransportEvent.NOT_READY)).to.equal(0)
      expect(socket.listenerCount(TransportEvent.CLOSED)).to.equal(0)
      expect(socket.listenerCount(TransportEvent.ERROR)).to.equal(0)
    })
  })

  describe('Client connect/disconnect cycles', () => {
    let server
    let client

    beforeEach(async () => {
      server = new Server({ id: 'server-for-client-cycles' })
      {
        const readyP = once(server, ServerEvent.READY)
        await server.bind('tcp://127.0.0.1:0')
        await readyP
      }
    })

    afterEach(async () => {
      if (client) {
        try { await client.close() } catch {}
        client = null
      }
      if (server) {
        try { await server.close() } catch {}
        server = null
      }
    })

    it('should not accumulate protocol transport listeners across connect/disconnect cycles', async function () {
      this.timeout(30000)
      client = new Client({ id: 'lifecycle-client' })
      const socket = client._getSocket()

      // Initial counts (after Protocol attached its listeners once)
      const initialCounts = {
        MESSAGE: socket.listenerCount(TransportEvent.MESSAGE),
        READY: socket.listenerCount(TransportEvent.READY),
        NOT_READY: socket.listenerCount(TransportEvent.NOT_READY),
        CLOSED: socket.listenerCount(TransportEvent.CLOSED),
        ERROR: socket.listenerCount(TransportEvent.ERROR)
      }

      const address = server.getAddress()
      for (let i = 0; i < 2; i++) {
        // client.connect() resolves only after ClientEvent.READY is emitted (handshake complete)
        await client.connect(address)
        await client.disconnect()
        // Client disconnect does not emit a specific event here; allow a brief tick
        await new Promise(r => setTimeout(r, 50))
      }

      // Listener counts should not increase
      expect(socket.listenerCount(TransportEvent.MESSAGE)).to.equal(initialCounts.MESSAGE)
      expect(socket.listenerCount(TransportEvent.READY)).to.equal(initialCounts.READY)
      expect(socket.listenerCount(TransportEvent.NOT_READY)).to.equal(initialCounts.NOT_READY)
      expect(socket.listenerCount(TransportEvent.CLOSED)).to.equal(initialCounts.CLOSED)
      expect(socket.listenerCount(TransportEvent.ERROR)).to.equal(initialCounts.ERROR)
    })
  })
})


