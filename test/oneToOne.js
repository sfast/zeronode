/**
 * Created by root on 12/13/17.
 */
import { assert } from 'chai'
import { Node, NodeEvents, ErrorCodes } from '../src'

describe('oneToOne, failures', () => {
  let clientNode, serverNode

  beforeEach(async () => {
    clientNode = new Node({})
    serverNode = new Node({ bind: 'tcp://127.0.0.1:3000' })
  })

  afterEach(async () => {
    await serverNode.stop()
    await clientNode.stop()
    clientNode = null
    serverNode = null
  })

  it('connect wrong argument', async () => {
    try {
      await clientNode.connect({ address: null })
    } catch (err) {
      assert.equal(err.message, `Wrong type for argument address null`)
    }
  })

  it('second connect attempt', async () => {
    await serverNode.bind()
    await clientNode.connect({ address: serverNode.getAddress() })
    await clientNode.connect({ address: serverNode.getAddress() })
  })

  it('disconnect wrong argument', async () => {
    try {
      await clientNode.disconnect(null)
    } catch (err) {
      assert.equal(err.message, `Wrong type for argument address null`)
    }
  })

  it('disconnect from not connected address', async () => {
    await clientNode.disconnect(serverNode.getAddress())
  })

  it('connect timeout', async () => {
    try {
      await clientNode.connect({ address: serverNode.getAddress(), timeout: 1000 })
    } catch (err) {
      assert.equal(err.description, `Error while disconnecting client '${clientNode.getId()}'`)
    }
  })

  it('request timeout', async () => {
    try {
      await serverNode.bind()
      await clientNode.connect({ address: serverNode.getAddress() })
      await clientNode.request({ to: serverNode.getId(), event: 'foo', data: 'bar', timeout: 200 })
    } catch (err) {
      assert.include(err.message, 'timeouted')
    }
  })

  it('request after offRequest', async () => {
    try {
      await serverNode.bind()
      await clientNode.connect({ address: serverNode.getAddress() })
      serverNode.onRequest('foo', ({ body, reply }) => {
        reply(body)
      })
      serverNode.offRequest('foo')
      await clientNode.request({ to: serverNode.getId(), event: 'foo', data: 'bar', timeout: 200 })
      return Promise.reject('fail')
    } catch (err) {
      assert.include(err.message, 'timeouted')
    }
  })

  it('request after disconnect', async () => {
    try {
      await serverNode.bind()
      await clientNode.connect({ address: serverNode.getAddress() })
      await clientNode.disconnect(serverNode.getAddress())
      await clientNode.request({ to: serverNode.getId(), event: 'foo', data: 'bar' })
    } catch (err) {
      assert.equal(err.code, ErrorCodes.NODE_NOT_FOUND)
    }
  })

  it('request-next-error', async () => {
    let expectedError = 'some error message'

    try {
      let expectedMessage = 'bar'

      await serverNode.bind()
      await clientNode.connect({ address: serverNode.getAddress() })
      serverNode.onRequest('foo', ({ body, reply, next }) => {
        assert.equal(body, expectedMessage)
        next(expectedError)
      })
      serverNode.onRequest('foo', ({ body, reply, next }) => {
        reply()
      })

      console.log(await clientNode.request({ to: serverNode.getId(), event: 'foo', data: expectedMessage }))
    } catch (err) {
      assert.equal(err, expectedError)
    }
  })

  it('tick after disconnect', async () => {
    try {
      await serverNode.bind()
      await clientNode.connect({ address: serverNode.getAddress() })
      await clientNode.disconnect(serverNode.getAddress())
      clientNode.tick({ to: serverNode.getId(), event: 'foo', data: 'bar' })
    } catch (err) {
      assert.equal(err.code, ErrorCodes.NODE_NOT_FOUND)
    }
  })

  it('request after unbind', async () => {
    try {
      await serverNode.bind()
      await clientNode.connect({ address: serverNode.getAddress() })
      await serverNode.unbind()
      await serverNode.request({ to: clientNode.getId(), event: 'foo', data: 'bar' })
    } catch (err) {
      assert.equal(err.message, `Sending failed as socket '${serverNode.getId()}' is not online`)
    }
  })
})

describe('oneToOne successfully connected', () => {
  let clientNode, serverNode

  beforeEach(async () => {
    clientNode = new Node({})
    serverNode = new Node({ bind: 'tcp://127.0.0.1:3020' })
    await serverNode.bind()
    await clientNode.connect({ address: serverNode.getAddress() })
  })

  afterEach(async () => {
    await serverNode.stop()
    await clientNode.stop()
    clientNode = null
    serverNode = null
  })

  it('tickFromClient', (done) => {
    let expectedMessage = 'bar'

    serverNode.onTick('foo', (message) => {
      assert.equal(message, expectedMessage)
      serverNode.offTick('foo')
      done()
    })

    clientNode.tick({ to: serverNode.getId(), event: 'foo', data: expectedMessage })
  })

  it('tickFromServer', (done) => {
    let expectedMessage = 'bar'

    clientNode.onTick('foo', (message) => {
      assert.equal(message, expectedMessage)
      done()
    })

    serverNode.tick({ to: clientNode.getId(), event: 'foo', data: expectedMessage })
  })

  it('requestFromClient', async () => {
    let expectedMessage = 'bar'
    let expectedMessage2 = 'baz'

    serverNode.onRequest('foo', ({ body, reply }) => {
      assert.equal(body, expectedMessage)
      reply(expectedMessage2)
    })

    let response = await clientNode.request({ to: serverNode.getId(), event: 'foo', data: expectedMessage })

    assert.equal(expectedMessage2, response)
  })

  it('request-next', async () => {
    let expectedMessage = 'bar'
    let expectedMessage2 = 'baz'

    serverNode.onRequest('foo', ({ body, reply, next }) => {
      assert.equal(body, expectedMessage)
      next()
    })
    serverNode.onRequest(/fo+/, ({ body, reply }) => {
      assert.equal(body, expectedMessage)
      reply(expectedMessage2)
    })

    let response = await clientNode.request({ to: serverNode.getId(), event: 'foo', data: expectedMessage })

    assert.equal(expectedMessage2, response)
  })

  it('requestFromServer', async () => {
    let expectedMessage = 'bar'
    let expectedMessage2 = 'baz'

    clientNode.onRequest('foo', ({ body, reply }) => {
      assert.equal(body, expectedMessage)
      reply(expectedMessage2)
    })

    let response = await serverNode.request({ to: clientNode.getId(), event: 'foo', data: expectedMessage })

    assert.equal(expectedMessage2, response)
  })

  it('set new options', async () => {
    await clientNode.setOptions(Object.assign({}, clientNode.getOptions(), { foo: 'bar' }))
    await serverNode.setOptions(Object.assign({}, serverNode.getOptions(), { foo: 'bar' }))
    assert.equal(serverNode.getOptions().foo, 'bar')
    assert.equal(clientNode.getOptions().foo, 'bar')
  })
})

describe('reconnect', () => {
  let clientNode, serverNode

  beforeEach(async () => {
    clientNode = new Node({})
    serverNode = new Node({ bind: 'tcp://127.0.0.1:3021' })
    await serverNode.bind()
    await clientNode.connect({ address: serverNode.getAddress(), reconnectionTimeout: 500 })
  })

  afterEach(async () => {
    await serverNode.stop()
    await clientNode.stop()
    clientNode = null
    serverNode = null
  })

  it('successfully reconnect', (done) => {
    clientNode.on(NodeEvents.SERVER_RECONNECT, () => {
      done()
    })
    serverNode.unbind()
      .then(() => {
        serverNode.bind()
      })
  })

  it('reconnect failure', (done) => {
    clientNode.on(NodeEvents.SERVER_RECONNECT_FAILURE, () => {
      done()
    })

    serverNode.unbind()
  })
})

describe('information', () => {
  let clientNode, serverNode

  beforeEach(async () => {
    clientNode = new Node({})
    serverNode = new Node({ bind: 'tcp://127.0.0.1:4001' })
    await serverNode.bind()
    await clientNode.connect({ address: serverNode.getAddress() })
  })

  afterEach(async () => {
    await serverNode.stop()
    await clientNode.stop()
    clientNode = null
    serverNode = null
  })

  it('get server information with address', (done) => {
    let serverInfo = clientNode.getServerInfo({ address: serverNode.getAddress() })
    assert.equal(serverInfo.id, serverNode.getId())
    assert.equal(serverInfo.address, serverNode.getAddress())
    assert.notEqual(serverInfo.online, false)
    done()
  })

  it('get server information with id', (done) => {
    let serverInfo = clientNode.getServerInfo({ id: serverNode.getId() })
    assert.equal(serverInfo.id, serverNode.getId())
    assert.equal(serverInfo.address, serverNode.getAddress())
    assert.notEqual(serverInfo.online, false)
    done()
  })

  it('get server information, wrong id/address', (done) => {
    let serverInfo = clientNode.getServerInfo({ id: 'foo' })
    assert.equal(serverInfo, null)
    done()
  })

  it('get client information with id', (done) => {
    let clientInfo = serverNode.getClientInfo({ id: clientNode.getId() })
    assert.equal(clientInfo.id, clientNode.getId())
    assert.notEqual(clientInfo.online, false)
    done()
  })

  it('get client information, wrong id', (done) => {
    let clientInfo = serverNode.getClientInfo({ id: 'foo' })
    assert.equal(clientInfo, null)
    done()
  })
})
