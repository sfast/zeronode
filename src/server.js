import _ from 'underscore'

import { events } from './enum'
import Globals from './globals'
import ActorModel from './actor'
import * as Errors from './errors'

import { Router as RouterSocket } from './sockets'

let _private = new WeakMap()

export default class Server extends RouterSocket {
  constructor (data = {}) {
    let {id, bind, logger, options} = data
    let routerSocketOptions = {logger}

    super({id, options: routerSocketOptions})
    super.setOptions(options)

    let _scope = {
      clientModels: new Map(),
      clientCheckInterval: null
    }

    _private.set(this, _scope)

    this.setAddress(bind)

      // ** ATTACHING client connected
    this.onRequest(events.CLIENT_CONNECTED, this::_clientConnectedRequest)

      // ** ATTACHING client stop
    this.onRequest(events.CLIENT_STOP, this::_clientStopRequest)

      // ** ATTACHING client ping
    this.onTick(events.CLIENT_PING, this::_clientPingTick)

      // ** ATTACHING CLIENT OPTIONS SYNCING
    this.onTick(events.OPTIONS_SYNC, this::_clientOptionsSync)
  }

  getClientById (clientId) {
    let {clientModels} = _private.get(this)
    return clientModels.has(clientId) ? clientModels.get(clientId) : null
  }

  isClientOnline (id) {
    let clientModel = this.getClientById(id)
    return clientModel ? clientModel.isOnline() : false
  }

  getOnlineClients () {
    let {clientModels} = _private.get(this)
    let onlineClients = []
    clientModels.forEach((actor) => {
      if (actor.isOnline()) {
        onlineClients.push(actor)
      }
    }, this)

    return onlineClients
  }

  setOptions (options, notify = true) {
    super.setOptions(options)
    if (notify) {
      _.each(this.getOnlineClients(), (client) => {
        this.tick(client.id, events.OPTIONS_SYNC, {actorId: this.getId(), options})
      })
    }
  }

  bind (bindAddress) {
    try {
      if (_.isString(bindAddress)) {
        this.setAddress(bindAddress)
      }

      return super.bind(this.getAddress())
    } catch (err) {
      throw new Errors.BindError({id: this.getId(), err})
    }
  }

  unbind () {
    try {
      _.each(this.getOnlineClients(), (client) => {
        this.tick(client.getId(), events.SERVER_STOP)
      })
      super.unbind()
    } catch (err) {
      throw new Errors.BindError({id: this.getId(), err, state: 'unbinding'})
    }
  }
}

// ** Request handlers
function _clientPingTick ({actor, stamp}) {
  let {clientModels} = _private.get(this)
    // ** PING DATA FROM CLIENT, actor is client id

  let actorModel = clientModels.get(actor)

  if (actorModel) {
    actorModel.ping(stamp)
  }
}

// TODO:: @dave, @avar why merge options when disconnecting
function _clientStopRequest (request) {
  let {clientModels} = _private.get(this)
  let {actorId, options} = request.body

  let actorModel = clientModels.get(actorId)
  actorModel.markStopped()
  actorModel.mergeOptions(options)

  this.emit(events.CLIENT_STOP, actorModel)
}

function _clientConnectedRequest (request) {
  let _scope = _private.get(this)
  let {clientModels, clientCheckInterval} = _scope

  let {actorId, options} = request.body

  let actorModel = new ActorModel({id: actorId, options: options, online: true})

  clientModels.set(actorId, actorModel)

  if (!clientCheckInterval) {
    let options = this.getOptions()
    let clientHeartbeatInterval = options.CLIENT_MUST_HEARTBEAT_INTERVAL || Globals.CLIENT_MUST_HEARTBEAT_INTERVAL
    _scope.clientCheckInterval = setInterval(this::_checkClientHeartBeat, clientHeartbeatInterval)
  }

  let replyData = {actorId: this.getId(), options: this.getOptions()}
    // ** replyData {actorId, options}
  request.reply(replyData)

  this.emit(events.CLIENT_CONNECTED, actorModel)
}

// ** check clients heartbeat
function _checkClientHeartBeat () {
  _.each(this.getOnlineClients(), (actor) => {
    if (!actor.isGhost()) {
      actor.markGhost()
    } else {
      actor.markFailed()
      this.emit(events.CLIENT_FAILURE, actor)
      this.logger.warn(`Server ${this.getId()} identifies client failure`, actor)
    }
  })
}

function _clientOptionsSync ({actorId, options}) {
  try {
    let {clientModels} = _private.get(this)
    let actorModel = clientModels.get(actorId)
    if (!actorModel) {
      throw new Error(`there is no client actor whit that id: ${actorId}`)
    }
    actorModel.setOptions(options)
  } catch (err) {
    this.logger.error('Error while handling clientOptionsSync:', err)
  }
}
