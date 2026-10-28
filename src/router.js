/**
 * Router - Specialized Node for Service Discovery and Request Forwarding
 * 
 * A Router is a Node that:
 * 1. Automatically sets options.router = true
 * 2. Handles proxy requests/ticks from other nodes
 * 3. Performs service discovery on its network
 * 4. Can optionally track routing statistics
 * 
 * Architecture:
 * - Regular nodes use requestAny/tickAny with router fallback
 * - If no local match, node sends _system:proxy_request to router
 * - Router performs its own requestAny to find the service
 * - Router forwards response back to original requester
 * 
 * Usage:
 *   const router = new Router({ bind: 'tcp://127.0.0.1:3000' })
 *   await router.bind()
 *   // Router automatically handles proxy requests
 */

import Node from './node.js'
import Globals from './globals.js'
import { NodeError, NodeErrorCode, kProxyMiss, kProxyReplyRouting } from './node-errors.js'

const _private = new WeakMap()

export class Router extends Node {
  constructor({ id, bind, options = {}, config = {} } = {}) {
    // Force router option to true
    super({
      id,
      bind,
      options: { ...options, router: true },
      config
    })
    
    // Private state for router-specific features
    _private.set(this, {
      stats: {
        proxyRequests: 0,
        proxyTicks: 0,
        successfulRoutes: 0,
        failedRoutes: 0,
        startTime: Date.now()
      },
      enabled: false,
      enableStats: config.enableRouterStats !== false, // Stats enabled by default
      debugLogging: config.DEBUG || false
    })
    
    // Auto-enable routing on construction
    this._enableRouting()
  }
  
  /**
   * Enable routing (called automatically in constructor)
   * @private
   */
  _enableRouting() {
    const scope = _private.get(this)
    
    if (scope.enabled) {
      return // Already enabled
    }
    
    // Register system event handlers for proxy messages
    this.onRequest('_system:proxy_request', this._handleProxyRequest.bind(this))
    this.onTick('_system:proxy_tick', this._handleProxyTick.bind(this))
    
    scope.enabled = true
  }
  
  /**
   * Handle incoming proxy request from another node
   * 
   * Flow:
   * 1. Extract original event, data, filter from envelope
   * 2. Perform requestAny on router's own network
   * 3. Reply with result or error
   * 
   * @private
   * @param {Envelope} envelope - Proxy request envelope
   * @param {Function} reply - Reply callback
   */
  async _handleProxyRequest(envelope, reply) {
    const scope = _private.get(this)
    
    // Increment stats (optimized: check flag first)
    if (scope.enableStats) {
      scope.stats.proxyRequests++
    }
    
    // Extract routing info from metadata
    const routing = envelope.metadata?.routing || {}
    const { event, filter, down, up, requestor } = routing
    const hop = sanitizeProxyRouting(routing, envelope.owner)
    
    // User data is in envelope.data (unchanged!)
    const data = envelope.data
    
    // Debug logging (optimized: guard expensive operations)
    if (scope.debugLogging) {
      const logger = this.getLogger()
      logger.debug(
        `[Router] Proxying requestAny - ` +
        `Event: ${event}, ` +
        `Filter: ${JSON.stringify(filter)}, ` +
        `From: ${requestor || envelope.owner}`
      )
    }
    
    try {
      // Malformed routing: refuse before anything is delivered locally
      if (hop.error) throw hop.error
      
      // Answer before the previous hop gives up, so it sees our real error
      // instead of its own REQUEST_TIMEOUT. The margin scales with the budget
      // so short timeouts still work across several routers.
      const margin = Math.min(Globals.PROXY_HOP_MARGIN_MS, Math.floor(hop.budget / 4))
      const innerTimeout = hop.budget - margin
      
      if (innerTimeout < Globals.PROXY_MIN_BUDGET_MS) {
        throw new NodeError({
          code: NodeErrorCode.PROXY_DEADLINE_EXCEEDED,
          message: `Proxy request for '${event}' arrived with ${hop.budget}ms left; not forwarding`,
          context: { event, budget: hop.budget }
        })
      }
      
      // Router performs requestAny on its own network
      const result = await this.requestAny({
        event,
        data,
        filter,
        down: down !== undefined ? down : true,
        up: up !== undefined ? up : true,
        timeout: innerTimeout,
        _routing: hop
      })
      
      if (scope.enableStats) {
        scope.stats.successfulRoutes++
      }
      
      if (scope.debugLogging) {
        this.getLogger().debug(`[Router] Successfully routed request for event: ${event}`)
      }
      
      reply(result)
      
    } catch (error) {
      if (scope.enableStats) {
        scope.stats.failedRoutes++
      }
      
      if (scope.debugLogging) {
        this.getLogger().warn(
          `[Router] Failed to route request - ` +
          `Event: ${event}, ` +
          `Error: ${error.message}`
        )
      }
      
      reply.error(toProxyReplyError(error))
    }
  }
  
  /**
   * Handle incoming proxy tick from another node
   * 
   * Flow:
   * 1. Extract original event, data, filter from envelope
   * 2. Perform tickAny on router's own network
   * 3. No response (fire-and-forget)
   * 
   * @private
   * @param {Envelope} envelope - Proxy tick envelope
   */
  _handleProxyTick(envelope) {
    const scope = _private.get(this)
    
    // Increment stats (optimized: check flag first)
    if (scope.enableStats) {
      scope.stats.proxyTicks++
    }
    
    // Extract routing info from metadata
    const routing = envelope.metadata?.routing || {}
    const { event, filter, down, up, requestor } = routing
    const hop = sanitizeProxyRouting(routing, envelope.owner)
    
    // User data is in envelope.data (unchanged!)
    const data = envelope.data
    
    // Debug logging (optimized: guard expensive operations)
    if (scope.debugLogging) {
      const logger = this.getLogger()
      logger.debug(
        `[Router] Proxying tickAny - ` +
        `Event: ${event}, ` +
        `Filter: ${JSON.stringify(filter)}, ` +
        `From: ${requestor || envelope.owner}`
      )
    }
    
    // Malformed routing: drop before anything is delivered locally
    if (hop.error) {
      if (scope.enableStats) scope.stats.failedRoutes++
      return
    }
    
    // Place it on our network; if that fails, it goes back to the sender,
    // which tries its next router. Never rejects.
    this._routeProxyTick({
      event,
      data,
      filter,
      down: down !== undefined ? down : true,
      up: up !== undefined ? up : true
    }, hop).then((routed) => {
      // successfulRoutes for ticks means "forwarded or delivered locally"
      if (scope.enableStats) {
        routed ? scope.stats.successfulRoutes++ : scope.stats.failedRoutes++
      }
      
      if (scope.debugLogging) {
        this.getLogger().debug(`[Router] Tick for event '${event}' ${routed ? 'routed' : 'not routed'}`)
      }
    })
  }
  
  /**
   * Update options; a Router always keeps `router: true` (peers find routers
   * by that option)
   */
  async setOptions(options = {}) {
    return super.setOptions({ ...options, router: true })
  }
  
  /**
   * Get routing statistics
   * 
   * @returns {Object} Statistics object
   *   - proxyRequests: Total proxy requests handled
   *   - proxyTicks: Total proxy ticks handled
   *   - successfulRoutes: Successfully routed messages
   *   - failedRoutes: Failed routing attempts
   *   - totalMessages: Total messages routed
   *   - uptime: Router uptime in seconds
   *   - requestsPerSecond: Average requests per second
   */
  getRoutingStats() {
    const scope = _private.get(this)
    const { stats } = scope
    
    const uptimeMs = Date.now() - stats.startTime
    const uptimeSeconds = uptimeMs / 1000
    const totalMessages = stats.proxyRequests + stats.proxyTicks
    const requestsPerSecond = uptimeSeconds > 0 ? totalMessages / uptimeSeconds : 0
    
    return {
      proxyRequests: stats.proxyRequests,
      proxyTicks: stats.proxyTicks,
      successfulRoutes: stats.successfulRoutes,
      failedRoutes: stats.failedRoutes,
      totalMessages,
      uptime: uptimeSeconds,
      requestsPerSecond: Math.round(requestsPerSecond * 100) / 100
    }
  }
  
  /**
   * Reset routing statistics
   */
  resetRoutingStats() {
    const scope = _private.get(this)
    scope.stats = {
      proxyRequests: 0,
      proxyTicks: 0,
      successfulRoutes: 0,
      failedRoutes: 0,
      startTime: Date.now()
    }
  }
  
  /**
   * Get logger - access Node's private logger through WeakMap
   * @private
   */
  _getLogger() {
    // Node stores its _scope in _private WeakMap
    // We need to import the _private WeakMap from node.js
    // For now, use a simple fallback to console
    // In production, Node could expose a getLogger() method
    
    // Try to access via super class (this is a hack, but works)
    try {
      // Access config which has logger
      const config = this._scope?.config || {}
      return config.logger || console
    } catch {
      return console
    }
  }
}

/**
 * Validate the routing info of an incoming proxy message. It comes from a peer,
 * so anything malformed is treated as absent (old peers send none of it).
 * @private
 * @returns {{ path: string[], from: string, requestor?: string, budget?: number }}
 */
function sanitizeProxyRouting (routing, sender) {
  const { path, visited, budget, timeout, requestor } = routing
  
  // A compliant peer sends either nothing (old version) or a well-formed list.
  // Anything else fails closed: treated as the hop limit being reached.
  const validIds = (list, max) => Array.isArray(list) && list.length <= max && list.every(id => typeof id === 'string')
  const badPath = path !== undefined && !validIds(path, Globals.PROXY_MAX_HOPS)
  const badVisited = visited !== undefined && !validIds(visited, Globals.PROXY_MAX_VISITED)
  
  // Budget: the sender's remaining time. Old peers send only `timeout`.
  // Never more than the caller's timeout, and within setTimeout's range.
  const fallback = Number.isFinite(timeout) && timeout > 0 ? timeout : Globals.PROTOCOL_REQUEST_TIMEOUT
  const raw = Number.isFinite(budget) ? budget : fallback
  const clamped = Math.max(0, Math.min(raw, fallback, MAX_TIMER_MS))
  
  const hop = {
    path: badPath ? [] : (path || []),
    visited: badVisited ? [] : (visited || []),
    from: typeof sender === 'string' ? sender : undefined,
    requestor: typeof requestor === 'string' ? requestor : undefined,
    // Proxy ticks: the sender's id for this forward, echoed back in a miss
    tick: typeof routing.tick === 'string' && routing.tick.length <= 64 ? routing.tick : undefined,
    // Proxy ticks: forwards left (absent from old peers: a fresh budget)
    forwards: Number.isInteger(routing.forwards) && routing.forwards >= 0
      ? Math.min(routing.forwards, Globals.PROXY_TICK_MAX_FORWARDS)
      : undefined,
    budget: clamped
  }
  
  if (badPath || badVisited) {
    hop.error = new NodeError({
      code: NodeErrorCode.PROXY_HOP_LIMIT,
      message: 'Malformed proxy routing metadata; not forwarding',
      context: { from: hop.from }
    })
    // Refused by this router before any delivery: a routing miss
    hop.error.routing = { miss: true, visited: [], unexplored: [] }
    hop.error[kProxyMiss] = true
  }
  
  return hop
}

/**
 * The error a Router replies with for a proxy request. Only a miss this router
 * produced itself carries routing data (so the previous hop may try another
 * router); any other error — e.g. one thrown by the service's handler, whatever
 * its code — is relayed as a final answer.
 * @private
 */
function toProxyReplyError (error) {
  if (!error?.[kProxyMiss]) return error
  return {
    message: error.message,
    code: error.code,
    [kProxyReplyRouting]: {
      miss: true,
      visited: error.routing?.visited || [],
      unexplored: error.routing?.unexplored || []
    }
  }
}

// Largest delay setTimeout accepts (larger values fire after 1ms)
const MAX_TIMER_MS = 2147483647

export default Router
