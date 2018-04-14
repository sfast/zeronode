/**
 * Created by dhar on 7/12/17.
 */

import Loki from 'lokijs'
import _ from 'underscore'
import { MetricCollections } from './enum'

const truePredicate = () => true
const finishedPredicate = (req) => {
  return req.success || req.error || req.timeout
}

const averageCalc = (a, n, b, m) => a * (n / (n + m)) + b * (m / (n + m))

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

const _updateAggregationTable = function () {
  let _scope = _private.get(this)

  let { aggregationTable, customColumns } = _scope
  // resetting timeout and count
  _scope.count = 0
  clearTimeout(_scope.flushTimeoutInstance)
  _scope.flushTimeoutInstance = setTimeout(this::_updateAggregationTable, _scope.flushTimeout)

  // getting requests and ticks
  let sendRequests = _scope.sendRequestCollection.where(finishedPredicate)
  let gotRequests = _scope.gotRequestCollection.where(finishedPredicate)
  let sendTicks = _scope.sendTickCollection.where(truePredicate)
  let gotTicks = _scope.gotTickCollection.where(truePredicate)

  // grouping by node and event
  sendRequests = _.groupBy(sendRequests, (request) => `${request.to}${request.event}`)
  gotRequests = _.groupBy(gotRequests, (request) => `${request.from}${request.event}`)
  sendTicks = _.groupBy(sendTicks, (tick) => `${tick.to}${tick.event}`)
  gotTicks = _.groupBy(gotTicks, (tick) => `${tick.from}${tick.event}`)

  // updating row in aggregation table
  const updateRequestRow = (node, event, groupedRequests, out = false) => {
    let row = aggregationTable.findOne({ node, event, out, request: true })

    if (!row) {
      row = {
        node,
        event,
        out,
        request: true,
        latency: 0,
        process: 0,
        count: 0,
        success: 0,
        error: 0,
        timeout: 0,
        size: 0
      }
      _.each(customColumns, ({initialValue}, columnName) => {
        row[columnName] = initialValue
      })
      row = aggregationTable.insert(row)
    }

    let latencySum = 0
    let processSum = 0
    let sizeSum = 0
    let allCount = row.count
    let initialCount = row.count - row.timeout

    _.each(groupedRequests, (request) => {
      row.count++
      row.success += request.success
      row.error += request.error
      row.timeout += request.timeout
      latencySum += request.duration.latency
      processSum += request.duration.process
      sizeSum += request.size[0] + request.size[1]
      _.each(customColumns, ({reducer}, columnName) => {
        row[columnName] = reducer(row, request)
      })
    })

    row.latency = averageCalc(row.latency, initialCount, latencySum / (row.count - initialCount - row.timeout), row.count - initialCount - row.timeout)
    row.process = averageCalc(row.process, initialCount, processSum / (row.count - initialCount - row.timeout), row.count - initialCount - row.timeout)
    row.size = averageCalc(row.size, allCount, sizeSum / (row.count - allCount), row.count - allCount)

    aggregationTable.update(row)
  }

  // updating row in aggregation table
  const updateTickRow = (node, event, groupedTicks, out = false) => {
    let row = aggregationTable.find({ node, event, out, request: false })
    if (!row) {
      row = {
        node,
        event,
        out,
        request: false,
        count: 0,
        size: 0
      }
      _.each(customColumns, ({initialValue}, columnName) => {
        row[columnName] = initialValue
      })
      row = aggregationTable.insert(row)
    }

    let sizeSum = 0
    let initialCount = row.count

    _.each(groupedTicks, (request) => {
      row.count++
      sizeSum += request.size
      _.each(customColumns, ({reducer}, columnName) => {
        row[columnName] = reducer(row, request)
      })
    })

    row.size = averageCalc(row.size, initialCount, sizeSum / groupedTicks.length, groupedTicks.length)

    aggregationTable.update(row)
  }

  _.each(sendRequests, (groupedRequests) => {
    updateRequestRow(groupedRequests[0].to, groupedRequests[0].event, groupedRequests, true)
  })
  _.each(gotRequests, (groupedRequests) => {
    updateRequestRow(groupedRequests[0].from, groupedRequests[0].event, groupedRequests)
  })
  _.each(sendTicks, (groupedTicks) => {
    updateTickRow(groupedTicks[0].from, groupedTicks[0].event, groupedTicks, true)
  })
  _.each(gotTicks, (groupedTicks) => {
    updateTickRow(groupedTicks[0].from, groupedTicks[0].event, groupedTicks)
  })

  this.flush()
}

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
      aggregationTable: ZeronodeMetricDB.addCollection(MetricCollections.AGGREGATION, { indices: ['node', 'event'] }),
      flushTimeoutInstance: null,
      flushTimeout: 30 * 1000,
      customColumns: {},
      count: 0
    }
    _private.set(this, _scope)
    this.db = ZeronodeMetricDB
  }

  get status () {
    let { enabled } = _private.get(this)
    return enabled
  }

  getMetrics (query = {}) {
    let { aggregationTable } = _private.get(this)
    if (!this.status) return
    let result = aggregationTable.find(query)

    let total = {
      count: 0,
      latency: 0,
      process: 0,
      out: 0,
      in: 0,
      request: 0,
      tick: 0,
      error: 0,
      success: 0,
      timeout: 0,
      size: 0
    }

    // calculating total
    total = _.reduce(result, (memo, row) => {
      let initialCount = memo.count
      let initialOut = memo.out
      let initialTimeout = memo.timeout
      memo.count += row.count
      row.out ? memo.out += row.count : memo.in += row.count
      row.request ? memo.request += row.count : memo.tick += row.count

      if (row.request) {
        memo.error += row.error
        memo.success += row.success
        memo.timeout += row.timeout

        if (row.out) {
          memo.latency = averageCalc(memo.latency, initialOut - initialTimeout, row.latency, row.count - row.timeout)
          memo.process = averageCalc(memo.process, initialOut - initialTimeout, row.process, row.count - row.timeout)
        }
      }

      memo.size = averageCalc(memo.size, initialCount, row.size, row.count)
      return memo
    }, total)

    return { result, total }
  }

  defineColumn (columnName, initialValue, reducer, isIndex = false) {
    let { aggregationTable, customColumns } = _private.get(this)
    if (this.status) throw new Error(`Can't define column after metrics enabled`)
    if (isIndex) {
      aggregationTable.ensureIndex(columnName)
    }

    customColumns[columnName] = { initialValue, reducer, isIndex }
  }

  enable (flushTimeout) {
    let _scope = _private.get(this)
    _scope.enabled = true
    _scope.flushTimeout = flushTimeout || _scope.flushTimeout
    _scope.flushTimeoutInstance = setTimeout(this::_updateAggregationTable, _scope.flushTimeout)
  }

  disable () {
    let _scope = _private.get(this)
    _scope.enabled = false
    clearTimeout(_scope.flushTimeoutInstance)
    this::_updateAggregationTable()
    _scope.count = 0
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
    let _scope = _private.get(this)
    let { gotRequestCollection, enabled } = _scope
    if (!enabled) return
    let request = gotRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.success = true
    request.size.push(envelop.size)

    gotRequestCollection.update(request)

    if (++_scope.count === 1000) {
      this::_updateAggregationTable()
    }
  }

  sendReplyError (envelop) {
    let _scope = _private.get(this)
    let { gotRequestCollection, enabled } = _scope
    if (!enabled) return
    let request = gotRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.error = true
    request.size.push(envelop.size)

    gotRequestCollection.update(request)

    if (++_scope.count === 1000) {
      this::_updateAggregationTable()
    }
  }

  gotReplySuccess (envelop) {
    let _scope = _private.get(this)
    let { sendRequestCollection, enabled } = _scope
    if (!enabled) return
    let request = sendRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.success = true
    request.duration = envelop.data.duration
    request.size.push(envelop.size)
    sendRequestCollection.update(request)

    if (++_scope.count === 1000) {
      this::_updateAggregationTable()
    }
  }

  gotReplyError (envelop) {
    let _scope = _private.get(this)
    let { sendRequestCollection, enabled } = _scope
    if (!enabled) return
    let request = sendRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.error = true
    request.duration = envelop.data.duration
    request.size.push(envelop.size)
    sendRequestCollection.update(request)
  }

  requestTimeout (envelop) {
    let _scope = _private.get(this)
    let { sendRequestCollection, enabled } = _scope
    if (!enabled) return
    let request = sendRequestCollection.findOne({ id: envelop.id })

    if (!request) return

    request.timeout = true
    sendRequestCollection.update(request)

    if (++_scope.count === 1000) {
      this::_updateAggregationTable()
    }
  }

  sendTick (envelop) {
    let _scope = _private.get(this)
    let { sendTickCollection, enabled } = _scope
    if (!enabled) return
    let tickInstance = MetricUtils.createTick(envelop)
    sendTickCollection.insert(tickInstance)

    if (++_scope.count === 1000) {
      this::_updateAggregationTable()
    }
  }

  gotTick (envelop) {
    let _scope = _private.get(this)
    let { gotTickCollection, enabled } = _scope
    if (!enabled) return
    let tickInstance = MetricUtils.createTick(envelop)
    gotTickCollection.insert(tickInstance)

    if (++_scope.count === 1000) {
      this::_updateAggregationTable()
    }
  }

  flush () {
    let _scope = _private.get(this)
    let { sendRequestCollection, sendTickCollection, gotRequestCollection, gotTickCollection } = _scope
    sendRequestCollection.removeWhere(finishedPredicate)
    sendTickCollection.removeWhere(finishedPredicate)
    gotRequestCollection.removeWhere(truePredicate)
    gotTickCollection.removeWhere(truePredicate)
    _scope.count = 0
  }
}
