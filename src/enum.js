/**
 * Created by artak on 2/15/17.
 */

export const events = {
  CLIENT_CONNECTED: 1,
  CLIENT_FAILURE: 2,
  CLIENT_STOP: 3,
  CLIENT_PING: 4,
  OPTIONS_SYNC: 5,
  SERVER_RECONNECT: 6,
  SERVER_FAILURE: 7,
  SERVER_STOP: 8,
  METRICS: 9,
  SERVER_RECONNECT_FAILURE: 10,
  CONNECT_TO_SERVER: 11
}

export const MetricCollections = {
  SEND_REQUEST: 'send_request',
  SEND_TICK: 'send_tick',
  GOT_REQUEST: 'got_request',
  GOT_TICK: 'got_tick',
  AGGREGATION: 'aggregation'
}
