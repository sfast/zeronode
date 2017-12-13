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
    serverNode = new Node({ bind: 'tcp://127.0.0.1:3000' })
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
})

describe('reconnect', () => {
  let clientNode, serverNode

  beforeEach(async () => {
    clientNode = new Node({})
    serverNode = new Node({ bind: 'tcp://127.0.0.1:3000' })
    await serverNode.bind()
    await clientNode.connect({ address: serverNode.getAddress() })
  })

  afterEach(async () => {
    await serverNode.stop()
    await clientNode.stop()
    clientNode = null
    serverNode = null
  })

  it('successfully reconnect', () => {
    clientNode.on(NodeEvents.SERVER_RECONNECT, () => {
      done()
    })
    serverNode.unbind()
      .then(() => {
        serverNode.bind()
      })
  })
})
