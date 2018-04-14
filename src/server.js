import _ from 'underscore'

import { events } from './enum'
import Globals from './globals'
import ActorModel from './actor'
import { ZeronodeError, ErrorCodes } from './errors'

import { Router as RouterSocket } from './sockets'

let _private = new WeakMap()

export default class Server extends RouterSocket {
  constructor ({id, bind, config, options} = {}) {
    options = options || {}
    config = config || {}

    super({id, options, config})

    let _scope = {
      clientModels: new Map(),
      clientCheckInterval: null
    }

    _private.set(this, _scope)

    this.setAddress(bind)

    // ** ATTACHING client connected
    this.onRequest(events.CLIENT_CONNECTED, this::_clientConnectedRequest, true)

    // ** ATTACHING client stop
    this.onRequest(events.CLIENT_STOP, this::_clientStopRequest, true)

    // ** ATTACHING client ping
    this.onTick(events.CLIENT_PING, this::_clientPingTick, true)

    // ** ATTACHING CLIENT OPTIONS SYNCING
    this.onTick(events.OPTIONS_SYNC, this::_clientOptionsSync, true)
  }

  getClientById (clientId) {
    let {clientModels} = _private.get(this)
    return clientModels.has(clientId) ? clientModels.get(clientId) : null
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
        this.tick({event: events.OPTIONS_SYNC, data: {actorId: this.getId(), options}, to: client.id, mainEvent: true})
      })
    }
  }

  bind (bindAddress) {
    if (_.isString(bindAddress)) {
      this.setAddress(bindAddress)
    }
    return super.bind(this.getAddress())
  }

  unbind () {
    try {
      let _scope = _private.get(this)

      if (this.isOnline()) {
        _.each(this.getOnlineClients(), (client) => {
          this.tick({ to: client.getId(), event: events.SERVER_STOP, mainEvent: true })
        })
      }

      // ** clear the heartbeat checking interval
      if (_scope.clientCheckInterval) {
        clearInterval(_scope.clientCheckInterval)
      }
      _scope.clientCheckInterval = null

      return super.unbind()
    } catch (err) {
      let serverUnbindError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.SERVER_UNBIND, error: err })
      return Promise.reject(serverUnbindError)
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

function _clientStopRequest (request) {
  let {clientModels} = _private.get(this)
  let {actorId, options} = request.body

  // ** just replying acknowledgment
  request.reply({stamp: Date.now()})

  let actorModel = clientModels.get(actorId)
  actorModel.markStopped()
  actorModel.mergeOptions(options)

  this.emit(events.CLIENT_STOP, actorModel.toJSON())
}

function _clientConnectedRequest (request) {
  let _scope = _private.get(this)
  let {clientModels, clientCheckInterval} = _scope

  let {actorId, options} = request.body

  let actorModel = new ActorModel({id: actorId, options: options, online: true})

  clientModels.set(actorId, actorModel)

  if (!clientCheckInterval) {
    let config = this.getConfig()
    let clientHeartbeatInterval = config.CLIENT_MUST_HEARTBEAT_INTERVAL || Globals.CLIENT_MUST_HEARTBEAT_INTERVAL
    _scope.clientCheckInterval = setInterval(this::_checkClientHeartBeat, clientHeartbeatInterval)
  }

  let replyData = {actorId: this.getId(), options: this.getOptions()}
  // ** replyData {actorId, options}
  request.reply(replyData)

  this.emit(events.CLIENT_CONNECTED, actorModel.toJSON())
}

// ** check clients heartbeat
function _checkClientHeartBeat () {
  _.each(this.getOnlineClients(), (actor) => {
    if (!actor.isGhost()) {
      actor.markGhost()
    } else {
      actor.markFailed()
      this.emit(events.CLIENT_FAILURE, actor.toJSON())
    }
  })
}

function _clientOptionsSync ({actorId, options}) {
  try {
    let {clientModels} = _private.get(this)
    let actorModel = clientModels.get(actorId)
    // TODO::remove after some time
    if (!actorModel) {
      throw new Error(`Client actor '${actorId}' is not available on server '${this.getId()}'`)
    }
    actorModel.setOptions(options)
  } catch (err) {
    let clientOptionsSyncHandlerError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.CLIENT_OPTIONS_SYNC_HANDLER, error: err })
    clientOptionsSyncHandlerError.description = `Error while handling client options sync on server ${this.getId()}`
    this.emit('error', clientOptionsSyncHandlerError)
  }
}
