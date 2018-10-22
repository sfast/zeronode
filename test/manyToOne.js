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
    clients = _.map(_.range(CLIENTS_COUNT), (i) => new Node({ options: {clientName: `client${i}`, idx: [i]} }))
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

  it('tickAnyFromServer-object-eq', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $eq: 'client2' }}})
      })
  })

  it('tickAnyFromServer-object-aeq', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $aeq: 'client2' }}})
      })
  })

  it('tickAnyFromServer-object-gt', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[9].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $gt: 'client8' }}})
      })
  })

  it('tickAnyFromServer-object-gte', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[9].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $gte: 'client9' }}})
      })
  })

  it('tickAnyFromServer-object-lt', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[0].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $lt: 'client1' }}})
      })
  })

  it('tickAnyFromServer-object-lte', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[0].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $lte: 'client0' }}})
      })
  })

  it('tickAnyFromServer-object-between', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $between: ['client1', 'client3'] }}})
      })
  })

  it('tickAnyFromServer-object-in', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $in: ['client2'] }}})
      })
  })

  it('tickAnyFromServer-object-nin', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $nin: ['client0', 'client1', 'client3', 'client4', 'client5', 'client6', 'client7', 'client8', 'client9'] }}})
      })
  })

  it('tickAnyFromServer-number-error', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: 1}})
      })
      .catch((err) => {
        assert.equal(err.code, 14)
        done()
      })
  })

  it('tickAnyFromServer-error', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {name: 1}})
      })
      .catch((err) => {
        assert.equal(err.code, 14)
        done()
      })
  })

  it('tickAnyFromServer-object-contains', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {idx: { $contains: 2 }}})
      })
  })

  it('tickAnyFromServer-object-containsAny', (done) => {
    Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'
        clients[2].onTick('foo', (data) => {
          assert.equal(data, expectedMessage)
          done()
        })
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {idx: { $containsAny: [2, 100] }}})
      })
  })

  it('tickAnyFromServer-object-containsNone', (done) => {
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
        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {idx: { $containsNone: [ 6, 7, 8, 9] }}})
      })
  })

  it('tickAnyFromServer-object-regexp', (done) => {
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

        serverNode.tickAny({event: 'foo', data: expectedMessage, filter: {clientName: { $regex: /client[0-5]/ }}})
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

  it('tickAllFromServer-object-ne', () => {
    return Promise.all(_.map(clients, (client) => client.connect({ address: serverNode.getAddress() })))
      .then(() => {
        let expectedMessage = 'bar'

        let p = Promise.all(_.map(clients, (client) => {
          if (client.getOptions().clientName === 'client1') return Promise.resolve()
          return new Promise((resolve, reject) => {
            client.onTick('foo', (data) => {
              assert.equal(data, expectedMessage)
              resolve()
            })
          })
        }))
        serverNode.tickAll({event: 'foo', data: expectedMessage, filter: {clientName: { $ne: 'client1' }}})
        return p
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
