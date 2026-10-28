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

  it('treats an oversized or malformed path as absent', async () => {
    const { error } = await proxy({
      event: 'x',
      filter: { service: 'missing' },
      path: new Array(1000).fill('r'),
      budget: 'not-a-number'
    })
    expect(error?.code).to.equal(NodeErrorCode.NO_NODES_MATCH_FILTER)
  })

  it('rejects immediately when the remaining budget is exhausted', async () => {
    const started = Date.now()
    const { error } = await proxy({ event: 'x', filter: { service: 'missing' }, path: [], budget: 1 })
    expect(error?.code).to.equal(NodeErrorCode.PROXY_DEADLINE_EXCEEDED)
    expect(Date.now() - started).to.be.below(100)
  })

  it('rejects a path that already holds the maximum number of hops', async () => {
    const { error } = await proxy({ event: 'x', filter: { service: 'missing' }, path: new Array(8).fill(0).map((_, i) => `r${i}`), budget: 1000 })
    expect(error?.code).to.equal(NodeErrorCode.PROXY_HOP_LIMIT)
  })
})
