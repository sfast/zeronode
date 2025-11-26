/**
 * ZeroNode - Minimal building block for NodeJS microservices
 * Public API exports
 */

// Core classes
import Node from './node.js'
import { NodeEvent } from './node.js'
import { NodeError, NodeErrorCode, assertValidAddress } from './node-errors.js'

// Protocol layer
import Server from './protocol/server.js'
import { ServerEvent } from './protocol/server.js'
import Client from './protocol/client.js'
import { ClientEvent } from './protocol/client.js'
import { ProtocolEvent, ProtocolSystemEvent } from './protocol/protocol.js'
import { ProtocolError, ProtocolErrorCode } from './protocol/protocol-errors.js'

// Transport layer
import { Transport } from './transport/index.js'
import { TransportEvent } from './transport/events.js'
import { TransportError, TransportErrorCode } from './transport/errors.js'

// Utils
import utils from './utils.js'
const { optionsPredicateBuilder } = utils

// ============================================================================
// PUBLIC API EXPORTS
// ============================================================================

export {
  // Core
  Node,
  Server,
  Client,
  
  // Events (by layer)
  NodeEvent,           // Orchestration layer events
  ServerEvent,         // Server protocol events
  ClientEvent,         // Client protocol events
  ProtocolEvent,       // Protocol transport state events
  ProtocolSystemEvent, // Internal protocol messages
  TransportEvent,      // Transport layer events
  
  // Errors (by layer)
  NodeError,
  NodeErrorCode,
  assertValidAddress,
  ProtocolError,
  ProtocolErrorCode,
  TransportError,
  TransportErrorCode,
  
  // Transport abstraction
  Transport,           // Transport factory and registry
  
  // Utils
  optionsPredicateBuilder
}

export default Node
