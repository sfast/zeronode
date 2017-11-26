/**
 * Created by artak on 3/2/17.
 */

import zmq from 'zmq'

import  Socket from './socket'
import Envelop from './envelope'
import Enum from './enum'

let EnvelopType = Enum.EnvelopType;

let _private = new WeakMap();

export default class DealerSocket extends Socket {
    constructor({id, logger}) {
        let socket =  zmq.socket('dealer');
        super({id, socket, logger});

        let _scope = {};
        _scope.socket = socket;

        // ** monitoring connect / disconnect

        _scope.socket.on('disconnect', this::this.serverFailHandler);

        _scope.socket.monitor(Enum.MONITOR_TIMEOUT, 0);

        _scope.routerAddress = null;
        _private.set(this, _scope);
    }

    getAddress() {
        let _scope = _private.get(this);
        return _scope.routerAddress;
    }

    setAddress(routerAddress) {
        let _scope = _private.get(this);
        if (typeof routerAddress == 'string' && routerAddress.length) {
            _scope.routerAddress = routerAddress;
        }
    }

    // ** not actually connected
    connect(routerAddress, timeout = -1) {
        return new Promise((resolve, reject) => {
            let _scope = _private.get(this);
            let rejectionTimeout;

            if(this.isOnline()) {
                resolve(true);
                return;
            }

            if(routerAddress) {
                this.setAddress(routerAddress);
            }

            _scope.socket.removeAllListeners('connect');

            if (timeout != -1) {
                rejectionTimeout = setTimeout(() => {
                    _scope.socket.removeAllListeners('connect');
                    reject('connection timeouted');
                    this.disconnect();
                }, timeout);
            }

            _scope.socket.on('connect', () => {
                if (rejectionTimeout) {
                    clearTimeout(rejectionTimeout);
                }

                this.setOnline();

                _scope.socket.removeAllListeners('connect');
                _scope.socket.on('connect', this::this.handleReconnecting);

                resolve();
            });

            _scope.socket.connect(this.getAddress());

            this.setOnline();
        });
    }

    // ** not actually disconnected
    disconnect() {
        this.close();
    }

    //** Polymorfic Functions
    async request(event, data, timeout = 5000, to) {
        let envelop = new Envelop({type: EnvelopType.SYNC, tag : event, data : data , owner : this.getId(), recipient: to});
        return super.request(envelop, timeout);
    }

    async tick(event, data, to) {
        let envelop = new Envelop({type: EnvelopType.ASYNC, tag: event, data: data, owner: this.getId(), recipient: to});
        return super.tick(envelop);
    }

    close () {
        super.close();
        let _scope = _private.get(this);
        _scope.socket.disconnect(_scope.routerAddress);
        _scope.socket.removeAllListeners('conenct');
        this.setOffline();
    }

    getSocketMsg(envelop) {
        return  envelop.getBuffer();
    }
}