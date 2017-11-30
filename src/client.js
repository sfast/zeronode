import {events} from './enum'
import Globals from './globals'
import ActorModel from './actor'
import * as Errors from './errors'

import {Dealer as DealerSocket, Enum} from './sockets'
let DealerEvent = Enum.DealerEvent

let _private = new WeakMap()

export default class Client extends DealerSocket {
  constructor (data = {}) {
    let {id, options, logger} = data
    let dealerSocketOptions = {logger}

    super({id, options: dealerSocketOptions})
    let _scope = {
      server: null,
      pingInterval: null
    }

    super.setOptions(options)

    this.on(DealerEvent.DISCONNECT, this::_serverFailHandler)
    this.on(DealerEvent.RECONNECT, this::_serverReconnectHandler)

    this.onTick(events.SERVER_STOP, this::_serverStopHandler)
    this.onTick(events.OPTIONS_SYNC, this::_serverOptionsSync)

    _private.set(this, _scope)
  }

  getServerActor () {
    let {server} = _private.get(this)
    return server
  }

  setOptions (options, notify = true) {
    super.setOptions(options)
    if (notify) {
      this.tick(events.OPTIONS_SYNC, {actorId: this.getId(), options})
    }
  }

    // ** returns a promise which resolves with server model after server replies to events.CLIENT_CONNECTED
  async connect (serverAddress, timeout = -1) {
    try {
      let _scope = _private.get(this)

        // actually connected
      await super.connect(serverAddress, timeout)
      let {actorId, options} = await this.request(events.CLIENT_CONNECTED, {
        actorId: this.getId(),
        options: this.getOptions()
      }, Globals.CONNECTION_REQUEST_TIMEOUT)
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
        await this.request(events.CLIENT_STOP, disconnectData)
        _scope.server = null
      }

      this::_stopServerPinging()

      super.disconnect()
    } catch (err) {
      this.emit('error', new Errors.ConnectionError({err, id: this.getId(), state: 'disconnecting'}))
    }
  }

  request (event, data, timeout) {
    let server = this.getServerActor()

        // this is first request, and there is no need to check if server online or not
    if (event === events.CLIENT_CONNECTED) {
      return super.request(event, data, timeout)
    }

    if (!server || !server.isOnline()) return Promise.reject(new Error(`Server is offline during request, on client: ${this.getId()}`))

    return super.request(event, data, timeout, server.getId())
  }

  tick (event, data) {
    let server = this.getServerActor()
    if (!server || !server.isOnline()) {
      throw new Error(`Server is offline during tick, on client: ${this.getId()}`)
    }
    super.tick(event, data, server.getId())
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
    let {options} = await this.request(events.CLIENT_CONNECTED, {actorId: this.getId(), options: this.getOptions()})

    // TODO։։avar remove this after some time (server should always be available at this point)
    if (!server) {
      this.logger.warn('Server actor isn\'t available on reconnect', this.getId())
    }

    server.setOnline()
    server.setOptions(options)

    this::_startServerPinging()
  } catch (err) {
    this.emit('error', new Errors.ConnectionError({err, id: this.getId(), state: 'reconnecting'}))
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
    let pingData = {actor: this.getId(), stamp: Date.now()}
    this.tick(events.CLIENT_PING, pingData)
  }, interval)
}

function _stopServerPinging () {
  let {pingInterval} = _private.get(this)

  if (pingInterval) {
    clearInterval(pingInterval)
  }
}

function _serverStopHandler () {
  try {
    let server = this.getServerActor()

    if (!server) {
      throw new Error('Client doesn\'t have server actor')
    }
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
