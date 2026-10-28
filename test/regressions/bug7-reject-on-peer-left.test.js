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
import Node, { ProtocolErrorCode, Transport } from '../../src/index.js'
import { LocalTransport } from '../../src/transport/local/index.js'
import Globals from '../../src/globals.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** TCP proxy on port 0; drop() simulates a blip, close() a lost server */
async function startProxy (target) {
  const [host, port] = target.replace('tcp://', '').split(':')
  const sockets = new Set()
  const server = net.createServer((inbound) => {
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
