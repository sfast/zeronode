/**
 * Created by dave on 7/11/17.
 */

const ErrorCodes = {
  ALREADY_BINDED: 1,
  SOCKET_ISNOT_ONLINE: 2,
  NO_NEXT_HANDLER_AVAILABLE: 3,
  REQUEST_TIMEOUTED: 4,
  ALREADY_CONNECTED: 5,
  CONNECTION_TIMEOUT: 6,
  SERVER_UNBIND: 7,
  SERVER_ACTOR_NOT_AVAILABLE: 8,
  SERVER_STOP_HANDLER: 9,
  SERVER_OPTIONS_SYNC_HANDLER: 10,
  SERVER_PING_ERROR: 11,
  CLIENT_OPTIONS_SYNC_HANDLER: 12,
  SERVER_RECONNECT_HANDLER: 13,
  NODE_NOT_FOUND: 14,
  CLIENT_DISCONNECT: 15,
  CLIENT_CONNECT: 16,
  SERVER_IS_OFFLINE: 17
}

class ZeronodeError extends Error {
  constructor ({socketId, envelopId, code, error, message, description} = {}) {
    error = error || {}
    message = message || error.message
    description = description || message
    super(message)
    this.socketId = socketId
    this.code = code
    this.envelopId = envelopId
    this.error = error
    this.description = description
  }
}

export { ZeronodeError }
export { ErrorCodes }

export default {
  ErrorCodes,
  ZeronodeError
}
