/**
 * Created by root on 12/13/17.
 */
import { assert } from 'chai'
import _ from 'underscore'

import { Node } from '../src'
import { TEST_PORTS, getPortRange, getAddress, waitForPortRelease } from './helpers/test-ports'

describe('manyToMany', () => {
  let clients, servers, centreNode
  const CLIENTS_COUNT = 10

  beforeEach(async () => {
    clients = _.map(_.range(CLIENTS_COUNT), (i) => new Node({ options: {clientName: `client${i}`} }))
    // Use port range 4300-4309 for the servers
    const serverPorts = getPortRange(TEST_PORTS.MANY_TO_MANY_BASE, CLIENTS_COUNT)
    servers = _.map(_.range(CLIENTS_COUNT), (i) => new Node({ bind: serverPorts[i], options: {serverName: `server${i}`} }))
    centreNode = new Node({ bind: getAddress(TEST_PORTS.MANY_TO_MANY_CENTER) })

    await centreNode.bind()
    await Promise.all(_.map(servers, async (server) => {
      await server.bind()
      await centreNode.connect({ address: server.getAddress() })
    }))
    await Promise.all(_.map(clients, (client) => client.connect({ address: centreNode.getAddress() })))
  })

  afterEach(async () => {
    await Promise.all(_.map(clients, (client) => client.stop()))
    await centreNode.stop()
    await Promise.all(_.map(servers, (server) => server.stop()))
    clients = null
    centreNode = null
    servers = null
    await waitForPortRelease(100) // Longer delay for multiple servers
  })

  it('tickAnyUp', (done) => {
    let expectedMessage = 'bar'

    _.each(servers, (server) => {
      server.onTick('foo', (message) => {
        assert.equal(message, expectedMessage)
        done()
      })
    })

    centreNode.tickUpAny({ event: 'foo', data: expectedMessage })
  })

  it('tickAnyUp', (done) => {
    let expectedMessage = 'bar'

    _.each(servers, (server) => {
      server.onTick('foo', (message) => {
        assert.equal(message, expectedMessage)
        done()
      })
    })

    centreNode.tickUpAny({ event: 'foo', data: expectedMessage })
  })

  it('tickAnyDown', (done) => {
    let expectedMessage = 'bar'

    _.each(clients, (client) => {
      client.onTick('foo', (message) => {
        assert.equal(message, expectedMessage)
        done()
      })
    })

    centreNode.tickDownAny({ event: 'foo', data: expectedMessage })
  })

  it('tickAllUp', (done) => {
    let expectedMessage = 'bar'
    let count = 0

    _.each(servers, (server) => {
      server.onTick('foo', (message) => {
        assert.equal(message, expectedMessage)
        count++
        count === CLIENTS_COUNT && done()
      })
    })

    centreNode.tickUpAll({ event: 'foo', data: expectedMessage })
  })

  it('tickAllDown', (done) => {
    let expectedMessage = 'bar'
    let count = 0

    _.each(clients, (client) => {
      client.onTick('foo', (message) => {
        assert.equal(message, expectedMessage)
        count++
        count === CLIENTS_COUNT && done()
      })
    })

    centreNode.tickDownAll({ event: 'foo', data: expectedMessage })
  })

  it('requestAnyDown', async () => {
    let expectedMessage = 'bar'
    let expectedMessage2 = 'baz'

    _.each(clients, (client) => {
      client.onRequest('foo', ({ body, reply }) => {
        assert.equal(body, expectedMessage)
        reply(expectedMessage2)
      })
    })

    let response = await centreNode.requestDownAny({ event: 'foo', data: expectedMessage })

    assert.equal(expectedMessage2, response)
  })

  it('requestAnyUp', async () => {
    let expectedMessage = 'bar'
    let expectedMessage2 = 'baz'

    _.each(servers, (server) => {
      server.onRequest('foo', ({ body, reply }) => {
        assert.equal(body, expectedMessage)
        reply(expectedMessage2)
      })
    })

    let response = await centreNode.requestUpAny({ event: 'foo', data: expectedMessage })

    assert.equal(expectedMessage2, response)
  })
})
