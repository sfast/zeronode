import { assert } from 'chai'
import Client from '../src/client'
import Server from '../src/server'

const address = 'tcp://127.0.0.1:3000'

describe('Client/Server', () => {
  let client, server

  beforeEach(() => {
    client = new Client({})
    server = new Server({})
  })

  afterEach(() => {
    server.unbind()
    client.disconnect()
    client = null
    server = null
  })

  it('tickToServer', done => {
    let expectedMessage = 'xndzor'
    server.bind(address)
            .then(() => {
              return client.connect(address)
            })
            .then(() => {
              server.onTick('tandz', (message) => {
                assert.equal(message, expectedMessage)
                done()
              })
              client.tick({ event: 'tandz', data: expectedMessage })
            })
  })

  it('requesttoServer-timeout', done => {
    let expectedMessage = 'xndzor'
    server.bind(address)
            .then(() => {
              return client.connect(address)
            })
            .then(() => {
              return client.request({ event: 'tandz', data: expectedMessage, timeout: 500 })
            })
            .catch(err => {
              assert.include(err.message, 'timeouted')
              done()
            })
  })

  it('requestToServer-response', done => {
    let expectedMessage = 'xndzor'
    server.bind(address)
            .then(() => {
              return client.connect(address)
            })
            .then(() => {
              server.onRequest('tandz', ({body, reply}) => {
                assert.equal(body, expectedMessage)
                reply(expectedMessage)
              })
              return client.request({ event: 'tandz', data: expectedMessage, timeout: 2000 })
            })
            .then((message) => {
              assert.equal(message, expectedMessage)
              done()
            })
  })

  it('tickToClient', done => {
    let expectedMessage = 'xndzor'
    server.bind(address)
            .then(() => {
              return client.connect(address)
            })
            .then(() => {
              client.onTick('tandz', message => {
                assert.equal(message, expectedMessage)
                done()
              })
              server.tick({ to: client.getId(), event: 'tandz', data: expectedMessage })
            })
  })

  it('requestToClient-timeout', done => {
    let expectedMessage = 'xndzor'
    server.bind(address)
            .then(() => {
              return client.connect(address)
            })
            .then(() => {
              return server.request({ to: client.getId(), event: 'tandz', data: expectedMessage, timeout: 500 })
            })
            .catch(err => {
              assert.include(err.message, 'timeouted')
              done()
            })
  })

  it('requestToClient-response', done => {
    let expectedMessage = 'xndzor'
    server.bind(address)
            .then(() => {
              return client.connect(address)
            })
            .then(() => {
              client.onRequest('tandz', ({body, reply}) => {
                assert.equal(body, expectedMessage)
                reply(body)
              })
              return server.request({ to: client.getId(), event: 'tandz', data: expectedMessage })
            })
            .then(message => {
              assert.equal(message, expectedMessage)
              done()
            })
  })
})
