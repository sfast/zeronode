/**
 * Regression: bug 10 — a node that stays up while its upstream router
 * restarts under a NEW id re-handshakes at the transport level (the DEALER
 * reconnects by itself) but never re-keyed its client maps: the new router was
 * joined yet had no route, so requestAny ended NO_NODES_MATCH_FILTER and
 * request({to}) NODE_NOT_FOUND until the process restarted.
 *
 * Same task (Codex review of rc-2.0.16, doc d736e0f6):
 * - g1: the reconnect timer declared "Successfully reconnected" (and stopped)
 *   for an indexed address whose client had no session
 * - g2: the first PEER_JOINED fired before the client was stored, so a
 *   synchronous listener could not route to the peer
 * - f2: requestAny/tickAny accepted the internal `_routing` from callers
 *
 * ZeroMQ transport; the restart test uses one ipc:// address for every router.
 */

import { expect } from 'chai'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as zmq from 'zeromq'
import Node, { Router, NodeEvent } from '../../src/index.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ipcFiles = []
const ipcAddress = () => {
  const file = path.join(os.tmpdir(), `zn-bug10-${uid()}.sock`)
  ipcFiles.push(file)
  return `ipc://${file}`
}

after(() => {
  for (const file of ipcFiles.splice(0)) fs.rmSync(file, { force: true })
})

/** Resolve once `check()` is true, re-checking on every `event` of `emitters` */
function waitUntil (emitters, events, check, ms = 5000, what = 'condition') {
  return new Promise((resolve, reject) => {
    const off = () => {
      clearTimeout(timer)
      for (const emitter of emitters) for (const event of events) emitter.off(event, onEvent)
    }
    const onEvent = () => {
      // Listeners run before later ones of the same emit: look once it is done
      setImmediate(() => { if (check()) { off(); resolve() } })
    }
    const timer = setTimeout(() => { off(); reject(new Error(`timed out waiting for ${what}`)) }, ms)
    for (const emitter of emitters) for (const event of events) emitter.on(event, onEvent)
    if (check()) { off(); resolve() }
  })
}

/** Resolve once `check()` is true (polled), reject after `ms` */
function pollUntil (check, ms, what) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = setInterval(() => {
      if (check()) {
        clearInterval(poll)
        resolve()
      } else if (Date.now() - started > ms) {
        clearInterval(poll)
        reject(new Error(`timed out waiting for ${what}`))
      }
    }, 20)
  })
}

/** Logger that records messages (the Node logs its reconnect decisions) */
function recordingLogger () {
  const lines = []
  const log = (level) => (...args) => lines.push({ level, text: args.map(String).join(' ') })
  return { lines, error: log('error'), warn: log('warn'), info: log('info'), debug: log('debug') }
}

describe('Regression bug 10: a router restarting under a new id is re-keyed', function () {
  this.timeout(20000)

  let nodes = []
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) {
      await node.close().catch(() => {})
    }
    nodes = []
  })

  /** A router at `address` that answers `whoami` with its id */
  const startRouter = (name) => {
    const router = track(new Router({ id: `bug10-${name}-${uid()}` }))
    router.onRequest('whoami', () => router.getId())
    return router
  }

  /** Bind `router` and wait until both nodes joined it and `requester` sees it */
  const bindAndWaitJoined = async (router, address, requester, provider, afterBind = async () => {}) => {
    const both = () => {
      const downstream = router.getNodesDownstream()
      return downstream.includes(requester.getId()) && downstream.includes(provider.getId()) &&
        requester.getNodesUpstream().includes(router.getId())
    }
    const joined = waitUntil([router, requester], [NodeEvent.PEER_JOINED], both, 8000, `both nodes joined ${router.getId()}`)
    await router.bind(address)
    await afterBind()
    await joined
  }

  // With 'always' the DEALER re-handshakes by itself; with 'disabled' (no
  // reconnect target, no id → address mapping) the connection ends when the
  // router goes and the requester connects again itself (2.1)
  for (const reconnect of ['always', 'disabled']) {
    it(`routes through each new router after restarts (requestAny and request({to}), reconnect: ${reconnect})`, async () => {
      const address = ipcAddress()

      const r1 = startRouter('r1')
      await r1.bind(address)

      const requester = track(new Node({ id: `bug10-req-${uid()}`, config: { reconnect } }))
      const provider = track(new Node({ id: `bug10-svc-${uid()}`, options: { service: 'target' } }))
      provider.onRequest('who', () => 'provider')

      // Upstream events seen by the requester, and whether a synchronous
      // PEER_JOINED listener could route to the peer at once (g2 on re-key)
      const events = []
      const syncRoutes = []
      requester.on(NodeEvent.PEER_JOINED, ({ peerId, direction }) => {
        if (direction !== 'upstream') return
        events.push(`joined ${peerId}`)
        syncRoutes.push(requester.request({ to: peerId, event: 'whoami', timeout: 2000 })
          .then(id => ({ peerId, id }), err => ({ peerId, code: err.code })))
      })
      requester.on(NodeEvent.PEER_LEFT, ({ peerId, direction }) => {
        if (direction === 'upstream') events.push(`left ${peerId}`)
      })

      await requester.connect({ address })
      await provider.connect({ address })

      const ask = () => requester.requestAny({ event: 'who', filter: { service: 'target' }, timeout: 2000 })
      expect(await ask()).to.equal('provider')

      const assertCurrent = async (current, old) => {
        expect(requester.getNodesUpstream(), 'upstream peers').to.deep.equal([current.getId()])
        expect(requester.getServerIdByAddress(address), 'id at the address').to.equal(current.getId())
        if (old) expect(requester.getPeerOptions(old.getId()), 'old router options').to.equal(null)
        expect(await ask(), 'requestAny through the current router').to.equal('provider')
        expect(await requester.request({ to: current.getId(), event: 'whoami', timeout: 2000 }), 'request({to})')
          .to.equal(current.getId())
      }
      await assertCurrent(r1)

      // Restart twice, each time under a new id at the same address
      const routerIds = [r1.getId()]
      let previous = r1
      for (const name of ['r2', 'r3']) {
        const left = waitUntil([requester], [NodeEvent.PEER_LEFT],
          () => !requester.getNodesUpstream().includes(previous.getId()), 5000, `${previous.getId()} left`)
        await previous.close()
        await left

        const next = startRouter(name)
        // 'disabled' ends the connection when the router goes (2.1): the
        // requester connects again itself; with 'always' ZeroMQ does it
        await bindAndWaitJoined(next, address, requester, provider,
          reconnect === 'disabled' ? () => requester.connect({ address }) : undefined)
        await assertCurrent(next, previous)
        routerIds.push(next.getId())
        previous = next
      }

      // joined R1 → left R1 → joined R2 → left R2 → joined R3 (a duplicate
      // PEER_LEFT is tolerated: SERVER_LEFT and NOT_READY both report it)
      const deduped = events.filter((e, i) => e !== events[i - 1])
      const [r1Id, r2Id, r3Id] = routerIds
      expect(deduped).to.deep.equal([
        `joined ${r1Id}`, `left ${r1Id}`,
        `joined ${r2Id}`, `left ${r2Id}`,
        `joined ${r3Id}`
      ])

      // Each PEER_JOINED listener could route to its peer synchronously
      expect(await Promise.all(syncRoutes)).to.deep.equal([
        { peerId: r1Id, id: r1Id },
        { peerId: r2Id, id: r2Id },
        { peerId: r3Id, id: r3Id }
      ])

      // disconnect() still forgets the (re-keyed) address entirely
      await requester.disconnect(address)
      expect(requester.getNodesUpstream()).to.deep.equal([])
      expect(requester.getServerIdByAddress(address)).to.equal(null)
      await requester.connect({ address })
      expect(await ask()).to.equal('provider')
    })
  }

  it('a re-handshake after close() does not repopulate the node', async () => {
    const address = ipcAddress()
    const r1 = startRouter('r1')
    await r1.bind(address)

    const requester = track(new Node({ id: `bug10-req-${uid()}` }))
    await requester.connect({ address })
    await r1.close()

    const joinedAfterClose = []
    await requester.close()
    requester.on(NodeEvent.PEER_JOINED, (p) => joinedAfterClose.push(p))

    const r2 = startRouter('r2')
    await r2.bind(address)
    // The closed requester's DEALER is gone: nothing can join any more
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(joinedAfterClose).to.deep.equal([])
    expect(requester.getNodesUpstream()).to.deep.equal([])
    expect(requester.getServerIdByAddress(address)).to.equal(null)
  })
})

describe('Regression bug 10 (g1): the reconnect timer verifies the session', function () {
  this.timeout(15000)

  let nodes = []
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) {
      await node.close().catch(() => {})
    }
    nodes = []
  })

  it('keeps retrying while the known client has no session, stops once re-keyed', async () => {
    const address = ipcAddress()
    const r1 = track(new Router({ id: `bug10-g1-r1-${uid()}` }))
    await r1.bind(address)

    const logger = recordingLogger()
    const requester = track(new Node({ id: `bug10-g1-req-${uid()}`, config: { logger } }))
    await requester.connect({ address })
    await r1.close()

    // The timer fires while nothing listens at the address. The client is
    // still indexed (its DEALER keeps reconnecting) but has no session: that
    // is not a successful reconnect, and the timer keeps retrying
    const verdict = (l) => /Successfully reconnected|no session yet/.test(l.text)
    await pollUntil(() => logger.lines.some(verdict), 5000, 'the first reconnect timer')
    expect(logger.lines.filter(verdict).map(l => l.text)[0]).to.match(/no session yet/)

    // The DEALER reaches a new router: the re-key refreshes the target
    const r2 = track(new Router({ id: `bug10-g1-r2-${uid()}` }))
    const joined = waitUntil([requester], [NodeEvent.PEER_JOINED],
      () => requester.getNodesUpstream().includes(r2.getId()), 5000, 'r2 joined')
    await r2.bind(address)
    await joined
    expect(requester.getNodesUpstream()).to.deep.equal([r2.getId()])

    // ...so the next loss starts over at the first backoff step (attempts = 0)
    const from = logger.lines.length
    await r2.close()
    await pollUntil(() => logger.lines.slice(from).some(l => /Reconnecting to .* \(attempt 1\)/.test(l.text)),
      3000, 'a fresh reconnect schedule')
  })

  it('a transport that is up again without a handshake is not a session', async () => {
    const address = ipcAddress()
    const r1 = track(new Router({ id: `bug10-g1s-r1-${uid()}` }))
    await r1.bind(address)

    const logger = recordingLogger()
    const requester = track(new Node({ id: `bug10-g1s-req-${uid()}`, config: { logger } }))
    await requester.connect({ address })
    await r1.close()

    // Something at the address accepts the DEALER but never answers the
    // handshake: the client's transport is up and it still knows the old id
    const silent = new zmq.Router({ linger: 0 })
    try {
      await silent.bind(address)
      const verdict = (l) => /Successfully reconnected|no session yet/.test(l.text)
      await pollUntil(() => logger.lines.some(verdict), 5000, 'the first reconnect timer')
      expect(logger.lines.filter(verdict).map(l => l.text)[0]).to.match(/no session yet/)
      expect(requester.getNodesUpstream()).to.deep.equal([])
    } finally {
      silent.close()
    }
  })
})

describe('Regression bug 10 (g2): the first PEER_JOINED is routable', function () {
  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = server = null
  })

  it('a synchronous PEER_JOINED listener can request({to: peerId})', async () => {
    server = new Node({ id: `bug10-g2-srv-${uid()}` })
    server.onRequest('who', () => 'server')
    await server.bind('tcp://127.0.0.1:0')

    client = new Node({ id: `bug10-g2-cli-${uid()}` })
    let fromListener
    client.once(NodeEvent.PEER_JOINED, ({ peerId }) => {
      fromListener = client.request({ to: peerId, event: 'who', timeout: 2000 })
        .then(value => ({ value }), err => ({ code: err.code }))
      // tick({to}) throws synchronously when there is no route
      try {
        client.tick({ to: peerId, event: 'noop' })
      } catch (err) {
        fromListener = Promise.resolve({ tickCode: err.code })
      }
    })
    await client.connect({ address: server.getAddress() })

    expect(await fromListener).to.deep.equal({ value: 'server' })
  })

  it('a throwing PEER_JOINED listener does not fail connect() (reported as NodeEvent.ERROR)', async () => {
    server = new Node({ id: `bug10-g2t-srv-${uid()}` })
    server.onRequest('who', () => 'server')
    await server.bind('tcp://127.0.0.1:0')

    client = new Node({ id: `bug10-g2t-cli-${uid()}`, config: { logger: recordingLogger() } })
    const errors = []
    client.on(NodeEvent.ERROR, (payload) => errors.push(payload))
    client.once(NodeEvent.PEER_JOINED, () => { throw new Error('listener bug') })

    const info = await client.connect({ address: server.getAddress() })
    expect(info.id).to.equal(server.getId())
    expect(errors.map(e => e.error?.message)).to.deep.equal(['listener bug'])
    expect(await client.request({ to: server.getId(), event: 'who', timeout: 2000 })).to.equal('server')
  })
})

describe('Regression bug 10: one server reached at two addresses (id collision at connect)', function () {
  this.timeout(10000)

  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = server = null
  })

  it('the newer connection replaces the older one, with a warning', async () => {
    server = new Node({ id: `bug10-alias-srv-${uid()}` })
    server.onRequest('who', () => 'server')
    await server.bind('tcp://127.0.0.1:0')
    const first = server.getAddress()
    const alias = first.replace('127.0.0.1', 'localhost')

    const logger = recordingLogger()
    client = new Node({ id: `bug10-alias-cli-${uid()}`, config: { logger } })
    await client.connect({ address: first })
    const info = await client.connect({ address: alias, timeout: 2000 })
    expect(info.id).to.equal(server.getId())
    expect(logger.lines.some(l => l.level === 'warn' && /already connected through another address/.test(l.text))).to.equal(true)

    // At the server the newer connection took this node's id over; it is the
    // one routed through. The older connection is closed (silently: no
    // CLIENT_STOP for the shared id) and its address forgotten (2.1.0-rc.2)
    expect(client.getNodesUpstream()).to.deep.equal([server.getId()])
    expect(client.getServerIdByAddress(first), 'older address forgotten').to.equal(null)
    expect(client.getServerIdByAddress(alias)).to.equal(server.getId())
    await wait(500) // the older DEALER would have reconnected and taken the id back by now
    expect(await client.request({ to: server.getId(), event: 'who', timeout: 2000 })).to.equal('server')

    // disconnect() of the older address touches nothing; of the alias, it ends the session
    await client.disconnect(first)
    expect(client.getNodesUpstream()).to.deep.equal([server.getId()])
    await client.disconnect(alias)
    expect(client.getNodesUpstream()).to.deep.equal([])
  })
})

describe('Regression bug 10 (f2): callers cannot pass _routing', function () {
  this.timeout(10000)

  let nodes = []
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) {
      await node.close().catch(() => {})
    }
    nodes = []
  })

  const setup = async () => {
    const router = track(new Router({ id: `bug10-f2-r-${uid()}` }))
    await router.bind('tcp://127.0.0.1:0')
    const provider = track(new Node({ id: `bug10-f2-svc-${uid()}`, options: { service: 'target' } }))
    provider.onRequest('who', () => 'provider')
    await provider.connect({ address: router.getAddress() })
    const requester = track(new Node({ id: `bug10-f2-req-${uid()}` }))
    await requester.connect({ address: router.getAddress() })
    return { router, provider, requester }
  }

  it('requestAny ignores a caller-supplied _routing', async () => {
    const { router, requester } = await setup()
    const params = { event: 'who', filter: { service: 'target' }, timeout: 2000 }

    expect(await requester.requestAny(params)).to.equal('provider')
    // Would exclude the only router, or fail the request outright
    expect(await requester.requestAny({ ...params, _routing: { visited: [router.getId()] } })).to.equal('provider')
    expect(await requester.requestAny({ ...params, _routing: { path: [router.getId()], requestor: 'forged' } })).to.equal('provider')
    expect(await requester.requestAny({ ...params, _routing: { error: new Error('injected') } })).to.equal('provider')
  })

  it('tickAny ignores a caller-supplied _routing', async () => {
    const { router, provider, requester } = await setup()
    const received = []
    provider.onTick('note', (envelope) => received.push(envelope.data))
    const deliver = async (extra, n) => {
      await requester.tickAny({ event: 'note', data: n, filter: { service: 'target' }, ...extra })
      await pollUntil(() => received.includes(n), 3000, `tick ${n}`)
    }

    await deliver({}, 1)
    await deliver({ _routing: { forwards: 0 } }, 2)
    await deliver({ _routing: { visited: [router.getId()] } }, 3)
    expect(received).to.deep.equal([1, 2, 3])
  })
})
