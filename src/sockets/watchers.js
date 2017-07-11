/**
 * Created by root on 7/11/17.
 */
import debugFactory from 'debug';
import _ from 'underscore'

let debug = debugFactory('node::sockets::watcher');

class WatcherData {
    constructor() {
        this._nodeSet = new Set();
        this._fnSet = new Set();
    }

    getFnSet() {
        debug(`getFnSet ${this._tag}`);
        return this._fnSet;
    }

    addFn(fn) {
        debug(`addFn ${this._tag}`);
        if(_.isFunction(fn)) {
            this._fnSet.add(fn);
        }
    }

    removeFn(fn){
        debug(`removeFn ${this._tag}`);
        if(_.isFunction(fn)) {
            this._fnSet.delete(fn);
            return;
        }

        this._fnSet = new Set();
    }
}

export class TickWatcher extends  WatcherData {
    constructor(event) {
        super();
        this._tag = event;
    }

    addTickListener(fn) {
        this.addFn(fn);
    }

    removeTickListener(fn){
        this.removeFn(fn);
    }
}

export class RequestWatcher extends  WatcherData{
    constructor(endpoint) {
        super();
        this._tag = endpoint;
    }

    addRequestListener(fn) {
        this.addFn(fn);
    }

    removeRequestListener(fn){
        this.removeFn(fn);
    }
}