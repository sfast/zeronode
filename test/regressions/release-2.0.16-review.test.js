/**
 * Regressions found by the Codex review of the 2.0.16 release (2026-10-28):
 *  (a) a service handler failing with NO_NODES_MATCH_FILTER / PROXY_HOP_LIMIT
 *      was taken for a routing miss and re-sent through another router, so
 *      the handler ran twice (at-most-once violated);
 *  (b) an unroutable proxied tick kept being forwarded in a mesh with more
 *      routers than PROXY_MAX_VISITED (visited list truncated);
 *  (c) malformed routing metadata was only rejected after a local service
 *      had been chosen, so the handler still ran.
 * Local transport (in-process) and ZeroMQ on port 0 only.
 */

import { expect } from 'chai'
import Node, {
  Router, Server, Client, ServerEvent, ClientEvent, NodeError, NodeErrorCode, ProtocolErrorCode, ProtocolSystemEvent, Transport
} from '../../src/index.js'
import { LocalTransport } from '../../src/transport/local/index.js'
import { Envelope } from '../../src/protocol/envelope.js'
import Globals from '../../src/globals.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Release 2.0.16 review: a handler error is never taken for a routing miss', function () {
  this.timeout(15000)

  let nodes = []
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) await node.close().catch(() => {})
    nodes = []
  })

  for (const code of [NodeErrorCode.NO_NODES_MATCH_FILTER, NodeErrorCode.PROXY_HOP_LIMIT]) {
    it(`a handler failing with ${code} runs once and its error reaches the caller`, async () => {
      const hub = track(new Router({ id: `rr-hub-${uid()}` }))
      await hub.bind('tcp://127.0.0.1:0')
      const left = track(new Router({ id: `rr-left-${uid()}` }))
      const right = track(new Router({ id: `rr-right-${uid()}` }))
      for (const r of [left, right]) {
        await r.bind('tcp://127.0.0.1:0')
        await r.connect({ address: hub.getAddress() })
      }

      let executions = 0
      for (const r of [left, right]) {
        const svc = track(new Node({ id: `rr-svc-${uid()}`, options: { service: 'charge' } }))
        svc.onRequest('charge', () => {
          executions++
          throw new NodeError({ code, message: 'downstream dependency missing' })
        })
        await svc.connect({ address: r.getAddress() })
      }

      const client = track(new Node({ id: `rr-cli-${uid()}` }))
      await client.connect({ address: hub.getAddress() })

      const err = await client.requestAny({ event: 'charge', filter: { service: 'charge' }, timeout: 2000 }).then(() => null, (e) => e)
      await wait(200)

      expect(executions, 'handler ran exactly once').to.equal(1)
      expect(err?.code).to.equal(code)
    })
  }
})

describe('Release 2.0.16 review: proxied ticks and routing validation (local transport)', function () {
  this.timeout(20000)

  let previousDefault
  let nodes = []
  const track = (node) => { nodes.push(node); return node }

  before(() => {
    previousDefault = Transport.defaultTransport
    Transport.register('local', LocalTransport)
    Transport.setDefault('local')
  })

  after(() => {
    Transport.setDefault(previousDefault)
  })

  afterEach(async () => {
    for (const node of nodes.reverse()) await node.close().catch(() => {})
    nodes = []
  })

  it('an unroutable tick through a hub with 129 leaf routers stops (each leaf at most once)', async () => {
    const address = `local://rr-hub-${uid()}`
    const hub = track(new Router({ id: `rr-hub-${uid()}` }))
    await hub.bind(address)

    const leaves = []
    for (let i = 0; i < 129; i++) {
      const leaf = track(new Router({ id: `rr-leaf${i}-${uid()}` }))
      await leaf.connect({ address })
      leaves.push(leaf)
    }
    const client = track(new Node({ id: `rr-cli-${uid()}` }))
    await client.connect({ address })

    const leafTicks = () => leaves.reduce((n, leaf) => n + leaf.getRoutingStats().proxyTicks, 0)

    await client.tickAny({ event: 'nope', filter: { service: 'missing' } })
    await wait(500)
    const first = leafTicks()
    await wait(500)

    expect(first, 'each leaf tried at most once').to.be.at.most(leaves.length)
    expect(leafTicks(), 'no more forwarding').to.equal(first)
  })

  const setupRouterWithService = async () => {
    const address = `local://rr-v-${uid()}`
    const router = track(new Router({ id: `rr-vr-${uid()}` }))
    await router.bind(address)
    const counter = { requests: 0, ticks: 0 }
    const svc = track(new Node({ id: `rr-vs-${uid()}`, options: { service: 'v' } }))
    svc.onRequest('hit', () => { counter.requests++; return 'ran' })
    svc.onTick('hit', () => { counter.ticks++ })
    await svc.connect({ address })
    return { router, counter }
  }

  for (const [label, routing] of [
    ['an oversized path', { path: new Array(100).fill('r') }],
    ['a non-array path', { path: 'r1' }],
    ['a malformed visited list', { path: [], visited: 'x' }]
  ]) {
    it(`a proxied request with ${label} is refused before any local delivery`, async () => {
      const { router, counter } = await setupRouterWithService()

      const { error } = await new Promise((resolve) => {
        const reply = (result) => resolve({ result })
        reply.error = (e) => resolve({ error: e })
        router._handleProxyRequest({
          owner: 'peer',
          data: null,
          metadata: { routing: { event: 'hit', filter: { service: 'v' }, budget: 1000, ...routing } }
        }, reply)
      })

      expect(error?.code).to.equal(NodeErrorCode.PROXY_HOP_LIMIT)
      expect(counter.requests).to.equal(0)
    })

    it(`a proxied tick with ${label} is dropped before any local delivery`, async () => {
      const { router, counter } = await setupRouterWithService()

      router._handleProxyTick({
        owner: 'peer',
        data: null,
        metadata: { routing: { event: 'hit', filter: { service: 'v' }, ...routing } }
      })
      await wait(100)

      expect(counter.ticks).to.equal(0)
    })
  }
})

describe('Release 2.0.16 review (round 2): lifecycle and error reporting', function () {
  this.timeout(15000)

  let previousDefault
  const closers = []

  before(() => {
    previousDefault = Transport.defaultTransport
    Transport.register('local', LocalTransport)
  })

  beforeEach(() => {
    Transport.setDefault('local')
  })

  after(() => {
    Transport.setDefault(previousDefault)
  })

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close().catch(() => {})
  })

  /** Capture a private Map by watching what gets stored in it */
  const captureMap = (matches) => {
    const set = Map.prototype.set
    const captured = { map: null }
    Map.prototype.set = function (key, value) {
      if (!captured.map && matches(key, value)) captured.map = this
      return set.call(this, key, value)
    }
    captured.restore = () => { Map.prototype.set = set }
    return captured
  }

  it('a tick handler rejecting / throwing a non-Error value is reported, not left unhandled', async () => {
    const server = new Server({ id: `rr2-s-${uid()}` })
    const client = new Client({ id: `rr2-c-${uid()}` })
    closers.push(() => server.close(), () => client.close())
    const errors = []
    server.on(ServerEvent.ERROR, (err) => errors.push(err))
    const unprintable = { toString () { throw new Error('no') } }
    server.onTick('bad-async', async () => { throw Symbol('failure') })
    server.onTick('bad-sync', () => { throw Symbol('failure') })
    server.onTick('bad-object', () => { throw unprintable })

    await server.bind(`local://rr2-sym-${uid()}`)
    await client.connect(server.getAddress())
    for (const event of ['bad-async', 'bad-sync', 'bad-object']) client.tick({ event })
    await wait(50)

    // The unhandled-rejection trap fails this test if reporting itself threw
    expect(errors).to.have.length(3)
  })

  it('a Client reused after disconnect() still fails pending requests after the reconnect grace', async () => {
    const server = new Server({ id: `rr2-s-${uid()}` })
    const client = new Client({ id: `rr2-c-${uid()}` })
    closers.push(() => server.close(), () => client.close())
    await server.bind(`local://rr2-grace-${uid()}`)
    await client.connect(server.getAddress())
    await client.disconnect()
    await client.connect(server.getAddress())
    server.onRequest('hang', () => new Promise(() => {}))

    let outcome = 'pending'
    const pending = client.request({ event: 'hang', timeout: 5000 }).then(() => { outcome = 'resolved' }, (e) => { outcome = e.code })
    await new Promise(setImmediate)
    await client._getSocket().disconnect()   // unexpected transport loss
    await wait(Globals.RECONNECT_GRACE_MS + 200)

    expect(outcome).to.equal(ProtocolErrorCode.PEER_UNREACHABLE)
    await pending
  })

  it('re-sending options after the handshake does not hold connect() or its cancellation', async () => {
    // A transport whose options-update sends never complete
    Transport.register('local-slow-options', {
      ...LocalTransport,
      createClientSocket (opts) {
        const socket = LocalTransport.createClientSocket(opts)
        const send = socket.sendBuffer.bind(socket)
        socket.sendBuffer = (buffer, to) =>
          new Envelope(buffer).event === ProtocolSystemEvent.OPTIONS_UPDATE ? new Promise(() => {}) : send(buffer, to)
        return socket
      }
    })
    Transport.setDefault('local-slow-options')

    const server = new Node({ id: `rr2-s-${uid()}` })
    closers.push(() => server.close())
    await server.bind(`local://rr2-opts-${uid()}`)

    for (const cancel of [false, true]) {
      const client = new Node({ id: `rr2-c-${uid()}` })
      closers.push(() => client.close())
      const started = Date.now()
      const outcome = client.connect({ address: server.getAddress(), timeout: 500 }).then(() => 'resolved', (e) => e.code)
      await client.setOptions({ v: 2 })   // before the handshake completes
      await wait(75)
      if (cancel) await client.close()
      await outcome

      expect(Date.now() - started, cancel ? 'cancellation' : 'connect').to.be.below(1000)
    }
  })

  it('the server forgets client instances on unbind and close', async () => {
    const captured = captureMap((key, value) => String(key).startsWith('rr2-inst-') && /^[0-9a-f]{8}-/.test(String(value)))
    const server = new Server({ id: `rr2-s-${uid()}` })
    closers.push(() => server.close())
    try {
      for (let i = 0; i < 3; i++) {
        await server.bind(`local://rr2-inst-${uid()}`)
        const client = new Client({ id: `rr2-inst-${i}-${uid()}` })
        await client.connect(server.getAddress())
        await client._getSocket().disconnect()   // lost without CLIENT_STOP
        await server.unbind()
        await client.close()
        expect(captured.map?.size, `after unbind ${i}`).to.equal(0)
      }
    } finally {
      captured.restore()
    }
  })

  it('forwarded-tick records are dropped when expired and when the node closes', async () => {
    const captured = captureMap((key, value) => value?.routerNode === 'rr2-router')
    const node = new Node({ id: `rr2-n-${uid()}` })
    const ttl = Globals.PROXY_TICK_RECORD_MS
    try {
      Globals.PROXY_TICK_RECORD_MS = 20
      const id = node._rememberForwardedTick('rr2-router', { event: 'x', filter: {} })
      await wait(40)
      expect(node._takeForwardedTick(id, 'rr2-router')).to.equal(null)
      expect(captured.map.size, 'expired record removed').to.equal(0)

      Globals.PROXY_TICK_RECORD_MS = 10000
      node._rememberForwardedTick('rr2-router', { event: 'x', filter: {} })
      await node.close()
      expect(captured.map.size, 'cleared on close').to.equal(0)
    } finally {
      Globals.PROXY_TICK_RECORD_MS = ttl
      captured.restore()
      await node.close().catch(() => {})
    }
  })

  it('a connect() overlapping close() does not turn the intentional close into a failure', async () => {
    const server = new Server({ id: `rr3-s-${uid()}` })
    const client = new Client({ id: `rr3-c-${uid()}` })
    closers.push(() => server.close(), () => client.close())
    await server.bind(`local://rr3-overlap-${uid()}`)
    await client.connect(server.getAddress())

    const events = []
    client.on(ClientEvent.CLOSED, () => events.push('CLOSED'))
    client.on(ClientEvent.NOT_READY, (e) => events.push(e.reason))
    const closing = client.close()
    const rejected = await client.connect(server.getAddress(), 100).then(() => null, (e) => e)
    await closing

    expect(rejected, 'overlapping connect rejects').to.be.an('error')
    expect(events).to.not.include('TRANSPORT_FAILED')
    expect(events).to.include('CLOSED')
  })

  it('forwarded-tick records expire while idle and none survive close()', async () => {
    const captured = captureMap((key, value) => String(value?.routerNode).startsWith('rr3-leaf-'))
    const ttl = Globals.PROXY_TICK_RECORD_MS
    Globals.PROXY_TICK_RECORD_MS = 20
    try {
      for (const mode of ['idle', 'close-race']) {
        captured.map = null
        const hub = new Router({ id: `rr3-hub-${mode}-${uid()}` })
        const leaf = new Router({ id: `rr3-leaf-${mode}-${uid()}` })
        const svc = new Node({ id: `rr3-svc-${mode}-${uid()}`, options: { service: `hit-${mode}` } })
        closers.push(() => hub.close(), () => leaf.close(), () => svc.close())
        await hub.bind(`local://${hub.getId()}`)
        await leaf.bind(`local://${leaf.getId()}`)
        await leaf.connect({ address: hub.getAddress() })
        let delivered = 0
        svc.onTick('hit', () => { delivered++ })
        await svc.connect({ address: leaf.getAddress() })

        if (mode === 'idle') {
          await hub.tickAny({ event: 'hit', filter: { service: `hit-${mode}` } })
        } else {
          const caller = new Node({ id: `rr3-caller-${uid()}` })
          closers.push(() => caller.close())
          await caller.connect({ address: hub.getAddress() })
          const tick = caller.tickAny({ event: 'hit', filter: { service: `hit-${mode}` } })
          const closing = hub.close()
          await tick
          await closing
        }
        await wait(100)

        expect(captured.map?.size ?? 0, `${mode}: records left`).to.equal(0)
        if (mode === 'idle') expect(delivered).to.equal(1)
      }
    } finally {
      Globals.PROXY_TICK_RECORD_MS = ttl
      captured.restore()
    }
  })
})

