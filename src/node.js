/**
 * Created by avar and dave on 2/14/17.
 */
import winston from 'winston'
import _ from 'underscore'
import md5 from 'md5'
import animal from 'animal-id'
import { EventEmitter } from 'events'

import { ZeronodeError, ErrorCodes } from './errors'
import NodeUtils from './utils'
import Server from './server'
import Client from './client'
import { events } from './enum'
import { Enum } from './sockets'
import { PatternEmitter } from '@sfast/pattern-emitter-ts'

const _private = new WeakMap()

let defaultLogger = winston.createLogger({
  transports: [
    new (winston.transports.Console)({ level: 'error' })
  ]
})

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

    let _scope = {
      id,
      bind,
      options,
      config,
      nodeServer: null,
      nodeClients: new Map(),
      nodeClientsAddressIndex: new Map(),
      tickEmitter: new PatternEmitter(),
      requestEmitter: new PatternEmitter()
    }

    _private.set(this, _scope)
    _initNodeServer.call(this)
  }

  getId () {
    let { id } = _private.get(this)
    return id
  }

  getAddress () {
    let { nodeServer } = _private.get(this)
    return nodeServer ? nodeServer.getAddress() : null
  }

  getOptions () {
    let { options } = _private.get(this)
    return options
  }

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

  getClientInfo ({ id }) {
    let { nodeServer } = _private.get(this)

    let client = nodeServer.getClientById(id)

    return client ? client.toJSON() : null
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
    let { nodeServer } = _private.get(this)
    nodeServer ? nodeServer.setAddress(bind) : this.logger.info('No server available')
  }

  // ** returns promise
  bind (address) {
    let { nodeServer } = _private.get(this)
    return nodeServer.bind(address)
  }

  // ** returns promise
  unbind () {
    let { nodeServer } = _private.get(this)
    if (!nodeServer) return Promise.resolve()

    return nodeServer.unbind()
  }

  // ** connect returns the id of the connected node
  async connect ({ address, timeout, reconnectionTimeout } = {}) {
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error(`Wrong type for argument address ${address}`)
    }

    let _scope = _private.get(this)
    let { id, nodeClientsAddressIndex, nodeClients, config } = _scope
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

    _addExistingListenersToClient.call(this, client)

    let { actorId } = await client.connect(address, timeout)

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

    await client.disconnect()
    _removeClientAllListeners.call(this, client)
    nodeClients.delete(nodeId)
    nodeClientsAddressIndex.delete(addressHash)
    return true
  }

  async stop () {
    let { nodeServer, nodeClients } = _private.get(this)
    let stopPromise = []

    if (nodeServer.isOnline()) {
      stopPromise.push(nodeServer.close())
    }

    nodeClients.forEach((client) => {
      stopPromise.push(client.close())
    }, this)

    await Promise.all(stopPromise)
  }

  onRequest (requestEvent, fn) {
    let _scope = _private.get(this)
    let { requestEmitter, nodeClients, nodeServer } = _scope

    requestEmitter.on(requestEvent, fn)

    nodeServer.onRequest(requestEvent, fn)

    nodeClients.forEach((client) => {
      client.onRequest(requestEvent, fn)
    }, this)
  }

  offRequest (requestEvent, fn) {
    let _scope = _private.get(this)
    let { requestEmitter, nodeServer, nodeClients } = _scope
    
    if (_.isFunction(fn)) {
      requestEmitter.off(requestEvent, fn)
    } else {
      requestEmitter.removeAllListeners(requestEvent)
    }

    nodeServer.offRequest(requestEvent, fn)
    nodeClients.forEach((client) => {
      client.offRequest(requestEvent, fn)
    })
  }

  onTick (event, fn) {
    let _scope = _private.get(this)
    let { tickEmitter, nodeClients, nodeServer } = _scope

    tickEmitter.on(event, fn)

    // ** _scope.nodeServer is constructed in Node constructor
    nodeServer.onTick(event, fn)

    nodeClients.forEach((client) => {
      client.onTick(event, fn)
    })
  }

  offTick (event, fn) {
    let _scope = _private.get(this)
    let { tickEmitter, nodeServer, nodeClients } = _scope
    
    if (_.isFunction(fn)) {
      tickEmitter.off(event, fn)
    } else {
      tickEmitter.removeAllListeners(event)
    }

    nodeServer.offTick(event, fn)
    nodeClients.forEach((client) => {
      client.offTick(event, fn)
    }, this)
  }

  async request ({ to, event, data, timeout } = {}) {
    let _scope = _private.get(this)

    let { nodeServer, nodeClients } = _scope

    let clientActor = _getClientByNode.call(this, to)
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
    let { nodeServer, nodeClients } = _scope
    let clientActor = _getClientByNode.call(this, to)
    if (clientActor) {
      return nodeServer.tick({ to: clientActor.getId(), event, data })
    }
    if (nodeClients.has(to)) {
      return nodeClients.get(to).tick({ event, data })
    }
    throw new ZeronodeError({ message: `Node with id '${to}' is not found.`, code: ErrorCodes.NODE_NOT_FOUND })
  }

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
    let to = _getWinnerNode.call(this, filteredNodes, event)
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
    let nodeId = _getWinnerNode.call(this, filteredNodes, event)
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

  // Metrics methods removed for performance optimization
  // Use external monitoring tools (Prometheus, StatsD, OpenTelemetry, etc.) instead

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
  let { id, bind, options, config } = _scope

  let nodeServer = new Server({ id, bind, options, config })
  // ** handlers for nodeServer
  nodeServer.on('error', (err) => this.emit('error', err))
  nodeServer.on(events.CLIENT_FAILURE, (clientActor) => this.emit(events.CLIENT_FAILURE, clientActor))
  nodeServer.on(events.CLIENT_CONNECTED, (clientActor) => this.emit(events.CLIENT_CONNECTED, clientActor))
  nodeServer.on(events.CLIENT_STOP, (clientActor) => this.emit(events.CLIENT_STOP, clientActor))
  nodeServer.on(events.OPTIONS_SYNC, ({ id, newOptions }) => this.emit(events.OPTIONS_SYNC, { id, newOptions }))

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

  // ** adding previously added onTick-s for this client
  // Iterate over all event patterns in the tickEmitter
  for (let [pattern, listeners] of _scope.tickEmitter.listeners) {
    listeners.forEach((fn) => {
      client.onTick(pattern, fn.bind(this))
    })
  }

  // ** adding previously added onRequests-s for this client
  // Iterate over all event patterns in the requestEmitter
  for (let [pattern, listeners] of _scope.requestEmitter.listeners) {
    listeners.forEach((fn) => {
      client.onRequest(pattern, fn.bind(this))
    })
  }
}

function _removeClientAllListeners (client) {
  let _scope = _private.get(this)

  // ** removing all tick handlers
  for (let [pattern] of _scope.tickEmitter.listeners) {
    client.offTick(pattern)
  }

  // ** removing all request handlers
  for (let [pattern] of _scope.requestEmitter.listeners) {
    client.offRequest(pattern)
  }
}

// Metrics handlers removed for performance optimization
// Use external monitoring tools (Prometheus, StatsD, etc.) instead
