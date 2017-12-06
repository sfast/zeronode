/**
 * Created by artak on 3/2/17.
 */

// ** ActorModel is a general model for describing both client and server nodes/actors

export default class ActorModel {
  constructor (data = {}) {
    let {id, online = true, address, options} = data
    this.id = id

    if (online) {
      this.setOnline()
    }

    this.address = address
    this.options = options || {}

    this.pingStamp = null
    this.ghost = false
    this.fail = false
    this.stop = false
  }

  toJSON () {
    return {
      id: this.id,
      address: this.address,
      options: this.options
    }
  }

  getId () {
    return this.id
  }

  markStopped () {
    this.stop = Date.now()
    this.setOffline()
  }

  markFailed () {
    this.fail = Date.now()
    this.setOffline()
  }

    // ** marking ghost means that there was some ping delay but that doeas not actually mean that its not there
  markGhost () {
    this.ghost = Date.now()
  }

  isGhost () {
    return !!this.ghost
  }

  isOnline () {
    return !!this.online
  }

  setOnline () {
    this.online = Date.now()
    this.ghost = false
    this.fail = false
    this.stop = false
  }

  setOffline () {
    this.online = false
  }

  ping (stamp) {
    this.pingStamp = stamp
    this.setOnline()
  }

  setId (newId) {
    this.id = newId
  }

  setAddress (address) {
    this.address = address
  }

  getAddress () {
    return this.address
  }

  setOptions (options) {
    this.options = options
  }

  mergeOptions (options) {
    this.options = Object.assign({}, this.options, options)
    return this.options
  }

  getOptions () {
    return this.options
  }
}
