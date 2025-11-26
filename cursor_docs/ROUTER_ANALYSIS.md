# No Nodes Found - Flow Analysis

## Current Behavior

When you try to send a request but no nodes are found, Zeronode has two distinct error scenarios:

### Scenario 1: Specific Node Not Found (`NODE_NOT_FOUND`)

**Happens when:** You try to reach a specific node by ID that isn't in your routing table.

```javascript
await node.request({
  to: 'api-server-999',  // This node doesn't exist or isn't connected
  event: 'process',
  data: { task: 'important' }
})
```

**Flow:**
```
1. node.request({ to: 'api-server-999', ... })
2. _findRoute('api-server-999')
   - Checks joinedPeers Set
   - Returns null (not found)
3. Throws NodeError
   - code: 'NODE_NOT_FOUND'
   - message: "No route to node 'api-server-999'"
4. Promise rejects immediately
5. NO events emitted
```

**Code:**
```javascript
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
  
  // ... proceed with request
}
```

---

### Scenario 2: No Nodes Match Filter (`NO_NODES_MATCH_FILTER`)

**Happens when:** You use `requestAny()` or `tickAny()` but no peers match the filter.

```javascript
await node.requestAny({
  event: 'ml:infer',
  filter: { role: 'ml-worker', gpu: true },
  data: { model: 'gpt-4' }
})
```

**Flow:**
```
1. node.requestAny({ filter: { role: 'ml-worker', gpu: true }, ... })
2. _getFilteredNodes({ options: filter, ... })
   - Checks all peers in joinedPeers
   - Filters by options match
   - Returns [] (empty array)
3. Creates NodeError
4. Emits 'error' event (generic EventEmitter)
5. Emits NodeEvent.ERROR (structured)
6. Returns Promise.reject(error)
```

**Code:**
```javascript
async requestAny ({ event, data, timeout, filter, down = true, up = true } = {}) {
  const filteredNodes = this._getFilteredNodes({ 
    options: filter, 
    down, 
    up 
  })
  
  if (filteredNodes.length === 0) {
    const error = new NodeError({
      code: NodeErrorCode.NO_NODES_MATCH_FILTER,
      message: 'No nodes match filter criteria',
      context: { filter, down, up, event }
    })
    
    // ✅ Emits events before rejecting
    this.emit('error', error)
    this.emit(NodeEvent.ERROR, {
      source: 'router',
      category: 'filter',
      error
    })
    
    return Promise.reject(error)
  }
  
  const targetNode = this._selectNode(filteredNodes, event)
  return this.request({ to: targetNode, event, data, timeout })
}
```

---

## Key Differences

| Aspect | `NODE_NOT_FOUND` | `NO_NODES_MATCH_FILTER` |
|--------|------------------|-------------------------|
| **Trigger** | `request({ to: 'specific-id' })` | `requestAny({ filter: {...} })` |
| **Emits Events** | ❌ No | ✅ Yes (`error` + `NodeEvent.ERROR`) |
| **Promise** | Throws immediately | Rejects after emitting |
| **Use Case** | Direct routing | Service discovery |

---

## Router Implications

This is **critical** for understanding how to implement router nodes!

### Problem: What should a router do when it can't find a node?

**Current behavior (without router):**
```
Node A → request({ to: 'node-z' })
         ↓
      NODE_NOT_FOUND
         ↓
      Promise rejects
```

**With router - Option 1: Immediate failure**
```
Node A → Router 1 → Check local peers
                     ↓ (not found)
                  Reject immediately
                     ↓
         NODE_NOT_FOUND back to Node A
```

**With router - Option 2: Forward to other routers**
```
Node A → Router 1 → Check local peers
                     ↓ (not found)
                  Forward to Router 2
                     ↓
         Router 2 → Check local peers
                     ↓ (not found)
                  Forward to Router 3
                     ↓
         Router 3 → Check local peers
                     ↓ (not found)
                  NODE_NOT_FOUND back to Node A
```

**With router - Option 3: Fallback to registry lookup**
```
Node A → Router 1 → Check local peers
                     ↓ (not found)
                  Query global registry
                     ↓
         Registry → { node-z: 'router-3' }
                     ↓
         Router 1 → Forward to Router 3
                     ↓
         Router 3 → Deliver to node-z ✅
```

---

## Proposed Router Implementation

### Approach 1: Hook into `_findRoute()`

**Idea:** Intercept routing before NODE_NOT_FOUND is thrown.

```javascript
class RouterNode extends Node {
  constructor(options) {
    super({ ...options, enableRouting: true })
    this.registry = new Map()  // nodeId → { router, lastSeen }
    this.routers = new Set()    // Connected router nodes
  }
  
  // Override _findRoute to add router fallback
  _findRoute(targetId) {
    // First try direct route (normal behavior)
    const directRoute = super._findRoute(targetId)
    if (directRoute) return directRoute
    
    // Not found locally - check registry
    const registryEntry = this.registry.get(targetId)
    if (registryEntry) {
      // Found in registry - route through another router
      return {
        type: 'router',
        targetId,
        routerId: registryEntry.router,
        target: this._getRouterClient(registryEntry.router)
      }
    }
    
    // Not found anywhere
    return null
  }
}
```

### Approach 2: Middleware/Interceptor Pattern

**Idea:** Catch NODE_NOT_FOUND and retry with router fallback.

```javascript
class RouterNode extends Node {
  async request({ to, event, data, timeout }) {
    try {
      // Try normal request first
      return await super.request({ to, event, data, timeout })
    } catch (err) {
      if (err.code === NodeErrorCode.NODE_NOT_FOUND && this.routers.size > 0) {
        // Not found locally - broadcast to routers
        return await this._requestThroughRouters({ to, event, data, timeout })
      }
      throw err
    }
  }
  
  async _requestThroughRouters({ to, event, data, timeout }) {
    // Try each router until one succeeds
    const errors = []
    
    for (const routerId of this.routers) {
      try {
        return await super.request({
          to: routerId,
          event: 'router:forward',
          data: { targetId: to, event, data },
          timeout
        })
      } catch (err) {
        errors.push({ routerId, error: err })
      }
    }
    
    // All routers failed
    throw new NodeError({
      code: NodeErrorCode.NODE_NOT_FOUND,
      message: `Node '${to}' not found in any router`,
      context: { routers: Array.from(this.routers), errors }
    })
  }
}
```

### Approach 3: Explicit Router Methods

**Idea:** New API specifically for routed requests.

```javascript
// Regular request (fails immediately if not found)
await node.request({ to: 'node-x', event: 'ping' })

// Routed request (tries routers if not found)
await node.requestRouted({ to: 'node-x', event: 'ping' })

// Or use requestAny with router filter
await node.requestAny({
  event: 'router:forward',
  filter: { type: 'router' },
  data: { targetId: 'node-x', event: 'ping', data: {} }
})
```

---

## Recommended Solution

**Hybrid Approach: Middleware + Explicit Methods**

```javascript
class RouterNode extends Node {
  constructor(options) {
    super(options)
    this.registry = new Map()
    this.routers = new Set()
    this.enableAutoRouting = options.autoRouting ?? false
  }
  
  // Standard request - optionally auto-route
  async request({ to, event, data, timeout }) {
    if (this.enableAutoRouting) {
      return this._requestWithFallback({ to, event, data, timeout })
    }
    return super.request({ to, event, data, timeout })
  }
  
  // Explicit routed request
  async requestRouted({ to, event, data, timeout }) {
    return this._requestWithFallback({ to, event, data, timeout })
  }
  
  // Internal: try direct, fallback to routers
  async _requestWithFallback({ to, event, data, timeout }) {
    try {
      return await super.request({ to, event, data, timeout })
    } catch (err) {
      if (err.code === NodeErrorCode.NODE_NOT_FOUND) {
        return await this._tryRouters({ to, event, data, timeout })
      }
      throw err
    }
  }
  
  async _tryRouters({ to, event, data, timeout }) {
    // Check registry first
    const location = this.registry.get(to)
    if (location) {
      return this._forwardToRouter(location.router, { to, event, data, timeout })
    }
    
    // Broadcast to all routers
    const promises = Array.from(this.routers).map(routerId =>
      this._forwardToRouter(routerId, { to, event, data, timeout })
        .catch(err => ({ error: err, routerId }))
    )
    
    const results = await Promise.all(promises)
    const success = results.find(r => !r.error)
    
    if (success) return success
    
    throw new NodeError({
      code: NodeErrorCode.NODE_NOT_FOUND,
      message: `Node '${to}' not found in network`,
      context: { to, routers: results }
    })
  }
}
```

---

## Usage Example

```javascript
// Create router nodes
const router1 = new RouterNode({
  id: 'router-1',
  bind: 'tcp://0.0.0.0:5000',
  autoRouting: true
})

const router2 = new RouterNode({
  id: 'router-2',
  bind: 'tcp://0.0.0.0:5001',
  autoRouting: true
})

// Connect routers to each other
await router1.connect({ address: 'tcp://router2:5001' })

// Register router forward handler
router1.onRequest('router:forward', async ({ data }) => {
  const { targetId, event, data: payload } = data
  return router1.request({ to: targetId, event, data: payload })
})

// Regular node connects to router
const client = new Node({ id: 'client-1' })
await client.connect({ address: 'tcp://router1:5000' })

// Client sends request - router handles if not found
try {
  const result = await client.request({
    to: 'some-node-on-router-2',
    event: 'process'
  })
} catch (err) {
  if (err.code === 'NODE_NOT_FOUND') {
    // Truly not found anywhere in the network
  }
}
```

---

## Summary

**Current State:**
- ✅ `NODE_NOT_FOUND` - clear, immediate failure
- ✅ `NO_NODES_MATCH_FILTER` - with event emission
- ❌ No fallback mechanism

**Router State (proposed):**
- ✅ Try local peers first
- ✅ Fallback to router lookup
- ✅ Optional auto-routing
- ✅ Explicit `requestRouted()` for clarity
- ✅ Maintains backward compatibility

**Next Steps:**
1. Implement RouterNode class
2. Add registry sync protocol
3. Add router forward handler
4. Test with multi-router mesh

