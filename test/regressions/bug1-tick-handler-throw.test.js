/**
 * Regression: bug 1 — a throwing tick handler (or a malformed frame) killed the
 * receive loop. After one bad message the node never received anything again.
 *
 * Fix plan: "Bug 1 — a throwing tick handler kills the receive loop".
 * Uses the ZeroMQ transport: the local transport delivers via setImmediate, so
 * on the old code the throw became an uncaught exception instead of a timeout.
 */

import { expect } from 'chai'
import * as zmq from 'zeromq'
import Node, { NodeEvent, TransportEvent, TransportErrorCode } from '../../src/index.js'
import { ZeroMQTransport } from '../../src/transport/zeromq/zeromq-transport.js'
import LocalServerSocket from '../../src/transport/local/server.js'
import LocalClientSocket from '../../src/transport/local/client.js'
import { MessageDispatcher } from '../../src/protocol/message-dispatcher.js'
import { ProtocolContext } from '../../src/protocol/protocol-context.js'
import { ProtocolEvent } from '../../src/protocol/lifecycle.js'
import { Envelope, EnvelopType, EnvelopeIdGenerator } from '../../src/protocol/envelope.js'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

describe('Regression bug 1: tick handler errors must not kill the receive loop', () => {
  let server
  let client
  let serverErrors

  beforeEach(async () => {
    server = new Node({ id: `bug1-srv-${Date.now()}` })
    await server.bind('tcp://127.0.0.1:0')
    server.onRequest('ping', () => 'pong')

    serverErrors = []
    server.on(NodeEvent.ERROR, (payload) => serverErrors.push(payload))

    client = new Node({ id: `bug1-cli-${Date.now()}` })
    await client.connect({ address: server.getAddress() })
  })

  afterEach(async () => {
    await client?.close().catch(() => {})
    await server?.close().catch(() => {})
  })

  it('keeps answering requests after a tick handler throws synchronously', async () => {
    server.onTick('boom', () => { throw new Error('sync handler bug') })

    expect(await client.request({ to: server.getId(), event: 'ping', timeout: 500 })).to.equal('pong')

    client.tick({ to: server.getId(), event: 'boom' })
    await wait(100)

    expect(await client.request({ to: server.getId(), event: 'ping', timeout: 500 })).to.equal('pong')

    const handlerError = serverErrors.find(p => p.error?.message?.includes('sync handler bug'))
    expect(handlerError, 'NodeEvent.ERROR with the handler error').to.exist
    expect(handlerError.source).to.equal('server')
  })

  it('keeps answering requests after an async tick handler rejects', async () => {
    server.onTick('boom-async', async () => { throw new Error('async handler bug') })

    client.tick({ to: server.getId(), event: 'boom-async' })
    await wait(100)

    expect(await client.request({ to: server.getId(), event: 'ping', timeout: 500 })).to.equal('pong')

    const handlerError = serverErrors.find(p => p.error?.message?.includes('async handler bug'))
    expect(handlerError, 'NodeEvent.ERROR with the async handler error').to.exist
  })

  it('runs the remaining tick handlers when one of them throws', async () => {
    const calls = []
    server.onTick('multi', () => { calls.push('first'); throw new Error('first fails') })
    server.onTick('multi', () => { calls.push('second') })

    client.tick({ to: server.getId(), event: 'multi' })
    await wait(100)

    expect(calls).to.deep.equal(['first', 'second'])
  })

  it('reports a throwing client-side tick handler as NodeEvent.ERROR from the client', async () => {
    const clientErrors = []
    client.on(NodeEvent.ERROR, (payload) => clientErrors.push(payload))
    client.onTick('down-boom', () => { throw new Error('client handler bug') })
    client.onRequest('ping-client', () => 'pong-client')

    server.tick({ to: client.getId(), event: 'down-boom' })
    await wait(100)

    expect(await server.request({ to: client.getId(), event: 'ping-client', timeout: 500 })).to.equal('pong-client')
    const handlerError = clientErrors.find(p => p.error?.message?.includes('client handler bug'))
    expect(handlerError, 'NodeEvent.ERROR with source client').to.exist
    expect(handlerError.source).to.equal('client')
  })

  it('ignores a remote tick named "error" that has no handler', async () => {
    client.tick({ to: server.getId(), event: 'error' })
    await wait(100)

    expect(await client.request({ to: server.getId(), event: 'ping', timeout: 500 })).to.equal('pong')
  })

  it('keeps receiving when a NodeEvent.ERROR listener itself throws', async () => {
    server.on(NodeEvent.ERROR, () => { throw new Error('error listener bug') })
    server.onTick('boom', () => { throw new Error('handler bug') })

    client.tick({ to: server.getId(), event: 'boom' })
    await wait(100)

    expect(await client.request({ to: server.getId(), event: 'ping', timeout: 500 })).to.equal('pong')
  })

  it('survives a malformed frame and keeps answering requests', async () => {
    const raw = new zmq.Dealer({ routingId: `bug1-raw-${Date.now()}` })
    try {
      raw.connect(server.getAddress())
      await raw.send(Buffer.from([1, 2, 3, 4, 5]))
      await wait(100)

      expect(await client.request({ to: server.getId(), event: 'ping', timeout: 500 })).to.equal('pong')
      expect(serverErrors.length, 'malformed frame reported').to.be.greaterThan(0)
    } finally {
      raw.close()
    }
  })
})

describe('Regression bug 1: transports keep receiving when a MESSAGE listener throws', () => {
  it('ZeroMQ receive loop survives a throwing MESSAGE listener', async () => {
    const router = ZeroMQTransport.createServerSocket({ id: `bug1-zrouter-${Date.now()}` })
    const dealer = ZeroMQTransport.createClientSocket({ id: `bug1-zdealer-${Date.now()}` })
    const received = []
    const errors = []
    let first = true
    router.on(TransportEvent.MESSAGE, ({ buffer }) => {
      received.push(buffer.toString())
      if (first) { first = false; throw new Error('listener bug') }
    })
    router.on(TransportEvent.ERROR, (err) => errors.push(err))

    try {
      await router.bind('tcp://127.0.0.1:0')
      await dealer.connect(router.getAddress())
      await wait(100)

      dealer.sendBuffer(Buffer.from('one'))
      await wait(100)
      dealer.sendBuffer(Buffer.from('two'))
      await wait(100)

      expect(received).to.deep.equal(['one', 'two'])
      expect(errors.map(e => e.code)).to.deep.equal([TransportErrorCode.MESSAGE_HANDLER_FAILED])
    } finally {
      await dealer.close().catch(() => {})
      await router.close().catch(() => {})
    }
  })

  it('local transport reports a throwing MESSAGE listener instead of throwing', async () => {
    const address = `local://bug1-local-${Date.now()}`
    const server = new LocalServerSocket({ id: address })
    const client = new LocalClientSocket({ id: `local://bug1-local-cli-${Date.now()}` })
    const received = []
    const errors = []
    let first = true
    server.on(TransportEvent.MESSAGE, ({ buffer }) => {
      received.push(buffer.toString())
      if (first) { first = false; throw new Error('listener bug') }
    })
    server.on(TransportEvent.ERROR, (err) => errors.push(err))

    try {
      await server.bind(address)
      await client.connect(address)

      client.sendBuffer(Buffer.from('one'))
      client.sendBuffer(Buffer.from('two'))
      await wait(50)

      expect(received).to.deep.equal(['one', 'two'])
      expect(errors.map(e => e.code)).to.deep.equal([TransportErrorCode.MESSAGE_HANDLER_FAILED])
    } finally {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
    }
  })
})

describe('Regression bug 1: MessageDispatcher isolates failures', () => {
  let dispatcher
  let protocolErrors

  const makeTick = (event) => {
    const id = new EnvelopeIdGenerator('unit').next()
    return Envelope.createBuffer({ type: EnvelopType.TICK, id, owner: 'peer', recipient: 'me', event, data: null })
  }

  beforeEach(() => {
    protocolErrors = []
    const protocol = { emit: (event, err) => { if (event === ProtocolEvent.ERROR) protocolErrors.push(err) } }
    const socket = { getId: () => 'unit-socket', logger: null }
    const context = new ProtocolContext(protocol, socket, { DEBUG: false })
    dispatcher = new MessageDispatcher(context, { match: () => true }, { execute: () => {} })
  })

  it('does not throw when a tick listener throws, and reports it', () => {
    dispatcher.onTick('boom', () => { throw new Error('listener bug') })

    expect(() => dispatcher.dispatch(makeTick('boom'))).not.to.throw()
    expect(protocolErrors).to.have.length(1)
    expect(protocolErrors[0].message).to.include('listener bug')
  })

  it('ignores an unknown envelope type without throwing', () => {
    const buffer = makeTick('t')
    buffer[0] = 99

    expect(() => dispatcher.dispatch(buffer)).not.to.throw()
    expect(protocolErrors).to.have.length(0)
  })

  it('does not throw on a buffer shorter than an envelope header, and reports it', () => {
    expect(() => dispatcher.dispatch(Buffer.alloc(5))).not.to.throw()
    expect(protocolErrors).to.have.length(1)
  })
})
