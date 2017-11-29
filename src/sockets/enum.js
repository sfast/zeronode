/**
 * Created by artak on 2/15/17.
 */

let EnvelopType = {
  ASYNC: 1,
  SYNC: 2,
  RESPONSE: 3,
  PROXY: 4
}

let MetricType = {
  SEND_TICK: 'sendTick',
  SEND_REQUEST: 'sendRequest',
  GOT_TICK: 'gotTick',
  GOT_REQUEST: 'gotRequest',
  GOT_REPLY: 'gotReply',
  REQUEST_TIMEOUT: 'requestTimeout'
}

let DealerEvent = {
  RECONNECT: 'DEALER_RECONNECT',
  DISCONNECT: 'DEALER_DISCONNECT'
}

let Timeouts = {MONITOR_TIMEOUT: 10}

export { EnvelopType }
export { MetricType }
export { Timeouts }
export { DealerEvent }

export default {
  EnvelopType,
  MetricType,
  Timeouts,
  DealerEvent
}
