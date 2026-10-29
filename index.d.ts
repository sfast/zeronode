// Type definitions for ZeroNode
// Project: https://github.com/sfast/zeronode
// Definitions by: ZeroNode Team

/// <reference types="node" />

import { EventEmitter } from 'events';

// ============================================================================
// Core Types
// ============================================================================

/**
 * Node configuration options
 */
export interface NodeConfig {
  /** Global request timeout in milliseconds (default: 10000) */
  PROTOCOL_REQUEST_TIMEOUT?: number;
  
  /**
   * Envelope buffer allocation: null (exact, the default) or 'power-of-2'
   * (BufferStrategy.EXACT / BufferStrategy.POWER_OF_2)
   */
  BUFFER_STRATEGY?: null | 'power-of-2';
  
  /**
   * @deprecated Never read: the key that is read is BUFFER_STRATEGY
   */
  PROTOCOL_BUFFER_STRATEGY?: null | 'power-of-2';
  
  /**
   * Client ping interval in milliseconds (default: 10000). A server not given
   * CLIENT_GHOST_TIMEOUT assumes its clients ping at its own PING_INTERVAL.
   */
  PING_INTERVAL?: number;
  
  /**
   * @deprecated Never read: the ping interval is PING_INTERVAL
   */
  CLIENT_PING_INTERVAL?: number;
  
  /** Server health check interval in milliseconds (default: 5000) */
  CLIENT_HEALTH_CHECK_INTERVAL?: number;
  
  /** Client ghost timeout in milliseconds (default: 3 × PING_INTERVAL = 30000) */
  CLIENT_GHOST_TIMEOUT?: number;
  
  /** Enable debug logging (default: false) */
  DEBUG?: boolean;
  
  /** Custom logger instance */
  logger?: any;
  
  /** ZeroMQ (dealer) reconnect interval in ms: ZMQ_RECONNECT_IVL (default: 100) */
  ZMQ_RECONNECT_IVL?: number;
  
  /**
   * ZeroMQ (dealer) maximum reconnect interval in ms: ZMQ_RECONNECT_IVL_MAX.
   * 0 (the default) = no backoff, retry every ZMQ_RECONNECT_IVL; greater than
   * it = the interval doubles on each attempt up to this value
   */
  ZMQ_RECONNECT_IVL_MAX?: number;
  
  /** ms unsent messages linger after close: ZMQ_LINGER (default: 0) */
  ZMQ_LINGER?: number;
  
  /** Max queued outgoing messages per peer: ZMQ_SNDHWM (default: 10000) */
  ZMQ_SNDHWM?: number;
  
  /** Max queued incoming messages: ZMQ_RCVHWM (default: 10000) */
  ZMQ_RCVHWM?: number;
  
  /** Send timeout in ms: ZMQ_SNDTIMEO (router default: 0; dealer: ZeroMQ default) */
  ZMQ_SNDTIMEO?: number;
  
  /** Receive timeout in ms: ZMQ_RCVTIMEO (default: ZeroMQ default) */
  ZMQ_RCVTIMEO?: number;
  
  /** Router: a send to an unknown peer fails (EHOSTUNREACH): ZMQ_ROUTER_MANDATORY (default: true) */
  ZMQ_ROUTER_MANDATORY?: boolean;
  
  /** Router: a new connection with a connected id takes it over: ZMQ_ROUTER_HANDOVER (default: true) */
  ZMQ_ROUTER_HANDOVER?: boolean;
  
  /** ZeroMQ I/O threads for client sockets (default: 1) */
  DEALER_IO_THREADS?: number;
  
  /** ZeroMQ I/O threads for server sockets (default: 2) */
  ROUTER_IO_THREADS?: number;
  
  /**
   * @deprecated Never read (has no effect): the reconnect interval is ZMQ_RECONNECT_IVL
   */
  reconnectInterval?: number;
  
  /**
   * @deprecated Never read (has no effect): the maximum reconnect interval is ZMQ_RECONNECT_IVL_MAX
   */
  reconnectMaxInterval?: number;
  
  /**
   * @deprecated Never read (has no effect): ZMTP heartbeats are not configured by zeronode
   */
  heartbeatInterval?: number;
  
  /**
   * @deprecated Never read (has no effect): ZMTP heartbeats are not configured by zeronode
   */
  heartbeatTimeout?: number;
  
  /**
   * @deprecated Never read (has no effect): ZMTP heartbeats are not configured by zeronode
   */
  heartbeatTtl?: number;
}

/**
 * Node constructor options
 */
export interface NodeOptions {
  /** Unique node identifier (auto-generated if not provided) */
  id?: string;
  
  /** Initial bind address (optional, can bind later) */
  bind?: string;
  
  /** Node metadata for routing and service discovery */
  options?: Record<string, any>;
  
  /** Node configuration */
  config?: NodeConfig;
}

/**
 * Request options
 */
export interface RequestOptions {
  /** Target node ID */
  to: string;
  
  /** Event name */
  event: string;
  
  /** Request payload */
  data?: any;
  
  /** Request timeout in milliseconds (overrides global timeout) */
  timeout?: number;
}

/**
 * Tick (fire-and-forget) options
 */
export interface TickOptions {
  /** Target node ID */
  to: string;
  
  /** Event name */
  event: string;
  
  /** Message payload */
  data?: any;
  
  /** Metadata (delivered to the handler as envelope.metadata) */
  metadata?: Record<string, any>;
}

/**
 * Request with filter options
 */
export interface RequestAnyOptions {
  /** Event name */
  event: string;
  
  /** Request payload */
  data?: any;
  
  /** Request timeout in milliseconds */
  timeout?: number;
  
  /** Filter object or predicate for node selection */
  filter?: Record<string, any> | { predicate: (options: Record<string, any>) => boolean };
  
  /** Search downstream nodes (default: true) */
  down?: boolean;
  
  /** Search upstream nodes (default: true) */
  up?: boolean;
}

/**
 * Tick with filter options
 */
export interface TickAnyOptions {
  /** Event name */
  event: string;
  
  /** Message payload */
  data?: any;
  
  /** Filter object or predicate for node selection */
  filter?: Record<string, any> | { predicate: (options: Record<string, any>) => boolean };
  
  /** Search downstream nodes (default: true) */
  down?: boolean;
  
  /** Search upstream nodes (default: true) */
  up?: boolean;
}

/**
 * Connection options
 */
export interface ConnectOptions {
  /** Server address to connect to (e.g., 'tcp://127.0.0.1:3000') */
  address: string;
  
  /** Connection timeout in milliseconds (optional) */
  timeout?: number;
  
  /**
   * @deprecated Has no effect since 2.0 (ZeroMQ reconnects without giving up);
   * connect() logs a warning once when it is given
   */
  reconnectionTimeout?: number;
}

/**
 * Envelope object passed to handlers
 */
export interface Envelope {
  /** Envelope unique ID (BigInt) */
  readonly id: bigint;
  
  /** Envelope type: 1=TICK, 2=REQUEST, 3=RESPONSE, 4=ERROR */
  readonly type: number;
  
  /** Unix timestamp in seconds */
  readonly timestamp: number;
  
  /** Sender node ID (original requester) */
  readonly owner: string;
  
  /** Recipient node ID */
  readonly recipient: string;
  
  /** Event name */
  readonly event: string;
  
  /** Parsed message data (read-only) */
  readonly data: any;
}

/**
 * Reply function for request handlers
 */
export interface ReplyFunction {
  /** Send successful response */
  (data: any): void;
  
  /** Send error response */
  error(error: any): void;
}

/**
 * Next function for middleware
 */
export interface NextFunction {
  /** Continue to next handler */
  (): void;
  
  /** Pass error to error handlers */
  (error: Error): void;
}

/**
 * Request handler signatures
 */
export type RequestHandler =
  | ((envelope: Envelope, reply: ReplyFunction) => void | Promise<void | any>)
  | ((envelope: Envelope, reply: ReplyFunction, next: NextFunction) => void | Promise<void>)
  | ((error: Error, envelope: Envelope, reply: ReplyFunction, next: NextFunction) => void | Promise<void>);

/**
 * Tick handler signature
 */
export type TickHandler = (envelope: Envelope) => void | Promise<void>;

// ============================================================================
// Events
// ============================================================================

/**
 * Node-level events
 */
export enum NodeEvent {
  /** Peer joined the network */
  PEER_JOINED = 'node:peer_joined',
  
  /** Peer left the network */
  PEER_LEFT = 'node:peer_left',
  
  /** A joined peer changed its options (setOptions) */
  PEER_UPDATED = 'node:peer_updated',
  
  /** Node stopped */
  STOPPED = 'node:stopped',
  
  /** Node error */
  ERROR = 'node:error'
}

/**
 * Client-level events
 */
export enum ClientEvent {
  /** Transport ready (can send/receive bytes) */
  READY = 'client:ready',
  
  /** Transport reported NOT_READY (lost connection, may recover) */
  NOT_READY = 'client:not_ready',
  
  /** Transport permanently closed */
  CLOSED = 'client:closed',
  
  /** Server joined (handshake complete, session established) */
  SERVER_JOINED = 'client:server_joined',
  
  /** Server left (shutdown, disconnect, timeout) */
  SERVER_LEFT = 'client:server_left',
  
  /** Joined server changed its options */
  SERVER_OPTIONS_UPDATED = 'client:server_options_updated',
  
  /** Client error */
  ERROR = 'client:error'
}

/**
 * Server-level events
 */
export enum ServerEvent {
  /** Server ready to accept clients */
  READY = 'server:ready',
  
  /** Server not ready */
  NOT_READY = 'server:not_ready',
  
  /** Server closed */
  CLOSED = 'server:closed',
  
  /** Client joined */
  CLIENT_JOINED = 'server:client_joined',
  
  /** Client left */
  CLIENT_LEFT = 'server:client_left',
  
  /** Joined client changed its options */
  CLIENT_OPTIONS_UPDATED = 'server:client_options_updated',
  
  /** Server error (protocol/transport failure, e.g. a failing tick handler) */
  ERROR = 'server:error'
}

/**
 * Transport-level events
 */
export enum TransportEvent {
  /** Transport ready: { address } on a ZeroMQ dealer (the endpoint connected to) */
  READY = 'transport:ready',
  
  /** Transport not ready: { address } on a ZeroMQ dealer; once per explicit disconnect */
  NOT_READY = 'transport:not_ready',
  
  /** Message received */
  MESSAGE = 'transport:message',
  
  /** Transport error */
  ERROR = 'transport:error',
  
  /** An asynchronous send failed: { recipient?, error } (error.code e.g. EHOSTUNREACH, EAGAIN) */
  SEND_FAILED = 'transport:send_failed',
  
  /** A ZeroMQ dealer is retrying its connection: { address, interval } (interval in ms) */
  RECONNECT_RETRY = 'transport:reconnect_retry',
  
  /** Transport closed */
  CLOSED = 'transport:closed'
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Node error codes
 */
export enum NodeErrorCode {
  /** Node not found */
  NODE_NOT_FOUND = 'NODE_NOT_FOUND',
  
  /** No nodes match filter */
  NO_NODES_MATCH_FILTER = 'NO_NODES_MATCH_FILTER',
  
  /** Invalid address */
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  
  /** connect() was cancelled by disconnect()/close() before the handshake completed */
  CONNECT_CANCELLED = 'CONNECT_CANCELLED',
  
  /** Predicate filters cannot be forwarded to a router */
  PREDICATE_NOT_ROUTABLE = 'PREDICATE_NOT_ROUTABLE',
  
  /** Router proxy path reached the hop limit */
  PROXY_HOP_LIMIT = 'PROXY_HOP_LIMIT',
  
  /** No time budget left to forward a proxy request */
  PROXY_DEADLINE_EXCEEDED = 'PROXY_DEADLINE_EXCEEDED'
}

/**
 * Node error class
 */
export class NodeError extends Error {
  code: NodeErrorCode;
  nodeId?: string;
  cause?: Error;
  context?: any;
  
  constructor(options: {
    code: NodeErrorCode;
    message: string;
    nodeId?: string;
    cause?: Error;
    context?: any;
  });
  
  toJSON(): any;
}

/**
 * Assert that address is valid
 * @throws {NodeError} If address is invalid
 */
export function assertValidAddress(address: string): void;

/**
 * Protocol error codes
 */
export enum ProtocolErrorCode {
  /** Protocol not ready */
  NOT_READY = 'PROTOCOL_NOT_READY',
  
  /** Request timeout */
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  
  /** Invalid envelope */
  INVALID_ENVELOPE = 'INVALID_ENVELOPE',
  
  /** Invalid response */
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  
  /** Invalid event */
  INVALID_EVENT = 'INVALID_EVENT',
  
  /** Handler error */
  HANDLER_ERROR = 'HANDLER_ERROR',
  
  /** Peer is gone (no route to it, or the server stayed unreachable past the reconnect grace) */
  PEER_UNREACHABLE = 'PEER_UNREACHABLE',
  
  /** Peer left (stop, timeout, replaced) while the request was pending */
  PEER_LEFT = 'PEER_LEFT',
  
  /** Message could not be sent (e.g. the peer's queue is full) */
  SEND_FAILED = 'SEND_FAILED'
}

/**
 * Context of a ProtocolError rejecting a request
 */
export interface ProtocolErrorContext {
  /**
   * Whether a failed request reached the peer: `false` — the transport refused
   * it, no handler ran (safe to send elsewhere); `'unknown'` — it may have been
   * delivered (peer left, reconnect grace expired). Absent on other errors.
   */
  delivered?: false | 'unknown';
  [key: string]: any;
}

/**
 * Protocol error class
 */
export class ProtocolError extends Error {
  code: ProtocolErrorCode;
  protocolId?: string;
  envelopeId?: bigint;
  cause?: Error;
  context?: ProtocolErrorContext;
  
  constructor(options: {
    code: ProtocolErrorCode;
    message: string;
    protocolId?: string;
    envelopeId?: bigint;
    cause?: Error;
    context?: any;
  });
  
  toJSON(): any;
}

/**
 * Transport error codes
 */
export enum TransportErrorCode {
  /** Already connected */
  ALREADY_CONNECTED = 'TRANSPORT_ALREADY_CONNECTED',
  
  /** Bind failed */
  BIND_FAILED = 'TRANSPORT_BIND_FAILED',
  
  /** Already bound */
  ALREADY_BOUND = 'TRANSPORT_ALREADY_BOUND',
  
  /** Unbind failed */
  UNBIND_FAILED = 'TRANSPORT_UNBIND_FAILED',
  
  /** Send failed */
  SEND_FAILED = 'TRANSPORT_SEND_FAILED',
  
  /** Receive failed */
  RECEIVE_FAILED = 'TRANSPORT_RECEIVE_FAILED',
  MESSAGE_HANDLER_FAILED = 'TRANSPORT_MESSAGE_HANDLER_FAILED',
  
  /** Invalid address */
  INVALID_ADDRESS = 'TRANSPORT_INVALID_ADDRESS',
  
  /** Close failed */
  CLOSE_FAILED = 'TRANSPORT_CLOSE_FAILED'
}

/**
 * Transport error class
 */
export class TransportError extends Error {
  code: TransportErrorCode;
  transportId?: string;
  address?: string;
  cause?: Error;
  context?: any;
  
  constructor(options: {
    code: TransportErrorCode;
    message: string;
    transportId?: string;
    address?: string;
    cause?: Error;
    context?: any;
  });
  
  toJSON(): any;
  isCode(code: string): boolean;
  isConnectionError(): boolean;
  isBindError(): boolean;
  isSendError(): boolean;
}

// ============================================================================
// Event Payloads
// ============================================================================

export interface PeerJoinedPayload {
  peerId: string;
  peerOptions: Record<string, any>;
  direction: 'upstream' | 'downstream';
}

/**
 * What a PEER_LEFT was observed as. It names the signal that arrived first,
 * not a proven cause (a server's stop message and the dropped link race).
 */
export enum PeerLeftCategory {
  /** The peer said it stops (reason 'server_left', 'CLIENT_STOP') */
  GRACEFUL = 'graceful',
  /** The link or the peer went away ('TRANSPORT_NOT_READY', 'TRANSPORT_FAILED', 'TIMEOUT', 'UNREACHABLE') */
  LOST = 'lost',
  /** Another session took its place ('replaced' upstream, 'REPLACED' downstream) */
  REPLACED = 'replaced',
  /** This node ended it (disconnect(), close(), unbind(): 'TRANSPORT_NOT_READY', 'closed', 'UNBOUND') */
  LOCAL = 'local'
}

/**
 * Emitted once per session that ends, per direction (only for a joined peer)
 */
export interface PeerLeftPayload {
  peerId: string;
  direction: 'upstream' | 'downstream';
  /**
   * Raw signal. Upstream: 'server_left', 'TRANSPORT_NOT_READY', 'TRANSPORT_FAILED',
   * 'closed', 'replaced'. Downstream: 'CLIENT_STOP', 'TIMEOUT', 'UNREACHABLE',
   * 'REPLACED', 'UNBOUND'.
   */
  reason?: string;
  category: 'graceful' | 'lost' | 'replaced' | 'local';
}

export interface PeerUpdatedPayload {
  peerId: string;
  peerOptions: Record<string, any>;
  direction: 'upstream' | 'downstream';
}

export interface NodeErrorPayload {
  source?: string;
  stage?: string;
  address?: string;
  serverId?: string;
  category?: string;
  code?: string;
  message?: string;
  error?: Error;
}

export interface ClientReadyPayload {
  serverId: string;
  serverOptions: Record<string, any>;
}

export interface ClientDisconnectedPayload {
  serverId: string;
  address: string;
}

export interface ClientFailedPayload {
  serverId: string;
  address: string;
  error?: Error;
}

export interface ClientStoppedPayload {
  serverId: string;
  address: string;
}

export interface ServerReadyPayload {
  serverId: string;
}

export interface ServerClientJoinedPayload {
  clientId: string;
  clientOptions: Record<string, any>;
}

export interface ServerClientLeftPayload {
  clientId: string;
}

export interface ServerClientTimeoutPayload {
  clientId: string;
  lastSeen: number;
  timeSinceLastSeen: number;
  final: boolean;
}

// ============================================================================
// Main Node Class
// ============================================================================

/**
 * Node - Main class for ZeroNode network nodes
 * 
 * A Node can simultaneously:
 * - Bind as a server (accept downstream connections)
 * - Connect as a client (to upstream servers)
 * - Route messages between peers
 * - Load balance across available nodes
 * 
 * @example
 * ```typescript
 * import Node from 'zeronode';
 * 
 * const node = new Node({ 
 *   id: 'my-service',
 *   options: { role: 'api', version: 1 }
 * });
 * 
 * await node.bind('tcp://0.0.0.0:3000');
 * 
 * node.onRequest('user:get', async (envelope, reply) => {
 *   const user = await getUser(envelope.data.userId);
 *   return user;
 * });
 * ```
 */
export default class Node extends EventEmitter {
  /**
   * Create a new Node
   */
  constructor(options?: NodeOptions);
  
  // ============================================================================
  // Node Identity & State
  // ============================================================================
  
  /**
   * Get node ID
   */
  getId(): string;
  
  /**
   * Get bind address (if server is bound)
   */
  getAddress(): string | null;
  
  /**
   * Get node options (metadata)
   */
  getOptions(): Record<string, any>;
  
  /**
   * Update node options (for dynamic routing)
   * @returns Promise that resolves when options are updated
   */
  setOptions(options: Record<string, any>): Promise<void>;
  
  /**
   * Get filtered nodes by options or predicate
   * @param options - Filter criteria
   * @returns Array of node IDs matching the filter
   */
  getFilteredNodes(options?: {
    options?: Record<string, any>;
    predicate?: (nodeOptions: Record<string, any>) => boolean;
    up?: boolean;
    down?: boolean;
  }): string[];
  
  /**
   * Get peer options by ID
   * @param peerId - Peer ID
   * @returns Peer options or null if peer not joined
   */
  getPeerOptions(peerId: string): any | null;
  
  /**
   * Get server ID by connection address
   * @param address - Server address (e.g., 'tcp://127.0.0.1:5000')
   * @returns Server ID or null if not connected
   */
  getServerIdByAddress(address: string): string | null;
  
  // ============================================================================
  // Connection Management
  // ============================================================================
  
  /**
   * Bind as server (accept connections)
   * @param address - Bind address (e.g., 'tcp://0.0.0.0:3000')
   */
  bind(address: string): Promise<void>;
  
  /**
   * Unbind server (stop accepting connections)
   */
  unbind(): Promise<void>;
  
  /**
   * Connect to remote server
   * @param options - Connection options
   */
  connect(options: ConnectOptions): Promise<void>;
  
  /**
   * Disconnect from remote server
   * @param address - Server address to disconnect from
   */
  disconnect(address: string): Promise<void>;
  
  /**
   * Close the node and all its connections.
   * 
   * This permanently closes:
   * - The server (if bound)
   * - All client connections
   * - All underlying transport sockets
   * 
   * After closing, the node cannot be reused.
   * Pending requests will be rejected.
   * All handlers will be removed.
   */
  close(): Promise<void>;
  
  // ============================================================================
  // Handler Registration
  // ============================================================================
  
  /**
   * Register request handler
   * @param pattern - Event name (string) or pattern (RegExp)
   * @param handler - Request handler function
   */
  onRequest(pattern: string | RegExp, handler: RequestHandler): void;
  
  /**
   * Unregister request handler
   * @param pattern - Event name (string) or pattern (RegExp)
   * @param handler - Handler function to remove (optional)
   */
  offRequest(pattern: string | RegExp, handler?: RequestHandler): void;
  
  /**
   * Register tick handler
   * @param pattern - Event name (string) or pattern (RegExp)
   * @param handler - Tick handler function
   */
  onTick(pattern: string | RegExp, handler: TickHandler): void;
  
  /**
   * Unregister tick handler
   * @param pattern - Event name (string) or pattern (RegExp)
   * @param handler - Handler function to remove (optional)
   */
  offTick(pattern: string | RegExp, handler?: TickHandler): void;
  
  // ============================================================================
  // Messaging API
  // ============================================================================
  
  /**
   * Send request to specific node
   * @param options - Request options
   * @returns Promise resolving to response data
   */
  request(options: RequestOptions): Promise<any>;
  
  /**
   * Send tick (fire-and-forget) to specific node
   * @param options - Tick options
   */
  tick(options: TickOptions): void;
  
  /**
   * Send request to any matching node (load balanced)
   * @param options - Request options with filter
   * @returns Promise resolving to response data
   */
  requestAny(options: RequestAnyOptions): Promise<any>;
  
  /**
   * Send request to any downstream node
   * @param options - Request options with filter
   * @returns Promise resolving to response data
   */
  requestDownAny(options: Omit<RequestAnyOptions, 'down' | 'up'>): Promise<any>;
  
  /**
   * Send request to any upstream node
   * @param options - Request options with filter
   * @returns Promise resolving to response data
   */
  requestUpAny(options: Omit<RequestAnyOptions, 'down' | 'up'>): Promise<any>;
  
  /**
   * Send tick to any matching node
   * @param options - Tick options with filter
   * @returns undefined when a local peer matches (sent at once; errors are
   *   thrown), otherwise a Promise: resolved once handed to a router, rejected
   *   (NO_NODES_MATCH_FILTER, PROXY_HOP_LIMIT, PREDICATE_NOT_ROUTABLE) if none
   */
  tickAny(options: TickAnyOptions): void | Promise<void>;
  
  /**
   * Send tick to any downstream node
   * @param options - Tick options with filter
   */
  tickDownAny(options: Omit<TickAnyOptions, 'down' | 'up'>): void | Promise<void>;
  
  /**
   * Send tick to any upstream node
   * @param options - Tick options with filter
   */
  tickUpAny(options: Omit<TickAnyOptions, 'down' | 'up'>): void | Promise<void>;
  
  /**
   * Send tick to all matching nodes
   * @param options - Tick options with filter
   * @returns Promise resolving to an array of results
   */
  tickAll(options: TickAnyOptions): Promise<void[]>;
  
  /**
   * Send tick to all downstream nodes
   * @param options - Tick options with filter
   * @returns Promise resolving to an array of results
   */
  tickDownAll(options: Omit<TickAnyOptions, 'down' | 'up'>): Promise<void[]>;
  
  /**
   * Send tick to all upstream nodes
   * @param options - Tick options with filter
   * @returns Promise resolving to an array of results
   */
  tickUpAll(options: Omit<TickAnyOptions, 'down' | 'up'>): Promise<void[]>;
  
  // ============================================================================
  // Event Emitter (typed events)
  // ============================================================================
  
  on(event: NodeEvent.PEER_JOINED, listener: (payload: PeerJoinedPayload) => void): this;
  on(event: NodeEvent.PEER_LEFT, listener: (payload: PeerLeftPayload) => void): this;
  on(event: NodeEvent.PEER_UPDATED, listener: (payload: PeerUpdatedPayload) => void): this;
  on(event: NodeEvent.STOPPED, listener: () => void): this;
  on(event: NodeEvent.ERROR, listener: (payload: NodeErrorPayload) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  
  once(event: NodeEvent.PEER_JOINED, listener: (payload: PeerJoinedPayload) => void): this;
  once(event: NodeEvent.PEER_LEFT, listener: (payload: PeerLeftPayload) => void): this;
  once(event: NodeEvent.PEER_UPDATED, listener: (payload: PeerUpdatedPayload) => void): this;
  once(event: NodeEvent.STOPPED, listener: () => void): this;
  once(event: NodeEvent.ERROR, listener: (payload: NodeErrorPayload) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string | symbol): this;
}

// ============================================================================
// Transport Abstraction
// ============================================================================

/**
 * Transport interface for custom transport implementations
 */
export interface ITransport {
  createClientSocket(config?: any): any;
  createServerSocket(config?: any): any;
}

/**
 * Transport factory and registry
 */
export class Transport {
  /**
   * Register a custom transport
   * @param name - Transport name
   * @param transportImpl - Transport implementation
   */
  static register(name: string, transportImpl: ITransport): void;
  
  /**
   * Set default transport
   * @param name - Transport name
   */
  static setDefault(name: string): void;
  
  /**
   * Create client socket using default transport
   * @param config - Socket configuration
   */
  static createClientSocket(config?: any): any;
  
  /**
   * Create server socket using default transport
   * @param config - Socket configuration
   */
  static createServerSocket(config?: any): any;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Build predicate function from options object
 * @param options - Filter options
 * @returns Predicate function
 */
export function optionsPredicateBuilder(options: Record<string, any>): (nodeOptions: Record<string, any>) => boolean;

// ============================================================================
// Module Exports
// ============================================================================
// Note: All exports are already declared with 'export' keyword above
// No need for re-export block

