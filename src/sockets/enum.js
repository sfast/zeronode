/**
 * Created by artak on 2/15/17.
 */

let EnvelopType = {
  TICK: 1,
  REQUEST: 2,
  RESPONSE: 3,
  ERROR: 4
}

let MetricType = {
  SEND_TICK: 'sendTick',
  SEND_REQUEST: 'sendRequest',
  SEND_REPLY_SUCCESS: 'sendReplySuccess',
  SEND_REPLY_ERROR: 'sendReplyError',
  GOT_TICK: 'gotTick',
  GOT_REQUEST: 'gotRequest',
  GOT_REPLY_SUCCESS: 'gotReplySuccess',
  GOT_REPLY_ERROR: 'gotReplyError',
  REQUEST_TIMEOUT: 'requestTimeout'
}

let Timeouts = {
  MONITOR_TIMEOUT: 10,
  // ** when monitor fials restart it after milliseconds
  MONITOR_RESTART_TIMEOUT: 1000,
  REQUEST_TIMEOUT: 10000,
  CONNECTION_TIMEOUT: -1,
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
