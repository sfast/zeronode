import {events} from './enum'
import Globals from './globals'
import ActorModel from './actor'
import { ZeronodeError, ErrorCodes } from './errors'

import {Dealer as DealerSocket, SocketEvent} from './sockets'

let _private = new WeakMap()

export default class Client extends DealerSocket {
  constructor ({ id, options, config } = {}) {
    options = options || {}
    config = config || {}

    super({ id, options, config })
    let _scope = {
      server: null,
      pingInterval: null
    }

    this.on(SocketEvent.DISCONNECT, this::_serverFailHandler)
    this.on(SocketEvent.RECONNECT, this::_serverReconnectHandler)
    this.on(SocketEvent.RECONNECT_FAILURE, () => this.emit(events.SERVER_RECONNECT_FAILURE, _scope.server.toJSON()))

    this.onTick(events.SERVER_STOP, this::_serverStopHandler, true)
    this.onTick(events.OPTIONS_SYNC, this::_serverOptionsSync, true)

    _private.set(this, _scope)
  }

  getServerActor () {
    let {server} = _private.get(this)
    return server
  }

  setOptions (options, notify = true) {
    super.setOptions(options)
    if (notify) {
      this.tick({ event: events.OPTIONS_SYNC, data: {actorId: this.getId(), options}, mainEvent: true })
    }
  }

  // ** returns a promise which resolves with server model after server replies to events.CLIENT_CONNECTED
  async connect (serverAddress, timeout) {
    try {
      let _scope = _private.get(this)

        // actually connected
      await super.connect(serverAddress, timeout)

      let requestData = {
        event: events.CLIENT_CONNECTED,
        data: {
          actorId: this.getId(),
          options: this.getOptions()
        },
        mainEvent: true
      }

      let {actorId, options} = await this.request(requestData)
      // ** creating server model and setting it online
      _scope.server = new ActorModel({id: actorId, options: options, online: true, address: serverAddress})
      this::_startServerPinging()
      return {actorId, options}
    } catch (err) {
      let clientConnectError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.CLIENT_CONNECT, error: err })
      clientConnectError.description = `Error while disconnecting client '${this.getId()}'`
      this.emit('error', clientConnectError)
    }
  }

  async disconnect (options) {
    try {
      let _scope = _private.get(this)
      let server = this.getServerActor()
      let disconnectData = {actorId: this.getId()}

      if (options) {
        disconnectData.options = options
      }

      if (server && server.isOnline()) {
        let requestOb = {
          event: events.CLIENT_STOP,
          data: disconnectData,
          mainEvent: true
        }

        await this.request(requestOb)
        _scope.server = null
      }

      this::_stopServerPinging()

      super.disconnect()
    } catch (err) {
      let clientDisconnectError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.CLIENT_DISCONNECT, error: err })
      clientDisconnectError.description = `Error while disconnecting client '${this.getId()}'`
      this.emit('error', clientDisconnectError)
    }
  }

  request ({event, data, timeout, mainEvent} = {}) {
    let server = this.getServerActor()

    // this is first request, and there is no need to check if server online or not
    if (mainEvent && event === events.CLIENT_CONNECTED) {
      return super.request({ event, data, timeout, mainEvent })
    }

    if (!server || !server.isOnline()) {
      let serverOfflineError = new Error(`Server is offline during request, on client: ${this.getId()}`)
      return Promise.reject(new ZeronodeError({ socketId: this.getId(), error: serverOfflineError, code: ErrorCodes.SERVER_IS_OFFLINE }))
    }

    return super.request({event, data, timeout, to: server.getId(), mainEvent})
  }

  tick ({event, data, mainEvent} = {}) {
    let server = this.getServerActor()

    if (!server || !server.isOnline()) {
      let serverOfflineError = new Error(`Server is offline during request, on client: ${this.getId()}`)
      return Promise.reject(new ZeronodeError({ socketId: this.getId(), error: serverOfflineError, code: ErrorCodes.SERVER_IS_OFFLINE }))
    }

    super.tick({event, data, to: server.getId(), mainEvent})
  }
}

function _serverFailHandler () {
  try {
    let server = this.getServerActor()

    if (!server || !server.isOnline()) return

    this::_stopServerPinging()

    server.markFailed()

    this.emit(events.SERVER_FAILURE, server.toJSON())
  } catch (err) {
    let serverFailHandlerError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.SERVER_RECONNECT_HANDLER, error: err })
    serverFailHandlerError.description = `Error while handling server failure on client ${this.getId()}`
    this.emit('error', serverFailHandlerError)
  }
}

async function _serverReconnectHandler (/* { fd, serverAddress } */) {
  try {
    let server = this.getServerActor()

    let requestObj = {
      event: events.CLIENT_CONNECTED,
      data: {
        actorId: this.getId(),
        options: this.getOptions()
      },
      mainEvent: true
    }

    let {actorId, options} = await this.request(requestObj)

    // **  TODO։։avar remove this after some time (server should always be available at this point)
    if (!server) {
      throw new Error(`Server actor is not available on client '${this.getId()}'`)
    }

    server.setId(actorId)
    server.setOnline()
    server.setOptions(options)

    this.emit(events.SERVER_RECONNECT, server.toJSON())

    this::_startServerPinging()
  } catch (err) {
    let serverReconnectHandlerError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.SERVER_RECONNECT_HANDLER, error: err })
    serverReconnectHandlerError.description = `Error while handling server reconnect on client ${this.getId()}`
    this.emit('error', serverReconnectHandlerError)
  }
}

function _serverStopHandler () {
  try {
    let server = this.getServerActor()

    // ** TODO:: this should not happen, please describe the situation
    if (!server) {
      throw new Error(`Server actor is not available on client '${this.getId()}'`)
    }

    this::_stopServerPinging()

    server.markStopped()
    this.emit(events.SERVER_STOP, server.toJSON())
  } catch (err) {
    let serverStopHandlerError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.SERVER_STOP_HANDLER, error: err })
    serverStopHandlerError.description = `Error while handling server stop on client ${this.getId()}`
    this.emit('error', serverStopHandlerError)
  }
}

function _serverOptionsSync ({options, actorId}) {
  try {
    let server = this.getServerActor()
    if (!server) {
      throw new Error(`Server actor is not available on client '${this.getId()}'`)
    }
    server.setOptions(options)
  } catch (err) {
    let serverOptionsSyncHandlerError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.SERVER_OPTIONS_SYNC_HANDLER, error: err })
    serverOptionsSyncHandlerError.description = `Error while handling server options sync on client ${this.getId()}`
    this.emit('error', serverOptionsSyncHandlerError)
  }
}

function _startServerPinging () {
  let _scope = _private.get(this)
  let {pingInterval} = _scope

  if (pingInterval) {
    clearInterval(pingInterval)
  }

  let config = this.getConfig()
  let interval = config.CLIENT_PING_INTERVAL || Globals.CLIENT_PING_INTERVAL

  _scope.pingInterval = setInterval(() => {
    try {
      let pingData = { actor: this.getId(), stamp: Date.now() }
      this.tick({ event: events.CLIENT_PING, data: pingData, mainEvent: true })
    } catch (err) {
      let pingError = new ZeronodeError({ socketId: this.getId(), code: ErrorCodes.SERVER_PING_ERROR, error: err })
      this.emit('error', pingError)
    }
  }, interval)
}

function _stopServerPinging () {
  let {pingInterval} = _private.get(this)

  if (pingInterval) {
    clearInterval(pingInterval)
  }
}
