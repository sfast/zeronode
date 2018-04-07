/**
 * Created by dhar on 7/12/17.
 */

import Loki from 'lokijs'
import { MetricCollections } from './enum'

const truePredicate = () => true

const MetricUtils = {
  createRequest: (envelop) => {
    return {
      id: envelop.id,
      event: envelop.tag,
      from: envelop.owner,
      to: envelop.recipient,
      size: [envelop.size],
      timeout: false,
      duration: {
        latency: -1,
        process: -1
      },
      success: false,
      error: false
    }
  },
  createTick: (envelop) => {
    return {
      id: envelop.id,
      event: envelop.tag,
      from: envelop.owner,
      to: envelop.recipient,
      size: envelop.size
    }
  }
}

let _private = new WeakMap()

export default class Metric {
  constructor ({id} = {}) {
    let ZeronodeMetricDB = new Loki('zeronode.db')

    let _scope = {
      id,
      enabled: false,
      // ** loki collections
      sendRequestCollection: ZeronodeMetricDB.addCollection(MetricCollections.SEND_REQUEST, { indices: ['id'] }),
      gotRequestCollection: ZeronodeMetricDB.addCollection(MetricCollections.GOT_REQUEST, { indices: ['id'] }),
      sendTickCollection: ZeronodeMetricDB.addCollection(MetricCollections.SEND_TICK, { indices: ['id'] }),
      gotTickCollection: ZeronodeMetricDB.addCollection(MetricCollections.GOT_TICK, { indices: ['id'] }),
      flushInterval: null
    }
    _private.set(this, _scope)
    this.db = ZeronodeMetricDB
  }

  get status () {
    let { enabled } = _private.get(this)
    return enabled
  }

  enable (flushInterval) {
    let _scope = _private.get(this)
    _scope.enabled = true
    _scope.flushInterval = setInterval(() => {
      this.flush()
    }, flushInterval)
  }

  disable () {
    let _scope = _private.get(this)
    _scope.enabled = false
    if (_scope.flushInterval) {
      clearInterval(_scope.flushInterval)
      this.flush()
    }
  }

  // ** actions
  sendRequest (envelop) {
    let { sendRequestCollection, enabled } = _private.get(this)
    if (!enabled) return
    let requestInstance = MetricUtils.createRequest(envelop)
    sendRequestCollection.insert(requestInstance)
  }

  gotRequest (envelop) {
    let { gotRequestCollection, enabled } = _private.get(this)
    if (!enabled) return
    let requestInstance = MetricUtils.createRequest(envelop)
    gotRequestCollection.insert(requestInstance)
  }

  sendReplySuccess (envelop) {
    let { gotRequestCollection, enabled } = _private.get(this)
    if (!enabled) return
    let request = gotRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.success = true
    request.duration = envelop.data.duration

    gotRequestCollection.update(request)
  }

  sendReplyError (envelop) {
    let { gotRequestCollection, enabled } = _private.get(this)
    if (!enabled) return
    let request = gotRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.error = true
    request.duration = envelop.data.duration

    gotRequestCollection.update(request)
  }

  gotReplySuccess (envelop) {
    let { sendRequestCollection, enabled } = _private.get(this)
    if (!enabled) return
    let request = sendRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.success = true
    request.duration = envelop.data.duration
    request.size.push(envelop.size)
    sendRequestCollection.update(request)
  }

  gotReplyError (envelop) {
    let { sendRequestCollection, enabled } = _private.get(this)
    if (!enabled) return
    let request = sendRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.error = true
    request.duration = envelop.data.duration
    request.size.push(envelop.size)
    sendRequestCollection.update(request)
  }

  requestTimeout (envelop) {
    let { sendRequestCollection, enabled } = _private.get(this)
    if (!enabled) return
    let request = sendRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.timeout = true
    sendRequestCollection.update(request)
  }

  sendTick (envelop) {
    let { sendTickCollection, enabled } = _private.get(this)
    if (!enabled) return
    let tickInstance = MetricUtils.createTick(envelop)
    sendTickCollection.insert(tickInstance)
  }

  gotTick (envelop) {
    let { gotTickCollection, enabled } = _private.get(this)
    if (!enabled) return
    let tickInstance = MetricUtils.createTick(envelop)
    gotTickCollection.insert(tickInstance)
  }

  flush () {
    let { sendRequestCollection, sendTickCollection, gotRequestCollection, gotTickCollection } = _private.get(this)
    sendRequestCollection.removeWhere(truePredicate)
    sendTickCollection.removeWhere(truePredicate)
    gotRequestCollection.removeWhere(truePredicate)
    gotTickCollection.removeWhere(truePredicate)
  }
}
