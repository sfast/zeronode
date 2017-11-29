import _ from 'underscore'
import animal from 'animal-id'
import EventEmitter from 'pattern-emitter'

import Envelop from './envelope'
import {EnvelopType, MetricType} from './enum'
import { Watchers } from './watchers'

let _private = new WeakMap()

class SocketIsNotOnline extends Error {
  constructor ({socketId, error}) {
    super(error.message, error.lineNumber, error.fileName)
    this.socketId = socketId
  }
}

export default class Socket extends EventEmitter {
  static generateSocketId () {
    return animal.getId()
  }

  constructor ({id, socket, logger}) {
    super()
    let socketId = id || Socket.generateSocketId()
    socket.identity = socketId
    socket.on('message', this::onSocketMessage)

    let _scope = {}
    _scope.id = socketId
    _scope.metric = false
    _scope.socket = socket
    _scope.online = false
    _scope.requests = new Map()
    _scope.requestWatcherMap = new Map()
    _scope.tickEmitter = new EventEmitter()
    _scope.socket = socket
    _scope.options = {}
    _private.set(this, _scope)

    this.logger = logger || console
  }

  getId () {
    let {id} = _private.get(this)
    return id
  }

  setOnline () {
    let _scope = _private.get(this)
    _scope.online = Date.now()
  }

  setOffline () {
    let _scope = _private.get(this)
    _scope.online = false
  }

  isOnline () {
    let {online} = _private.get(this)
    return !!online
  }

  setOptions (options = {}) {
    let _scope = _private.get(this)
    _scope.options = options
  }

  setMetric (status) {
    let _scope = _private.get(this)
    _scope.metric = status
  }

  getOptions () {
    let {options} = _private.get(this)
    return options
  }

  async request (envelop, reqTimeout = 5000) {
    let {id, requests, metric} = _private.get(this)

    if (!this.isOnline()) {
      let err = new Error(`Sending failed as socket ${this.getId()} is not online`)
      throw new SocketIsNotOnline({socketId: id, error: err })
    }

    let envelopId = envelop.getId()

    return new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        if (requests.has(envelopId)) {
          let requestObj = requests.get(envelopId)
          requests.delete(envelopId)
          if (metric) {
            // TODO::avar maybe we need metrics by tags also
            this.emit(MetricType.REQUEST_TIMEOUT, envelop.getRecipient())
          }
          requestObj.reject(new Error(`Request ${envelopId} timeouted on socket ${this.getId()}`))
        }
      }, reqTimeout)
      requests.set(envelopId, {resolve: resolve, reject: reject, timeout: timeout, sendTime: process.hrtime()})
      this.sendEnvelop(envelop)
    })
  }

  tick (envelop) {
    let {id} = _private.get(this)
    if (!this.isOnline()) {
      let err = new Error(`Sending failed as socket ${this.getId()} is not online`)
      throw new SocketIsNotOnline({socketId: id, error: err})
    }

    this.sendEnvelop(envelop)
  }

  sendEnvelop (envelop) {
    let {socket, metric} = _private.get(this)

    let self = this
    if (metric) {
      switch (envelop.getType()) {
        case EnvelopType.ASYNC:
            // TODO::avar maybe we need metrics by tags also
            self.emit(MetricType.SEND_TICK, envelop.getRecipient())
            break
        case EnvelopType.SYNC:
            self.emit(MetricType.SEND_REQUEST, envelop.getRecipient())
            break
      }
    }
    socket.send(this.getSocketMsg(envelop))
  }

  close () {
    let {socket} = _private.get(this)
    socket.removeAllListeners('message')
  }

  onRequest (endpoint, fn) {
        // ** function will called with argument  request = {body, reply}
    let {requestWatcherMap} = _private.get(this)
    let requestWatcher = requestWatcherMap.get(endpoint)

    if (!requestWatcher) {
      requestWatcher = new Watchers(endpoint)
      requestWatcherMap.set(endpoint, requestWatcher)
    }

    requestWatcher.addFn(fn)
  }

  offRequest (endpoint, fn) {
    let {requestWatcherMap} = _private.get(this)
    if (_.isFunction(fn)) {
      let endpointWatcher = requestWatcherMap.get(endpoint)
      if (!endpointWatcher) return
      endpointWatcher.removeFn(fn)
      return
    }

    requestWatcherMap.delete(endpoint)
  }

  onTick (event, fn) {
    let {tickEmitter} = _private.get(this)
    tickEmitter.on(event, fn)
  }

  offTick (event, fn) {
    let {tickEmitter} = _private.get(this)
    if (_.isFunction(fn)) {
      tickEmitter.removeListener(event, fn)
      return
    }

    tickEmitter.removeAllListeners(event)
  }
}

//* * Handlers of specific envelop msg-es

//* * when socket is dealer identity is empty
//* * when socket is router, identity is the dealer which sends data
function onSocketMessage (empty, envelopBuffer) {
  let {metric, tickEmitter} = _private.get(this)

  let {type, id, owner, recipient, tag, mainEvent} = Envelop.readMetaFromBuffer(envelopBuffer)
  let envelop = new Envelop({type, id, owner, recipient, tag, mainEvent})
  let envelopData = Envelop.readDataFromBuffer(envelopBuffer)

  switch (type) {
    case EnvelopType.ASYNC:
      if (metric) this.emit(MetricType.GOT_TICK, owner)
      tickEmitter.emit(tag, envelopData)
      break
    case EnvelopType.SYNC:
      envelop.setData(envelopData)
      if (metric) this.emit(MetricType.GOT_REQUEST, owner)
      this::syncEnvelopHandler(envelop)
      break
    case EnvelopType.RESPONSE:
      envelop.setData(envelopData)
      this::responseEnvelopHandler(envelop)
      break
  }
}

function syncEnvelopHandler (envelop) {
  let self = this
  let getTime = process.hrtime()

  let prevOwner = envelop.getOwner()
  let handlers = self::determineHandlersByTag(envelop.getTag())

  if(!handlers.length) return

  let requestOb = {
    body: envelop.getData(),
    reply: (data) => {
      envelop.setRecipient(prevOwner)
      envelop.setOwner(self.getId())
      envelop.setType(EnvelopType.RESPONSE)
      envelop.setData({getTime, replyTime: process.hrtime(), data})
      self.sendEnvelop(envelop)
    },
    next: (err) => {
      // TODO::avar lets refactor next and add it under documentation
        if (err) {
            self.logger.error(err);
            return this.reply({error: err});
        }

        if (!handlers.length) {
            throw new Error(`There is no handlers available as to process next() on socket ${self.getId()}`)
        }

        handlers.pop()(requestOb)
    }
  }

  handlers.pop()(requestOb)
}

function determineHandlersByTag (tag) {
  let handlers = [];

  let {requestWatcherMap} = _private.get(this)

  for (let endpoint of requestWatcherMap.keys()) {
    if (endpoint instanceof RegExp) {
      if (endpoint.test(tag)) {
          requestWatcherMap.get(endpoint).getFnMap().forEach((index, fnKey) => {
              handlers.push({index, fnKey});
          })
      }
    } else if (endpoint == tag) {
        requestWatcherMap.get(endpoint).getFnMap().forEach((index, fnKey) => {
            handlers.push({index, fnKey});
        })
    }
  }

  return handlers.sort((a, b) => {
      return a.index - b.index
  }).map((ob) => ob.fnKey)
}

function responseEnvelopHandler (envelop) {
  let {requests, metric} = _private.get(this)

  let id = envelop.getId()
  if (requests.has(id)) {
        //** requestObj is like {resolve, reject, timeout : clearRequestTimeout}
    let {timeout, sendTime, resolve} = requests.get(id)
    // ** getTime is the time when message arrives to server
    // ** replyTime is the time when message is send from server
    let {getTime, replyTime, data} = envelop.getData()

    let gotReplyMetric = {id: envelop.getOwner(), sendTime, getTime, replyTime, replyGetTime: process.hrtime()}
    if (metric) this.emit(MetricType.GOT_REPLY, gotReplyMetric)
    clearTimeout(timeout)
        //** resolving request promise with response data
    resolve(data)
    requests.delete(id)
  } else {
    this.logger.warn(`Response ${id} is probably time outed`)
  }
}
