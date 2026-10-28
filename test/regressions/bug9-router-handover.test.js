/**
 * Regression: bug 9 — a restarted peer reconnecting with the same id was
 * silently ignored while the router still held the old pipe (ZMQ_ROUTER_HANDOVER
 * off): its handshake never arrived and replies went to the old, dead pipe.
 *
 * Fix plan: "Bug 9 — a restarted peer with the same id is silently ignored".
 * ZeroMQ transport, port 0.
 */

import { expect } from 'chai'
import Node, { NodeEvent } from '../../src/index.js'
import Server, { ServerEvent } from '../../src/protocol/server.js'
import Client from '../../src/protocol/client.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Regression bug 9: a second process with the same id takes over', function () {
  this.timeout(10000)

  let server
  let first
  let second

  afterEach(async () => {
    await second?.close().catch(() => {})
    await first?.close().catch(() => {})
    await server?.close().catch(() => {})
    first = second = server = null
  })

  it('the new instance joins and receives the traffic', async () => {
    server = new Node({ id: `bug9-srv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')

    const sharedId = `bug9-svc-${uid()}`
    first = new Node({ id: sharedId, config: { reconnect: 'disabled' } })
    first.onRequest('who', () => 'first')
    await first.connect({ address: server.getAddress() })

    const peerEvents = []
    server.on(NodeEvent.PEER_LEFT, ({ peerId, reason }) => peerEvents.push({ type: 'left', peerId, reason }))
    server.on(NodeEvent.PEER_JOINED, ({ peerId }) => peerEvents.push({ type: 'joined', peerId }))

    // `first` is still open: this is the restart-before-the-old-pipe-is-gone case
    second = new Node({ id: sharedId, config: { reconnect: 'disabled' } })
    second.onRequest('who', () => 'second')
    await second.connect({ address: server.getAddress(), timeout: 1000 })

    expect(server.getNodesDownstream()).to.include(sharedId)
    expect(await server.request({ to: sharedId, event: 'who', timeout: 1000 })).to.equal('second')

    expect(peerEvents).to.deep.equal([
      { type: 'left', peerId: sharedId, reason: 'REPLACED' },
      { type: 'joined', peerId: sharedId }
    ])
  })
})

describe('Regression bug 9: re-handshake of the same instance is not a replacement', function () {
  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
  })

  it('does not emit CLIENT_LEFT when the same client handshakes again', async () => {
    server = new Server({ id: `bug9-psrv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    client = new Client({ id: `bug9-pcli-${uid()}` })
    await client.connect(server.getAddress(), 1000)

    const left = []
    const joined = []
    server.on(ServerEvent.CLIENT_LEFT, (payload) => left.push(payload))
    server.on(ServerEvent.CLIENT_JOINED, (payload) => joined.push(payload))

    // Same process, same Client: what happens after a transport blip
    client._sendClientConnected()
    await wait(100)

    expect(joined).to.have.length(1)
    expect(left).to.deep.equal([])
  })
})
