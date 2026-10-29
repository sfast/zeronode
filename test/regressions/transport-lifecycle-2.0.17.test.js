/**
 * Regression: transport / lifecycle bookkeeping fixes (2.0.17 candidates).
 *
 * From the PEER_LEFT / reconnectionTimeout analysis (aki doc 15) as refined by
 * the Codex plan review (aki doc 16), items 1-5:
 * 1. an explicit disconnect reports NOT_READY once: Dealer.close() after
 *    disconnect() reported it a second time
 * 2. unbind()/close() left downstream peers joined in the Node
 * 3. DEALER transport events carried the zeromq.js event object as `fd` and
 *    an undefined `endpoint`; now { address } / { address, interval }
 * 4. getServerIdByAddress() returned a server id that had left
 * 5. reconnectionTimeout has had no effect since 2.0: it is now documented
 *    as such and warns once, instead of being copied into an unread key
 *
 * ZeroMQ transport, port 0.
 */

import { expect } from 'chai'
import fs from 'fs'
import { fileURLToPath } from 'url'
import Node, { NodeEvent } from '../../src/index.js'
import Server from '../../src/protocol/server.js'
import Client, { ClientEvent } from '../../src/protocol/client.js'
import { Router as RouterSocket, Dealer as DealerSocket } from '../../src/transport/zeromq/index.js'
import { TransportEvent } from '../../src/transport/events.js'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const quiet = () => {
  const lines = []
  const log = (level) => (...args) => lines.push({ level, text: args.map(String).join(' ') })
  return { lines, error: log('error'), warn: log('warn'), info: log('info'), debug: log('debug') }
}

/** Resolve on the first `event` of `emitter` matching `match`, reject after `ms` */
function nextEvent (emitter, event, match = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { emitter.off(event, on); reject(new Error(`timed out waiting for ${event}`)) }, ms)
    const on = (payload) => {
      if (!match(payload)) return
      clearTimeout(timer)
      emitter.off(event, on)
      resolve(payload)
    }
    emitter.on(event, on)
  })
}

describe('2.0.17 (1): an explicit disconnect reports NOT_READY once', function () {
  let server
  let client
  let router
  let dealer

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    await dealer?.close().catch(() => {})
    await router?.close().catch(() => {})
    client = server = dealer = router = null
  })

  it('Client.close() emits one NOT_READY, then CLOSED', async () => {
    server = new Server({ id: `l2-srv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    client = new Client({ id: `l2-cli-${uid()}` })
    await client.connect(server.getAddress(), 2000)

    const seen = []
    client.on(ClientEvent.NOT_READY, ({ reason }) => seen.push(`NOT_READY ${reason}`))
    client.on(ClientEvent.CLOSED, () => seen.push('CLOSED'))
    await client.close()

    expect(seen).to.deep.equal(['NOT_READY TRANSPORT_NOT_READY', 'CLOSED'])
  })

  it('Dealer.close() after disconnect() does not report NOT_READY again', async () => {
    router = new RouterSocket({ id: `l2-router-${uid()}` })
    await router.bind('tcp://127.0.0.1:0')
    dealer = new DealerSocket({ id: `l2-dealer-${uid()}` })
    const ready = nextEvent(dealer, TransportEvent.READY)
    await dealer.connect(router.getAddress())
    await ready

    let notReady = 0
    dealer.on(TransportEvent.NOT_READY, () => notReady++)
    await dealer.disconnect()
    await dealer.close()
    dealer = null
    expect(notReady).to.equal(1)
  })
})

describe('2.0.17 (2): unbind()/close() leave no downstream peer behind', function () {
  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = server = null
  })

  it('unbind() forgets the downstream peers; they rejoin after a rebind', async () => {
    server = new Node({ id: `st-srv-${uid()}` })
    server.onRequest('who', () => 'server')
    await server.bind('tcp://127.0.0.1:0')
    const address = server.getAddress()

    client = new Node({ id: `st-cli-${uid()}`, config: { logger: quiet() } })
    client.onRequest('who', () => 'client')
    await client.connect({ address })
    expect(server.getNodesDownstream()).to.deep.equal([client.getId()])

    await server.unbind()
    expect(server.getNodesDownstream(), 'after unbind').to.deep.equal([])
    expect(server.getPeerOptions(client.getId()), 'options after unbind').to.equal(null)

    // The client's DEALER reconnects by itself once the address is bound again
    const rejoined = nextEvent(server, NodeEvent.PEER_JOINED, ({ peerId }) => peerId === client.getId(), 5000)
    await server.bind(address)
    await rejoined
    expect(await server.request({ to: client.getId(), event: 'who', timeout: 2000 })).to.equal('client')
  })

  it('close() forgets the downstream peers', async () => {
    server = new Node({ id: `st-srv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    client = new Node({ id: `st-cli-${uid()}`, config: { logger: quiet(), reconnect: 'disabled' } })
    await client.connect({ address: server.getAddress() })

    await server.close()
    expect(server.getPeers()).to.deep.equal([])
    server = null
  })
})

describe('2.0.17 (3): DEALER transport events carry the endpoint address', function () {
  let router
  let dealer

  afterEach(async () => {
    await dealer?.close().catch(() => {})
    await router?.close().catch(() => {})
    dealer = router = null
  })

  it('READY has { address }, RECONNECT_RETRY has { address, interval }', async () => {
    router = new RouterSocket({ id: `mon-router-${uid()}` })
    await router.bind('tcp://127.0.0.1:0')
    const address = router.getAddress()

    dealer = new DealerSocket({ id: `mon-dealer-${uid()}` })
    const ready = nextEvent(dealer, TransportEvent.READY)
    await dealer.connect(address)
    expect(await ready).to.deep.equal({ address })

    const retry = nextEvent(dealer, TransportEvent.RECONNECT_RETRY)
    const notReady = nextEvent(dealer, TransportEvent.NOT_READY)
    await router.close()
    router = null
    expect(await notReady).to.deep.equal({ address })
    const retried = await retry
    expect(retried.address).to.equal(address)
    expect(retried.interval).to.be.a('number')
  })
})

describe('2.0.17 (4): getServerIdByAddress() only reports a live session', function () {
  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = server = null
  })

  it('is null once the server has left', async () => {
    server = new Node({ id: `p4-srv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    const address = server.getAddress()
    client = new Node({ id: `p4-cli-${uid()}`, config: { logger: quiet() } })
    await client.connect({ address })
    expect(client.getServerIdByAddress(address)).to.equal(server.getId())

    const left = nextEvent(client, NodeEvent.PEER_LEFT)
    await server.close()
    server = null
    await left
    expect(client.getServerIdByAddress(address)).to.equal(null)
  })
})

describe('2.0.17 (5): reconnectionTimeout is documented as having no effect', function () {
  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = server = null
  })

  it('connect({ reconnectionTimeout }) warns once that it has no effect', async () => {
    server = new Node({ id: `t1-srv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    const other = new Node({ id: `t1-srv2-${uid()}` })
    await other.bind('tcp://127.0.0.1:0')

    const logger = quiet()
    client = new Node({ id: `t1-cli-${uid()}`, config: { logger } })
    try {
      await client.connect({ address: server.getAddress(), reconnectionTimeout: 300 })
      await client.connect({ address: other.getAddress(), reconnectionTimeout: 300 })
      const warnings = logger.lines.filter(l => l.level === 'warn' && /reconnectionTimeout/.test(l.text))
      expect(warnings).to.have.length(1)
      expect(warnings[0].text).to.match(/no effect/)
    } finally {
      await client.close().catch(() => {})
      client = null
      await other.close()
    }
  })

  it('index.d.ts marks the options nothing reads as deprecated and types the real ones', () => {
    const dts = fs.readFileSync(fileURLToPath(new URL('../../index.d.ts', import.meta.url)), 'utf8')
    const declaration = (name) => {
      const at = dts.search(new RegExp(`\\n\\s*${name}\\?:`))
      expect(at, `${name} is declared`).to.be.greaterThan(-1)
      return dts.slice(Math.max(0, dts.lastIndexOf('/**', at)), at)
    }
    for (const dead of ['reconnectionTimeout', 'reconnectInterval', 'reconnectMaxInterval', 'heartbeatInterval', 'heartbeatTimeout', 'heartbeatTtl']) {
      expect(declaration(dead), dead).to.match(/@deprecated/)
    }
    for (const live of ['ZMQ_RECONNECT_IVL', 'ZMQ_RECONNECT_IVL_MAX', 'ZMQ_SNDHWM', 'ZMQ_SNDTIMEO']) {
      expect(declaration(live), live).to.not.match(/@deprecated/)
    }
  })
})
