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

let Timeouts = {
  MONITOR_TIMEOUT: 10,
  // ** when monitor fials restart it after milliseconds
  MONITOR_RESTART_TIMEOUT: 1000,
  RECONNECTION_TIMEOUT: -1,
  INFINITY: -1
}

let DealerStateType = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting'
}

export { EnvelopType }
export { MetricType }
export { Timeouts }
export { DealerStateType }

export default {
  EnvelopType,
  MetricType,
  Timeouts,
  DealerStateType
}
