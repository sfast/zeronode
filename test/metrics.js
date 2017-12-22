import { assert } from 'chai'
import _ from 'underscore'

import { Node, NodeEvents, ErrorCodes } from '../src'

describe('oneToOne, failures', () => {
  let clientNode, serverNode

  beforeEach(async() => {
    clientNode = new Node({})
    serverNode = new Node({bind: 'tcp://127.0.0.1:4000'})
    await serverNode.bind()
    await clientNode.connect({ address: serverNode.getAddress() })
  })

  afterEach(async() => {
    await serverNode.stop()
    await clientNode.stop()
    clientNode = null
    serverNode = null
  })

  it('enable/disable metrics', (done) => {
    clientNode.on(NodeEvents.METRICS, () => {
      clientNode.disableMetrics()
      done()
    })
    clientNode.enableMetrics(100)
  })

  it('tick metrics', (done) => {
    clientNode.on(NodeEvents.METRICS, (data) => {
      if (!data.ticks.size) return
      done()
    })
    clientNode.enableMetrics(100)
    clientNode.tickAny({ event: 'foo', data: 'bar' })
  })

  it('request metrics', (done) => {
    clientNode.on(NodeEvents.METRICS, (data) => {
      if (!data.requests.size) return
      done()
    })
    clientNode.enableMetrics(100)
    clientNode.requestAny({ event: 'foo', data: 'bar', timeout: 100 })
      .catch((err) => {
        //
      })
  })

  it('request-timeout metrics', (done) => {
    clientNode.on(NodeEvents.METRICS, (data) => {
      if (!data.requests.size || !data.requests.get(serverNode.getId()).timeouted) return

      done()
    })
    clientNode.enableMetrics(100)
    clientNode.requestAny({ event: 'foo', data: 'bar', timeout: 100 })
      .catch((err) => {
        //
      })
  })

  it('request-reply metrics', (done) => {
    clientNode.on(NodeEvents.METRICS, (data) => {
      if (!data.requests.size || !data.requests.get(serverNode.getId()).delay.send) return
      done()
    })
    clientNode.enableMetrics(100)
    serverNode.onRequest('foo', ({ reply }) => {
      reply('bar')
    })
    clientNode.requestAny({ event: 'foo', data: 'bar' })
      .catch((err) => {
        //
      })
  })
})