/**
 * Created by avar on 7/11/17.
 */
import { isFunction } from 'underscore'

let index = 1
/**
 * @class Watchers 
 * @property {string} tag 
 * @property  {Map} _fnMap this property is private 
 */

export default class Watchers {
  constructor (tag) {
    this._tag = tag
    this._fnMap = new Map()
  }
/**
 * Returns new Map()
 */
  getFnMap () {
    return this._fnMap
  }
/**
 * 
 * @param {Function} fn 
 */
  addFn (fn) {
    if (isFunction(fn)) {
      this._fnMap.set(fn, index)
      index++
    }
  }
/**
 * 
 * @param {Function} fn 
 */
  removeFn (fn) {
    if (isFunction(fn)) {
      this._fnMap.delete(fn)
      return
    }

    this._fnMap.clear()
  }
}
