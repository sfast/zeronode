/**
 * Created by artak on 3/2/17.
 */

import Promise from 'bluebird'
import zmq from 'zeromq'

import { ZeronodeError, ErrorCodes } from '../errors'
import { Socket, SocketEvent } from './socket'
import Envelop from './envelope'
import { EnvelopType, DealerStateType, Timeouts } from './enum'

// ** enable cancellation , by default it's turned off
Promise.config({ cancellation: true })

let _private = new WeakMap()

export default class DealerSocket extends Socket {
  constructor ({ id, options, config } = {}) {
    options = options || {}
    config = config || {}

    let socket = zmq.socket('dealer')

    super({id, socket, options, config})

    let _scope = {
      socket,
      state: DealerStateType.DISCONNECTED,
      connectionPromise: null,
      routerAddress: null
    }

    _private.set(this, _scope)
  }

  getAddress () {
    let {routerAddress} = _private.get(this)
    return routerAddress
  }

  setAddress (routerAddress) {
    let _scope = _private.get(this)
    if (typeof routerAddress === 'string' && routerAddress.length) {
      _scope.routerAddress = routerAddress
    }
  }

  setOnline () {
    let _scope = _private.get(this)
    super.setOnline()
    _scope.state = DealerStateType.CONNECTED
  }

  getState () {
    let { state } = _private.get(this)
    return state
  }

  connect (routerAddress, timeout = -1) {
    if (this.isOnline() && routerAddress === this.getAddress()) {
      return Promise.resolve(true)
    }

    let _scope = _private.get(this)
    let connectionPromise = _scope.connectionPromise

    if (connectionPromise && routerAddress !== this.getAddress()) {
      // ** if trying to connect to other address you need to disconnect first
      let alreadyConnectedError = new Error(`Already connected to '${this.getAddress()}', disconnect before changing connection address to '${routerAddress}'`)
      return Promise.reject(new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.ALREADY_CONNECTED, error: alreadyConnectedError }))
    }

    // ** if connection is still pending then returning it
    if (connectionPromise && connectionPromise.isPending() && routerAddress === this.getAddress()) return connectionPromise

    // ** if connect is called for the first time then creating the connection promise
    _scope.connectionPromise = new Promise((resolve, reject) => {
      let {socket} = _scope
      let { RECONNECTION_TIMEOUT } = this.getConfig()
      RECONNECTION_TIMEOUT = RECONNECTION_TIMEOUT || Timeouts.RECONNECTION_TIMEOUT

      let rejectionTimeout = null

      if (routerAddress) {
        this.setAddress(routerAddress)
      }

      const onConnectionHandler = () => {
        if (rejectionTimeout) {
          clearTimeout(rejectionTimeout)
        }

        this.once(SocketEvent.DISCONNECT, onDisconnectionHandler)

        this.setOnline()
        resolve()
      }

      const onReConnectionHandler = (fd, endpoint) => {
        if (_scope.reconnectionTimeoutInstance) {
          clearTimeout(_scope.reconnectionTimeoutInstance)
          _scope.reconnectionTimeoutInstance = null
        }

        this.once(SocketEvent.DISCONNECT, onDisconnectionHandler)
        this.setOnline()
        this.emit(SocketEvent.RECONNECT, {fd, endpoint})
      }

      const onDisconnectionHandler = () => {
        this.setOffline()
        _scope.state = DealerStateType.RECONNECTING
        this.once(SocketEvent.CONNECT, onReConnectionHandler)
        if (RECONNECTION_TIMEOUT !== Timeouts.INFINITY) {
          _scope.reconnectionTimeoutInstance = setTimeout(() => {
            // ** removing reconnection listener
            this.removeListener(SocketEvent.CONNECT, onReConnectionHandler)
            // ** disconnecting socket
            this.emit(SocketEvent.RECONNECT_FAILURE)
            this.disconnect()
          }, RECONNECTION_TIMEOUT)
        }
      }

      if (timeout !== -1) {
        rejectionTimeout = setTimeout(() => {
          this.removeListener(SocketEvent.CONNECT, onConnectionHandler)
          // ** reject the connection promise and then disconnect
          let connectionTimeoutError = new Error(`Timeout to connect to ${this.getAddress()} `)
          reject(new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.CONNECTION_TIMEOUT, error: connectionTimeoutError }))
          this.disconnect()
        }, timeout)
      }

      this.once(SocketEvent.CONNECT, onConnectionHandler)

      this.attachSocketMonitor()

      socket.connect(this.getAddress())
    })

    return _scope.connectionPromise
  }

  // ** not actually disconnected
  disconnect () {
    //* closing and removing all listeners on socket
    super.close()

    let _scope = _private.get(this)
    let { socket, routerAddress, connectionPromise, reconnectionTimeoutInstance } = _scope

    //* if connection promise is pending then cancel it
    if (connectionPromise && connectionPromise.isPending()) connectionPromise.cancel()

    if (reconnectionTimeoutInstance) {
      clearTimeout(reconnectionTimeoutInstance)
      _scope.reconnectionTimeoutInstance = null
    }

    _scope.connectionPromise = null

    if (this.getState() !== DealerStateType.DISCONNECTED) {
      socket.disconnect(routerAddress)
      _scope.state = DealerStateType.DISCONNECTED
    }

    this.setOffline()
  }

  // ** Polymorphic functions
  request ({to, event, data, timeout, mainEvent = false} = {}) {
    let envelop = new Envelop({type: EnvelopType.SYNC, tag: event, data, owner: this.getId(), recipient: to, mainEvent})
    return super.request(envelop, timeout)
  }

  tick ({to, event, data, mainEvent = false} = {}) {
    let envelop = new Envelop({type: EnvelopType.ASYNC, tag: event, data, owner: this.getId(), recipient: to, mainEvent})
    return super.tick(envelop)
  }

  async close () {
    await this.disconnect()
    let { socket } = _private.get(this)

    socket.close()
  }

  getSocketMsg (envelop) {
    return envelop.getBuffer()
  }
}
