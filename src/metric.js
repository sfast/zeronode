/**
 * Created by root on 7/12/17.
 */
import Loki from 'lokijs'
import _ from 'underscore'

let collections = {
  SEND_REQUEST: 'send_request',
  SEND_TICK: 'send_tick',
  GOT_REQUEST: 'got_request',
  GOT_TICK: 'got_tick',
}


function _createRequest (envelop) {
  return {
    id: envelop.id,
    event: envelop.tag,
    from: envelop.owner,
    to: envelop.recipient,
    size: envelop.size,
    timeout: false,
    duration: {
      latency: -1,
      process: -1
    },
    success: false,
    error: false,
  }
}

function _createTick (envelop) {
  return {
    id: envelop.id,
    event: envelop.tag,
    from: envelop.owner,
    to: envelop.recipient,
    size: envelop.size
  }
}

export default class Metric {
  constructor ({id}) {
    this.id = id
    this.loki = new Loki('metric.db')
    this.loki.addCollection(collections.SEND_REQUEST)
    this.loki.addCollection(collections.SEND_TICK)
    this.loki.addCollection(collections.GOT_REQUEST)
    this.loki.addCollection(collections.GOT_TICK)
  }

  sendRequest (envelop) {
    let collection = this.loki.getCollection(collections.SEND_REQUEST)
    let requestInstance = _createRequest(envelop)
    collection.insert(requestInstance)
  }

  gotRequest (envelop) {
    let collection = this.loki.getCollection(collections.GOT_REQUEST)
    let requestInstance = _createRequest(envelop)
    collection.insert(requestInstance)
  }

  sendReplySuccess (envelop) {
    let collection = this.loki.getCollection(collections.GOT_REQUEST)
    let request = collection.findOne({ id: envelop.id })

    if (!request) return

    request.success = true
    request.duration = envelop.data.duration

    collection.update(request)
  }

  sendReplyError (envelop) {
    let collection = this.loki.getCollection(collections.GOT_REQUEST)
    let request = collection.findOne({ id: envelop.id })

    if (!request) return

    request.error = true
    request.duration = envelop.data.duration

    collection.update(request)
  }

  gotReplySuccess (envelop) {
    let collection = this.loki.getCollection(collections.SEND_REQUEST)
    let request = collection.findOne({ id: envelop.id })

    if (!request) return

    request.success = true
    request.duration = envelop.data.duration

    collection.update(request)
  }

  gotReplyError (envelop) {
    let collection = this.loki.getCollection(collections.SEND_REQUEST)
    let request = collection.findOne({ id: envelop.id })

    if (!request) return

    request.error = true
    request.duration = envelop.data.duration
    collection.update(request)
  }

  sendTick (envelop) {
    let collection = this.loki.getCollection(collections.SEND_TICK)
    let tickInstance = _createTick(envelop)
    collection.insert(tickInstance)
  }

  gotTick (envelop) {
    let collection = this.loki.getCollection(collections.GOT_TICK)
    let tickInstance = _createTick(envelop)
    collection.insert(tickInstance)
  }

  requestTimeout (envelop) {
    let collection = this.loki.getCollection(collections.SEND_REQUEST)
    let request = collection.findOne({ id: envelop.id })

    if (!request) return

    request.timeout = true
    collection.update(request)
  }

  flush () {
    _.each(collections, (collectionName) => {
      let collection = this.loki.getCollection(collectionName)
      if (collection.count() > 1000) {
        collection.removeWhere(() => true)
      }
    })
  }
}
