/**
 * Created by avar on 7/11/17.
 */
import _ from 'underscore'

class WatcherData {
  constructor (tag) {
    this._tag = tag
    this._fnSet = new Set()
  }

  getFnSet () {
    return this._fnSet
  }

  addFn (fn) {
    if (_.isFunction(fn)) {
      this._fnSet.add(fn)
    }
  }

  removeFn (fn) {
    if (_.isFunction(fn)) {
      this._fnSet.delete(fn)
      return
    }

    this._fnSet.clear()
  }
}

export class TickWatcher extends WatcherData {
  addTickListener (fn) {
    this.addFn(fn)
  }

  removeTickListener (fn) {
    this.removeFn(fn)
  }
}

export class RequestWatcher extends WatcherData {
  addRequestListener (fn) {
    this.addFn(fn)
  }

  removeRequestListener (fn) {
    this.removeFn(fn)
  }
}
