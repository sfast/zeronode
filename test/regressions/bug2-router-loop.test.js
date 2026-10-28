/**
 * Regression: bug 2 — two connected Routers bounced an unroutable requestAny /
 * tickAny between each other until the caller's timeout (~59k proxy requests
 * in 1.5s), and the caller saw REQUEST_TIMEOUT instead of the real error.
 *
 * Fix plan: "Bug 2 — router↔router proxy loop". ZeroMQ transport, port 0.
 */

import { expect } from 'chai'
import Node, { Router, NodeErrorCode } from '../../src/index.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Regression bug 2: router proxy loop is bounded', function () {
  this.timeout(15000)

  let nodes = []

  const track = (node) => { nodes.push(node); return node }

  const makeRouter = async (name) => {
    const router = track(new Router({ id: `bug2-${name}-${uid()}` }))
    await router.bind('tcp://127.0.0.1:0')
    return router
  }

  afterEach(async () => {
    // Close in reverse creation order (clients before the routers they joined)
    for (const node of nodes.reverse()) {
      await node.close().catch(() => {})
    }
    nodes = []
  })

  const proxyTotals = (...routers) => routers.reduce((acc, r) => {
    const stats = r.getRoutingStats()
    acc.requests += stats.proxyRequests
    acc.ticks += stats.proxyTicks
    return acc
  }, { requests: 0, ticks: 0 })

  it('requestAny between two connected routers fails fast with the real error', async () => {
    const r1 = await makeRouter('r1')
    const r2 = await makeRouter('r2')
    await r1.connect({ address: r2.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: r1.getAddress() })

    const started = Date.now()
    let error
    try {
      await client.requestAny({ event: 'nope', filter: { service: 'missing' }, timeout: 1000 })
    } catch (err) {
      error = err
    }
    const elapsed = Date.now() - started

    expect(error, 'requestAny rejects').to.exist
    expect(error.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
    expect(elapsed, 'rejected before the caller timeout').to.be.below(1000)
    expect(proxyTotals(r1, r2).requests).to.be.at.most(2)
  })

  it('still routes through a valid multi-router chain (r1 → r2 → r3)', async () => {
    const r1 = await makeRouter('r1')
    const r2 = await makeRouter('r2')
    const r3 = await makeRouter('r3')
    await r1.connect({ address: r2.getAddress() })
    await r2.connect({ address: r3.getAddress() })

    const service = track(new Node({ id: `bug2-svc-${uid()}`, options: { service: 'svc' } }))
    service.onRequest('hello', ({ data }) => `hello ${data}`)
    await service.connect({ address: r3.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: r1.getAddress() })

    for (let i = 0; i < 5; i++) {
      const result = await client.requestAny({ event: 'hello', data: i, filter: { service: 'svc' }, timeout: 2000 })
      expect(result).to.equal(`hello ${i}`)
    }
  })

  it('finds the service behind a hub whose other neighbour is a dead end (20/20)', async () => {
    const hub = await makeRouter('hub')
    const deadEnd = await makeRouter('dead')
    const target = await makeRouter('target')
    await deadEnd.connect({ address: hub.getAddress() })
    await target.connect({ address: hub.getAddress() })

    const service = track(new Node({ id: `bug2-svc-${uid()}`, options: { service: 'svc' } }))
    service.onRequest('hello', () => 'hi')
    await service.connect({ address: target.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: hub.getAddress() })

    for (let i = 0; i < 20; i++) {
      expect(await client.requestAny({ event: 'hello', filter: { service: 'svc' }, timeout: 2000 })).to.equal('hi')
    }
  })

  it('tickAny also finds the service behind a hub with a dead-end neighbour (20/20)', async () => {
    const hub = await makeRouter('hub')
    const deadEnd = await makeRouter('dead')
    const target = await makeRouter('target')
    await deadEnd.connect({ address: hub.getAddress() })
    await target.connect({ address: hub.getAddress() })

    let delivered = 0
    const service = track(new Node({ id: `bug2-svc-${uid()}`, options: { service: 'svc' } }))
    service.onTick('ping', () => { delivered++ })
    await service.connect({ address: target.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: hub.getAddress() })

    for (let i = 0; i < 20; i++) {
      await client.tickAny({ event: 'ping', filter: { service: 'svc' } })
    }
    await wait(300)

    expect(delivered).to.equal(20)
  })

  it('an unroutable tickAny in a router cycle is dropped after visiting each router once', async () => {
    const r1 = await makeRouter('r1')
    const r2 = await makeRouter('r2')
    const r3 = await makeRouter('r3')
    await r1.connect({ address: r2.getAddress() })
    await r2.connect({ address: r3.getAddress() })
    await r3.connect({ address: r1.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: r1.getAddress() })

    await client.tickAny({ event: 'nope', filter: { service: 'missing' } })
    await wait(300)

    expect(proxyTotals(r1, r2, r3).ticks).to.be.at.most(3)
  })

  it('an unroutable request in a mesh larger than the hop limit reports NO_NODES_MATCH_FILTER', async () => {
    const mesh = []
    for (let i = 0; i < 10; i++) mesh.push(await makeRouter(`m${i}`))
    for (let i = 0; i < mesh.length; i++) {
      for (let j = i + 1; j < mesh.length; j++) {
        await mesh[i].connect({ address: mesh[j].getAddress() })
      }
    }
    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: mesh[0].getAddress() })

    const err = await client.requestAny({ event: 'nope', filter: { service: 'missing' }, timeout: 2000 }).then(() => null, (e) => e)

    expect(err?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
    expect(proxyTotals(...mesh).requests).to.be.at.most(mesh.length)
  })

  it('an unroutable request in a router cycle (r1 → r2 → r3 → r1) visits each router once', async () => {
    const r1 = await makeRouter('r1')
    const r2 = await makeRouter('r2')
    const r3 = await makeRouter('r3')
    await r1.connect({ address: r2.getAddress() })
    await r2.connect({ address: r3.getAddress() })
    await r3.connect({ address: r1.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: r1.getAddress() })

    const err = await client.requestAny({ event: 'nope', filter: { service: 'missing' }, timeout: 1000 }).then(() => null, (e) => e)

    expect(err?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
    expect(proxyTotals(r1, r2, r3).requests).to.be.at.most(3)
  })

  it('a short timeout still works across three routers', async () => {
    const r1 = await makeRouter('r1')
    const r2 = await makeRouter('r2')
    const r3 = await makeRouter('r3')
    await r1.connect({ address: r2.getAddress() })
    await r2.connect({ address: r3.getAddress() })

    const service = track(new Node({ id: `bug2-svc-${uid()}`, options: { service: 'fast' } }))
    service.onRequest('hello', () => 'quick')
    await service.connect({ address: r3.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: r1.getAddress() })

    expect(await client.requestAny({ event: 'hello', filter: { service: 'fast' }, timeout: 120 })).to.equal('quick')
  })

  it('a slow service: the caller gets the inner hop error before its own timer', async () => {
    const r1 = await makeRouter('r1')
    const r2 = await makeRouter('r2')
    await r1.connect({ address: r2.getAddress() })

    const service = track(new Node({ id: `bug2-svc-${uid()}`, options: { service: 'slow' } }))
    service.onRequest('hello', () => wait(3000).then(() => 'too late'))
    await service.connect({ address: r2.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: r1.getAddress() })

    const started = Date.now()
    const err = await client.requestAny({ event: 'hello', filter: { service: 'slow' }, timeout: 600 }).then(() => null, (e) => e)
    const elapsed = Date.now() - started

    expect(err?.code).to.equal('REQUEST_TIMEOUT')
    expect(elapsed, 'answered by a router, not by the caller timer').to.be.below(590)
  })

  it('tickAny between two connected routers is not forwarded back and forth', async () => {
    const r1 = await makeRouter('r1')
    const r2 = await makeRouter('r2')
    await r1.connect({ address: r2.getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: r1.getAddress() })

    await client.tickAny({ event: 'nope', filter: { service: 'missing' } })
    await wait(300)

    expect(proxyTotals(r1, r2).ticks).to.be.at.most(2)
  })

  it('stops at the hop limit in a long router chain', async () => {
    const chain = []
    for (let i = 0; i < 10; i++) {
      chain.push(await makeRouter(`c${i}`))
    }
    for (let i = 0; i < chain.length - 1; i++) {
      await chain[i].connect({ address: chain[i + 1].getAddress() })
    }

    const service = track(new Node({ id: `bug2-svc-${uid()}`, options: { service: 'far' } }))
    service.onRequest('hello', () => 'unreachable')
    await service.connect({ address: chain[chain.length - 1].getAddress() })

    const client = track(new Node({ id: `bug2-cli-${uid()}` }))
    await client.connect({ address: chain[0].getAddress() })

    let error
    try {
      await client.requestAny({ event: 'hello', filter: { service: 'far' }, timeout: 3000 })
    } catch (err) {
      error = err
    }

    expect(error?.code).to.equal(NodeErrorCode.PROXY_HOP_LIMIT)
  })
})

/**
 * A 2.0.15-style router: proxies forward to any router peer (even the sender)
 * and carry no path/visited/budget. Uses internals to send system messages.
 */
function makeOldStyleRouter (id) {
  const node = new Node({ id, options: { router: true } })
  const stats = { requests: 0, ticks: 0 }
  const pickRouter = () => {
    const routers = node.getFilteredNodes({ options: { router: true } })
    return routers[Math.floor(Math.random() * routers.length)]
  }
  const routeTo = (peerId, params) => {
    const route = node._findRoute(peerId)
    if (route.type === 'server') params.to = route.targetId
    return route.target
  }
  node.onRequest('_system:proxy_request', async (envelope, reply) => {
    stats.requests++
    const { event, filter, timeout } = envelope.metadata.routing
    const local = node.getFilteredNodes({ options: filter })
    if (local.length) return node.request({ to: local[0], event, data: envelope.data, timeout })
    const next = pickRouter()
    if (!next) return reply.error({ code: NodeErrorCode.NO_NODES_MATCH_FILTER, message: 'none' })
    const params = { event: '_system:proxy_request', data: envelope.data, timeout, metadata: { routing: { event, filter, timeout, requestor: id } } }
    return routeTo(next, params)._sendSystemRequest(params)
  })
  node.onTick('_system:proxy_tick', (envelope) => {
    stats.ticks++
    const { event, filter } = envelope.metadata.routing
    const local = node.getFilteredNodes({ options: filter })
    if (local.length) return node.tick({ to: local[0], event, data: envelope.data })
    const next = pickRouter()
    if (!next) return
    const params = { event: '_system:proxy_tick', data: envelope.data, metadata: { routing: { event, filter, requestor: id } } }
    routeTo(next, params)._sendSystemTick(params)
  })
  return { node, stats }
}

describe('Regression bug 2: mixed versions and forged messages', function () {
  this.timeout(15000)

  let nodes = []
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) await node.close().catch(() => {})
    nodes = []
  })

  const ring = async () => {
    const n1 = track(new Router({ id: `bug2-n1-${uid()}` }))
    const n3 = track(new Router({ id: `bug2-n3-${uid()}` }))
    const old = makeOldStyleRouter(`bug2-old-${uid()}`)
    track(old.node)
    for (const node of [n1, n3, old.node]) await node.bind('tcp://127.0.0.1:0')
    await n1.connect({ address: old.node.getAddress() })
    await old.node.connect({ address: n3.getAddress() })
    await n3.connect({ address: n1.getAddress() })
    const client = track(new Node({ id: `bug2-mcli-${uid()}` }))
    await client.connect({ address: n1.getAddress() })
    return { n1, n3, old, client }
  }

  it('an unroutable request in a ring with an old-style router ends quickly', async () => {
    const { n1, n3, old, client } = await ring()

    const err = await client.requestAny({ event: 'nope', filter: { service: 'missing' }, timeout: 2000 }).then(() => null, (e) => e)
    const proxies = n1.getRoutingStats().proxyRequests + n3.getRoutingStats().proxyRequests + old.stats.requests

    expect(err?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
    expect(proxies).to.be.at.most(5)
  })

  it('an unroutable tick in a ring with an old-style router dies out', async () => {
    const { n1, n3, old, client } = await ring()

    await client.tickAny({ event: 'nope', filter: { service: 'missing' } })
    await wait(500)
    const proxies = n1.getRoutingStats().proxyTicks + n3.getRoutingStats().proxyTicks + old.stats.ticks

    expect(proxies).to.be.at.most(5)
  })

  it('a forged proxy_tick_miss makes a node re-send nothing', async () => {
    const router = track(new Router({ id: `bug2-fr-${uid()}` }))
    await router.bind('tcp://127.0.0.1:0')

    let delivered = 0
    const victim = track(new Node({ id: `bug2-victim-${uid()}`, options: { service: 'v' } }))
    victim.onTick('hit', () => { delivered++ })
    await victim.connect({ address: router.getAddress() })

    const plain = track(new Node({ id: `bug2-plain-${uid()}` }))
    await plain.bind('tcp://127.0.0.1:0')
    await plain.connect({ address: router.getAddress() })

    const attacker = track(new Node({ id: `bug2-att-${uid()}` }))
    await attacker.connect({ address: plain.getAddress() })
    const route = attacker._findRoute(plain.getId())

    for (let i = 0; i < 5; i++) {
      route.target._sendSystemTick({
        event: '_system:proxy_tick_miss',
        data: 'forged',
        metadata: { routing: { event: 'hit', filter: { service: 'v' }, path: [plain.getId()], tick: `fake-${i}` } }
      })
    }
    await wait(300)

    expect(delivered).to.equal(0)
  })
})

describe('Regression bug 2: router validates incoming routing metadata', function () {
  let router

  beforeEach(async () => {
    router = new Router({ id: `bug2-unit-${uid()}` })
  })

  afterEach(async () => {
    await router.close().catch(() => {})
  })

  const proxy = (routing) => new Promise((resolve) => {
    const reply = (result) => resolve({ result })
    reply.error = (error) => resolve({ error })
    router._handleProxyRequest({ owner: 'peer', data: null, metadata: { routing } }, reply)
  })

  it('fails closed on an oversized or malformed path', async () => {
    for (const path of [new Array(1000).fill('r'), 'r1', [1, 2]]) {
      const { error } = await proxy({ event: 'x', filter: { service: 'missing' }, path, budget: 1000 })
      expect(error?.code, JSON.stringify(path).slice(0, 40)).to.equal(NodeErrorCode.PROXY_HOP_LIMIT)
    }
  })

  it('accepts routing metadata from an old peer (no path, no budget)', async () => {
    for (const routing of [{ event: 'x', filter: { service: 'missing' }, timeout: 1000 }, { event: 'x', filter: { service: 'missing' } }]) {
      const { error } = await proxy(routing)
      expect(error?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
    }
  })

  it('clamps an absurd budget instead of passing it to setTimeout', async () => {
    const { error } = await proxy({ event: 'x', filter: { service: 'missing' }, path: [], budget: 1e12, timeout: 1000 })
    expect(error?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
  })

  it('rejects immediately when the remaining budget is exhausted', async () => {
    const started = Date.now()
    const { error } = await proxy({ event: 'x', filter: { service: 'missing' }, path: [], budget: 1 })
    expect(error?.code).to.equal(NodeErrorCode.PROXY_DEADLINE_EXCEEDED)
    expect(Date.now() - started).to.be.below(100)
  })

  it('at the hop limit with no router left to explore, answers NO_NODES_MATCH_FILTER', async () => {
    const { error } = await proxy({ event: 'x', filter: { service: 'missing' }, path: new Array(8).fill(0).map((_, i) => `r${i}`), budget: 1000 })
    expect(error?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
  })
})
