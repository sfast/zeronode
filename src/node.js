/**
 * Created by avar and dave on 2/14/17.
 */
import _ from 'underscore'
import Promise from 'bluebird'
import md5 from 'md5'
import animal from 'animal-id'
import { EventEmitter } from 'events'

import { ZeronodeError, ErrorCodes } from './errors'
import NodeUtils from './utils'
import Server from './server'
import Client from './client'
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

  getFilteredNodes ({ options, predicate, up = true, down = true } = {}) {
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

  // ** returns promise
  bind (routerAddress) {
    let {nodeServer} = _private.get(this)
    return nodeServer.bind(routerAddress)
  }

  // ** returns promise
  unbind () {
    let {nodeServer} = _private.get(this)
    if (!nodeServer) return Promise.resolve()

    return nodeServer.unbind()
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

    this::_attachMetricsHandlers(client, metricInfo)

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
      nodeServer.close()
    }

    nodeClients.forEach((client) => {
      stopPromise.push(client.close())
    }, this)

    await Promise.all(stopPromise)
  }

  onRequest (requestEvent, fn) {
    let _scope = _private.get(this)
    let {requestWatcherMap, nodeClients, nodeServer} = _scope

    let requestWatcher = requestWatcherMap.get(requestEvent)
    if (!requestWatcher) {
      requestWatcher = new Watchers(requestEvent)
      requestWatcherMap.set(requestEvent, requestWatcher)
    }

    requestWatcher.addFn(fn)

    nodeServer.onRequest(requestEvent, fn)

    nodeClients.forEach((client) => {
      client.onRequest(requestEvent, fn)
    }, this)
  }

  offRequest (requestEvent, fn) {
    let _scope = _private.get(this)

    _scope.nodeServer.offRequest(requestEvent)
    _scope.nodeClients.forEach((client) => {
      client.offRequest(requestEvent, fn)
    })

    let requestWatcher = _scope.requestWatcherMap.get(requestEvent)
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

    let clientActor = this::_getClientByNode(to)
    if (clientActor) {
      return nodeServer.request({ to: clientActor.getId(), event, data, timeout })
    }

    if (nodeClients.has(to)) {
      // ** to is the serverId of node so we request
      return nodeClients.get(to).request({ event, data, timeout })
    }

    throw new ZeronodeError({ message: `Node with id '${to}' is not found.`, code: ErrorCodes.NODE_NOT_FOUND })
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
    throw new ZeronodeError({ message: `Node with id '${to}' is not found.`, code: ErrorCodes.NODE_NOT_FOUND })
  }

  async requestAny ({ event, data, timeout, filter, down = true, up = true } = {}) {
    // ** if no timeout provided then we try to get from options and then from our internal global
    if (!timeout) {
      let {options} = _private.get(this)
      timeout = options.REQUEST_TIMEOUT || Globals.REQUEST_TIMEOUT
    }

    let nodesFilter = { down, up }
    if (_.isFunction(filter)) {
      nodesFilter.predicate = filter
    } else {
      nodesFilter.options = filter || {}
    }

    let filteredNodes = this.getFilteredNodes(nodesFilter)

    if (!filteredNodes.length) {
      throw new ZeronodeError({ message: `Node with filter is not found.`, code: ErrorCodes.NODE_NOT_FOUND })
    }

    // ** find the node id where the request will be sent
    let to = this::_getWinnerNode(filteredNodes, event)
    return this.request({ to, event, data, timeout })
  }

  async requestDownAny ({ event, data, timeout, filter } = {}) {
    let result = await this.requestAny({ event, data, timeout, filter, down: true, up: false })
    return result
  }

  async requestUpAny ({ event, data, timeout, filter } = {}) {
    let result = await this.requestAny({ event, data, timeout, filter, down: false, up: true })
    return result
  }

  tickAny ({ event, data, filter, down = true, up = true } = {}) {
    let nodesFilter = { down, up }
    if (_.isFunction(filter)) {
      nodesFilter.predicate = filter
    } else {
      nodesFilter.options = filter || {}
    }

    let filteredNodes = this.getFilteredNodes(nodesFilter)

    if (!filteredNodes.length) {
      throw new ZeronodeError({ message: `Node with filter is not found.`, code: ErrorCodes.NODE_NOT_FOUND })
    }
    let nodeId = this::_getWinnerNode(filteredNodes, event)
    return this.tick({ to: nodeId, event, data })
  }

  tickDownAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: true, up: false })
  }

  tickUpAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: false, up: true })
  }

  tickAll ({ event, data, filter, down = true, up = true } = {}) {
    let nodesFilter = { down, up }
    if (_.isFunction(filter)) {
      nodesFilter.predicate = filter
    } else {
      nodesFilter.options = filter || {}
    }

    let filteredNodes = this.getFilteredNodes(nodesFilter)
    let tickPromises = []

    filteredNodes.forEach((nodeId) => {
      tickPromises.push(this.tick({ to: nodeId, event, data }))
    }, this)

    return Promise.all(tickPromises)
  }

  tickDownAll ({ event, data, filter } = {}) {
    return this.tickAll({ event, data, filter, down: true, up: false })
  }

  tickUpAll ({ event, data, filter } = {}) {
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

  async setOptions (options) {
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
  this::_attachMetricsHandlers(nodeServer, metricsInfo)

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

// TODO::avar optimize this
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
  _scope.requestWatcherMap.forEach((requestWatcher, requestEvent) => {
        // ** TODO what about order of functions ?
    requestWatcher.getFnMap().forEach((index, fn) => {
      client.onRequest(requestEvent, this::fn)
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
  _scope.requestWatcherMap.forEach((requestWatcher, requestEvent) => {
    client.offRequest(requestEvent)
  }, this)
}

function _attachMetricsHandlers (socket, metricsInfo) {
  socket.on(MetricType.SEND_TICK, (toNode) => metricsInfo.sendTick(toNode))

  socket.on(MetricType.SEND_REQUEST, (toNode) => metricsInfo.sendRequest(toNode))

  socket.on(MetricType.REQUEST_TIMEOUT, (fromNode) => metricsInfo.requestTimeout(fromNode))

  socket.on(MetricType.GOT_TICK, (fromNode) => metricsInfo.gotTick(fromNode))

  socket.on(MetricType.GOT_REQUEST, (fromNode) => metricsInfo.gotRequest(fromNode))

  socket.on(MetricType.GOT_REPLY, (data) => {
    let {id, sendTime, getTime, replyTime, replyGetTime} = data
    metricsInfo.gotReply({id, sendTime, getTime, replyTime, replyGetTime})
  })
}
