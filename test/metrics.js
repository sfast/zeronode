import { assert } from 'chai'

import { Node, MetricEvents, ErrorCodes } from '../src'

describe('metrics', () => {
  let clientNode, serverNode

  beforeEach(async() => {
    clientNode = new Node({})
    serverNode = new Node({bind: 'tcp://127.0.0.1:3000'})
    await serverNode.bind()
    await clientNode.connect({ address: serverNode.getAddress() })
  })

  afterEach(async() => {
    await clientNode.stop()
    await serverNode.stop()
    clientNode = null
    serverNode = null
  })

  it('tick metrics', (done) => {
    clientNode.on(MetricEvents.SEND_TICK, (data) => {
      assert.equal(data.owner, clientNode.getId())
      assert.equal(data.recipient, serverNode.getId())
      done()
    })
    clientNode.enableMetrics(100)
    serverNode.enableMetrics()
    clientNode.tickAny({ event: 'foo', data: 'bar' })
  })

  it('request metrics', (done) => {
    clientNode.on(MetricEvents.SEND_REQUEST, (data) => {
      assert.equal(data.owner, clientNode.getId())
      assert.equal(data.recipient, serverNode.getId())
      done()
    })

    clientNode.enableMetrics(100)
    serverNode.enableMetrics()
    clientNode.requestAny({ event: 'foo', data: 'bar', timeout: 100 })
      .catch((err) => {
        //
      })
  })

  it('request-timeout metrics', (done) => {
    let id = ''
    clientNode.on(MetricEvents.SEND_REQUEST, (data) => {
      id = data.id
      assert.equal(data.owner, clientNode.getId())
      assert.equal(data.recipient, serverNode.getId())
    })

    clientNode.on(MetricEvents.REQUEST_TIMEOUT, (data) => {
      assert.equal(data.id, id)
      done()
    })
    clientNode.enableMetrics(100)
    serverNode.enableMetrics()
    clientNode.requestAny({ event: 'foo', data: 'bar', timeout: 100 })
      .catch((err) => {
        //
      })
  })

  it('request-reply metrics', (done) => {
    let id = ''
    clientNode.on(MetricEvents.SEND_REQUEST, (data) => {
      id = data.id
      assert.equal(data.owner, clientNode.getId())
      assert.equal(data.recipient, serverNode.getId())
    })
    clientNode.on(MetricEvents.GOT_REPLY_SUCCESS, (data) => {
      assert.equal(data.recipient, clientNode.getId())
      assert.equal(data.owner, serverNode.getId())
      assert.equal(data.id, id)
      done()
    })
    clientNode.enableMetrics(100)
    serverNode.enableMetrics()
    serverNode.onRequest('foo', ({ reply }) => {
      reply('bar')
    })
    clientNode.requestAny({ event: 'foo', data: 'bar' })
      .catch((err) => {
        //
      })
  })

  it('request-error metrics', (done) => {
    let id = ''
    clientNode.on(MetricEvents.SEND_REQUEST, (data) => {
      id = data.id
      assert.equal(data.owner, clientNode.getId())
      assert.equal(data.recipient, serverNode.getId())
    })
    clientNode.on(MetricEvents.GOT_REPLY_ERROR, (data) => {
      assert.equal(data.recipient, clientNode.getId())
      assert.equal(data.owner, serverNode.getId())
      assert.equal(id, data.id)
      done()
    })
    clientNode.enableMetrics(100)
    serverNode.enableMetrics()
    serverNode.onRequest('foo', ({ error }) => {
      error('bar')
    })
    clientNode.requestAny({ event: 'foo', data: 'bar' })
      .catch((err) => {
        //
      })
  })
})
