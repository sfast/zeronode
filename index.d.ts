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
  
  /** Buffer allocation strategy: 'EXACT' or 'POWER_OF_2' */
  PROTOCOL_BUFFER_STRATEGY?: 'EXACT' | 'POWER_OF_2';
  
  /** Client ping interval in milliseconds (default: 10000) */
  CLIENT_PING_INTERVAL?: number;
  
  /** Server health check interval in milliseconds (default: 30000) */
  CLIENT_HEALTH_CHECK_INTERVAL?: number;
  
  /** Client ghost timeout in milliseconds (default: 60000) */
  CLIENT_GHOST_TIMEOUT?: number;
  
  /** Enable debug logging (default: false) */
  DEBUG?: boolean;
  
  /** Custom logger instance */
  logger?: any;
  
  /** ZeroMQ reconnection interval in milliseconds */
  reconnectInterval?: number;
  
  /** ZeroMQ maximum reconnection interval in milliseconds */
  reconnectMaxInterval?: number;
  
  /** ZeroMQ heartbeat interval in milliseconds */
  heartbeatInterval?: number;
  
  /** ZeroMQ heartbeat timeout in milliseconds */
  heartbeatTimeout?: number;
  
  /** ZeroMQ heartbeat TTL in milliseconds */
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
  
  /** Reconnection timeout in milliseconds (optional) */
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
  /** Node is ready */
  READY = 'node:ready',
  
  /** Peer joined the network */
  PEER_JOINED = 'node:peer_joined',
  
  /** Peer left the network */
  PEER_LEFT = 'node:peer_left',
  
  /** Node stopped */
  STOPPED = 'node:stopped',
  
  /** Node error */
  ERROR = 'node:error'
}

/**
 * Client-level events
 */
export enum ClientEvent {
  /** Client handshake complete */
  READY = 'client:ready',
  
  /** Client disconnected from server */
  DISCONNECTED = 'client:disconnected',
  
  /** Client connection failed */
  FAILED = 'client:failed',
  
  /** Client explicitly stopped */
  STOPPED = 'client:stopped',
  
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
  
  /** Client timeout */
  CLIENT_TIMEOUT = 'server:client_timeout'
}

/**
 * Transport-level events
 */
export enum TransportEvent {
  /** Transport ready */
  READY = 'transport:ready',
  
  /** Transport not ready */
  NOT_READY = 'transport:not_ready',
  
  /** Message received */
  MESSAGE = 'transport:message',
  
  /** Transport error */
  ERROR = 'transport:error',
  
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
  
  /** Routing failed */
  ROUTING_FAILED = 'ROUTING_FAILED',
  
  /** Duplicate connection */
  DUPLICATE_CONNECTION = 'DUPLICATE_CONNECTION',
  
  /** Server not initialized */
  SERVER_NOT_INITIALIZED = 'SERVER_NOT_INITIALIZED'
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
  HANDLER_ERROR = 'HANDLER_ERROR'
}

/**
 * Protocol error class
 */
export class ProtocolError extends Error {
  code: ProtocolErrorCode;
  protocolId?: string;
  envelopeId?: bigint;
  cause?: Error;
  context?: any;
  
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

export interface PeerLeftPayload {
  peerId: string;
  direction: 'upstream' | 'downstream';
  reason?: string;
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
   * Get server info by address or ID
   * @param params - Search parameters
   * @returns Server peer info or null
   */
  getServerInfo(params: { address?: string; id?: string }): any | null;
  
  /**
   * Get client info by ID
   * @param params - Client ID
   * @returns Client peer info or null
   */
  getClientInfo(params: { id: string }): any | null;
  
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
   * Stop node (unbind + disconnect all)
   */
  stop(): Promise<void>;
  
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
   */
  tickAny(options: TickAnyOptions): void;
  
  /**
   * Send tick to any downstream node
   * @param options - Tick options with filter
   */
  tickDownAny(options: Omit<TickAnyOptions, 'down' | 'up'>): void;
  
  /**
   * Send tick to any upstream node
   * @param options - Tick options with filter
   */
  tickUpAny(options: Omit<TickAnyOptions, 'down' | 'up'>): void;
  
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
  
  on(event: NodeEvent.READY, listener: () => void): this;
  on(event: NodeEvent.PEER_JOINED, listener: (payload: PeerJoinedPayload) => void): this;
  on(event: NodeEvent.PEER_LEFT, listener: (payload: PeerLeftPayload) => void): this;
  on(event: NodeEvent.STOPPED, listener: () => void): this;
  on(event: NodeEvent.ERROR, listener: (payload: NodeErrorPayload) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  
  once(event: NodeEvent.READY, listener: () => void): this;
  once(event: NodeEvent.PEER_JOINED, listener: (payload: PeerJoinedPayload) => void): this;
  once(event: NodeEvent.PEER_LEFT, listener: (payload: PeerLeftPayload) => void): this;
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

