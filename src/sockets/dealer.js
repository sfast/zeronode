/**
 * Created by artak on 3/2/17.
 */

import zmq from 'zmq'

import Socket from './socket'
import Envelop from './envelope'
import { Timeouts, EnvelopType, DealerEvent } from './enum'

let _private = new WeakMap()

// ** if there is no logger the default console will be used
export default class DealerSocket extends Socket {
  constructor (data = {}) {
    let {id, options} = data
    options = options || {}

    let logger = options.logger
    let monitorTimeout = options.MONITOR_TIMEOUT || Timeouts.MONITOR_TIMEOUT

    let socket = zmq.socket('dealer')
    super({id, socket, logger})

    // ** emitting disconnect (this emits only when server disconnects)
    socket.on('disconnect', () => {
      this.emit(DealerEvent.DISCONNECT)
    })

    // ** monitoring connect / disconnect
    socket.monitor(monitorTimeout, 0)

    let _scope = {
      socket,
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

  connect (routerAddress, timeout = -1) {
    if (this.isOnline()) {
      this.logger.info(`Dealer already connected`)
      return Promise.resolve(true)
    }

    return new Promise((resolve, reject) => {
      let {socket} = _private.get(this)
      let rejectionTimeout

      if (routerAddress) {
        this.setAddress(routerAddress)
      }

      socket.removeAllListeners('connect')

      if (timeout !== -1) {
        rejectionTimeout = setTimeout(() => {
          socket.removeAllListeners('connect')
          reject(new Error('Dealer connection timeouted'))
          this.disconnect()
        }, timeout)
      }

      socket.on('connect', () => {
        if (rejectionTimeout) {
          clearTimeout(rejectionTimeout)
        }

        this.setOnline()

        socket.removeAllListeners('connect')
        socket.on('connect', (fd, serverAddress) => {
          this.emit(DealerEvent.RECONNECT, {fd, serverAddress})
        })

        resolve()
      })

      socket.connect(this.getAddress())
    })
  }

    // ** not actually disconnected
  disconnect () {
    this.close()
  }

    //* * Polymorphic functions
  request (event, data, timeout = 5000, to, mainEvent = false) {
    let envelop = new Envelop({type: EnvelopType.SYNC, tag: event, data, owner: this.getId(), recipient: to, mainEvent})
    return super.request(envelop, timeout)
  }

  tick (event, data, to, mainEvent = false) {
    let envelop = new Envelop({type: EnvelopType.ASYNC, tag: event, data, owner: this.getId(), recipient: to, mainEvent})
    return super.tick(envelop)
  }

  close () {
    super.close()

    let {socket, routerAddress} = _private.get(this)

    socket.disconnect(routerAddress)
    socket.removeAllListeners('connect')

    this.setOffline()
  }

  getSocketMsg (envelop) {
    return envelop.getBuffer()
  }
}
