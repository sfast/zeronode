/**
 * Regression: bug 5 — a failed Node.connect() leaked its Client. The DEALER kept
 * reconnecting; once a server appeared it handshook and the Node gained a ghost
 * upstream peer that was not in `clients`, so requestAny failed with NODE_NOT_FOUND.
 *
 * Fix plan: "Bug 5 — failed connect() leaks the client and creates a ghost peer".
 * ZeroMQ transport: the port is found by binding a probe on port 0 and closing it.
 */

import { expect } from 'chai'
import * as zmq from 'zeromq'
import Node, { NodeEvent, NodeErrorCode } from '../../src/index.js'
import Client from '../../src/protocol/client.js'
import { ClientEvent } from '../../src/protocol/client.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function reserveFreeAddress () {
  const probe = new zmq.Router()
  await probe.bind('tcp://127.0.0.1:*')
  const address = probe.lastEndpoint
  probe.close()
  await wait(50)
  return address
}

describe('Regression bug 5: failed connect() does not leak a client', function () {
  this.timeout(10000)

  let client
  let server

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
  })

  it('leaves no ghost upstream peer once a server appears at the address', async () => {
    const address = await reserveFreeAddress()
    client = new Node({ id: `bug5-cli-${Date.now()}`, config: { reconnect: 'disabled' } })

    let connectError
    try {
      await client.connect({ address, timeout: 300 })
    } catch (err) {
      connectError = err
    }
    expect(connectError, 'connect() rejects when nothing listens').to.exist

    server = new Node({ id: `bug5-srv-${Date.now()}` })
    server.onRequest('x', () => 'y')
    await server.bind(address)

    // Old code: the leaked DEALER reconnects within ~100ms and handshakes
    await wait(1000)

    expect(client.getNodesUpstream()).to.deep.equal([])
    expect(server.getNodesDownstream(), 'leaked dealer never handshook').to.deep.equal([])

    let requestError
    try {
      await client.requestAny({ event: 'x', timeout: 300 })
    } catch (err) {
      requestError = err
    }
    expect(requestError?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
  })

  for (const how of ['disconnect', 'close']) {
    it(`${how}() cancels a connect() still waiting for its handshake`, async () => {
      const address = await reserveFreeAddress()
      client = new Node({ id: `bug5-cli-${Date.now()}` })
      const joined = []
      client.on(NodeEvent.PEER_JOINED, (payload) => joined.push(payload))

      const pending = client.connect({ address, timeout: 5000 })
      const outcome = pending.then(() => 'resolved', (err) => err)
      await wait(100)

      const started = Date.now()
      if (how === 'disconnect') {
        await client.disconnect(address)
      } else {
        await client.close()
      }
      const err = await outcome
      expect(err?.code, 'connect() rejects as cancelled').to.equal(NodeErrorCode.CONNECT_CANCELLED)
      expect(Date.now() - started, 'without waiting for the handshake timeout').to.be.below(1000)

      server = new Node({ id: `bug5-srv-${Date.now()}` })
      await server.bind(address)
      await wait(800)

      expect(joined).to.deep.equal([])
      expect(client.getNodesUpstream()).to.deep.equal([])
      expect(server.getNodesDownstream()).to.deep.equal([])
    })
  }

  for (const how of ['disconnect', 'close']) {
    it(`${how}() right as the handshake completes leaves no ghost peer`, async () => {
      server = new Node({ id: `bug5-srv-${Date.now()}` })
      await server.bind('tcp://127.0.0.1:0')
      const address = server.getAddress()
      client = new Node({ id: `bug5-cli-${Date.now()}` })

      const events = []
      client.on(NodeEvent.PEER_LEFT, ({ peerId }) => events.push(`L:${peerId}`))
      let cancelled
      client.on(NodeEvent.PEER_JOINED, ({ peerId }) => {
        events.push(`J:${peerId}`)
        // Lands after SERVER_JOINED but before connect() resumes
        cancelled = how === 'disconnect' ? client.disconnect(address) : client.close()
      })

      const err = await client.connect({ address }).then(() => null, (e) => e)
      await cancelled
      await wait(200)

      expect(err?.code).to.equal(NodeErrorCode.CONNECT_CANCELLED)
      expect(client.getNodesUpstream()).to.deep.equal([])
      expect(events).to.deep.equal([`J:${server.getId()}`, `L:${server.getId()}`])
    })
  }

  it('a caller joining a pending connect() keeps its own shorter timeout', async () => {
    const address = await reserveFreeAddress()
    client = new Node({ id: `bug5-cli-${Date.now()}` })

    const first = client.connect({ address, timeout: 2000 }).then(() => null, (e) => e)
    const started = Date.now()
    const second = await client.connect({ address, timeout: 200 }).then(() => null, (e) => e)

    expect(second, 'second caller rejects').to.be.an('error')
    expect(Date.now() - started).to.be.below(1000)
    await first
  })

  it('connect() after close() rejects and registers nothing', async () => {
    server = new Node({ id: `bug5-srv-${Date.now()}` })
    await server.bind('tcp://127.0.0.1:0')
    client = new Node({ id: `bug5-cli-${Date.now()}` })
    await client.close()

    const err = await client.connect({ address: server.getAddress() }).then(() => null, (e) => e)
    await wait(200)

    expect(err?.code).to.equal(NodeErrorCode.CONNECT_CANCELLED)
    expect(client.getNodesUpstream()).to.deep.equal([])
    expect(server.getNodesDownstream()).to.deep.equal([])
  })

  it('concurrent connect() calls to one address share a single client', async () => {
    server = new Node({ id: `bug5-srv-${Date.now()}` })
    await server.bind('tcp://127.0.0.1:0')
    client = new Node({ id: `bug5-cli-${Date.now()}` })

    const [a, b] = await Promise.all([
      client.connect({ address: server.getAddress() }),
      client.connect({ address: server.getAddress() })
    ])
    expect(a.id).to.equal(server.getId())
    expect(b.id).to.equal(server.getId())

    await client.disconnect(server.getAddress())
    await wait(300)
    expect(server.getNodesDownstream(), 'no second, leaked client stays joined').to.deep.equal([])
  })

  it('Client.connect() removes its SERVER_JOINED listener on handshake timeout', async () => {
    const address = await reserveFreeAddress()
    const raw = new Client({ id: `bug5-raw-${Date.now()}` })
    const before = raw.listenerCount(ClientEvent.SERVER_JOINED)

    try {
      await raw.connect(address, 200)
    } catch (err) {
      // expected: handshake timeout
    }

    try {
      expect(raw.listenerCount(ClientEvent.SERVER_JOINED)).to.equal(before)
    } finally {
      await raw.close().catch(() => {})
    }
  })
})
