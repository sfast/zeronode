/**
 * Regression: peer lifecycle events are edge-triggered (2.1 candidates).
 *
 * From the PEER_LEFT analysis (aki doc 15) as refined by the Codex plan
 * review (aki doc 16), item 6:
 * - PEER_JOINED once per transition to joined, PEER_LEFT once per transition
 *   out of it (per direction); a re-handshake of a joined peer is silent, or
 *   PEER_UPDATED if its options changed
 * - PEER_LEFT carries a `category` (graceful / lost / replaced / local); the
 *   `reason` strings are unchanged
 * - one peer id may be joined in both directions (two nodes connected to
 *   each other): each direction has its own state
 * - server side: CLIENT_STOP from a client that is not joined, and a
 *   resurrection ping, no longer produce extra CLIENT_LEFT events
 * - unbind()/close() report PEER_LEFT (UNBOUND, local) for downstream peers
 *
 * ZeroMQ transport, port 0.
 */

import { expect } from 'chai'
import net from 'net'
import Node, { NodeEvent } from '../../src/index.js'
import { ServerEvent } from '../../src/protocol/server.js'
import { ClientEvent } from '../../src/protocol/client.js'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const quiet = () => ({ error () {}, warn () {}, info () {}, debug () {} })

/** Resolve once `check()` is true (polled), reject after `ms` */
function until (check, ms = 3000, what = 'condition') {
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
    }, 10)
  })
}

/** Record a node's peer events as compact strings */
function recorder (node) {
  const events = []
  node.on(NodeEvent.PEER_JOINED, ({ peerId, direction }) => events.push(`joined ${direction} ${peerId}`))
  node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason, category }) => events.push(`left ${direction} ${peerId} ${reason} ${category}`))
  node.on(NodeEvent.PEER_UPDATED, ({ peerId, direction }) => events.push(`updated ${direction} ${peerId}`))
  return events
}

/** TCP proxy on port 0; drop() simulates a transport blip */
async function startProxy (target) {
  const sockets = new Set()
  const server = net.createServer((inbound) => {
    const [host, port] = target.replace('tcp://', '').split(':')
    const outbound = net.connect(Number(port), host)
    sockets.add(inbound)
    sockets.add(outbound)
    inbound.pipe(outbound)
    outbound.pipe(inbound)
    const cleanup = () => { inbound.destroy(); outbound.destroy(); sockets.delete(inbound); sockets.delete(outbound) }
    inbound.on('error', cleanup)
    outbound.on('error', cleanup)
    inbound.on('close', cleanup)
    outbound.on('close', cleanup)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    address: `tcp://127.0.0.1:${server.address().port}`,
    drop () { for (const s of sockets) s.destroy() },
    close () { this.drop(); return new Promise(resolve => server.close(resolve)) }
  }
}

describe('2.1 (6): peer events are edge-triggered', function () {
  this.timeout(10000)

  let nodes = []
  let proxy
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) await node.close().catch(() => {})
    nodes = []
    await proxy?.close()
    proxy = null
  })

  it('a server that stops: one PEER_LEFT on the client, none more at its own close()', async () => {
    const server = track(new Node({ id: `el-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    const client = new Node({ id: `el-cli-${uid()}`, config: { logger: quiet() } })
    const events = recorder(client)
    await client.connect({ address: server.getAddress() })

    await server.close()
    await until(() => events.some(e => e.startsWith('left')), 3000, 'PEER_LEFT')
    await wait(100)
    await client.close()

    const left = events.filter(e => e.startsWith('left'))
    expect(left, events.join(' | ')).to.have.length(1)
    // Whichever signal arrived first: the server's stop or the dropped link
    expect(left[0]).to.match(/ (server_left graceful|TRANSPORT_NOT_READY lost)$/)
  })

  it('a client that closes: one PEER_LEFT on each side (local / graceful)', async () => {
    const server = track(new Node({ id: `el-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    const serverEvents = recorder(server)
    const client = new Node({ id: `el-cli-${uid()}` })
    const clientEvents = recorder(client)
    await client.connect({ address: server.getAddress() })

    await client.close()
    await until(() => serverEvents.some(e => e.startsWith('left')), 3000, 'server PEER_LEFT')

    expect(clientEvents).to.deep.equal([
      `joined upstream ${server.getId()}`,
      `left upstream ${server.getId()} TRANSPORT_NOT_READY local`
    ])
    expect(serverEvents).to.deep.equal([
      `joined downstream ${client.getId()}`,
      `left downstream ${client.getId()} CLIENT_STOP graceful`
    ])
  })

  it('disconnect(address): one PEER_LEFT, category local', async () => {
    const server = track(new Node({ id: `el-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    const client = track(new Node({ id: `el-cli-${uid()}` }))
    const events = recorder(client)
    await client.connect({ address: server.getAddress() })
    await client.disconnect(server.getAddress())
    expect(events).to.deep.equal([
      `joined upstream ${server.getId()}`,
      `left upstream ${server.getId()} TRANSPORT_NOT_READY local`
    ])
  })

  it('a transport blip: the server sees no second PEER_JOINED', async () => {
    const server = track(new Node({ id: `el-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    const serverEvents = recorder(server)
    proxy = await startProxy(server.getAddress())
    const client = track(new Node({ id: `el-cli-${uid()}`, config: { logger: quiet() } }))
    const clientEvents = recorder(client)
    await client.connect({ address: proxy.address })

    proxy.drop()
    // The client sees the link go and come back (left, then joined again)
    await until(() => clientEvents.filter(e => e.startsWith('joined')).length === 2, 5000, 'client rejoined')
    await wait(100)
    expect(serverEvents).to.deep.equal([`joined downstream ${client.getId()}`])
    expect(clientEvents.filter(e => e.startsWith('left'))).to.have.length(1)
  })

  it('a re-handshake with changed options: PEER_UPDATED, not PEER_JOINED', async () => {
    const server = track(new Node({ id: `el-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    const serverEvents = recorder(server)
    proxy = await startProxy(server.getAddress())
    const client = track(new Node({ id: `el-cli-${uid()}`, options: { v: 1 }, config: { logger: quiet() } }))
    await client.connect({ address: proxy.address })

    // Offline: the new options travel with the next handshake only
    const back = new Promise(resolve => client.once(NodeEvent.PEER_JOINED, resolve))
    proxy.drop()
    await until(() => client.getNodesUpstream().length === 0, 3000, 'client offline')
    await client.setOptions({ v: 2 })
    await back
    await until(() => serverEvents.length === 2, 3000, 'server PEER_UPDATED')
    expect(serverEvents).to.deep.equal([`joined downstream ${client.getId()}`, `updated downstream ${client.getId()}`])
    expect(server.getPeerOptions(client.getId()).v).to.equal(2)
  })

  it('unbind(): PEER_LEFT (UNBOUND, local) once per downstream peer', async () => {
    const server = track(new Node({ id: `el-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    const events = recorder(server)
    const client = track(new Node({ id: `el-cli-${uid()}`, config: { logger: quiet(), reconnect: 'disabled' } }))
    await client.connect({ address: server.getAddress() })
    await until(() => events.length === 1, 2000, 'server PEER_JOINED')

    await server.unbind()
    await wait(100)
    expect(events).to.deep.equal([
      `joined downstream ${client.getId()}`,
      `left downstream ${client.getId()} UNBOUND local`
    ])
  })

  it('two nodes connected to each other: each direction has its own session', async () => {
    const a = track(new Node({ id: `el-a-${uid()}` }))
    const b = track(new Node({ id: `el-b-${uid()}`, config: { logger: quiet() } }))
    a.onRequest('who', () => 'a')
    b.onRequest('who', () => 'b')
    await a.bind('tcp://127.0.0.1:0')
    await b.bind('tcp://127.0.0.1:0')
    await a.connect({ address: b.getAddress() })
    await b.connect({ address: a.getAddress() })
    await until(() => a.getNodesDownstream().includes(b.getId()), 2000, 'b downstream of a')

    expect(a.getNodesUpstream()).to.deep.equal([b.getId()])
    expect(a.getNodesDownstream()).to.deep.equal([b.getId()])

    // b's connection to a ends; a's own connection to b is untouched
    const events = recorder(a)
    await b.disconnect(a.getAddress())
    await until(() => events.length === 1, 2000, 'a PEER_LEFT')
    expect(events).to.deep.equal([`left downstream ${b.getId()} CLIENT_STOP graceful`])
    expect(a.getNodesUpstream()).to.deep.equal([b.getId()])
    expect(await a.request({ to: b.getId(), event: 'who', timeout: 2000 })).to.equal('b')
  })
})

describe('2.1 (6): server-side lifecycle bookkeeping', function () {
  this.timeout(10000)

  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = server = null
  })

  it('a timed-out client that pings again rejoins without a REPLACED', async () => {
    server = new Node({
      id: `rs-srv-${uid()}`,
      config: { logger: quiet(), CLIENT_HEALTH_CHECK_INTERVAL: 50, CLIENT_GHOST_TIMEOUT: 300 }
    })
    await server.bind('tcp://127.0.0.1:0')
    const nodeEvents = recorder(server)
    client = new Node({ id: `rs-cli-${uid()}`, config: { logger: quiet(), PING_INTERVAL: 1000 } })
    await client.connect({ address: server.getAddress() })

    // No ping for 1s, ghost after 300ms: TIMEOUT; the next ping resurrects it
    await until(() => nodeEvents.some(e => / TIMEOUT /.test(e)), 3000, 'TIMEOUT')
    await until(() => nodeEvents.filter(e => e.startsWith('joined')).length === 2, 4000, 'rejoined after the ping')
    expect(nodeEvents).to.deep.equal([
      `joined downstream ${client.getId()}`,
      `left downstream ${client.getId()} TIMEOUT lost`,
      `joined downstream ${client.getId()}`
    ])
  })

  it('the protocol server: TIMEOUT then a resurrection ping gives no REPLACED', async () => {
    const { default: Server } = await import('../../src/protocol/server.js')
    const { default: Client } = await import('../../src/protocol/client.js')
    const protocolServer = new Server({
      id: `rp-srv-${uid()}`,
      config: { CLIENT_HEALTH_CHECK_INTERVAL: 50, CLIENT_GHOST_TIMEOUT: 300 }
    })
    const protocolClient = new Client({ id: `rp-cli-${uid()}`, config: { PING_INTERVAL: 1000 } })
    try {
      await protocolServer.bind('tcp://127.0.0.1:0')
      const left = []
      let joined = 0
      protocolServer.on(ServerEvent.CLIENT_LEFT, ({ reason }) => left.push(reason))
      protocolServer.on(ServerEvent.CLIENT_JOINED, () => joined++)
      await protocolClient.connect(protocolServer.getAddress(), 2000)
      await until(() => joined === 2, 4000, 'rejoined after the ping')
      expect(left).to.deep.equal(['TIMEOUT'])
    } finally {
      await protocolClient.close().catch(() => {})
      await protocolServer.close().catch(() => {})
    }
  })

  it('CLIENT_STOP from a client that is not joined emits no CLIENT_LEFT', async () => {
    const { default: Server } = await import('../../src/protocol/server.js')
    const { default: Client } = await import('../../src/protocol/client.js')
    const protocolServer = new Server({
      id: `cs-srv-${uid()}`,
      config: { CLIENT_HEALTH_CHECK_INTERVAL: 50, CLIENT_GHOST_TIMEOUT: 200 }
    })
    const protocolClient = new Client({ id: `cs-cli-${uid()}`, config: { PING_INTERVAL: 60000 } })
    try {
      await protocolServer.bind('tcp://127.0.0.1:0')
      const left = []
      protocolServer.on(ServerEvent.CLIENT_LEFT, ({ reason }) => left.push(reason))
      await protocolClient.connect(protocolServer.getAddress(), 2000)
      await until(() => left.length === 1, 3000, 'TIMEOUT')

      await protocolClient.close()
      await wait(150)
      expect(left).to.deep.equal(['TIMEOUT'])
    } finally {
      await protocolClient.close().catch(() => {})
      await protocolServer.close().catch(() => {})
    }
  })
})

describe('2.1 (7): reconnect attempts are observable', function () {
  this.timeout(10000)

  let server
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = server = null
  })

  it('RECONNECT_ATTEMPT { address, interval, peerId } while the server is gone, none after disconnect()', async () => {
    server = new Node({ id: `ra-srv-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    const address = server.getAddress()
    const serverId = server.getId()
    client = new Node({ id: `ra-cli-${uid()}`, config: { logger: quiet() } })
    const attempts = []
    client.on(NodeEvent.RECONNECT_ATTEMPT, (payload) => attempts.push(payload))
    await client.connect({ address })

    await server.close()
    server = null
    await until(() => attempts.length >= 2, 3000, 'reconnect attempts')
    expect(attempts[0]).to.include({ address, peerId: serverId })
    expect(attempts[0].interval).to.be.a('number')

    await client.disconnect(address)
    const seen = attempts.length
    await wait(400)
    expect(attempts.length, 'no attempts after disconnect()').to.equal(seen)
  })
})

describe('2.1 (8): ZMTP heartbeats detect an unresponsive server', function () {
  this.timeout(15000)

  const SERVER_CHILD = new URL('./fixtures/server-child.js', import.meta.url)
  let child
  let client
  let server

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGKILL')
      await exited
    }
    child = client = server = null
  })

  const startFrozenableServer = async () => {
    const { fork } = await import('child_process')
    const { fileURLToPath } = await import('url')
    child = fork(fileURLToPath(SERVER_CHILD), [`hb-srv-${uid()}`, 'x'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    const { address } = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server child did not start')), 5000)
      child.once('message', (msg) => { clearTimeout(timer); resolve(msg) })
      child.once('error', (err) => { clearTimeout(timer); reject(err) })
      child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`server child exited (${code ?? signal})`)) })
    })
    return address
  }

  it('a frozen server (TCP still up) is reported lost within the heartbeat timeout', async () => {
    const address = await startFrozenableServer()
    client = new Node({ id: `hb-cli-${uid()}`, config: { logger: quiet(), ZMQ_HEARTBEAT_IVL: 100, ZMQ_HEARTBEAT_TIMEOUT: 300 } })
    const events = recorder(client)
    await client.connect({ address })

    child.kill('SIGSTOP')
    const frozenAt = Date.now()
    await until(() => events.some(e => e.startsWith('left')), 3000, 'PEER_LEFT for the frozen server')
    expect(Date.now() - frozenAt).to.be.below(1500)
    expect(events.find(e => e.startsWith('left'))).to.match(/ lost$/)
  })

  it('with heartbeats off (ZMQ_HEARTBEAT_IVL: 0) a frozen server is not detected', async () => {
    const address = await startFrozenableServer()
    client = new Node({ id: `hb-off-${uid()}`, config: { logger: quiet(), ZMQ_HEARTBEAT_IVL: 0 } })
    const events = recorder(client)
    await client.connect({ address })

    child.kill('SIGSTOP')
    await wait(1000)
    expect(events.filter(e => e.startsWith('left'))).to.deep.equal([])
  })

  it('an idle server without heartbeats keeps a heartbeating client connected', async () => {
    // The server sets no heartbeat options (as a 2.0.15 server): libzmq answers PINGs itself
    server = new Node({ id: `hb-plain-${uid()}` })
    await server.bind('tcp://127.0.0.1:0')
    client = new Node({ id: `hb-idle-${uid()}`, config: { logger: quiet(), ZMQ_HEARTBEAT_IVL: 100, ZMQ_HEARTBEAT_TIMEOUT: 300 } })
    const events = recorder(client)
    await client.connect({ address: server.getAddress() })

    await wait(1500)
    expect(events).to.deep.equal([`joined upstream ${server.getId()}`])
  })

  it('clients heartbeat by default (5s / 15s); servers only when configured', async () => {
    const { ZMQConfigDefaults, DealerHeartbeatDefaults } = await import('../../src/transport/zeromq/config.js')
    expect(DealerHeartbeatDefaults).to.deep.equal({ ZMQ_HEARTBEAT_IVL: 5000, ZMQ_HEARTBEAT_TIMEOUT: 15000 })
    expect(ZMQConfigDefaults.ZMQ_HEARTBEAT_IVL).to.equal(undefined)
  })

  it('invalid heartbeat / reconnect settings are rejected', async () => {
    const { validateConfig } = await import('../../src/transport/zeromq/config.js')
    expect(() => validateConfig({ ZMQ_HEARTBEAT_IVL: -1 })).to.throw(/ZMQ_HEARTBEAT_IVL/)
    expect(() => validateConfig({ ZMQ_HEARTBEAT_TIMEOUT: 'x' })).to.throw(/ZMQ_HEARTBEAT_TIMEOUT/)
    expect(() => validateConfig({ ZMQ_HEARTBEAT_TTL: 1.5 })).to.throw(/ZMQ_HEARTBEAT_TTL/)
    expect(() => validateConfig({ ZMQ_RECONNECT_IVL_MAX: -5 })).to.throw(/ZMQ_RECONNECT_IVL_MAX/)
    expect(() => validateConfig({ ZMQ_HEARTBEAT_IVL: 0, ZMQ_RECONNECT_IVL_MAX: 30000 })).to.not.throw()
  })
})

describe('2.1 (10): reconnect policies are applied to the connection', function () {
  this.timeout(10000)

  let nodes = []
  let proxy
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) await node.close().catch(() => {})
    nodes = []
    await proxy?.close()
    proxy = null
  })

  /** A server at a fixed address that can be replaced by a new one there */
  const serverAt = async (address) => {
    const server = track(new Node({ id: `rp-srv-${uid()}` }))
    server.onRequest('who', () => server.getId())
    await server.bind(address || 'tcp://127.0.0.1:0')
    return server
  }

  for (const [policy, rejoinsAfterBlip] of [['always', true], ['on_failure', true], ['disabled', false]]) {
    it(`${policy}: after a transport blip the client ${rejoinsAfterBlip ? 'rejoins' : 'stays disconnected'}`, async () => {
      const server = await serverAt()
      proxy = await startProxy(server.getAddress())
      const client = track(new Node({ id: `rp-cli-${uid()}`, config: { logger: quiet(), reconnect: policy } }))
      const events = recorder(client)
      await client.connect({ address: proxy.address })

      proxy.drop()
      await until(() => events.some(e => e.startsWith('left')), 3000, 'PEER_LEFT')
      if (rejoinsAfterBlip) {
        await until(() => client.getNodesUpstream().length === 1, 3000, 'rejoined')
      } else {
        await wait(800) // several ZeroMQ reconnect intervals
        expect(client.getNodesUpstream()).to.deep.equal([])
        expect(client.getServerIdByAddress(proxy.address)).to.equal(null)
        // An explicit connect() works again
        await client.connect({ address: proxy.address })
        expect(await client.request({ to: server.getId(), event: 'who', timeout: 2000 })).to.equal(server.getId())
      }
      expect(events.filter(e => e.startsWith('left')), 'one PEER_LEFT').to.have.length(1)
    })
  }

  it('disabled: a connect() from the PEER_LEFT listener waits for the old connection to end', async () => {
    const first = await serverAt()
    const address = first.getAddress()
    const client = track(new Node({ id: `rp-cli-${uid()}`, config: { logger: quiet(), reconnect: 'disabled' } }))
    await client.connect({ address })

    let reconnecting
    client.once(NodeEvent.PEER_LEFT, () => {
      // Synchronously, before the policy has ended the old connection
      reconnecting = client.connect({ address, timeout: 3000 })
    })
    await first.close()
    await until(() => reconnecting, 3000, 'PEER_LEFT')
    const second = await serverAt(address)
    const info = await reconnecting
    expect(info?.id).to.equal(second.getId())
    expect(await client.request({ to: second.getId(), event: 'who', timeout: 2000 })).to.equal(second.getId())
  })

  for (const [policy, rejoinsAfterStop] of [['always', true], ['on_failure', false], ['disabled', false]]) {
    it(`${policy}: after the server stops gracefully the client ${rejoinsAfterStop ? 'rejoins the next server' : 'stays disconnected'}`, async () => {
      const first = await serverAt()
      const address = first.getAddress()
      const client = track(new Node({ id: `rp-cli-${uid()}`, config: { logger: quiet(), reconnect: policy } }))
      const events = recorder(client)
      await client.connect({ address })

      await first.close()
      await until(() => events.some(e => e.startsWith('left')), 3000, 'PEER_LEFT')
      // The stop message and the dropped link race: the policy follows what
      // was observed first (graceful vs lost)
      const graceful = events.find(e => e.startsWith('left')).endsWith(' graceful')
      const second = await serverAt(address)
      const expectRejoin = rejoinsAfterStop || (policy === 'on_failure' && !graceful)
      if (expectRejoin) {
        await until(() => client.getNodesUpstream().includes(second.getId()), 3000, 'rejoined the next server')
      } else {
        await wait(800)
        expect(client.getNodesUpstream()).to.deep.equal([])
        expect(client.getServerIdByAddress(address)).to.equal(null)
      }
    })
  }
})

describe('2.1 review (Codex): teardown from peer-event listeners, direction-aware routing', function () {
  this.timeout(10000)

  let nodes = []
  let proxy
  const track = (node) => { nodes.push(node); return node }

  afterEach(async () => {
    for (const node of nodes.reverse()) await node.close().catch(() => {})
    nodes = []
    await proxy?.close()
    proxy = null
  })

  // A second process with the same id takes the session over (REPLACED); the
  // server's PEER_LEFT listener tears the server down
  for (const teardown of ['close', 'unbind']) {
    it(`a REPLACED client does not join again when a PEER_LEFT listener runs ${teardown}()`, async () => {
      const server = track(new Node({ id: `rv-srv-${uid()}` }))
      await server.bind('tcp://127.0.0.1:0')
      const sharedId = `rv-dup-${uid()}`
      const first = track(new Node({ id: sharedId, config: { logger: quiet(), reconnect: 'disabled' } }))
      await first.connect({ address: server.getAddress() })

      const events = recorder(server)
      let stopping
      server.on(NodeEvent.PEER_LEFT, ({ reason }) => {
        if (reason === 'REPLACED') stopping = server[teardown]()
      })
      const second = track(new Node({ id: sharedId, config: { logger: quiet(), reconnect: 'disabled' } }))
      second.connect({ address: server.getAddress(), timeout: 1000 }).catch(() => {})
      await until(() => stopping, 3000, 'REPLACED')
      await stopping
      await wait(100)

      expect(events.filter(e => e.startsWith('joined'))).to.deep.equal([])
      expect(server.getNodesDownstream()).to.deep.equal([])
    })
  }

  it('a disconnect() from the PEER_LEFT listener of a re-key is not undone by the new join', async () => {
    const server = track(new Node({ id: `rk-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    const address = server.getAddress()
    const client = track(new Node({ id: `rk-cli-${uid()}`, config: { logger: quiet() } }))
    await client.connect({ address })
    const protocolClient = client._findRoute(server.getId()).target

    const events = recorder(client)
    let disconnecting
    client.once(NodeEvent.PEER_LEFT, () => { disconnecting = client.disconnect(address) })
    // The server at the address answers under a new id while the old one is
    // still joined: a re-key (PEER_LEFT replaced for the old id)
    protocolClient.emit(ClientEvent.SERVER_JOINED, { serverId: `rk-new-${uid()}`, serverOptions: {} })
    await disconnecting

    expect(events).to.deep.equal([`left upstream ${server.getId()} replaced replaced`])
    expect(client.getNodesUpstream()).to.deep.equal([])
  })

  it('disabled: a handshake before the policy ends the connection does not rejoin it', async () => {
    const server = track(new Node({ id: `pg-srv-${uid()}` }))
    await server.bind('tcp://127.0.0.1:0')
    proxy = await startProxy(server.getAddress())
    const client = track(new Node({ id: `pg-cli-${uid()}`, config: { logger: quiet(), reconnect: 'disabled' } }))
    await client.connect({ address: proxy.address })
    const protocolClient = client._findRoute(server.getId()).target

    const events = recorder(client)
    client.once(NodeEvent.PEER_LEFT, () => {
      // Before the deferred teardown runs, the old client handshakes again
      protocolClient.emit(ClientEvent.SERVER_JOINED, { serverId: server.getId(), serverOptions: {} })
    })
    proxy.drop()
    await until(() => events.length > 0, 3000, 'PEER_LEFT')
    await wait(800)

    expect(events.filter(e => e.startsWith('joined')), events.join(' | ')).to.deep.equal([])
    expect(client.getServerIdByAddress(proxy.address)).to.equal(null)
  })

  it('requestDownAny / tickDownAny to a peer joined both ways use the downstream route', async () => {
    const a = track(new Node({ id: `dr-a-${uid()}` }))
    const b = track(new Node({ id: `dr-b-${uid()}`, config: { logger: quiet() } }))
    b.onRequest('who', () => 'b')
    b.onTick('note', () => {})
    await a.bind('tcp://127.0.0.1:0')
    await b.bind('tcp://127.0.0.1:0')
    await a.connect({ address: b.getAddress() })
    await b.connect({ address: a.getAddress() })
    await until(() => a.getNodesDownstream().includes(b.getId()), 2000, 'b downstream of a')

    // a's own connection to b (its upstream route, preferred by request({ to }))
    const { default: Client } = await import('../../src/protocol/client.js')
    const upstream = a._findRoute(b.getId()).target
    expect(upstream).to.be.instanceOf(Client)
    const viaUpstream = []
    for (const method of ['request', 'tick']) {
      const original = upstream[method].bind(upstream)
      upstream[method] = (params) => { viaUpstream.push(method); return original(params) }
    }

    expect(await a.requestDownAny({ event: 'who', timeout: 2000 })).to.equal('b')
    a.tickDownAny({ event: 'note' })
    expect(viaUpstream, 'down-only calls must not use the upstream route').to.deep.equal([])
    expect(await a.request({ to: b.getId(), event: 'who', timeout: 2000 })).to.equal('b')
    expect(viaUpstream).to.deep.equal(['request'])
  })

  it('index.d.ts types RECONNECT_ATTEMPT listeners and the connect() result', async () => {
    const fs = await import('fs')
    const { fileURLToPath } = await import('url')
    const dts = fs.readFileSync(fileURLToPath(new URL('../../index.d.ts', import.meta.url)), 'utf8')
    expect(dts).to.match(/on\(event: NodeEvent\.RECONNECT_ATTEMPT, listener: \(payload: ReconnectAttemptPayload\) => void\): this;/)
    expect(dts).to.match(/once\(event: NodeEvent\.RECONNECT_ATTEMPT, listener: \(payload: ReconnectAttemptPayload\) => void\): this;/)
    expect(dts).to.match(/connect\(options: ConnectOptions\): Promise<\{ id: string; options: Record<string, any> \} \| null>;/)
  })
})
