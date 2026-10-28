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
import Node, { NodeErrorCode } from '../../src/index.js'
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
