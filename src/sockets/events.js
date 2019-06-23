/**
 * Here are some events example that we use in code 
 * <pre>  CONNECT: 'zmq::socket::connect' 
  RECONNECT: 'zmq::socket::reconnect',
  RECONNECT_FAILURE: 'zmq::socket:reconnect-failure',
  DISCONNECT: 'zmq::socket::disconnect',
  CONNECT_DELAY: 'zmq::socket::connect-delay',
  CONNECT_RETRY: 'zmq::socket::connect-retry',
  LISTEN: 'zmq::socket::listen',
  BIND_ERROR: 'zmq::socket::bind-error',
  ACCEPT: 'zmq::socket::accept',
  ACCEPT_ERROR: 'zmq::socket::accept-error',
  CLOSE: 'zmq::socket::close',
  CLOSE_ERROR: 'zmq::socket::close-error'
  </pre>
 */

const SocketEvent = {
  CONNECT: 'zmq::socket::connect',
  RECONNECT: 'zmq::socket::reconnect',
  RECONNECT_FAILURE: 'zmq::socket:reconnect-failure',
  DISCONNECT: 'zmq::socket::disconnect',
  CONNECT_DELAY: 'zmq::socket::connect-delay',
  CONNECT_RETRY: 'zmq::socket::connect-retry',
  LISTEN: 'zmq::socket::listen',
  BIND_ERROR: 'zmq::socket::bind-error',
  ACCEPT: 'zmq::socket::accept',
  ACCEPT_ERROR: 'zmq::socket::accept-error',
  CLOSE: 'zmq::socket::close',
  CLOSE_ERROR: 'zmq::socket::close-error'
}

export default SocketEvent
