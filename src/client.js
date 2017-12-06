import {events} from './enum'
import Globals from './globals'
import ActorModel from './actor'
import * as Errors from './errors'

import {Dealer as DealerSocket, SocketEvent} from './sockets'

let _private = new WeakMap()

export default class Client extends DealerSocket {
  constructor ({id, options, config} = {}) {
    options = options || {}
    config = config || {}

    super({id, options, config})
    let _scope = {
      server: null,
      pingInterval: null
    }

    this.on(SocketEvent.DISCONNECT, this::_serverFailHandler)
    this.on(SocketEvent.RECONNECT, this::_serverReconnectHandler)

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
  async connect (serverAddress, timeout = -1) {
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
        timeout: Globals.CONNECTION_REQUEST_TIMEOUT,
        mainEvent: true
      }

      let {actorId, options} = await this.request(requestData)
      // ** creating server model and setting it online
      _scope.server = new ActorModel({id: actorId, options: options, online: true, address: serverAddress})
      this::_startServerPinging()
      return {actorId, options}
    } catch (err) {
      this.emit('error', new Errors.ConnectionError({err, id: this.getId()}))
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
      this.emit('error', new Errors.ConnectionError({err, id: this.getId(), state: 'disconnecting'}))
    }
  }

  request ({event, data, timeout, mainEvent} = {}) {
    let server = this.getServerActor()

        // this is first request, and there is no need to check if server online or not
    if (mainEvent && event === events.CLIENT_CONNECTED) {
      return super.request({ event, data, timeout, mainEvent })
    }

    if (!server || !server.isOnline()) return Promise.reject(new Error(`Server is offline during request, on client: ${this.getId()}`))

    return super.request({event, data, timeout, to: server.getId(), mainEvent})
  }

  tick ({event, data, mainEvent} = {}) {
    let server = this.getServerActor()
    if (!server || !server.isOnline()) {
      throw new Error(`Server is offline during tick, on client: ${this.getId()}`)
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

    this.emit(events.SERVER_FAILURE, server)
  } catch (err) {
    this.logger.error(err)
  }
}

async function _serverReconnectHandler (/* { fd, serverAddress } */) {
  try {
    this.setOnline()

    let server = this.getServerActor()

    let requestObj = {
      event: events.CLIENT_CONNECTED,
      data: {
        actorId: this.getId(),
        options: this.getOptions()
      },
      timeout: Globals.CONNECTION_REQUEST_TIMEOUT,
      mainEvent: true
    }

    let {actorId, options} = await this.request(requestObj)

    // **  TODO։։avar remove this after some time (server should always be available at this point)
    if (!server) {
      this.logger.warn(`Server actor is not available on reconnect`, this.getId())
      return
    }

    server.setId(actorId)
    server.setOnline()
    server.setOptions(options)

    this.emit(events.SERVER_RECONNECT, server)

    this::_startServerPinging()
  } catch (err) {
    this.emit('error', new Errors.ConnectionError({err, id: this.getId(), state: 'reconnecting'}))
  }
}

function _serverStopHandler () {
  try {
    let server = this.getServerActor()

    if (!server) {
      throw new Error('Client doesn\'t have server actor')
    }

    this::_stopServerPinging()

    server.markStopped()
    this.emit(events.SERVER_STOP, server)
  } catch (err) {
    this.logger.error('Error while handling server stop', err)
  }
}

function _serverOptionsSync ({options, actorId}) {
  try {
    let server = this.getServerActor()
    if (!server) {
      throw new Error(`Client: ${this.getId()}, does not have server`)
    }
    server.setOptions(options)
  } catch (err) {
    this.logger.error('Error while handling server options sync:', err)
  }
}

function _startServerPinging () {
  let _scope = _private.get(this)
  let {pingInterval} = _scope

  if (pingInterval) {
    clearInterval(pingInterval)
  }

  let options = this.getOptions()
  let interval = options.CLIENT_PING_INTERVAL || Globals.CLIENT_PING_INTERVAL

  _scope.pingInterval = setInterval(() => {
    try {
      let pingData = {actor: this.getId(), stamp: Date.now()}
      this.tick({event: events.CLIENT_PING, data: pingData, mainEvent: true})
    } catch (err) {
      this.logger.error('Error while pinging to server:', err)
    }
  }, interval)
}

function _stopServerPinging () {
  let {pingInterval} = _private.get(this)

  if (pingInterval) {
    clearInterval(pingInterval)
  }
}
