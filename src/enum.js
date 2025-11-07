/**
 * Created by artak on 2/15/17.
 */

// System events (protected with _system: prefix)
// These can ONLY be sent by Client/Server internally
export const events = {
  // Client system events
  CLIENT_CONNECTED: '_system:client_connected',
  CLIENT_STOP: '_system:client_stop',
  CLIENT_PING: '_system:client_ping',
  CLIENT_READY: 'client:ready',  // Application event (after handshake)
  CLIENT_JOINED: 'client:joined',  // Server event (peer discovered)
  CLIENT_GHOST: 'client:ghost',  // Server event (peer timeout)
  
  // Server system events  
  SERVER_STOP: '_system:server_stop',
  SERVER_READY: 'server:ready',
  SERVER_NOT_READY: 'server:not_ready',
  SERVER_CLOSED: 'server:closed',
  SERVER_DISCONNECTED: 'server:disconnected',
  SERVER_FAILED: 'server:failed',
  
  // Transport events (from Protocol)
  TRANSPORT_READY: 'transport:ready',
  
  // Legacy (keep for compatibility, but deprecated)
  CLIENT_FAILURE: 'client:failure',
  OPTIONS_SYNC: 'options:sync',
  SERVER_RECONNECT: 'server:reconnect',
  SERVER_FAILURE: 'server:failure',
  SERVER_RECONNECT_FAILURE: 'server:reconnect_failure',
  CONNECT_TO_SERVER: 'connect:to_server',
  METRICS: 'metrics'
}

export const MetricCollections = {
  SEND_REQUEST: 'send_request',
  SEND_TICK: 'send_tick',
  GOT_REQUEST: 'got_request',
  GOT_TICK: 'got_tick',
  AGGREGATION: 'aggregation'
}
