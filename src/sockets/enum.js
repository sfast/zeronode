/**
 * Created by artak on 2/15/17.
 */
/**
 * Envelop Type
 * @description
 * <pre>
 *  TICK: 1,
 REQUEST: 2,
 RESPONSE: 3,
 ERROR: 4
 </pre>
 */
let EnvelopType = {
  TICK: 1,
  REQUEST: 2,
  RESPONSE: 3,
  ERROR: 4
}
/**
 * Metric Type 
 * @description 
 * <pre>
 *SEND_TICK: 'sendTick'
  SEND_REQUEST: 'sendRequest'
  SEND_REPLY_SUCCESS: 'sendReplySuccess'
  SEND_REPLY_ERROR: 'sendReplyError'
  GOT_TICK: 'gotTick'
  GOT_REQUEST: 'gotRequest'
  GOT_REPLY_SUCCESS: 'gotReplySuccess'
  GOT_REPLY_ERROR: 'gotReplyError'
  REQUEST_TIMEOUT: 'requestTimeout'
 </pre>
  */
 
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
/**
 * The Timeout events 
 * @description
 * <pre>
   MONITOR_TIMEOUT: 10,
   MONITOR_RESTART_TIMEOUT: 1000,  //When monitor fails restart it after milliseconds
   REQUEST_TIMEOUT: 10000,
   CONNECTION_TIMEOUT: -1,
   RECONNECTION_TIMEOUT: -1,
   INFINITY: -1
  </pre>
 */
let Timeouts = {
  MONITOR_TIMEOUT: 10,
  // ** when monitor fials restart it after milliseconds
  MONITOR_RESTART_TIMEOUT: 1000,
  REQUEST_TIMEOUT: 10000,
  CONNECTION_TIMEOUT: -1,
  RECONNECTION_TIMEOUT: -1,
  INFINITY: -1
}
/**
 * Dealer State Type 
 * @description
 * <pre>
   CONNECTED: 'connected',
   DISCONNECTED: 'disconnected',
   RECONNECTING: 'reconnecting'
   </pre>
 */
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
