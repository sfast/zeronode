/**
 * Regression: bug 3 — a crashed (SIGKILLed) client stayed routable until the
 * ghost timeout; the ROUTER silently dropped sends to it, so requests waited
 * their full timeout and requestAny kept choosing the dead peer.
 *
 * Fix plan: "Bug 3 + 7 — crashed peers stay routable". ZeroMQ transport, port 0.
 */

import { expect } from 'chai'
import { fork } from 'child_process'
import { fileURLToPath } from 'url'
import * as zmq from 'zeromq'
import Node, { NodeEvent, NodeErrorCode, ProtocolErrorCode, TransportEvent } from '../../src/index.js'
import { ZeroMQTransport } from '../../src/transport/zeromq/zeromq-transport.js'
import { Envelope, EnvelopType, EnvelopeIdGenerator } from '../../src/protocol/envelope.js'
import { ProtocolSystemEvent } from '../../src/protocol/config.js'

const CHILD = fileURLToPath(new URL('./fixtures/peer-child.js', import.meta.url))
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Regression bug 3: crashed peers fail fast', function () {
  this.timeout(15000)

  let server
  let children = []

  const spawnPeer = async (service) => {
    const id = `bug3-peer-${uid()}`
    const child = fork(CHILD, [server.getAddress(), id, service], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    children.push(child)
    await new Promise((resolve, reject) => {
      child.once('message', resolve)
      child.once('exit', (code) => reject(new Error(`peer exited early (${code})`)))
    })
    return { id, child }
  }

  const crash = async ({ child }) => {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGKILL')
    await exited
    // Loopback: libzmq drops the dead pipe within a few ms of the RST/FIN
    await wait(200)
  }

  beforeEach(async () => {
    server = new Node({ id: `bug3-srv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
  })

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    children = []
    await server?.close().catch(() => {})
  })

  it('a direct request to a crashed peer rejects with PEER_UNREACHABLE at once', async () => {
    const peer = await spawnPeer('x')
    expect(await server.request({ to: peer.id, event: 'who', timeout: 2000 })).to.equal(peer.id)

    const left = []
    server.on(NodeEvent.PEER_LEFT, (payload) => left.push(payload))
    await crash(peer)

    const started = Date.now()
    const err = await server.request({ to: peer.id, event: 'who', timeout: 2000 }).then(() => null, (e) => e)

    expect(err?.code).to.equal(ProtocolErrorCode.PEER_UNREACHABLE)
    expect(Date.now() - started).to.be.below(500)
    expect(server.getNodesDownstream()).to.not.include(peer.id)
    expect(left).to.deep.equal([{ peerId: peer.id, direction: 'downstream', reason: 'UNREACHABLE' }])
  })

  it('requestAny for a crashed only provider rejects with NO_NODES_MATCH_FILTER at once', async () => {
    const peer = await spawnPeer('x')
    await crash(peer)

    const started = Date.now()
    const err = await server.requestAny({ event: 'who', filter: { service: 'x' }, timeout: 2000 }).then(() => null, (e) => e)

    expect(err?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
    expect(Date.now() - started).to.be.below(500)
  })

  it('requestAny skips a crashed provider and reaches a live one', async () => {
    const live = await spawnPeer('y')
    const dead = await spawnPeer('y')
    await crash(dead)

    for (let i = 0; i < 6; i++) {
      expect(await server.requestAny({ event: 'who', filter: { service: 'y' }, timeout: 2000 })).to.equal(live.id)
    }
    expect(server.getNodesDownstream()).to.deep.equal([live.id])
  })
})

describe('Regression bug 3: router send failures are handled', function () {
  this.timeout(10000)

  it('a send to an unknown identity rejects, emits SEND_FAILED and never floats', async () => {
    const router = ZeroMQTransport.createServerSocket({ id: `bug3-router-${uid()}` })
    const failures = []
    router.on(TransportEvent.SEND_FAILED, (payload) => failures.push(payload))
    try {
      await router.bind('tcp://127.0.0.1:0')
      const err = await router.sendBuffer(Buffer.from('x'), 'nobody').then(() => null, (e) => e)
      // The unhandled-rejection trap fails this test if anything floated
      await wait(50)

      expect(err?.code).to.equal('EHOSTUNREACH')
      expect(failures).to.have.length(1)
      expect(failures[0].recipient).to.equal('nobody')
    } finally {
      await router.close().catch(() => {})
    }
  })

  it('flooding a live but slow peer fails sends without dropping the peer', async () => {
    const server = new Node({ id: `bug3-flood-${uid()}`, config: { ZMQ_SNDHWM: 2 } })
    await server.bind('tcp://127.0.0.1:0')

    // A raw dealer that joins (handshake) and then never reads
    const slowId = `bug3-slow-${uid()}`
    const slow = new zmq.Dealer({ routingId: slowId, receiveHighWaterMark: 1 })
    const left = []
    server.on(NodeEvent.PEER_LEFT, (payload) => left.push(payload))

    try {
      slow.connect(server.getAddress())
      const handshake = Envelope.createBuffer({
        type: EnvelopType.TICK,
        id: new EnvelopeIdGenerator(slowId).next(),
        event: ProtocolSystemEvent.HANDSHAKE_INIT_FROM_CLIENT,
        owner: slowId,
        data: {}
      })
      await slow.send(handshake)
      await wait(200)
      expect(server.getNodesDownstream()).to.include(slowId)

      // Its queue fills up (send HWM 2, never read): sends fail with EAGAIN.
      // The peer is slow, not gone: those requests fail, the peer stays.
      const outcomes = await Promise.all(Array.from({ length: 300 }, () =>
        server.request({ to: slowId, event: 'flood', data: Buffer.alloc(65536), timeout: 500 })
          .then(() => 'ok', (e) => e.code)
      ))
      const counts = outcomes.reduce((acc, code) => { acc[code] = (acc[code] || 0) + 1; return acc }, {})

      expect(counts[ProtocolErrorCode.SEND_FAILED], JSON.stringify(counts)).to.be.greaterThan(0)
      expect(counts[ProtocolErrorCode.PEER_UNREACHABLE], JSON.stringify(counts)).to.equal(undefined)

      expect(server.getNodesDownstream()).to.include(slowId)
      expect(left).to.deep.equal([])
    } finally {
      slow.close()
      await server.close().catch(() => {})
    }
  })
})
