/**
 * Created by artak on 3/2/17.
 */
import zmq from 'zmq'
import Promise from 'bluebird'

import Socket from './socket'
import Envelop from './envelope'
import {EnvelopType} from './enum'

let _private = new WeakMap()

// ** if there is no logger the default console will be used
export default class RouterSocket extends Socket {
  constructor (data = {}) {
    let {id, options} = data

    options = options || {}

    let logger = options.logger
    let socket = zmq.socket('router')

    super({id, socket, logger})

    let _scope = {
      socket,
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

  //* * binded promise returns status
  bind (bindAddress) {
    if (this.isOnline()) return Promise.resolve(true)

    let {socket} = _private.get(this)

    if (bindAddress) this.setAddress(bindAddress)

    return new Promise((resolve, reject) => {
      socket.bind(this.getAddress(), (err) => {
        if (err) {
          return reject(err)
        }

        this.setOnline()
        resolve('router - is online')
      })
    })
  }

  // ** returns status
  unbind () {
    this.close()
  }

  close () {
    super.close()
    let {socket, bindAddress} = _private.get(this)
    socket.unbindSync(bindAddress)
    this.setOffline()
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
