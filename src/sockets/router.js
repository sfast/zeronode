/**
 * Created by artak on 3/2/17.
 */
import zmq from 'zmq'
import Promise from 'bluebird'

import { Socket } from './socket'
import Envelop from './envelope'
import {EnvelopType} from './enum'

Promise.config({ cancellation: true })

let _private = new WeakMap()

export default class RouterSocket extends Socket {
  constructor ({id, options, config} = {}) {
    options = options || {}
    config = config || {}

    let socket = zmq.socket('router')

    super({id, socket, options, config})

    let _scope = {
      socket,
      bindPromise: null,
      bindAddress: null
    }

    _private.set(this, _scope)
  }

  getAddress () {
    let {bindAddress} = _private.get(this)
    return bindAddress
  }

  setAddress (bindAddress) {
    let _scope = _private.get(this)

    if (typeof bindAddress === 'string' && bindAddress.length) {
      _scope.bindAddress = bindAddress
    }
  }

  // ** returns promise
  bind (bindAddress) {
    if (this.isOnline() && bindAddress === this.getAddress()) {
      return Promise.resolve(true)
    }

    let _scope = _private.get(this)
    let bindPromise = _scope.bindPromise

    if (bindPromise && bindAddress !== this.getAddress()) {
      // ** if trying to bind to other address you need to unbind first
      return Promise.reject(new Error(`Already binded to ${this.getAddress()}, unbind before changing bind address`))
    }

    // ** if bind is still pending then returning it
    if (bindPromise && bindPromise.isPending() && bindAddress === this.getAddress()) return bindPromise

    if (bindAddress) this.setAddress(bindAddress)

    _scope.bindPromise = new Promise((resolve, reject) => {
      let { socket } = _scope
      socket.bind(this.getAddress(), (err) => {
        if (err) return reject(err)
        this.setOnline()
        this.attachSocketMonitor()
        resolve(`Router (${this.getId()}) is binded at address ${this.getAddress()}`)
      })
    })

    return _scope.bindPromise
  }

  // ** returns promise
  unbind () {
    return this.close()
  }

  // ** returns promise
  close () {
    return new Promise((resolve, reject) => {
      try {
        //* closing and removing all listeners on socket
        super.close()

        let _scope = _private.get(this)
        let {socket, bindAddress, bindPromise} = _scope

        //* if bind promise is pending then cancel it
        if (bindPromise && bindPromise.isPending()) {
          bindPromise.cancel()
        }

        _scope.bindPromise = null

        socket.unbindSync(bindAddress)
        this.setOffline()
        resolve()
      } catch (err) {
        reject(err)
      }
    })
  }

  //* Polymorphic Functions
  request ({to, event, data, timeout, mainEvent = false} = {}) {
    let envelop = new Envelop({type: EnvelopType.SYNC, tag: event, data, owner: this.getId(), recipient: to, mainEvent})
    return super.request(envelop, timeout)
  }

  tick ({to, event, data, mainEvent = false} = {}) {
    let envelop = new Envelop({type: EnvelopType.ASYNC, tag: event, data: data, owner: this.getId(), recipient: to, mainEvent})
    return super.tick(envelop)
  }

  getSocketMsg (envelop) {
    return [envelop.getRecipient(), '', envelop.getBuffer()]
  }
}
