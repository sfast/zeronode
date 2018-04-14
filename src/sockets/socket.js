import _ from 'underscore'
import animal from 'animal-id'
import EventEmitter from 'pattern-emitter'

import { ZeronodeError, ErrorCodes } from '../errors'

import SocketEvent from './events'
import Envelop from './envelope'
import { EnvelopType, MetricType, Timeouts } from './enum'
import Watchers from './watchers'

let _private = new WeakMap()

function _calculateLatency ({ sendTime, getTime, replyTime, replyGetTime }) {
  let processTime = (replyTime[0] * 10e9 + replyTime[1]) - (getTime[0] * 10e9 + getTime[1])
  let requestTime = (replyGetTime[0] * 10e9 + replyGetTime[1]) - (sendTime[0] * 10e9 + sendTime[1])

  return {
    process: processTime,
    latency: requestTime - processTime
  }
}

const nop = () => {}

/**
 *
 * @param envelop: Object
 * @param type: Enum(-1 = timeout, 0 = send, 1 = got)
 */
function emitMetric (envelop, type = 0) {
  let event = ''

  if (envelop.mainEvent) return

  switch (envelop.type) {
    case EnvelopType.TICK:
      event = !type ? MetricType.SEND_TICK : MetricType.GOT_TICK
      break
    case EnvelopType.REQUEST:
      if (type === -1) {
        event = MetricType.REQUEST_TIMEOUT
        break
      }
      event = !type ? MetricType.SEND_REQUEST : MetricType.GOT_REQUEST
      break
    case EnvelopType.RESPONSE:
      event = !type ? MetricType.SEND_REPLY_SUCCESS : MetricType.GOT_REPLY_SUCCESS
      break
    case EnvelopType.ERROR:
      event = !type ? MetricType.SEND_REPLY_ERROR : MetricType.GOT_REPLY_ERROR
  }

  this.emit(event, envelop)
}

function buildSocketEventHandler (eventName) {
  const handler = (fd, endpoint) => {
    if (this.debugMode()) {
      this.logger.info(`Emitted '${eventName}' on socket '${this.getId()}'`)
    }
    this.emit(eventName, {fd, endpoint})
  }

  return this::handler
}

class Socket extends EventEmitter {
  static generateSocketId () {
    return animal.getId()
  }

  constructor ({id, socket, config, options} = {}) {
    super()
    options = options || {}
    config = config || {}

    // ** creating the socket
    let socketId = id || Socket.generateSocketId()
    socket.identity = socketId
    socket.on('message', this::onSocketMessage)

    let _scope = {
      id: socketId,
      socket,
      config,
      options,
      logger: null,
      online: false,
      metric: nop,
      isDebugMode: false,
      monitorRestartInterval: null,
      requests: new Map(),
      requestWatcherMap: {
        main: new Map(),
        custom: new Map()
      },
      tickEmitter: {
        main: new EventEmitter(),
        custom: new EventEmitter()
      }
    }

    _private.set(this, _scope)

    // ** setting the logger as soon as possible
    this.setLogger(config.logger)

    this.debugMode(false)
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

  getOptions () {
    let {options} = _private.get(this)
    return options
  }

  getConfig () {
    let {config} = _private.get(this)
    return config
  }

  setMetric (status) {
    let _scope = _private.get(this)
    _scope.metric = status ? this::emitMetric : nop
  }

  setLogger (logger) {
    this.logger = logger || console
  }

  debugMode (val) {
    let _scope = _private.get(this)
    if (val) {
      _scope.isDebugMode = !!val
    } else {
      return _scope.isDebugMode
    }
  }

  request (envelop, reqTimeout) {
    let { id, requests, metric, config } = _private.get(this)
    reqTimeout = reqTimeout || config.REQUEST_TIMEOUT || Timeouts.REQUEST_TIMEOUT

    if (!this.isOnline()) {
      let err = new Error(`Sending failed as socket '${this.getId()}' is not online`)
      return Promise.reject(new ZeronodeError({ socketId: id, error: err, code: ErrorCodes.SOCKET_ISNOT_ONLINE }))
    }

    let envelopId = envelop.getId()

    return new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        if (requests.has(envelopId)) {
          let requestObj = requests.get(envelopId)
          requests.delete(envelopId)

          metric(envelop.toJSON(), -1)

          let requestTimeoutedError = new Error(`Request envelop '${envelopId}' timeouted on socket '${this.getId()}'`)
          requestObj.reject(new ZeronodeError({socketId: this.getId(), envelopId: envelopId, error: requestTimeoutedError, code: ErrorCodes.REQUEST_TIMEOUTED}))
        }
      }, reqTimeout)

      requests.set(envelopId, {resolve: resolve, reject: reject, timeout: timeout, sendTime: process.hrtime()})
      this.sendEnvelop(envelop)
    })
  }

  tick (envelop) {
    let socketId = this.getId()
    if (!this.isOnline()) {
      let socketNotOnlineError = new Error(`Sending failed as socket ${socketId} is not online`)
      throw new ZeronodeError({ socketId, error: socketNotOnlineError, code: ErrorCodes.SOCKET_ISNOT_ONLINE })
    }

    this.sendEnvelop(envelop)
  }

  sendEnvelop (envelop) {
    let {socket, metric} = _private.get(this)
    let msg = this.getSocketMsg(envelop)
    let envelopJSON = envelop.toJSON()

    if (msg instanceof Buffer) {
      envelopJSON.size = msg.length
    } else {
      envelopJSON.size = msg[2].length
    }

    metric(envelopJSON)

    socket.send(msg)
  }

  attachSocketMonitor () {
    let _scope = _private.get(this)
    let { config, socket } = _scope

    // ** start monitoring socket events
    let monitorTimeout = config.MONITOR_TIMEOUT || Timeouts.MONITOR_TIMEOUT
    let monitorRestartTimeout = config.MONITOR_RESTART_TIMEOUT || Timeouts.MONITOR_RESTART_TIMEOUT

    // ** start socket monitoring
    socket.monitor(monitorTimeout, 0)

    // ** Handle monitor error and restart it
    socket.on('monitor_error', () => {
      this.logger.warn(`Restarting monitor after ${monitorRestartTimeout} on socket ${this.getId()}`)
      _scope.monitorRestartInterval = setTimeout(() => socket.monitor(monitorTimeout, 0), monitorRestartTimeout)
    })

    socket.on('connect', this::buildSocketEventHandler(SocketEvent.CONNECT))
    socket.on('disconnect', this::buildSocketEventHandler(SocketEvent.DISCONNECT))
    socket.on('connect_delay', this::buildSocketEventHandler(SocketEvent.CONNECT_DELAY))
    socket.on('connect_retry', this::buildSocketEventHandler(SocketEvent.CONNECT_RETRY))
    socket.on('listen', this::buildSocketEventHandler(SocketEvent.LISTEN))
    socket.on('bind_error', this::buildSocketEventHandler(SocketEvent.BIND_ERROR))
    socket.on('accept', this::buildSocketEventHandler(SocketEvent.ACCEPT))
    socket.on('accept_error', this::buildSocketEventHandler(SocketEvent.ACCEPT_ERROR))
    socket.on('close', this::buildSocketEventHandler(SocketEvent.CLOSE))
    socket.on('close_error', this::buildSocketEventHandler(SocketEvent.CLOSE_ERROR))
  }

  detachSocketMonitor () {
    let {socket, monitorRestartInterval} = _private.get(this)
    // ** remove all listeners
    socket.removeAllListeners('connect')
    socket.removeAllListeners('disconnect')
    socket.removeAllListeners('connect_delay')
    socket.removeAllListeners('connect_retry')
    socket.removeAllListeners('listen')
    socket.removeAllListeners('bind_error')
    socket.removeAllListeners('accept')
    socket.removeAllListeners('accept_error')
    socket.removeAllListeners('close')
    socket.removeAllListeners('close_error')

    // ** if during closing there is a monitor restart scheduled then clear the schedule
    if (monitorRestartInterval) clearInterval(monitorRestartInterval)
    socket.unmonitor()
  }

  close () {
    this.detachSocketMonitor()
  }

  onRequest (endpoint, fn, main = false) {
    // ** function will called with argument  request = {body, reply}
    if (!(endpoint instanceof RegExp)) {
      endpoint = endpoint.toString()
    }
    let {requestWatcherMap} = _private.get(this)
    let watcherMap = main ? requestWatcherMap.main : requestWatcherMap.custom

    let requestWatcher = watcherMap.get(endpoint)

    if (!requestWatcher) {
      requestWatcher = new Watchers(endpoint)
      watcherMap.set(endpoint, requestWatcher)
    }

    requestWatcher.addFn(fn)
  }

  offRequest (endpoint, fn, main = false) {
    let {requestWatcherMap} = _private.get(this)
    let watcherMap = main ? requestWatcherMap.main : requestWatcherMap.custom

    if (_.isFunction(fn)) {
      let endpointWatcher = watcherMap.get(endpoint)
      if (!endpointWatcher) return
      endpointWatcher.removeFn(fn)
      return
    }

    watcherMap.delete(endpoint)
  }

  onTick (event, fn, main = false) {
    let {tickEmitter} = _private.get(this)
    main ? tickEmitter.main.on(event, fn) : tickEmitter.custom.on(event, fn)
  }

  offTick (event, fn, main = false) {
    let {tickEmitter} = _private.get(this)
    let eventTickEmitter = main ? tickEmitter.main : tickEmitter.custom

    if (_.isFunction(fn)) {
      eventTickEmitter.removeListener(event, fn)
      return
    }

    eventTickEmitter.removeAllListeners(event)
  }
}

//* * Handlers of specific envelop msg-es

//* * when socket is dealer identity is empty
//* * when socket is router, identity is the dealer which sends data
function onSocketMessage (empty, envelopBuffer) {
  let { metric, tickEmitter } = _private.get(this)

  let { type, id, owner, recipient, tag, mainEvent } = Envelop.readMetaFromBuffer(envelopBuffer)
  let envelop = new Envelop({type, id, owner, recipient, tag, mainEvent})
  let envelopData = Envelop.readDataFromBuffer(envelopBuffer)
  envelop.setData(envelopData)

  let envelopJSON = envelop.toJSON()
  envelopJSON.size = envelopBuffer.length

  switch (type) {
    case EnvelopType.TICK:
      metric(envelopJSON, 1)

      if (mainEvent) {
        tickEmitter.main.emit(tag, envelopData)
      } else {
        tickEmitter.custom.emit(tag, envelopData, {
          id: owner,
          event: tag
        })
      }
      break
    case EnvelopType.REQUEST:
      metric(envelopJSON, 1)
      // ** if metric is enabled then emit it
      this::syncEnvelopHandler(envelop)
      break
    case EnvelopType.RESPONSE:
    case EnvelopType.ERROR:
      envelop.size = envelopBuffer.length
      this::responseEnvelopHandler(envelop)
      break
  }
}

function syncEnvelopHandler (envelop) {
  let self = this
  let getTime = process.hrtime()

  let prevOwner = envelop.getOwner()
  let handlers = self::determineHandlersByTag(envelop.getTag(), envelop.isMain())

  if (!handlers.length) return

  let requestOb = {
    head: {
      id: envelop.getOwner(),
      event: envelop.getTag()
    },
    body: envelop.getData(),
    reply: (response) => {
      envelop.setRecipient(prevOwner)
      envelop.setOwner(self.getId())
      envelop.setType(EnvelopType.RESPONSE)
      envelop.setData({getTime, replyTime: process.hrtime(), data: response})
      self.sendEnvelop(envelop)
    },
    error: (err) => {
      envelop.setRecipient(prevOwner)
      envelop.setOwner(self.getId())
      envelop.setType(EnvelopType.ERROR)
      envelop.setData({getTime, replyTime: process.hrtime(), data: err})

      self.sendEnvelop(envelop)
    },
    next: (err) => {
      if (err) {
        return requestOb.error(err)
      }

      if (!handlers.length) {
        let noHandlerErr = new Error(`There is no handlers available as to process next() on socket '${self.getId()}'`)
        throw new ZeronodeError({ socketId: self.getId(), code: ErrorCodes.NO_NEXT_HANDLER_AVAILABLE, error: noHandlerErr })
      }

      handlers.shift()(requestOb)
    }
  }

  handlers.shift()(requestOb)
}

function determineHandlersByTag (tag, main = false) {
  let handlers = []

  let {requestWatcherMap} = _private.get(this)
  let watcherMap = main ? requestWatcherMap.main : requestWatcherMap.custom

  for (let endpoint of watcherMap.keys()) {
    if (endpoint instanceof RegExp) {
      if (endpoint.test(tag)) {
        watcherMap.get(endpoint).getFnMap().forEach((index, fnKey) => {
          handlers.push({index, fnKey})
        })
      }
    } else if (endpoint === tag) {
      watcherMap.get(endpoint).getFnMap().forEach((index, fnKey) => {
        handlers.push({index, fnKey})
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
  if (!requests.has(id)) {
    // ** TODO:: metric
    return this.logger.warn(`Response ${id} is probably time outed`)
  }

  //* * requestObj is like {resolve, reject, timeout : clearRequestTimeout}
  let {timeout, sendTime, resolve, reject} = requests.get(id)

  // ** getTime is the time when message arrives to server
  // ** replyTime is the time when message is send from server
  let gotReplyMetric = envelop.toJSON()
  let { getTime, replyTime } = gotReplyMetric.data
  let duration = _calculateLatency({ sendTime, getTime, replyTime, replyGetTime: process.hrtime() })

  gotReplyMetric.data = {
    data: gotReplyMetric.data,
    duration
  }

  gotReplyMetric.size = envelop.size

  metric(gotReplyMetric, 1)

  clearTimeout(timeout)
  requests.delete(id)

  let { data } = envelop.getData()
  //* * resolving request promise with response data
  envelop.getType() === EnvelopType.ERROR ? reject(data) : resolve(data)
}

// ** exports
export { SocketEvent }
export { Socket }

export default {
  SocketEvent,
  Socket
}
