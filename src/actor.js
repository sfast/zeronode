/**
 * Created by artak on 3/2/17.
 */

// ** ActorModel is a general model for describing both client and server nodes/actors


/**
 * ActorModel is a general model for describing both client and server nodes/actors
 * @param    {JSON}     data 
 * @property {Date}     id
 * @property {Boolean}  online 
 * @property {String}   address
 * @property {Object}   options
 * @property {Number}   pingStamp
 * @property {Boolean}  ghost
 * @property {Data}     fail
 * @property {Data}     stop
 */
export default class ActorModel {
  constructor (data = {}) {
    let { id, online = true, address, options } = data
    this.id = id

    this.online = false

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

  /**
   * This is for calling JSON.stringify or JSON.parse                   
   */
  toJSON () {
    return {
      id: this.id,
      address: this.address,
      options: this.options,  
      fail: this.fail,
      stop: this.stop,
      online: this.online,
      ghost: this.ghost
    }
  }
/**
 * Get the Id 
 */
  getId () {
    return this.id
  }
/**
 * this function is calling {@link setOffline()}
 */
  markStopped () {
    this.stop = Date.now()
    this.setOffline()
  }
/**
 * calling {@link setOffline()}
 */
  markFailed () {
    this.fail = Date.now()
    this.setOffline()
  }
/**
 * marking ghost means that there was some ping delay but that doeas not actually mean that its not there
 */

  // ** marking ghost means that there was some ping delay but that doeas not actually mean that its not there
  markGhost () {
    this.ghost = Date.now()
  }
/**
 * Checking the ghost
 * @returns {Boolean}
 */
  isGhost () {
    return !!this.ghost
  }
/**
 * Checking is online or no
 * @returns {Boolean}
 */
  isOnline () {
    return !!this.online
  }
/**
 * Setting Online 
 * @default 
 */
  setOnline () {
    this.online = Date.now()
    this.ghost = false
    this.fail = false
    this.stop = false
  }
/**
 * Setting Offline
 */
  setOffline () {
    this.online = false
  }
/**
 * 
 * @param {Data} stamp 
 */
  ping (stamp) {
    this.pingStamp = stamp
    this.setOnline()
  }
/**
 * Setting the newId 
 * @param {Number} newId 
 */
  setId (newId) {
    this.id = newId
  }
/**
 * Setting the address
 * @param {Boolean} address 
 */
  setAddress (address) {
    this.address = address
  }
/**
 * Getting the address
 * 
 * returns address
 */
  getAddress () {
    return this.address
  }
/**
 * Setting options 
 * @param {Object} options 
 */
  setOptions (options) {
    this.options = options
  }
/**
 * Merging the options 
 * 
 * returns the options
 * @param {Object} options 
 *  
 */
  mergeOptions (options) {
    this.options = Object.assign({}, this.options, options)
    return this.options
  }
/**
 * Gettig the options 
 */
  getOptions () {
    return this.options
  }
}
