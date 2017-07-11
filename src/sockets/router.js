/**
 * Created by artak on 3/2/17.
 */

import debugFactory from 'debug';
let debug = debugFactory('node::sockets::router');

import zmq from 'zmq'
import Promise from 'bluebird'

import  Socket  from './socket'
import Envelop from './envelope'
import {EnvelopType} from './enum'

let _private = new WeakMap();

export default class RouterSocket extends Socket {
    constructor({id}) {
        let socket = zmq.socket('router');
        super({id, socket});

        let _scope = {};
        _scope.socket = socket;
        _scope.bindAddress = null;
        _private.set(this, _scope);
    }

    getAddress() {
        let _scope = _private.get(this);
        return _scope.bindAddress;
    }

    setAddress(bindAddress) {
        let _scope = _private.get(this);
        if (typeof bindAddress == 'string' && bindAddress.length) {
            _scope.bindAddress = bindAddress;
        }
    }

    //** binded promise returns status
    async bind(bindAddress) {
        let _scope = _private.get(this);

        if(this.isOnline()) {
            return true;
        }

        if(bindAddress) {
            this.setAddress(bindAddress);
        }

        return new Promise((resolve, reject) => {
            _scope.socket.bind(this.getAddress(), (err) => {
                if (err) {
                    debug(err);
                    return reject(err);
                }

                this.setOnline();
                resolve('router - is online');
            });
        });
    }

    // ** returns status
    unbind() {
        this.close();
    }

    close() {
        super.close();
        let _scope = _private.get(this);
        _scope.socket.unbindSync(_scope.bindAddress);
        _scope.bindAddress = null;
        this.setOffline();
    }

    //** Polymorfic Functions

    async request(to, event, data, timeout = 5000) {
        let envelop = new Envelop({type: EnvelopType.SYNC, tag : event, data : data , owner : this.getId(), recipient: to});
        return super.request(envelop, timeout);
    }

    async tick(to, event, data) {
        let envelop = new Envelop({type: EnvelopType.ASYNC, tag: event, data: data, owner : this.getId(), recipient: to});
        return super.tick(envelop);
    }

    getSocketMsg(envelop) {
        return [envelop.getRecipient(), '', envelop.getBuffer()];
    }
}