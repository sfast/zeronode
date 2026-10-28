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
import Node, { Router, NodeError, NodeErrorCode, Transport } from '../../src/index.js'
import { LocalTransport } from '../../src/transport/local/index.js'

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
