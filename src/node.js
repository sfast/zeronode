/**
 * Created by avar and dave on 2/14/17.
 */
import _ from 'underscore'
import Promise from 'bluebird'
import md5 from 'md5'
import animal from 'animal-id'
import { EventEmitter } from 'events'

import NodeUtils from './utils'
import Server from './server'
import Client from './client'
import Errors from './errors'
import Metric from './metric'
import Globals from './globals'
import { events } from './enum'
import {Enum, Watchers} from './sockets'
import winston from 'winston'

let MetricType = Enum.MetricType

const _private = new WeakMap()

let defaultLogger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({level: 'error'})
  ]
})

export default class Node extends EventEmitter {
  constructor (data = {}) {
    super()

    let {id, bind, options, logger} = data
    options = options || {}
    id = id || _generateNodeId()
    logger = logger || defaultLogger

    this.logger = logger

    let _scope = {
      id,
      bind,
      options,
      metric: {
        status: false,
        info: new Metric({id}),
        interval: null
      },
      nodeServer: null,
      nodeClients: new Map(),
      nodeClientsAddressIndex: new Map(),
      tickWatcherMap: new Map(),
      requestWatcherMap: new Map()
    }

    _private.set(this, _scope)
    this::_initNodeServer()
  }

  getId () {
    let {id} = _private.get(this)
    return id
  }

  getAddress () {
    let {nodeServer} = _private.get(this)
    return nodeServer ? nodeServer.getAddress() : null
  }

  getOptions () {
    let {options} = _private.get(this)
    return options
  }

  getFilteredNodes ({options, predicate, up = true, down = true} = {}) {
    let _scope = _private.get(this)
    let nodes = new Set()

    // ** if the predicate is provided we'll use it, if not then filtering will hapen based on options
    // ** options predicate is built via NodeUtils.optionsPredicateBuilder
    predicate = _.isFunction(predicate) ? predicate : NodeUtils.optionsPredicateBuilder(options)

    if (_scope.nodeServer && down) {
      _scope.nodeServer.getOnlineClients().forEach((clientNode) => {
        NodeUtils.checkNodeReducer(clientNode, predicate, nodes)
      }, this)
    }

    if (_scope.nodeClients.size && up) {
      _scope.nodeClients.forEach((client) => {
        let actorModel = client.getServerActor()
        if (actorModel && actorModel.isOnline()) {
          NodeUtils.checkNodeReducer(actorModel, predicate, nodes)
        }
      }, this)
    }

    return Array.from(nodes)
  }

  setAddress (bind) {
    let {nodeServer} = _private.get(this)
    nodeServer ? nodeServer.setAddress(bind) : this.logger.info('No server available')
  }

  // async
  bind (routerAddress) {
    let {nodeServer} = _private.get(this)
    return nodeServer.bind(routerAddress)
  }

  unbind () {
    let {nodeServer} = _private.get(this)
    if (!nodeServer) return Promise.resolve()

    nodeServer.unbind()
    return Promise.resolve()
  }

    // ** connect returns the id of the connected node
  async connect (address = 'tcp://127.0.0.1:3000', timeout) {
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error(`Wrong type for argument address ${address}`)
    }

    let _scope = _private.get(this)
    let {id, metric, nodeClientsAddressIndex, nodeClients} = _scope
    let metricEnabled = metric.status
    let metricInfo = metric.info

    let addressHash = md5(address)

    if (nodeClientsAddressIndex.has(addressHash)) {
      return nodeClientsAddressIndex.get(addressHash)
    }

    let client = new Client({ id, options: _scope.options, logger: this.logger })

    // ** attaching client handlers
    client.on('error', (err) => this.emit('error', err))
    client.on(events.SERVER_FAILURE, (serverActor) => this.emit(events.SERVER_FAILURE, serverActor.toJSON()))
    client.on(events.SERVER_STOP, (serverActor) => this.emit(events.SERVER_STOP, serverActor.toJSON()))

    // **
    client.setMetric(metricEnabled)

    let { actorId, options } = await client.connect(address, timeout)

    this::_attachClientMetrics(client, metricInfo)

    this.logger.info(`Node connected: ${this.getId()} -> ${actorId}`)

    nodeClientsAddressIndex.set(addressHash, actorId)
    nodeClients.set(actorId, client)

    this::_addExistingListenersToClient(client)

    return {
      actorId,
      options
    }
  }

    // TODO::avar maybe disconnect from node ?
  async disconnect (address = 'tcp://127.0.0.1:3000') {
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error(`Wrong type for argument address ${address}`)
    }

    let addressHash = md5(address)

    let _scope = _private.get(this)
    let {nodeClientsAddressIndex, nodeClients} = _scope

    if (!nodeClientsAddressIndex.has(addressHash)) return true

    let nodeId = nodeClientsAddressIndex.get(addressHash)
    let client = nodeClients.get(nodeId)

    client.removeAllListeners(events.SERVER_FAILURE)
    client.removeAllListeners(MetricType.SEND_TICK)
    client.removeAllListeners(MetricType.GOT_TICK)
    client.removeAllListeners(MetricType.SEND_REQUEST)
    client.removeAllListeners(MetricType.GOT_REQUEST)
    client.removeAllListeners(MetricType.GOT_REPLY)

    await client.disconnect()
    this::_removeClientAllListeners(client)
    nodeClients.delete(nodeId)
    nodeClientsAddressIndex.delete(addressHash)
    return true
  }

  async stop () {
    let {nodeServer, nodeClients} = _private.get(this)
    let stopPromise = []
    if (nodeServer.isOnline()) {
      nodeServer.unbind()
    }

    nodeClients.forEach((client) => {
      if (client.isOnline()) {
        stopPromise.push(client.disconnect())
      }
    }, this)

    await Promise.all(stopPromise)
  }

  onRequest (endpoint, fn) {
    let _scope = _private.get(this)
    let {requestWatcherMap, nodeClients, nodeServer} = _scope

    let requestWatcher = requestWatcherMap.get(endpoint)
    if (!requestWatcher) {
      requestWatcher = new Watchers(endpoint)
      requestWatcherMap.set(endpoint, requestWatcher)
    }

    requestWatcher.addFn(fn)

    nodeServer.onRequest(endpoint, fn)

    nodeClients.forEach((client) => {
      client.onRequest(endpoint, fn)
    }, this)
  }

  offRequest (endpoint, fn) {
    let _scope = _private.get(this)

    _scope.nodeServer.offRequest(endpoint)
    _scope.nodeClients.forEach((client) => {
      client.offRequest(endpoint, fn)
    })

    let requestWatcher = _scope.requestWatcherMap.get(endpoint)
    if (requestWatcher) {
      requestWatcher.removeFn(fn)
    }
  }

  onTick (event, fn) {
    let _scope = _private.get(this)
    let {tickWatcherMap, nodeClients, nodeServer} = _scope

    let tickWatcher = tickWatcherMap.get(event)
    if (!tickWatcher) {
      tickWatcher = new Watchers(event)
      tickWatcherMap.set(event, tickWatcher)
    }

    tickWatcher.addFn(fn)

        // ** _scope.nodeServer is constructed in Node constructor
    nodeServer.onTick(event, fn)

    nodeClients.forEach((client) => {
      client.onTick(event, fn)
    })
  }

  offTick (event, fn) {
    let _scope = _private.get(this)
    _scope.nodeServer.offTick(event)
    _scope.nodeClients.forEach((client) => {
      client.offTick(event, fn)
    }, this)

    let tickWatcher = _scope.tickWatcherMap.get(event)
    if (tickWatcher) {
      tickWatcher.removeFn(fn)
    }
  }

  async request ({ to, event, data, timeout } = {}) {
    let _scope = _private.get(this)

    // ** if no timeout provided then we try to get from options and then from our internal global
    if (!timeout) {
      let {options} = _scope
      timeout = options.REQUEST_TIMEOUT || Globals.REQUEST_TIMEOUT
    }

    let {nodeServer, nodeClients} = _scope

    let endpoint = event

    let clientActor = this::_getClientByNode(to)
    if (clientActor) {
      return nodeServer.request({ to: clientActor.getId(), event: endpoint, data, timeout })
    }

    if (nodeClients.has(to)) {
            // ** to is the serverId of node so we request
      return nodeClients.get(to).request({ event: endpoint, data, timeout })
    }

    throw new Error(`Node with ${to} is not found.`)
  }

  tick ({ to, event, data } = {}) {
    let _scope = _private.get(this)
    let {nodeServer, nodeClients} = _scope
    let clientActor = this::_getClientByNode(to)
    if (clientActor) {
      return nodeServer.tick({ to: clientActor.getId(), event, data })
    }
    if (nodeClients.has(to)) {
      return nodeClients.get(to).tick({ event, data })
    }
    throw new Error(`Node with ${to} is not found.`)
  }

  async requestAny ({ endpoint, data, timeout, filter = {}, down = true, up = true } = {}) {
    // ** if no timeout provided then we try to get from options and then from our internal global
    if (!timeout) {
      let {options} = _private.get(this)
      timeout = options.REQUEST_TIMEOUT || Globals.REQUEST_TIMEOUT
    }

    let filteredNodes = this.getFilteredNodes({filter, down, up})

    if (!filteredNodes.length) {
      throw new Error('There is no node with that filter', {code: Errors.NO_NODE})
    }
    let nodeId = this::_getWinnerNode(filteredNodes, endpoint)
    return this.request({ to: nodeId, endpoint, data, timeout })
  }

  async requestDownAny ({ endpoint, data, timeout, filter } = {}) {
    let result = await this.requestAny({ endpoint, data, timeout, filter, down: true, up: false })
    return result
  }

  async requestUpAny ({ endpoint, data, timeout, filter } = {}) {
    let result = await this.requestAny({ endpoint, data, timeout, filter, down: false, up: true })
    return result
  }

  tickAny ({ event, data, filter = {}, down = true, up = true } = {}) {
    let filteredNodes = this.getFilteredNodes({filter, down, up})
    if (!filteredNodes.length) {
      throw new Error('There is no node with that filter', {code: Errors.NO_NODE})
    }
    let nodeId = this::_getWinnerNode(filteredNodes, event)
    return this.tick({ to: nodeId, event, data })
  }

  tickDownAny ({event, data, filter} = {}) {
    return this.tickAny({ event, data, filter, down: true, up: false })
  }

  tickUpAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: false, up: true })
  }

  tickAll ({ event, data, filter = {}, down = true, up = true } = {}) {
    let filteredNodes = this.getFilteredNodes({filter, down, up})
    let tickPromises = []

    filteredNodes.forEach((nodeId) => {
      tickPromises.push(this.tick({ to: nodeId, event, data }))
    }, this)

    return Promise.all(tickPromises)
  }

  tickDownAll ({event, data, filter} = {}) {
    return this.tickAll({ event, data, filter, down: true, up: false })
  }

  tickUpAll ({event, data, filter} = {}) {
    return this.tickAll({ event, data, filter, down: false, up: true })
  }

  enableMetrics (interval = 1000) {
    let _scope = _private.get(this)
    let {metric, nodeClients, nodeServer} = _scope
    metric.status = true

    nodeClients.forEach((client) => {
      client.setMetric(true)
    }, this)

    nodeServer.setMetric(true)

    metric.interval = setInterval(() => {
      this.emit(events.METRICS, metric.info)
      metric.info.flush()
    }, interval)
  }

  disableMetrics () {
    let _scope = _private.get(this)
    let {metric, nodeClients, nodeServer} = _scope
    metric.status = false
    nodeClients.forEach((client) => {
      client.setMetric(false)
    }, this)
    nodeServer.setMetric(false)
    clearInterval(metric.interval)
    metric.interval = null
    metric.info.flush()
  }

  setOptions (options) {
    let _scope = _private.get(this)
    _scope.options = options

    let {nodeServer, nodeClients} = _scope
    nodeServer.setOptions(options)
    nodeClients.forEach((client) => {
      client.setOptions(options)
    }, this)
  }
}

// ** PRIVATE FUNCTIONS

function _initNodeServer () {
  let _scope = _private.get(this)
  let {id, bind, options, metric} = _scope

  let metricStatus = metric.status
  let metricsInfo = metric.info

  let nodeServer = new Server({id, bind, logger: this.logger, options})
  // ** handlers for nodeServer
  nodeServer.on('error', (err) => this.emit('error', err))
  nodeServer.on(events.CLIENT_FAILURE, (clientActor) => this.emit(events.CLIENT_FAILURE, clientActor.toJSON()))
  nodeServer.on(events.CLIENT_CONNECTED, (clientActor) => this.emit(events.CLIENT_CONNECTED, clientActor.toJSON()))
  nodeServer.on(events.CLIENT_STOP, (clientActor) => this.emit(events.CLIENT_STOP, clientActor.toJSON()))

  // ** enabling metrics
  nodeServer.setMetric(metricStatus)
  this::_attachServerMetrics(nodeServer, metricsInfo)

  _scope.nodeServer = nodeServer
}

function _getClientByNode (nodeId) {
  let _scope = _private.get(this)
  let actors = _scope.nodeServer.getOnlineClients().filter((actor) => {
    let node = actor.getId()
    return node === nodeId
  })

  if (!actors.length) {
    return null
  }

  if (actors.length > 1) {
    return this.logger.warn(`We should have just 1 client from 1 node`)
  }

  return actors[0]
}

function _generateNodeId () {
  return animal.getId()
}

// TODO:: optimize this
function _getWinnerNode (nodeIds, tag) {
  let len = nodeIds.length
  let idx = Math.floor(Math.random() * len)
  return nodeIds[idx]
}

function _addExistingListenersToClient (client) {
  let _scope = _private.get(this)

  // ** adding previously added onTick-s for this client to
  _scope.tickWatcherMap.forEach((tickWatcher, event) => {
    // ** TODO what about order of functions ?
    tickWatcher.getFnMap().forEach((index, fn) => {
      client.onTick(event, this::fn)
    }, this)
  }, this)

  // ** adding previously added onRequests-s for this client to
  _scope.requestWatcherMap.forEach((requestWatcher, endpoint) => {
        // ** TODO what about order of functions ?
    requestWatcher.getFnMap().forEach((index, fn) => {
      client.onRequest(endpoint, this::fn)
    }, this)
  }, this)
}

function _removeClientAllListeners (client) {
  let _scope = _private.get(this)

    // ** removing all handlers
  _scope.tickWatcherMap.forEach((tickWatcher, event) => {
    client.offTick(event)
  }, this)

  // ** removing all handlers
  _scope.requestWatcherMap.forEach((requestWatcher, endpoint) => {
    client.offRequest(endpoint)
  }, this)
}

// TODO::REVIEW we can merge with _attachClientMetrics
function _attachServerMetrics (server, metricsInfo) {
  server.on(MetricType.SEND_TICK, (id) => metricsInfo.sendTick(id))

  server.on(MetricType.GOT_TICK, (id) => metricsInfo.gotTick(id))

  server.on(MetricType.SEND_REQUEST, (id) => metricsInfo.sendRequest(id))

  server.on(MetricType.GOT_REQUEST, (id) => metricsInfo.gotRequest(id))

  server.on(MetricType.REQUEST_TIMEOUT, (id) => metricsInfo.requestTimeout(id))

  server.on(MetricType.GOT_REPLY, (data) => {
    let {id, sendTime, getTime, replyTime, replyGetTime} = data
    metricsInfo.gotReply({id, sendTime, getTime, replyTime, replyGetTime})
  })
}

// TODO::REVIEW
function _attachClientMetrics (client, metricInfo) {
  let serverActorId = client.getServerActor().getId()

  client.on(MetricType.SEND_TICK, () => metricInfo.sendTick(serverActorId))

  client.on(MetricType.GOT_TICK, () => metricInfo.gotTick(serverActorId))

  // TODO::REVIEW
  client.on(MetricType.SEND_REQUEST, (id) => metricInfo.sendRequest(id))

  client.on(MetricType.GOT_REQUEST, () => metricInfo.gotRequest(serverActorId))

  client.on(MetricType.REQUEST_TIMEOUT, () => metricInfo.requestTimeout(serverActorId))

  client.on(MetricType.GOT_REPLY, (data) => {
    let {id, sendTime, getTime, replyTime, replyGetTime} = data
    metricInfo.gotReply({id, sendTime, getTime, replyTime, replyGetTime})
  })
}
