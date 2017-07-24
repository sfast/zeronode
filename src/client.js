import {events} from './enum';
import globals from './globals';
import ActorModel from './actor';
import {Dealer as DealerSocket} from './sockets';
import * as Errors from './errors'
let _private = new WeakMap();

export default class Client extends DealerSocket {
    constructor(data) {
        let {id, options, logger} = data;

        super({id, logger});
        let _scope = {
            server: null,
            pingInterval: null,
            logger: logger || console
        };

        this.setOptions(options);

        _scope.logger.info(`Client ${this.getId()} started`);
        this.onTick(events.SERVER_STOP, this::_serverStopHandler);
        _private.set(this, _scope);
    }

    getServerActor() {
        return _private.get(this).server;
    }

    // ** returns a promise which resolves with server model after server replies to events.CLIENT_CONNECTED
    async connect(serverAddress) {
        try {
            let _scope = _private.get(this);
            super.connect(serverAddress);
            let {actorId, options} = await this.request(events.CLIENT_CONNECTED, {actorId: this.getId(), options: this.getOptions()});
            // ** creating server model and setting it online
            _scope.server = new ActorModel( {id: actorId, options: options, online: true, address: serverAddress});
            this::_startServerPinging();
            return {actorId, options}
        } catch (err) {
            this.emit('error', new Errors.ConnectionError({err, id: this.getId()}));
        }
    }

    async disconnect(options) {
        try {
            let _scope = _private.get(this);
            let disconnectData = {actorId: this.getId()};
            if (options) {
                disconnectData.options = options;
            }

            let serverId = await this.request(events.CLIENT_STOP, disconnectData);
            this::_stopServerPinging();
            super.disconnect();
            _scope.server = null;
            return serverId;
        } catch (err) {
            this.emit('error', new Errors.ConnectionError({err, id: this.getId(), state: 'disconnecting'}));
        }
    }

    async request (event, data, timeout) {
        let _scope = _private.get(this);

        // this is first request, and there is no need to check if server online or not
        if (event == events.CLIENT_CONNECTED) {
            return await super.request(event, data, timeout);
        }
        if (!_scope.server || !_scope.server.isOnline()) {
            return Promise.reject('server is Offline');
        }
        return await super.request(event, data, timeout, _scope.server.getId())
    }

    async tick (event, data) {
        let _scope = _private.get(this);
        if (!_scope.server || !_scope.server.isOnline()) {
            return Promise.reject('server is offline');
        }
        await super.tick(event, data, _scope.server.getId())
    }
}

function _startServerPinging(){
    let context = this;
    let _scope = _private.get(context);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }

    _scope.pingInterval = setInterval(async ()=> {
        let pingRequest = { actor: context.getId(), stamp : Date.now()};
        let pingResponse = 0;
        try {
            await context.request(events.CLIENT_PING, pingRequest);
        } catch (err) {
            pingResponse = 1
        }
        if(_scope.server) {
            _scope.server.ping(pingResponse);
            if (pingResponse) {
                context.emit(events.SERVER_FAILURE, _scope.server);
            }
        }
    } , globals.CLIENT_PING_INTERVAL);
}

function _stopServerPinging() {
    let _scope = _private.get(this);

    if(_scope.pingInterval) {
        clearInterval(_scope.pingInterval);
    }
}

function _serverStopHandler() {
    let _scope = _private.get(this);
    _scope.server.markStopped();
    this.emit(events.SERVER_STOP, _scope.server)
}