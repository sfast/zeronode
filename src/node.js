/**
 * Node - Network orchestration layer
 * 
 * Manages N clients + 1 server to create a mesh network node.
 * Handles routing, options, and node identity.
 * 
 * Architecture:
 * - One Node has one identity (node ID)
 * - Server and Clients use the same node ID (envelope.owner)
 * - Central handler registry (handlers work even if server/clients created later)
 * - Smart routing based on node ID and options
 * - Options sync for dynamic routing
 */

import winston from 'winston'
import md5 from 'md5'
import animal from 'animal-id'
import { EventEmitter } from 'events'
import { PatternEmitter } from '@sfast/pattern-emitter-ts'

import { NodeError, NodeErrorCode } from './node-errors.js'
import NodeUtils from './utils.js'
import Server, { ServerEvent } from './protocol/server.js'
import Client, { ClientEvent } from './protocol/client.js'

// ============================================================================
// NODE EVENTS (Orchestration Layer - Public API)
// ============================================================================
export const NodeEvent = {
  READY: 'node:ready',             // Node is fully initialized and ready
  PEER_JOINED: 'node:peer_joined', // New peer discovered (upstream or downstream)
  PEER_LEFT: 'node:peer_left',     // Peer disconnected
  STOPPED: 'node:stopped'          // Node stopped
}

const _private = new WeakMap()

const defaultLogger = winston.createLogger({
  transports: [
    new winston.transports.Console({ level: 'error' })
  ]
})

/**
 * Node - Network node with server and multiple client connections
 */
export default class Node extends EventEmitter {
  constructor ({ id, bind, options, config } = {}) {
    super()
    
    // Node identity
    id = id || _generateNodeId()
    options = options || {}
    config = config || {}
    
    // Bind node identity to options (used for routing and handshakes)
    Object.defineProperty(options, '_id', {
      value: id,
      writable: false,
      configurable: true,
      enumerable: true
    })
    
    // Private state
    const _scope = {
      id,
      options,
      config,
      logger: config.logger || defaultLogger,
      
      // Server (created on bind) - Server manages its own state
      nodeServer: null,
      bindAddress: bind || null,  // Cache bind address for async initialization window
      
      // Clients (nodeId → Client) - Clients manage their own state
      nodeClients: new Map(),
      nodeClientsAddressIndex: new Map(), // addressHash → nodeId
      
      // Central handler registry (single source of truth)
      handlerRegistry: {
        request: new PatternEmitter(),
        tick: new PatternEmitter()
      }
    }
    
    _private.set(this, _scope)
    
    // Default error handler for NO_NODES_MATCH_FILTER
    // Users can override by adding their own 'error' listener
    this.on('error', (err) => {
      if (err.code === NodeErrorCode.NO_NODES_MATCH_FILTER) {
        // Only throw if no other error listeners are registered
        if (this.listenerCount('error') === 1) {
          throw err
        }
      }
    })
    
    // Initialize server if bind address provided
    if (bind) {
      // Initialize and bind server asynchronously
      this._initServer(bind)
      
      // Bind in background (Node should be fully initialized when used)
      setImmediate(() => {
        this.bind(bind).catch(err => {
          _scope.logger.error(`[Node] Failed to bind server to ${bind}:`, err)
          this.emit('error', err)
        })
      })
    }
  }
  
  // ============================================================================
  // IDENTITY & INFO
  // ============================================================================
  
  getId () {
    const { id } = _private.get(this)
    return id
  }
  
  getAddress () {
    const { nodeServer, bindAddress } = _private.get(this)
    // Prefer server's address (source of truth), fallback to cached bind address
    return nodeServer?.getAddress() || bindAddress
  }
  
  getOptions () {
    const { options } = _private.get(this)
    return options
  }
  
  // ============================================================================
  // SERVER MANAGEMENT
  // ============================================================================
  
  /**
   * Initialize server (can be called later if not provided in constructor)
   * @private
   */
  _initServer (bindAddress) {
    const _scope = _private.get(this)
    
    if (_scope.nodeServer) {
      _scope.logger.warn(`[Node] Server already initialized`)
      return
    }
    
    const { id, options, config } = _scope
    
    // Create server with node identity
    const nodeServer = new Server({ 
      id,              // ✅ Server uses Node's ID
      bind: bindAddress, 
      options, 
      config 
    })
    
    // Apply all registered handlers to server
    this._syncHandlersToTarget(nodeServer)
    
    // Transform and forward server events to node
    this._attachServerEvents(nodeServer)
    
    _scope.nodeServer = nodeServer
    
    _scope.logger.info(`[Node] Server initialized: ${id}`)
  }
  
  /**
   * Bind server to address
   */
  async bind (address) {
    const _scope = _private.get(this)
    
    // Cache the bind address
    _scope.bindAddress = address
    
    // Initialize server if not already done
    if (!_scope.nodeServer) {
      this._initServer(address)
    }
    
    // Server handles idempotency and state management
    await _scope.nodeServer.bind(address)
  }
  
  /**
   * Unbind server
   */
  async unbind () {
    const { nodeServer } = _private.get(this)
    
    if (!nodeServer) {
      return Promise.resolve()
    }
    
    return nodeServer.unbind()
  }
  
  /**
   * Attach server event handlers and transform to Node events
   * @private
   */
  _attachServerEvents (server) {
    const { logger } = _private.get(this)
    
    // Forward errors
    server.on('error', (err) => {
      logger.error('[Node] Server error:', err)
      this.emit('error', err)
    })
    
    // Transform: Server.CLIENT_JOINED → Node.PEER_JOINED
    server.on(ServerEvent.CLIENT_JOINED, ({ clientId, data }) => {
      this.emit(NodeEvent.PEER_JOINED, {
        peerId: clientId,
        direction: 'downstream',   // Client connected TO our server
        peerOptions: data || {}
      })
    })
    
    // Transform: Server.CLIENT_LEFT → Node.PEER_LEFT
    server.on(ServerEvent.CLIENT_LEFT, ({ clientId }) => {
      this.emit(NodeEvent.PEER_LEFT, {
        peerId: clientId,
        direction: 'downstream'
      })
    })
    
    // Transform: Server.CLIENT_TIMEOUT → Node.PEER_LEFT (ghost = left)
    server.on(ServerEvent.CLIENT_TIMEOUT, ({ clientId }) => {
      this.emit(NodeEvent.PEER_LEFT, {
        peerId: clientId,
        direction: 'downstream',
        reason: 'timeout'
      })
    })
    
    // Server ready
    server.on(ServerEvent.READY, () => {
      this.emit(NodeEvent.READY, {
        nodeId: this.getId(),
        hasServer: true
      })
    })
  }
  
  // ============================================================================
  // CLIENT MANAGEMENT
  // ============================================================================
  
  /**
   * Connect to remote node
   * @param {Object} params
   * @param {string} params.address - Remote address (tcp://...)
   * @param {number} [params.timeout] - Connection timeout
   * @param {number} [params.reconnectionTimeout] - Reconnection timeout
   * @returns {Promise<Object>} Remote node info
   */
  async connect ({ address, timeout, reconnectionTimeout } = {}) {
    if (!address || typeof address !== 'string') {
      throw new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: `Invalid address: ${address}`,
        context: { address }
      })
    }
    
    const _scope = _private.get(this)
    const { id, options, config, nodeClients, nodeClientsAddressIndex, logger } = _scope
    
    const addressHash = md5(address)
    
    // Check if already connected
    if (nodeClientsAddressIndex.has(addressHash)) {
      const existingNodeId = nodeClientsAddressIndex.get(addressHash)
      const client = nodeClients.get(existingNodeId)
      
      logger.info(`[Node] Already connected to ${address}`)
      
      const serverPeer = client.getServerPeerInfo()
      return serverPeer ? serverPeer.toJSON() : null
    }
    
    // Prepare client config
    let clientConfig = config
    if (reconnectionTimeout !== undefined) {
      clientConfig = Object.assign({}, config, { 
        RECONNECTION_TIMEOUT: reconnectionTimeout 
      })
    }
    
    // Create client with node identity
    const client = new Client({ 
      id,              // ✅ Client uses Node's ID
      options,         // ✅ Node's options for handshake
      config: clientConfig 
    })
    
    // Apply all registered handlers to client
    this._syncHandlersToTarget(client)
    
    // Attach client event handlers
    this._attachClientEvents(client)
    
    // Connect (Client.connect() waits for handshake to complete)
    await client.connect(address, timeout)
    
    // Get server peer info (now available after handshake)
    const serverPeer = client.getServerPeerInfo()
    if (!serverPeer || !serverPeer.getId()) {
      throw new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: `Failed to get server peer info after connection to ${address}`,
        context: { address }
      })
    }
    
    const remoteNodeId = serverPeer.getId()
    
    logger.info(`[Node] Connected: ${id} → ${remoteNodeId} (${address})`)
    
    // Store client by remote node's ID
    nodeClients.set(remoteNodeId, client)
    nodeClientsAddressIndex.set(addressHash, remoteNodeId)
    
    // Emit connection event with server peer info
    // Note: PEER_JOINED will be emitted when Client.READY fires
    
    return serverPeer.toJSON()
  }
  
  /**
   * Disconnect from remote node
   * @param {string} address - Remote address
   */
  async disconnect (address) {
    if (!address || typeof address !== 'string') {
      throw new NodeError({
        code: NodeErrorCode.ROUTING_FAILED,
        message: `Invalid address: ${address}`,
        context: { address }
      })
    }
    
    const _scope = _private.get(this)
    const { nodeClients, nodeClientsAddressIndex, logger } = _scope
    
    const addressHash = md5(address)
    
    if (!nodeClientsAddressIndex.has(addressHash)) {
      logger.warn(`[Node] Not connected to ${address}`)
      return true
    }
    
    const nodeId = nodeClientsAddressIndex.get(addressHash)
    const client = nodeClients.get(nodeId)
    
    // Remove all event listeners
    client.removeAllListeners()
    
    // Disconnect client
    await client.disconnect()
    
    // Clean up
    this._removeClientHandlers(client)
    nodeClients.delete(nodeId)
    nodeClientsAddressIndex.delete(addressHash)
    
    logger.info(`[Node] Disconnected from ${address}`)
    
    return true
  }
  
  /**
   * Attach client event handlers and transform to Node events
   * @private
   */
  _attachClientEvents (client) {
    const _scope = _private.get(this)
    const { logger } = _scope
    
    // Forward errors
    client.on('error', (err) => {
      logger.error('[Node] Client error:', err)
      this.emit('error', err)
    })
    
    // Transform: Client.READY → Node.PEER_JOINED
    client.on(ClientEvent.READY, ({ serverId, serverData }) => {
      this.emit(NodeEvent.PEER_JOINED, {
        peerId: serverId,
        direction: 'upstream',     // We connected TO this server
        peerOptions: serverData || {}
      })
    })
    
    // Transform: Client.DISCONNECTED → Node.PEER_LEFT
    client.on(ClientEvent.DISCONNECTED, ({ serverId }) => {
      this.emit(NodeEvent.PEER_LEFT, {
        peerId: serverId,
        direction: 'upstream',
        reason: 'disconnected'
      })
    })
    
    // Transform: Client.FAILED → Node.PEER_LEFT
    client.on(ClientEvent.FAILED, ({ serverId }) => {
      this.emit(NodeEvent.PEER_LEFT, {
        peerId: serverId,
        direction: 'upstream',
        reason: 'failed'
      })
    })
    
    // Transform: Client.STOPPED → Node.PEER_LEFT
    client.on(ClientEvent.STOPPED, () => {
      const serverPeer = client.getServerPeerInfo()
      if (serverPeer) {
        this.emit(NodeEvent.PEER_LEFT, {
          peerId: serverPeer.getId(),
          direction: 'upstream',
          reason: 'stopped'
        })
      }
    })
  }
  
  // ============================================================================
  // HANDLER MANAGEMENT (Central Registry)
  // ============================================================================
  
  /**
   * Register request handler
   * Handlers are stored centrally and applied to all servers/clients
   */
  onRequest (pattern, handler) {
    const { handlerRegistry, nodeServer, nodeClients, logger } = _private.get(this)
    
    // Store in central registry
    handlerRegistry.request.on(pattern, handler)
    
    // Apply to server if it exists
    if (nodeServer) {
      nodeServer.onRequest(pattern, handler)
    }
    
    // Apply to all existing clients
    nodeClients.forEach(client => {
      client.onRequest(pattern, handler)
    })
  }
  
  /**
   * Unregister request handler
   */
  offRequest (pattern, handler) {
    const { handlerRegistry, nodeServer, nodeClients } = _private.get(this)
    
    // Remove from registry
    if (handler) {
      handlerRegistry.request.off(pattern, handler)
    } else {
      handlerRegistry.request.removeAllListeners(pattern)
    }
    
    // Remove from server
    if (nodeServer) {
      nodeServer.offRequest(pattern, handler)
    }
    
    // Remove from clients
    nodeClients.forEach(client => {
      client.offRequest(pattern, handler)
    })
  }
  
  /**
   * Register tick handler
   */
  onTick (pattern, handler) {
    const { handlerRegistry, nodeServer, nodeClients } = _private.get(this)
    
    // Store in central registry
    handlerRegistry.tick.on(pattern, handler)
    
    // Apply to server if it exists
    if (nodeServer) {
      nodeServer.onTick(pattern, handler)
    }
    
    // Apply to all existing clients
    nodeClients.forEach(client => {
      client.onTick(pattern, handler)
    })
  }
  
  /**
   * Unregister tick handler
   */
  offTick (pattern, handler) {
    const { handlerRegistry, nodeServer, nodeClients } = _private.get(this)
    
    // Remove from registry
    if (handler) {
      handlerRegistry.tick.off(pattern, handler)
    } else {
      handlerRegistry.tick.removeAllListeners(pattern)
    }
    
    // Remove from server
    if (nodeServer) {
      nodeServer.offTick(pattern, handler)
    }
    
    // Remove from clients
    nodeClients.forEach(client => {
      client.offTick(pattern, handler)
    })
  }
  
  /**
   * Sync all registered handlers to a target (server or client)
   * @private
   */
  _syncHandlersToTarget (target) {
    const { handlerRegistry } = _private.get(this)
    
    // PatternEmitter.allListeners returns ALL listeners (string events + RegExp patterns)
    // This is much simpler than before!
    
    // Apply all request handlers
    for (const [pattern, handlers] of handlerRegistry.request.allListeners) {
      handlers.forEach(handler => {
        // Pattern can be string, symbol, or RegExp pattern string (like '/test.*/')
        // If it starts with '/', it's a RegExp pattern string, convert back to RegExp
        const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
          ? new RegExp(pattern.slice(1, -1))
          : pattern
        target.onRequest(eventPattern, handler)
      })
    }
    
    // Apply all tick handlers
    for (const [pattern, handlers] of handlerRegistry.tick.allListeners) {
      handlers.forEach(handler => {
        const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
          ? new RegExp(pattern.slice(1, -1))
          : pattern
        target.onTick(eventPattern, handler)
      })
    }
  }
  
  /**
   * Remove all handlers from a client
   * @private
   */
  _removeClientHandlers (client) {
    const { handlerRegistry } = _private.get(this)
    
    // Remove all request handlers
    for (const [pattern] of handlerRegistry.request.allListeners) {
      const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
        ? new RegExp(pattern.slice(1, -1))
        : pattern
      client.offRequest(eventPattern)
    }
    
    // Remove all tick handlers
    for (const [pattern] of handlerRegistry.tick.allListeners) {
      const eventPattern = (typeof pattern === 'string' && pattern.startsWith('/') && pattern.endsWith('/'))
        ? new RegExp(pattern.slice(1, -1))
        : pattern
      client.offTick(eventPattern)
    }
  }
  
  // ============================================================================
  // ROUTING
  // ============================================================================
  
  /**
   * Find route to node
   * @private
   * @returns {{ type: 'server'|'client', target: Server|Client, targetId?: string } | null}
   */
  _findRoute (nodeId) {
    const { nodeServer, nodeClients } = _private.get(this)
    
    // Check if node is connected to our server (downstream)
    if (nodeServer) {
      const clientPeer = nodeServer.getClientPeerInfo(nodeId)
      if (clientPeer && clientPeer.isOnline()) {
        return { 
          type: 'server', 
          target: nodeServer, 
          targetId: nodeId 
        }
      }
    }
    
    // Check if we're connected to this node (upstream)
    if (nodeClients.has(nodeId)) {
      const client = nodeClients.get(nodeId)
      const serverPeer = client.getServerPeerInfo()
      
      if (serverPeer && serverPeer.isOnline()) {
        return { 
          type: 'client', 
          target: client 
        }
      }
    }
    
    return null
  }
  
  /**
   * Get filtered nodes by options/predicate
   * @private
   */
  _getFilteredNodes ({ options, predicate, up = true, down = true } = {}) {
    const { nodeServer, nodeClients } = _private.get(this)
    const nodes = new Set()
    
    // Build predicate function
    const pred = predicate || NodeUtils.optionsPredicateBuilder(options)
    
    // Downstream: Clients connected to our server
    if (down && nodeServer) {
      const allClientPeers = nodeServer.getAllClientPeers()
      allClientPeers.forEach(clientPeer => {
        if (clientPeer && clientPeer.isOnline()) {
          // Predicate receives peer.options
          if (pred(clientPeer.getOptions())) {
            nodes.add(clientPeer.getId())
          }
        }
      })
    }
    
    // Upstream: Servers we're connected to
    if (up) {
      nodeClients.forEach((client, nodeId) => {
        const serverPeer = client.getServerPeerInfo()
        if (serverPeer && serverPeer.isOnline()) {
          // Predicate receives peer.options
          if (pred(serverPeer.getOptions())) {
            nodes.add(nodeId)
          }
        }
      })
    }
    
    return Array.from(nodes)
  }
  
  /**
   * Select node from list (load balancing strategy)
   * @private
   */
  _selectNode (nodeIds, event) {
    if (!nodeIds || nodeIds.length === 0) {
      return null
    }
    
    // Simple random selection
    // Can be enhanced with round-robin, least-connections, etc.
    const idx = Math.floor(Math.random() * nodeIds.length)
    return nodeIds[idx]
  }
  
  // ============================================================================
  // MESSAGING API
  // ============================================================================
  
  /**
   * Send request to specific node
   */
  async request ({ to, event, data, timeout } = {}) {
    const route = this._findRoute(to)
    
    if (!route) {
      throw new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: `No route to node '${to}'`,
        nodeId: to,
        context: { event }
      })
    }
    
    if (route.type === 'server') {
      // Route through our server to connected client
      return route.target.request({ to: route.targetId, event, data, timeout })
    } else {
      // Route through client to remote server
      return route.target.request({ event, data, timeout })
    }
  }
  
  /**
   * Send tick to specific node
   */
  tick ({ to, event, data } = {}) {
    const route = this._findRoute(to)
    
    if (!route) {
      throw new NodeError({
        code: NodeErrorCode.NODE_NOT_FOUND,
        message: `No route to node '${to}'`,
        nodeId: to,
        context: { event }
      })
    }
    
    if (route.type === 'server') {
      return route.target.tick({ to: route.targetId, event, data })
    } else {
      return route.target.tick({ event, data })
    }
  }
  
  /**
   * Send request to any matching node
   */
  async requestAny ({ event, data, timeout, filter, down = true, up = true } = {}) {
    // Extract options from filter if wrapped
    const filterOptions = filter?.options || filter
    const filteredNodes = this._getFilteredNodes({ options: filterOptions, down, up })
    
    if (filteredNodes.length === 0) {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'No nodes match filter criteria',
        context: { filter, down, up, event }
      })
      this.emit('error', error)
      return Promise.reject(error)
    }
    
    const targetNode = this._selectNode(filteredNodes, event)
    return this.request({ to: targetNode, event, data, timeout })
  }
  
  /**
   * Send request to any downstream node
   */
  async requestDownAny ({ event, data, timeout, filter } = {}) {
    return this.requestAny({ event, data, timeout, filter, down: true, up: false })
  }
  
  /**
   * Send request to any upstream node
   */
  async requestUpAny ({ event, data, timeout, filter } = {}) {
    return this.requestAny({ event, data, timeout, filter, down: false, up: true })
  }
  
  /**
   * Send tick to any matching node
   */
  tickAny ({ event, data, filter, down = true, up = true } = {}) {
    // Extract options from filter if wrapped
    const filterOptions = filter?.options || filter
    const filteredNodes = this._getFilteredNodes({ options: filterOptions, down, up })
    
    if (filteredNodes.length === 0) {
      const error = new NodeError({
        code: NodeErrorCode.NO_NODES_MATCH_FILTER,
        message: 'No nodes match filter criteria',
        context: { filter, down, up, event }
      })
      this.emit('error', error)
      return
    }
    
    const targetNode = this._selectNode(filteredNodes, event)
    return this.tick({ to: targetNode, event, data })
  }
  
  /**
   * Send tick to any downstream node
   */
  tickDownAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: true, up: false })
  }
  
  /**
   * Send tick to any upstream node
   */
  tickUpAny ({ event, data, filter } = {}) {
    return this.tickAny({ event, data, filter, down: false, up: true })
  }
  
  /**
   * Send tick to all matching nodes
   */
  async   tickAll ({ event, data, filter, down = true, up = true } = {}) {
    // Extract options from filter if wrapped
    const filterOptions = filter?.options || filter
    const filteredNodes = this._getFilteredNodes({ options: filterOptions, down, up })
    
    const promises = filteredNodes.map(nodeId => {
      return this.tick({ to: nodeId, event, data })
    })
    
    return Promise.all(promises)
  }
  
  /**
   * Send tick to all downstream nodes
   */
  tickDownAll ({ event, data, filter } = {}) {
    return this.tickAll({ event, data, filter, down: true, up: false })
  }
  
  /**
   * Send tick to all upstream nodes
   */
  tickUpAll ({ event, data, filter } = {}) {
    return this.tickAll({ event, data, filter, down: false, up: true })
  }
  
  // ============================================================================
  // OPTIONS MANAGEMENT (Used for routing)
  // ============================================================================
  
  /**
   * Update node options and propagate to server/clients
   */
  async setOptions (options = {}) {
    const _scope = _private.get(this)
    
    // Maintain node identity
    Object.defineProperty(options, '_id', {
      value: _scope.id,
      writable: false,
      configurable: true,
      enumerable: true
    })
    
    _scope.options = options
    
    // Note: Options are used during handshakes and are part of Node's identity
    // They don't need to be actively propagated to existing connections
    // Server and clients will use updated options for new connections
  }
  
  /**
   * Get filtered nodes (with options/predicate)
   */
  getFilteredNodes ({ options, predicate, up = true, down = true } = {}) {
    return this._getFilteredNodes({ options, predicate, up, down })
  }
  
  // ============================================================================
  // PEER INFO (Compatibility)
  // ============================================================================
  
  /**
   * Get server info by address or ID
   */
  getServerInfo ({ address, id }) {
    const { nodeClients, nodeClientsAddressIndex } = _private.get(this)
    
    if (!id && address) {
      const addressHash = md5(address)
      if (!nodeClientsAddressIndex.has(addressHash)) {
        return null
      }
      id = nodeClientsAddressIndex.get(addressHash)
    }
    
    const client = nodeClients.get(id)
    if (!client) {
      return null
    }
    
    const serverPeer = client.getServerPeerInfo()
    return serverPeer ? serverPeer.toJSON() : null
  }
  
  /**
   * Get client info by ID
   */
  getClientInfo ({ id }) {
    const { nodeServer } = _private.get(this)
    
    if (!nodeServer) {
      return null
    }
    
    const client = nodeServer.getClientPeerInfo(id)
    return client ? client.toJSON() : null
  }
  
  // ============================================================================
  // LIFECYCLE
  // ============================================================================
  
  /**
   * Stop node (close server and all clients)
   */
  async stop () {
    const { nodeServer, nodeClients, logger } = _private.get(this)
    const promises = []
    
    // Stop server
    if (nodeServer && nodeServer.isOnline()) {
      promises.push(nodeServer.close())
    }
    
    // Stop all clients
    nodeClients.forEach(client => {
      promises.push(client.close())
    })
    
    await Promise.all(promises)
    
    logger.info('[Node] Stopped')
  }
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Generate random node ID
 * @private
 */
function _generateNodeId () {
  return animal.getId()
}
