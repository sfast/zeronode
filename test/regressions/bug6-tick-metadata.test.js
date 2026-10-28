/**
 * Regression: bug 6 — Protocol.tick() dropped `metadata`, so tick handlers
 * always saw `envelope.metadata === null`.
 *
 * Fix plan: "Bug 6 — tick() drops metadata". Uses the in-process local transport.
 */

import { expect } from 'chai'
import Node, { Transport } from '../../src/index.js'
import { LocalTransport } from '../../src/transport/local/index.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

describe('Regression bug 6: tick() delivers metadata', () => {
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

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    server = new Node({ id: `bug6-srv-${suffix}` })
    await server.bind(`local://bug6-${suffix}`)
    client = new Node({ id: `bug6-cli-${suffix}` })
    await client.connect({ address: `local://bug6-${suffix}` })
  })

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
  })

  it('client → server tick carries metadata', async () => {
    let received
    server.onTick('t', (envelope) => { received = envelope.metadata })

    client.tick({ to: server.getId(), event: 't', data: 1, metadata: { trace: 'abc' } })
    await wait(50)

    expect(received).to.deep.equal({ trace: 'abc' })
  })

  it('server → client tick carries metadata', async () => {
    let received
    client.onTick('t', (envelope) => { received = envelope.metadata })

    server.tick({ to: client.getId(), event: 't', data: 1, metadata: { trace: 'xyz' } })
    await wait(50)

    expect(received).to.deep.equal({ trace: 'xyz' })
  })
})
