/**
 * Regression: bug 7 — in-flight requests to a peer that is known to be gone
 * were not rejected; they waited their full timeout. Only a full transport
 * close rejected them.
 *
 * Fix plan: "Bug 3 + 7", item 7 (grace policy): client requests survive a
 * transport blip for Globals.RECONNECT_GRACE_MS, then fail; requests to a
 * peer that left (timeout, stop, unreachable, replaced) fail at once.
 */

import { expect } from 'chai'
import net from 'net'
import { fork } from 'child_process'
import { fileURLToPath } from 'url'
import Node, { ProtocolErrorCode, Transport } from '../../src/index.js'
import { LocalTransport } from '../../src/transport/local/index.js'
import Globals from '../../src/globals.js'

const SERVER_CHILD = fileURLToPath(new URL('./fixtures/server-child.js', import.meta.url))
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** TCP proxy on port 0; drop() simulates a blip, close() a lost server */
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
    retarget (address) { target = address },
    close () { this.drop(); return new Promise(resolve => server.close(resolve)) }
  }
}

describe('Regression bug 7: server rejects requests to a client that left', function () {
  this.timeout(10000)

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

  it('rejects a pending request when the client times out (ghost)', async () => {
    const address = `local://bug7-${uid()}`
    server = new Node({
      id: `bug7-srv-${uid()}`,
      config: { CLIENT_HEALTH_CHECK_INTERVAL: 50, CLIENT_GHOST_TIMEOUT: 150 }
    })
    await server.bind(address)

    // Never pings after the handshake: looks like a silent, dead client
    client = new Node({ id: `bug7-cli-${uid()}`, config: { PING_INTERVAL: 60000 } })
    client.onRequest('hang', () => new Promise(() => {}))
    await client.connect({ address })

    const started = Date.now()
    const err = await server.request({ to: client.getId(), event: 'hang', timeout: 5000 }).then(() => null, (e) => e)

    expect(err?.code).to.equal(ProtocolErrorCode.PEER_LEFT)
    expect(Date.now() - started).to.be.below(1000)
  })
})

describe('Regression bug 7: client grace policy', function () {
  this.timeout(15000)

  let server
  let client
  let proxy

  afterEach(async () => {
    await client?.close().catch(() => {})
    await proxy?.close().catch(() => {})
    await server?.close().catch(() => {})
    client = proxy = server = null
  })

  const setup = async (replyAfterMs) => {
    server = new Node({ id: `bug7-zsrv-${uid()}` })
    server.onRequest('slow', () => wait(replyAfterMs).then(() => 'late reply'))
    await server.bind('tcp://127.0.0.1:0')
    proxy = await startProxy(server.getAddress())
    client = new Node({ id: `bug7-zcli-${uid()}`, config: { reconnect: 'disabled' } })
    await client.connect({ address: proxy.address })
  }

  it('a pending request survives a short transport blip', async () => {
    await setup(800)

    const pending = client.request({ to: server.getId(), event: 'slow', timeout: 5000 })
    await wait(100)
    proxy.drop()   // connection lost; the dealer reconnects through the proxy

    expect(await pending).to.equal('late reply')
  })

  it('a pending request fails after the grace period when the server is gone', async () => {
    await setup(60000)

    const pending = client.request({ to: server.getId(), event: 'slow', timeout: 10000 }).then(() => null, (e) => e)
    await wait(100)
    const lostAt = Date.now()
    await proxy.close()   // server unreachable for good

    const err = await pending
    expect(err?.code).to.equal(ProtocolErrorCode.PEER_UNREACHABLE)
    expect(Date.now() - lostAt).to.be.below(Globals.RECONNECT_GRACE_MS + 1000)
  })

  it('close() during the grace period rejects at once and leaves no timer behind', async () => {
    await setup(60000)

    const pending = client.request({ to: server.getId(), event: 'slow', timeout: 10000 }).then(() => null, (e) => e)
    await wait(100)
    await proxy.close()
    await wait(200)   // grace period running

    const closedAt = Date.now()
    await client.close()
    const err = await pending
    expect(err, 'rejected').to.be.an('error')
    expect(Date.now() - closedAt).to.be.below(500)

    // The grace timer must not fire into a closed client
    await wait(Globals.RECONNECT_GRACE_MS)
    client = null
  })

  it('a reconnect that reaches a different server rejects what the old one owed', async () => {
    await setup(60000)
    const other = new Node({ id: `bug7-other-${uid()}` })
    await other.bind('tcp://127.0.0.1:0')

    try {
      const pending = client.request({ to: server.getId(), event: 'slow', timeout: 10000 }).then(() => null, (e) => e)
      await wait(100)
      proxy.retarget(other.getAddress())
      const switchedAt = Date.now()
      proxy.drop()   // the dealer reconnects and handshakes with `other`

      const err = await pending
      expect(err?.code).to.equal(ProtocolErrorCode.PEER_LEFT)
      expect(Date.now() - switchedAt).to.be.below(Globals.RECONNECT_GRACE_MS)
    } finally {
      await other.close().catch(() => {})
    }
  })

  it('a pending request fails at once when the server stops (SERVER_LEFT)', async () => {
    await setup(60000)

    const pending = client.request({ to: server.getId(), event: 'slow', timeout: 10000 }).then(() => null, (e) => e)
    await wait(100)
    const stoppedAt = Date.now()
    await server.close()
    server = null

    const err = await pending
    expect(err?.code).to.equal(ProtocolErrorCode.PEER_LEFT)
    expect(Date.now() - stoppedAt).to.be.below(1000)
  })
})

describe('Regression bug 7: a request already delivered is never retried elsewhere', function () {
  this.timeout(15000)

  const children = []
  let client

  afterEach(async () => {
    await client?.close().catch(() => {})
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  })

  const spawnServer = async (id, executions) => {
    const child = fork(SERVER_CHILD, [id, 'svc'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    children.push(child)
    child.on('message', (msg) => { if (msg.exec) executions.push(msg.exec) })
    const { address } = await new Promise((resolve) => {
      const onMessage = (msg) => { if (msg.address) { child.off('message', onMessage); resolve(msg) } }
      child.on('message', onMessage)
    })
    return { id, child, address }
  }

  it('the provider crashes mid-handler: one execution, PEER_UNREACHABLE, no retry', async () => {
    const executions = []
    const s1 = await spawnServer(`bug7-s1-${uid()}`, executions)
    const s2 = await spawnServer(`bug7-s2-${uid()}`, executions)

    client = new Node({ id: `bug7-dup-${uid()}`, config: { reconnect: 'disabled' } })
    await client.connect({ address: s1.address })
    await client.connect({ address: s2.address })

    const pending = client.requestAny({ event: 'charge', filter: { service: 'svc' }, timeout: 8000 }).then(() => null, (e) => e)

    // Kill whichever provider started the handler
    while (executions.length === 0) await wait(10)
    const victim = [s1, s2].find(s => s.id === executions[0])
    victim.child.kill('SIGKILL')

    const err = await pending
    await wait(300)

    expect(err?.code).to.equal(ProtocolErrorCode.PEER_UNREACHABLE)
    expect(executions, 'handler ran exactly once').to.deep.equal([victim.id])
  })
})

