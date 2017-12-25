/**
 * Created by root on 12/13/17.
 */
import { assert } from 'chai'
import _ from 'underscore'

import { Node } from '../src'

describe('manyToOne', () => {
  let clients, serverNode
  const CLIENTS_COUNT = 10

  beforeEach(async () => {
    clients = _.map(_.range(CLIENTS_COUNT), (i) => new Node({ options: {clientName: `client${i}`} }))
    serverNode = new Node({ bind: 'tcp://127.0.0.1:3000' })
    await serverNode.bind()
  })

  afterEach(async () => {
    await Promise.all(_.map(clients, (client) => client.stop()))
    await serverNode.stop()
    clients = null
    serverNode = null
  })

  it('tickFromClients', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        let count = 0

        serverNode.onTick('foo', (message) => {
          assert.equal(message, expectedMessage)
          count++
          if (count === CLIENTS_COUNT) done()
        })

        _.each(clients, (client) => client.tick({to: serverNode.getId(), event: 'foo', data: expectedMessage}))
      })
  })

  it('tickAnyFromServer-string', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: 'client2'}})
      })
  })

  it('tickAnyFromServer-regexp', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        _.find(clients, (client, i) => {
          client.onTick('foo', (data) => {
            assert.equal(data, expectedMessage)
            done()
          })
          return i === 5
        })

        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: /client[0-5]/}})
      })
  })

  it('tickAnyFromServer-function', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        _.each(clients, (client, i) => {
          if (i % 2) {
            client.onTick('foo', (data) => {
              assert.equal(data, expectedMessage)
              done()
            })
          }
        })

        serverNode.tickAny({ event: 'foo', data: expectedMessage, filter: _predicate })
      })
  })

  it('tickAllFromServer-string', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAll({event: 'foo', data: expectedMessage, filter: {clientName: 'client2'}})
      })
  })

  it('tickAllFromServer-regexp', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        let count = 0

        _.find(clients, (client, i) => {
          client.onTick('foo', (data) => {
            assert.equal(data, expectedMessage)
            count++
            count === 6 && done()
          })
          return i === 5
        })

        serverNode.tickAll({event: 'foo', data: expectedMessage, filter: {clientName: /client[0-5]/}})
      })
  })

  it('tickAllFromServer-function', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        let count = 0

        _.each(clients, (client, i) => {
          if (i % 2) {
            client.onTick('foo', (data) => {
              assert.equal(data, expectedMessage)
              count++
              count === 5 && done()
            })
          }
        })

        serverNode.tickAll({ event: 'foo', data: expectedMessage, filter: _predicate })
      })
  })

  it('requestAnyFromServer', async () => {
    await Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))

    let expectedMessage = 'bar'
    let expectedMessage2 = 'baz'
    _.each(clients, (client) => {
      client.onRequest('foo', ({ body, reply }) => {
        assert.equal(body, expectedMessage)
        reply(expectedMessage2)
      })
    })

    let response = await serverNode.requestAny({ event: 'foo', data: expectedMessage })

    assert.equal(response, expectedMessage2)
  })
})

function _predicate (options) {
  let clientNumber = parseInt(options.clientName[options.clientName.length - 1])

  return clientNumber % 2
}
