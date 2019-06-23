/**
 * Created by artak on 3/2/17.
 */
import zmq from 'zeromq'
import Promise from 'bluebird'

import { ZeronodeError, ErrorCodes } from '../errors'
import { Socket } from './socket'
import Envelop from './envelope'
import { EnvelopType } from './enum'

let _private = new WeakMap()
/**
 * Extends 
 * {@link Socket}  
 * @param {Integer} id
 * @param {Objcet} options 
 * @param {Objcet} config
   */
 
export default class RouterSocket extends Socket {
  
  constructor ({ id, options, config } = {}) {
    options = options || {}
    config = config || {}

    let socket = zmq.socket('router')

    super({ id, socket, options, config })

    let _scope = {
      socket,
      bindPromise: null,
      bindAddress: null
    }

    _private.set(this, _scope)
  }
/**
 * Get the Address 
 */
  getAddress () {
    let { bindAddress } = _private.get(this)
    return bindAddress
  }
/**
 * Set the Address
 * @param {bindAddress} bindAddress 
 */
  setAddress (bindAddress) {
    let _scope = _private.get(this)

    if (typeof bindAddress === 'string' && bindAddress.length) {
      _scope.bindAddress = bindAddress
    }
  }

  /**
   * 
   * @param {bindardess} bindAddress 
   * @returns {Promise}
   *  if trying to bind to other address you need  unbind first 
   * 
   * 
   *  if bind is still pending then returning the binded Promise 
   */  
  bind (bindAddress) {
    if (this.isOnline() && bindAddress === this.getAddress()) {
      return Promise.resolve(true)
    }

    let _scope = _private.get(this)
    let bindPromise = _scope.bindPromise

    if (bindPromise && bindAddress !== this.getAddress()) {
      // ** if trying to bind to other address you need to unbind first
      let alreadyBindedError = new Error(`Already binded to '${this.getAddress()}', unbind before changing bind address to '${bindAddress}'`)
      return Promise.reject(new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.ALREADY_BINDED, error: alreadyBindedError }))
    }

    // ** if bind is still pending then returning it
    if (bindPromise && bindPromise.isPending() && bindAddress === this.getAddress()) return bindPromise

    if (bindAddress) this.setAddress(bindAddress)

    _scope.bindPromise = new Promise((resolve, reject) => {
      let { socket } = _scope

      this.attachSocketMonitor()

      socket.bind(this.getAddress(), (err) => {
        if (err) return reject(err)
        this.setOnline()
        resolve(`Router (${this.getId()}) is binded at address ${this.getAddress()}`)
      })
    })

    return _scope.bindPromise
  }
  /**
   * You can unbind your Znode form address
   * 
   * 
   * and this function will return promise 
   * @returns {Promise}
   * 
   * If bind promise is pending then reject it 
   */
  
  unbind () {
    return new Promise((resolve, reject) => {
      //* closing and removing all listeners on socket
      super.close()

      let _scope = _private.get(this)
      let { socket, bindAddress, bindPromise } = _scope

      //* if bind promise is pending then reject it
      if (bindPromise && bindPromise.isPending()) {
        bindPromise.reject('Unbinding')
      }

      _scope.bindPromise = null

      socket.unbindSync(bindAddress)

      this.setOffline()
      resolve()
    })
  }

  /**
   * Close the socket  
   * This function returns Promise 
   * @returns {Promise }
   */
  async close () {
    await this.unbind()

    let { socket } = _private.get(this)

    socket.close()
  }

  //* Polymorphic Functions
/**
 * Polymorphic Function
 * @param {Id} to
 * @param {Event} event
 * @param {Any} data
 * @param {Number} timeout
 * @param {Boolean} mainEvent 
 */
  request ({ to, event, data, timeout, mainEvent = false } = {}) {
    let envelop = new Envelop({ type: EnvelopType.REQUEST, tag: event, data, owner: this.getId(), recipient: to, mainEvent })
    return super.request(envelop, timeout)
  }
/**
 * * Polymorphic Function
 * @param {Id} to
 * @param {Event} event
 * @param {Any} data
 * @param {Boolean} mainEvent
 */
  tick ({ to, event, data, mainEvent = false } = {}) {
    let envelop = new Envelop({ type: EnvelopType.TICK, tag: event, data: data, owner: this.getId(), recipient: to, mainEvent })
    return super.tick(envelop)
  }
/**
 * Polymorphic Functions
 * @param {Envelop} envelop 
 */
  getSocketMsg (envelop) {
    return [envelop.getRecipient(), '', envelop.getBuffer()]
  }
}
