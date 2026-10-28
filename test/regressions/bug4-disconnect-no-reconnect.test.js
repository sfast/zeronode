/**
 * Regression: bug 4 — an explicit Node.disconnect() was undone by auto-reconnect.
 * The dealer emitted NOT_READY while disconnecting → PEER_LEFT → the reconnect
 * listener still found the address in peerIdToAddress and reconnected ~1s later.
 *
 * Fix plan: "Bug 4 — explicit disconnect() is undone by auto-reconnect".
 */

import { expect } from 'chai'
import Node, { NodeEvent, ReconnectPolicy, Transport } from '../../src/index.js'
import { LocalTransport } from '../../src/transport/local/index.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

describe('Regression bug 4: disconnect() is not undone by auto-reconnect', function () {
  this.timeout(10000)

  let previousDefault
  let server
  let client
  let address

  before(() => {
    previousDefault = Transport.defaultTransport
    Transport.register('local', LocalTransport)
    Transport.setDefault('local')
  })

  after(() => {
    Transport.setDefault(previousDefault)
  })

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
  })

  const setup = async (reconnect) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    address = `local://bug4-${suffix}`
    server = new Node({ id: `bug4-srv-${suffix}` })
    await server.bind(address)
    client = new Node({ id: `bug4-cli-${suffix}`, config: { reconnect } })
    await client.connect({ address })
    expect(client.getNodesUpstream()).to.have.length(1)
  }

  for (const policy of [ReconnectPolicy.ALWAYS, ReconnectPolicy.ON_FAILURE]) {
    it(`stays disconnected (reconnect: ${policy})`, async () => {
      await setup(policy)

      const joinedAfterDisconnect = []
      await client.disconnect(address)
      client.on(NodeEvent.PEER_JOINED, (payload) => joinedAfterDisconnect.push(payload))

      expect(client.getNodesUpstream()).to.deep.equal([])

      // First reconnect attempt fires after 1s on the old code
      await wait(2500)

      expect(client.getNodesUpstream()).to.deep.equal([])
      expect(joinedAfterDisconnect).to.deep.equal([])
      expect(server.getNodesDownstream()).to.deep.equal([])
    })
  }

  it('can connect again explicitly after disconnect', async () => {
    await setup(ReconnectPolicy.ALWAYS)

    await client.disconnect(address)
    const info = await client.connect({ address })

    expect(info.id).to.equal(server.getId())
    expect(client.getNodesUpstream()).to.have.length(1)
  })
})
