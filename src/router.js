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
    const { event, filter, timeout, down, up, requestor } = routing
    
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
      // Router performs requestAny on its own network
      const result = await this.requestAny({
        event,
        data,
        filter,
        down: down !== undefined ? down : true,
        up: up !== undefined ? up : true,
        timeout
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
      
      reply.error(error)
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
    
    try {
      // Router performs tickAny on its own network
      this.tickAny({
        event,
        data,
        filter,
        down: down !== undefined ? down : true,
        up: up !== undefined ? up : true
      })
      
      if (scope.enableStats) {
        scope.stats.successfulRoutes++
      }
      
      if (scope.debugLogging) {
        this.getLogger().debug(`[Router] Successfully routed tick for event: ${event}`)
      }
      
    } catch (error) {
      if (scope.enableStats) {
        scope.stats.failedRoutes++
      }
      
      if (scope.debugLogging) {
        this.getLogger().warn(
          `[Router] Failed to route tick - ` +
          `Event: ${event}, ` +
          `Error: ${error.message}`
        )
      }
    }
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

export default Router

