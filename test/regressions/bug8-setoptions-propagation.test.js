/**
 * Regression: bug 8 — Node.setOptions() only replaced the local object. Peers
 * kept the options from the handshake forever (docs say it propagates), and a
 * later re-handshake even sent the stale, original options.
 *
 * Fix plan: "Bug 8 — setOptions() never reaches peers".
 */

import { expect } from 'chai'
import net from 'net'
import * as zmq from 'zeromq'
import Node, { Router, NodeEvent, Transport } from '../../src/index.js'
import { LocalTransport } from '../../src/transport/local/index.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Regression bug 8: setOptions() reaches connected peers', function () {
  let previousDefault
  let server
  let client

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

  const setup = async (ServerClass = Node) => {
    const address = `local://bug8-${uid()}`
    server = new ServerClass({ id: `bug8-srv-${uid()}`, options: { role: 'hub' } })
    await server.bind(address)
    client = new Node({ id: `bug8-cli-${uid()}`, options: { service: 'svc', __status: 'started' } })
    await client.connect({ address })
  }

  it('client → server: the server sees the new options and filters by them', async () => {
    await setup()
    const updates = []
    server.on(NodeEvent.PEER_UPDATED, (payload) => updates.push(payload))

    await client.setOptions({ ...client.getOptions(), __status: 'draining' })
    await wait(50)

    expect(server.getPeerOptions(client.getId()).__status).to.equal('draining')
    expect(server.getFilteredNodes({ options: { __status: 'started' } })).to.not.include(client.getId())
    expect(server.getFilteredNodes({ options: { __status: 'draining' } })).to.include(client.getId())
    expect(updates).to.have.length(1)
    expect(updates[0]).to.include({ peerId: client.getId(), direction: 'downstream' })
    expect(updates[0].peerOptions.__status).to.equal('draining')
  })

  it('server → client: the client sees the new options', async () => {
    await setup()
    const updates = []
    client.on(NodeEvent.PEER_UPDATED, (payload) => updates.push(payload))

    await server.setOptions({ role: 'hub', version: 2 })
    await wait(50)

    expect(client.getPeerOptions(server.getId()).version).to.equal(2)
    expect(updates).to.have.length(1)
    expect(updates[0]).to.include({ peerId: server.getId(), direction: 'upstream' })
  })

  it('does not mutate the caller\'s object and accepts a frozen one', async () => {
    await setup()
    const frozen = Object.freeze({ service: 'svc', __status: 'frozen' })

    await client.setOptions(frozen)
    await wait(50)

    expect(frozen).to.not.have.property('_id')
    expect(client.getOptions()._id).to.equal(client.getId())
    expect(server.getPeerOptions(client.getId()).__status).to.equal('frozen')
  })

  it('a Router keeps router: true across setOptions()', async () => {
    await setup(Router)

    await server.setOptions({ role: 'edge' })
    await wait(50)

    expect(server.getOptions().router).to.equal(true)
    expect(client.getPeerOptions(server.getId()).router).to.equal(true)
  })
})

/** TCP proxy on port 0; drop() simulates a blip */
async function startProxy (target) {
  const [host, port] = target.replace('tcp://', '').split(':')
  const sockets = new Set()
  const proxy = net.createServer((inbound) => {
    const outbound = net.connect(Number(port), host)
    for (const s of [inbound, outbound]) sockets.add(s)
    inbound.pipe(outbound)
    outbound.pipe(inbound)
    const cleanup = () => { inbound.destroy(); outbound.destroy(); sockets.delete(inbound); sockets.delete(outbound) }
    for (const s of [inbound, outbound]) { s.on('error', cleanup); s.on('close', cleanup) }
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  return {
    address: `tcp://127.0.0.1:${proxy.address().port}`,
    drop () { for (const s of sockets) s.destroy() },
    close () { this.drop(); return new Promise(resolve => proxy.close(resolve)) }
  }
}

describe('Regression bug 8: a re-handshake carries the current options', function () {
  this.timeout(10000)

  it('setOptions() during a pending connect() reaches the server once joined', async () => {
    const probe = new zmq.Router()
    await probe.bind('tcp://127.0.0.1:*')
    const address = probe.lastEndpoint
    probe.close()
    await wait(50)

    const client = new Node({ id: `bug8-pcli-${uid()}`, options: { __status: 'stopped' } })
    const server = new Node({ id: `bug8-psrv-${uid()}` })
    try {
      const connecting = client.connect({ address, timeout: 3000 })
      await wait(100)
      await client.setOptions({ __status: 'started' })
      await server.bind(address)
      await connecting
      await wait(100)

      expect(server.getPeerOptions(client.getId()).__status).to.equal('started')
    } finally {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
    }
  })

  it('after a transport blip the server still sees the updated options', async () => {
    const server = new Node({ id: `bug8-zsrv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    const proxy = await startProxy(server.getAddress())
    const client = new Node({ id: `bug8-zcli-${uid()}`, options: { __status: 'started' }, config: { reconnect: 'always' } })

    try {
      await client.connect({ address: proxy.address })
      await client.setOptions({ __status: 'draining' })
      await wait(100)
      expect(server.getPeerOptions(client.getId()).__status).to.equal('draining')

      // The server never noticed the blip, so the re-handshake is not a new
      // join there (2.1: edge-triggered events); the client sees it come back
      const updated = []
      server.on(NodeEvent.PEER_UPDATED, (payload) => updated.push(payload))
      const rejoined = new Promise(resolve => client.once(NodeEvent.PEER_JOINED, resolve))
      proxy.drop()   // the dealer reconnects and handshakes again
      await rejoined

      // The handshake carried the current options: nothing changed on the server
      expect(server.getPeerOptions(client.getId()).__status, 'handshake options').to.equal('draining')
      expect(updated, 'no options change seen').to.deep.equal([])
    } finally {
      await client.close().catch(() => {})
      await proxy.close().catch(() => {})
      await server.close().catch(() => {})
    }
  })
})
