/**
 * Created by avar and dave on 2/14/17.
 */
import winston from 'winston'
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
import { events } from './enum'
import { Enum, Watchers } from './sockets'

let MetricType = Enum.MetricType

const _private = new WeakMap()

let defaultLogger = winston.createLogger({
  transports: [
    new (winston.transports.Console)({ level: 'error' })
  ]
})
/**
 * @param {Number} id
 * @param {Socket} bind
 * @param {Object} options 
 * @param {Object} config
 */
export default class Node extends EventEmitter {
  constructor ({ id, bind, options, config } = {}) {
    super()

    id = id || _generateNodeId()
    options = options || {}
    Object.defineProperty(options, '_id', {
      value: id,
      writable: false,
      configurable: true,
      enumerable: true
    })
    config = config || {}
    config.logger = defaultLogger

    this.logger = config.logger || defaultLogger

    // ** default metric is disabled
    let metric = new Metric({ id })

    let _scope = {
      id,
      bind,
      options,
      config,
      metric,
      nodeServer: null,
      nodeClients: new Map(),
      nodeClientsAddressIndex: new Map(),
      tickWatcherMap: new Map(),
      requestWatcherMap: new Map()
    }

    _private.set(this, _scope)
    this::_initNodeServer()
  }
/**
 * Getting id 
 */
  getId () {
    let { id } = _private.get(this)
    return id
  }
/**
 * Getting Address
 */
  getAddress () {
    let { nodeServer } = _private.get(this)
    return nodeServer ? nodeServer.getAddress() : null
  }
/**
 * Getting options
 */
  getOptions () {
    let { options } = _private.get(this)
    return options
  }
/**
 * Get the information abour server 
 * @param {String} address 
 * @param {Number} id
 */
  getServerInfo ({ address, id }) {
    let { nodeClients, nodeClientsAddressIndex } = _private.get(this)

    if (!id) {
      let addressHash = md5(address)

      if (!nodeClientsAddressIndex.has(addressHash)) return null
      id = nodeClientsAddressIndex.get(addressHash)
    }

    let client = nodeClients.get(id)

    if (!client) return null

    let serverActor = client.getServerActor()

    return serverActor ? serverActor.toJSON() : null
  }
/** 
 * Get the information abour client  
 * @param {String} address 
 * @param {Number} id 
 * */
  getClientInfo ({ id }) {
    let { nodeServer } = _private.get(this)

    let client = nodeServer.getClientById(id)

    return client ? client.toJSON() : null
  }
/**
 * 
 * @param {Object} options
 * @param {Boolean} up
 * @param {Boolean} down
 *  
 */
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
/**
 * Setting the address
 * @param {String} bind 
 */
  setAddress (bind) {
    let { nodeServer } = _private.get(this)
    nodeServer ? nodeServer.setAddress(bind) : this.logger.info('No server available')
  }

  /**
   * Binds the znode to the specified interface and port and returns promise. 
   * You can bind only to one address. Address can be of the following protocols: tcp, inproc(in-process/inter-thread), ipc(inter-process). 
   * @param {String} address 
   */
  bind (address) {
    let { nodeServer } = _private.get(this)
    return nodeServer.bind(address)
  }

  /**
   * Unbinds the server znode and returns promise.
   * Unbinding doesn't stop znode, it can still be connected to other nodes if there are any,
   * it just stops the server behaviour of znode, and on all the client znodes (connected to this server znode) SERVER_STOP event will be triggered.
   */
  unbind () {
    let { nodeServer } = _private.get(this)
    if (!nodeServer) return Promise.resolve()

    return nodeServer.unbind()
  }
  /**
   * Connects the znode to server znode with specified address and returns promise. 
   * znode can connect to multiple znodes. If timeout is provided (in milliseconds) 
   * then the connect()-s promise will be rejected if connection is taking longer.
   * connect returns the id of the connected node
   * @param {String} address
   * @param {Number} timeout 
   * @param {Number} reconnectionTimeout
   */
  async connect ({ address, timeout, reconnectionTimeout } = {}) {
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error(`Wrong type for argument address ${address}`)
    }

    let _scope = _private.get(this)
    let { id, metric, nodeClientsAddressIndex, nodeClients, config } = _scope
    let clientConfig = config

    if (reconnectionTimeout) clientConfig = Object.assign({}, config, { RECONNECTION_TIMEOUT: reconnectionTimeout })

    address = address || 'tcp://127.0.0.1:3000'

    let addressHash = md5(address)

    if (nodeClientsAddressIndex.has(addressHash)) {
      let client = nodeClients.get(nodeClientsAddressIndex.get(addressHash))
      return client.getServerActor().toJSON()
    }

    let client = new Client({ id, options: _scope.options, config: clientConfig })

    // ** attaching client handlers
    client.on('error', (err) => this.emit('error', err))
    client.on(events.SERVER_FAILURE, (serverActor) => this.emit(events.SERVER_FAILURE, serverActor))
    client.on(events.SERVER_STOP, (serverActor) => this.emit(events.SERVER_STOP, serverActor))
    client.on(events.SERVER_RECONNECT, (serverActor) => {
      try {
        let addressHash = md5(serverActor.address)
        let oldId = nodeClientsAddressIndex.get(addressHash)
        nodeClients.delete(oldId)
        nodeClientsAddressIndex.set(addressHash, serverActor.id)
        nodeClients.set(serverActor.id, client)
      } catch (err) {
        this.logger.error('Error while handling server reconnect', err)
      }
      this.emit(events.SERVER_RECONNECT, serverActor)
    })
    client.on(events.SERVER_RECONNECT_FAILURE, (serverActor) => {
      try {
        nodeClients.delete(serverActor.id)
        nodeClientsAddressIndex.delete(md5(serverActor.address))
      } catch (err) {
        this.logger.error('Error while handling server reconnect failure', err)
      }
      this.emit(events.SERVER_RECONNECT_FAILURE, serverActor)
    })
    client.on(events.OPTIONS_SYNC, ({ id, newOptions }) => this.emit(events.OPTIONS_SYNC, { id, newOptions }))

    // **
    client.setMetric(metric.status)

    this::_addExistingListenersToClient(client)

    let { actorId } = await client.connect(address, timeout)

    this::_attachMetricsHandlers(client, metric)

    this.logger.info(`Node connected: ${this.getId()} -> ${actorId}`)

    nodeClientsAddressIndex.set(addressHash, actorId)
    nodeClients.set(actorId, client)

    this.emit(events.CONNECT_TO_SERVER, client.getServerActor().toJSON())

    return client.getServerActor().toJSON()
  }

  // TODO::avar maybe disconnect from node ?
  async disconnect (address = 'tcp://127.0.0.1:3000') {
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error(`Wrong type for argument address ${address}`)
    }

    let addressHash = md5(address)

    let _scope = _private.get(this)
    let { nodeClientsAddressIndex, nodeClients } = _scope

    if (!nodeClientsAddressIndex.has(addressHash)) return true

    let nodeId = nodeClientsAddressIndex.get(addressHash)
    let client = nodeClients.get(nodeId)

    client.removeAllListeners(events.SERVER_FAILURE)
    client.removeAllListeners(MetricType.SEND_TICK)
    client.removeAllListeners(MetricType.GOT_TICK)
    client.removeAllListeners(MetricType.SEND_REQUEST)
    client.removeAllListeners(MetricType.GOT_REQUEST)
    client.removeAllListeners(MetricType.SEND_REPLY_SUCCESS)
    client.removeAllListeners(MetricType.SEND_REPLY_ERROR)
    client.removeAllListeners(MetricType.GOT_REPLY_SUCCESS)
    client.removeAllListeners(MetricType.GOT_REPLY_ERROR)
    client.removeAllListeners(MetricType.REQUEST_TIMEOUT)
    client.removeAllListeners(MetricType.OPTIONS_SYNC)

    await client.disconnect()
    this::_removeClientAllListeners(client)
    nodeClients.delete(nodeId)
    nodeClientsAddressIndex.delete(addressHash)
    return true
  }
/**
 * Unbinds znode, disconnects from all connected addresses (znodes) and returns promise.
 * @param {Server} nodeServer
 * @param {Clinet} nodeClient
 */
  async stop () {
    let { nodeServer, nodeClients } = _private.get(this)
    let stopPromise = []

    this.disableMetrics()

    if (nodeServer.isOnline()) {
      stopPromise.push(nodeServer.close())
    }

    nodeClients.forEach((client) => {
      stopPromise.push(client.close())
    }, this)

    await Promise.all(stopPromise)
  }
/**
 * Adds request handler for given event on znode.
 * @param {Event} requestEvent 
 * @param {Function} fn 
 */
  onRequest (requestEvent, fn) {
    let _scope = _private.get(this)
    let { requestWatcherMap, nodeClients, nodeServer } = _scope

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
/**
 * Removes request handler for given event.
   If handler is not provided then removes all of the listeners.
 * @param {Event} requestEvent 
 * @param {Function} fn 
 */
  offRequest (requestEvent, fn) {
    let _scope = _private.get(this)

    _scope.nodeServer.offRequest(requestEvent, fn)
    _scope.nodeClients.forEach((client) => {
      client.offRequest(requestEvent, fn)
    })

    let requestWatcher = _scope.requestWatcherMap.get(requestEvent)
    if (requestWatcher) {
      requestWatcher.removeFn(fn)
    }
  }
/**
 * Adds tick(event) handler for given event
 * @param {Event} event 
 * @param {Function} fn 
 */
  onTick (event, fn) {
    let _scope = _private.get(this)
    let { tickWatcherMap, nodeClients, nodeServer } = _scope

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
/**
 * Removes given tick(event) handler from event listeners' list. 
   If handler is not provided then removes all of the listeners.
 * @param {Event} event 
 * @param {Function} fn 
 */
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
/**
 * to is the serverId of node so we request
 * @param {Id} to 
 * @param {Event} event
 * @param {Any}  data
 * @param {Number} timeout 
 */
  async request ({ to, event, data, timeout } = {}) {
    let _scope = _private.get(this)

    let { nodeServer, nodeClients } = _scope

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
/**
 * Ticks(emits) event to given znode(to).
 * @param {Id} to
 * @param {Event} event
 * @param {Any} data
 */
  tick ({ to, event, data } = {}) {
    let _scope = _private.get(this)
    let { nodeServer, nodeClients } = _scope
    let clientActor = this::_getClientByNode(to)
    if (clientActor) {
      return nodeServer.tick({ to: clientActor.getId(), event, data })
    }
    if (nodeClients.has(to)) {
      return nodeClients.get(to).tick({ event, data })
    }
    throw new ZeronodeError({ message: `Node with id '${to}' is not found.`, code: ErrorCodes.NODE_NOT_FOUND })
  }
  /**General method to send request to only one znode satisfying the filter
   * @param {Event} event
     @param {Any} data
     @param {Number} timeou
     @param {Object} filter
   *  
   */
  async requestAny ({ event, data, timeout, filter, down = true, up = true } = {}) {
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
/**
 * Send request to one of downstream znodes (znodes which has been connected to your znode via connect()
 * @param {Event} event
 * @param {Any} data
 * @param {Number} timeout
 * @param {Object} filter
 */
  async requestDownAny ({ event, data, timeout, filter } = {}) {
    let result = await this.requestAny({ event, data, timeout, filter, down: true, up: false })
    return result
  }
  /**
   * Send request to one of upstream znodes (znodes to which your znode has been connected via connect() ).
   * @param {Event} event
   * @param {Any} data
   * @param {Number} timeout
   * @param {object} filter
   */
  async requestUpAny ({ event, data, timeout, filter } = {}) {
    let result = await this.requestAny({ event, data, timeout, filter, down: false, up: true })
    return result
  }
  /**
   * General method to send tick-s to only one znode satisfying the filter.
   * @param {*} param0 
   */
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
/**
 * 
Send tick-s to one of downstream znodes (znodes which has been connected to your znode via connect() 
 * @param {Event} event
 * @param {}
 * @param {Object} filter 
 */
  tickDownAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: true, up: false })
  }
/**
 * Send tick-s to one of upstream znodes (znodes to which your znode has been connected via connect() 
 * @param {Event} event
 * @param {}
 * @param {Object} filter 
 */
  tickUpAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: false, up: true })
  }
/**
 * Tick to ALL znodes satisfying the filter (object or predicate function), up ( upstream ) and down ( downstream ).
 * @param {Event} event
 * @param {}
 * @param {Object} filter 
 * @param {Boolean} down
 * @param {Boolean} up
 */
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
/**
 * Tick to ALL downstream znodes.
 * @param {Event} event
 * @param {}
 * @param {Object} filter 
 */
  tickDownAll ({ event, data, filter } = {}) {
    return this.tickAll({ event, data, filter, down: true, up: false })
  }
  /**
   * Tick to ALL upstream znodes.
   * @param {Event} event
   * @param {}
   * @param {Object} filter  
   */

  tickUpAll ({ event, data, filter } = {}) {
    return this.tickAll({ event, data, filter, down: false, up: true })
  }
/**
 * Enables metrics, events will be triggered by the given interval. 
 * Default interval is 1000 msEnables metrics, events will be triggered by the given interval. Default interval is 1000 ms
 * @param {Number} flushInterval 
 */
  enableMetrics (flushInterval) {
    let _scope = _private.get(this)
    let { metric, nodeClients, nodeServer } = _scope
    metric.enable(flushInterval)

    nodeClients.forEach((client) => {
      client.setMetric(true)
    }, this)

    nodeServer.setMetric(true)
  }

  get metric () {
    let { metric } = _private.get(this)
    return metric
  }
/**
 * Stops triggering events, and removes all collected data
 */
  disableMetrics () {
    let { metric, nodeClients, nodeServer } = _private.get(this)
    metric.disable()

    nodeClients.forEach((client) => {
      client.setMetric(false)
    }, this)
    nodeServer.setMetric(false)
  }/**
   * Setting the Options
   * @param {Object} options 
   */

  async setOptions (options = {}) {
    let _scope = _private.get(this)
    _scope.options = options

    Object.defineProperty(options, '_id', {
      value: _scope.id,
      writable: false,
      configurable: true,
      enumerable: true
    })

    let { nodeServer, nodeClients } = _scope
    nodeServer.setOptions(options)
    nodeClients.forEach((client) => {
      client.setOptions(options)
    }, this)
  }
}

// ** PRIVATE FUNCTIONS

function _initNodeServer () {
  let _scope = _private.get(this)
  let { id, bind, options, metric, config } = _scope

  let nodeServer = new Server({ id, bind, options, config })
  // ** handlers for nodeServer
  nodeServer.on('error', (err) => this.emit('error', err))
  nodeServer.on(events.CLIENT_FAILURE, (clientActor) => this.emit(events.CLIENT_FAILURE, clientActor))
  nodeServer.on(events.CLIENT_CONNECTED, (clientActor) => this.emit(events.CLIENT_CONNECTED, clientActor))
  nodeServer.on(events.CLIENT_STOP, (clientActor) => this.emit(events.CLIENT_STOP, clientActor))
  nodeServer.on(events.OPTIONS_SYNC, ({ id, newOptions }) => this.emit(events.OPTIONS_SYNC, { id, newOptions }))

  // ** enabling metrics
  nodeServer.setMetric(metric.status)
  this::_attachMetricsHandlers(nodeServer, metric)

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

function _attachMetricsHandlers (socket, metric) {
  socket.on(MetricType.SEND_TICK, (envelop) => {
    this.emit(MetricType.SEND_TICK, envelop)
    metric.sendTick(envelop)
  })

  socket.on(MetricType.SEND_REQUEST, (envelop) => {
    this.emit(MetricType.SEND_REQUEST, envelop)
    metric.sendRequest(envelop)
  })

  socket.on(MetricType.SEND_REPLY_SUCCESS, (envelop) => {
    this.emit(MetricType.SEND_REPLY_SUCCESS, envelop)
    metric.sendReplySuccess(envelop)
  })

  socket.on(MetricType.SEND_REPLY_ERROR, (envelop) => {
    this.emit(MetricType.SEND_REPLY_ERROR, envelop)
    metric.sendReplyError(envelop)
  })

  socket.on(MetricType.REQUEST_TIMEOUT, (envelop) => {
    this.emit(MetricType.REQUEST_TIMEOUT, envelop)
    metric.requestTimeout(envelop)
  })

  socket.on(MetricType.GOT_TICK, (envelop) => {
    this.emit(MetricType.GOT_TICK, envelop)
    metric.gotTick(envelop)
  })

  socket.on(MetricType.GOT_REQUEST, (envelop) => {
    this.emit(MetricType.GOT_REQUEST, envelop)
    metric.gotRequest(envelop)
  })

  socket.on(MetricType.GOT_REPLY_SUCCESS, (envelop) => {
    this.emit(MetricType.GOT_REPLY_SUCCESS, envelop)
    metric.gotReplySuccess(envelop)
  })

  socket.on(MetricType.GOT_REPLY_ERROR, (envelop) => {
    this.emit(MetricType.GOT_REPLY_ERROR, envelop)
    metric.gotReplyError(envelop)
  })
}
