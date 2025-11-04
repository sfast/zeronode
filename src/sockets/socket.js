import _ from 'underscore'
import animal from 'animal-id'
import EventEmitter from 'pattern-emitter'

import { ZeronodeError, ErrorCodes } from '../errors'

import SocketEvent from './events'
import Envelop from './envelope'
import { EnvelopType, MetricType, Timeouts } from './enum'
import Watchers from './watchers'

// ============================================================================
// CONSTANTS
// ============================================================================

const NANOSECONDS_PER_SECOND = 1e9

const METRIC_TYPE_VALUES = {
  SEND: 0,
  RECEIVE: 1,
  TIMEOUT: -1
}

// ============================================================================
// PRIVATE STORAGE
// ============================================================================

let _private = new WeakMap()

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const nop = () => {}

function calculateLatency ({ sendTime, getTime, replyTime, replyGetTime }) {
  const processTime = (replyTime[0] * NANOSECONDS_PER_SECOND + replyTime[1]) - 
                       (getTime[0] * NANOSECONDS_PER_SECOND + getTime[1])
  const requestTime = (replyGetTime[0] * NANOSECONDS_PER_SECOND + replyGetTime[1]) - 
                       (sendTime[0] * NANOSECONDS_PER_SECOND + sendTime[1])

  return {
    process: processTime,
    latency: requestTime - processTime
  }
}

function emitMetric (envelop, type = METRIC_TYPE_VALUES.SEND) {
  let event = ''

  if (envelop.mainEvent) return

  switch (envelop.type) {
    case EnvelopType.TICK:
      event = !type ? MetricType.SEND_TICK : MetricType.GOT_TICK
      break
    case EnvelopType.REQUEST:
      if (type === METRIC_TYPE_VALUES.TIMEOUT) {
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

function startMessageListener (socket) {
  (async () => {
    try {
      for await (const [empty, envelopBuffer] of socket) {
        onSocketMessage.call(this, empty, envelopBuffer)
      }
    } catch (err) {
      // Socket closed or error occurred
      if (this.logger && err.code !== 'EAGAIN') {
        this.logger.error('Socket message listener error:', err)
      }
    }
  }).call(this)
}

function buildSocketEventHandler (eventName) {
  const handler = (fd, endpoint) => {
    if (this.debugMode()) {
      this.logger.info(`Emitted '${eventName}' on socket '${this.getId()}'`)
    }
    this.emit(eventName, { fd, endpoint })
  }

  return handler.bind(this)
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

function onSocketMessage (empty, envelopBuffer) {
  let { metric, tickEmitter } = _private.get(this)

  let { type, id, owner, recipient, tag, mainEvent } = Envelop.readMetaFromBuffer(envelopBuffer)
  let envelop = new Envelop({ type, id, owner, recipient, tag, mainEvent })
  let envelopData = Envelop.readDataFromBuffer(envelopBuffer)
  envelop.setData(envelopData)

  let envelopJSON = envelop.toJSON()
  envelopJSON.size = envelopBuffer.length

  switch (type) {
    case EnvelopType.TICK:
      metric(envelopJSON, METRIC_TYPE_VALUES.RECEIVE)

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
      metric(envelopJSON, METRIC_TYPE_VALUES.RECEIVE)
      syncEnvelopHandler.call(this, envelop)
      break
    case EnvelopType.RESPONSE:
    case EnvelopType.ERROR:
      envelop.size = envelopBuffer.length
      responseEnvelopHandler.call(this, envelop)
      break
  }
}

function syncEnvelopHandler (envelop) {
  let self = this
  let getTime = process.hrtime()

  let prevOwner = envelop.getOwner()
  let handlers = determineHandlersByTag.call(self, envelop.getTag(), envelop.isMain())

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
      envelop.setData({ getTime, replyTime: process.hrtime(), data: response })
      self.sendEnvelop(envelop)
    },
    error: (err) => {
      envelop.setRecipient(prevOwner)
      envelop.setOwner(self.getId())
      envelop.setType(EnvelopType.ERROR)
      envelop.setData({ getTime, replyTime: process.hrtime(), data: err })

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

  let { requestWatcherMap } = _private.get(this)
  let watcherMap = main ? requestWatcherMap.main : requestWatcherMap.custom

  for (let endpoint of watcherMap.keys()) {
    if (endpoint instanceof RegExp) {
      if (endpoint.test(tag)) {
        watcherMap.get(endpoint).getFnMap().forEach((index, fnKey) => {
          handlers.push({ index, fnKey })
        })
      }
    } else if (endpoint === tag) {
      watcherMap.get(endpoint).getFnMap().forEach((index, fnKey) => {
        handlers.push({ index, fnKey })
      })
    }
  }

  return handlers.sort((a, b) => {
    return a.index - b.index
  }).map((ob) => ob.fnKey)
}

function responseEnvelopHandler (envelop) {
  let { requests, metric } = _private.get(this)

  let id = envelop.getId()
  if (!requests.has(id)) {
    return this.logger.warn(`Response ${id} is probably time outed`)
  }

  let { timeout, sendTime, resolve, reject } = requests.get(id)

  // Calculate timing metrics
  let gotReplyMetric = envelop.toJSON()
  let { getTime, replyTime } = gotReplyMetric.data
  let duration = calculateLatency({ sendTime, getTime, replyTime, replyGetTime: process.hrtime() })

  gotReplyMetric.data = {
    data: gotReplyMetric.data,
    duration
  }

  gotReplyMetric.size = envelop.size

  metric(gotReplyMetric, METRIC_TYPE_VALUES.RECEIVE)

  clearTimeout(timeout)
  requests.delete(id)

  let { data } = envelop.getData()
  envelop.getType() === EnvelopType.ERROR ? reject(data) : resolve(data)
}

// ============================================================================
// SOCKET CLASS
// ============================================================================

class Socket extends EventEmitter {
  static generateSocketId () {
    return animal.getId()
  }

  constructor ({ id, socket, config, options } = {}) {
    super()
    options = options || {}
    config = config || {}

    // ** creating the socket
    let socketId = id || Socket.generateSocketId()
    socket.routingId = socketId
    startMessageListener.call(this, socket)

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
    let { id } = _private.get(this)
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
    let { online } = _private.get(this)
    return !!online
  }

  setOptions (options = {}) {
    let _scope = _private.get(this)
    _scope.options = options
  }

  getOptions () {
    let { options } = _private.get(this)
    return options
  }

  getConfig () {
    let { config } = _private.get(this)
    return config
  }

  setMetric (status) {
    let _scope = _private.get(this)
    _scope.metric = status ? emitMetric.bind(this) : nop
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

          metric(envelop.toJSON(), METRIC_TYPE_VALUES.TIMEOUT)

          let requestTimeoutedError = new Error(`Request envelop '${envelopId}' timeouted on socket '${this.getId()}'`)
          requestObj.reject(new ZeronodeError({ socketId: this.getId(), envelopId: envelopId, error: requestTimeoutedError, code: ErrorCodes.REQUEST_TIMEOUTED }))
        }
      }, reqTimeout)

      requests.set(envelopId, { resolve: resolve, reject: reject, timeout: timeout, sendTime: process.hrtime() })
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
    let { socket, metric } = _private.get(this)
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
    let { socket } = _private.get(this)

    // ** In zeromq v6, events are accessed via socket.events
    if (socket.events) {
      socket.events.on('connect', buildSocketEventHandler.call(this, SocketEvent.CONNECT))
      socket.events.on('disconnect', buildSocketEventHandler.call(this, SocketEvent.DISCONNECT))
      socket.events.on('connect:delay', buildSocketEventHandler.call(this, SocketEvent.CONNECT_DELAY))
      socket.events.on('connect:retry', buildSocketEventHandler.call(this, SocketEvent.CONNECT_RETRY))
      socket.events.on('listen', buildSocketEventHandler.call(this, SocketEvent.LISTEN))
      socket.events.on('bind:error', buildSocketEventHandler.call(this, SocketEvent.BIND_ERROR))
      socket.events.on('accept', buildSocketEventHandler.call(this, SocketEvent.ACCEPT))
      socket.events.on('accept:error', buildSocketEventHandler.call(this, SocketEvent.ACCEPT_ERROR))
      socket.events.on('close', buildSocketEventHandler.call(this, SocketEvent.CLOSE))
      socket.events.on('close:error', buildSocketEventHandler.call(this, SocketEvent.CLOSE_ERROR))
    }
  }

  detachSocketMonitor () {
    let { socket } = _private.get(this)
    // ** In zeromq v6, events are on socket.events
    if (socket.events && typeof socket.events.removeAllListeners === 'function') {
      socket.events.removeAllListeners()
    }
  }

  close () {
    this.detachSocketMonitor()
  }

  // --------------------------------------------------------------------------
  // REQUEST/RESPONSE HANDLING
  // --------------------------------------------------------------------------

  onRequest (endpoint, fn, main = false) {
    // ** function will called with argument  request = {body, reply}
    if (!(endpoint instanceof RegExp)) {
      endpoint = endpoint.toString()
    }
    let { requestWatcherMap } = _private.get(this)
    let watcherMap = main ? requestWatcherMap.main : requestWatcherMap.custom

    let requestWatcher = watcherMap.get(endpoint)

    if (!requestWatcher) {
      requestWatcher = new Watchers(endpoint)
      watcherMap.set(endpoint, requestWatcher)
    }

    requestWatcher.addFn(fn)
  }

  offRequest (endpoint, fn, main = false) {
    let { requestWatcherMap } = _private.get(this)
    let watcherMap = main ? requestWatcherMap.main : requestWatcherMap.custom

    if (_.isFunction(fn)) {
      let endpointWatcher = watcherMap.get(endpoint)
      if (!endpointWatcher) return
      endpointWatcher.removeFn(fn)
      return
    }

    watcherMap.delete(endpoint)
  }

  // --------------------------------------------------------------------------
  // TICK (ONE-WAY MESSAGE) HANDLING
  // --------------------------------------------------------------------------

  onTick (event, fn, main = false) {
    let { tickEmitter } = _private.get(this)
    main ? tickEmitter.main.on(event, fn) : tickEmitter.custom.on(event, fn)
  }

  offTick (event, fn, main = false) {
    let { tickEmitter } = _private.get(this)
    let eventTickEmitter = main ? tickEmitter.main : tickEmitter.custom

    if (_.isFunction(fn)) {
      eventTickEmitter.removeListener(event, fn)
      return
    }

    eventTickEmitter.removeAllListeners(event)
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
export { SocketEvent }
export { Socket }

export default {
  SocketEvent,
  Socket
}
