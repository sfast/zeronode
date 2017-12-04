/**
 * Created by avar on 7/11/17.
 */
import { isFunction } from 'underscore'

let index = 1

export default class Watchers {
  constructor (tag) {
    this._tag = tag
    this._fnMap = new Map()
  }

  getFnMap () {
    return this._fnMap
  }

  addFn (fn) {
    if (isFunction(fn)) {
      this._fnMap.set(fn, index)
      index++
    }
  }

  removeFn (fn) {
    if (isFunction(fn)) {
      this._fnMap.delete(fn)
      return
    }

    this._fnMap.clear()
  }
}
