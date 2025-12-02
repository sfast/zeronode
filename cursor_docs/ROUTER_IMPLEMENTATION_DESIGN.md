# Router Implementation Design

## 🎯 **Core Concept**

When `requestAny()` or `tickAny()` can't find a matching node locally, automatically fallback to router nodes for service discovery.

---

## 📐 **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│                    Node.requestAny()                         │
│                                                              │
│  1. Try local discovery (existing logic)                    │
│     ├─ Find matching nodes with filter                      │
│     └─ If found → send direct request                       │
│                                                              │
│  2. Router fallback (NEW)                                   │
│     ├─ Find nodes with { router: true }                     │
│     ├─ If found → send system event to router              │
│     │   Event: '_system:proxy_request'                      │
│     │   Data: { event, data, filter }                       │
│     │   Metadata: { timeout, down, up }                     │
│     └─ Router performs requestAny on its network           │
│                                                              │
│  3. No match (error)                                        │
│     └─ Throw NodeError: NO_NODES_MATCH_FILTER              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 **Implementation Details**

### **Step 1: Node Layer Changes**

#### **Modify `requestAny()` to add router fallback:**

```javascript
// In src/node.js

async requestAny({ event, data, timeout, filter, down = true, up = true } = {}) {
  // Extract options and predicate from filter
  const filterOptions = filter?.options || (filter?.predicate ? undefined : filter)
  const filterPredicate = filter?.predicate
  
  // ============================================================================
  // 1. TRY LOCAL DISCOVERY FIRST
  // ============================================================================
  const filteredNodes = this._getFilteredNodes({ 
    options: filterOptions, 
    predicate: filterPredicate, 
    down, 
    up 
  })
  
  if (filteredNodes.length > 0) {
    const targetNode = this._selectNode(filteredNodes, event)
    return this.request({ to: targetNode, event, data, timeout })
  }
  
  // ============================================================================
  // 2. ROUTER FALLBACK (if no local match)
  // ============================================================================
  
  // Predicate functions cannot be serialized over network
  if (filterPredicate) {
    throw new NodeError({
      code: NodeErrorCode.PREDICATE_NOT_ROUTABLE,
      message: 'Predicate filters cannot be forwarded to router. Use object-based filters for router fallback.',
      context: { event, down, up }
    })
  }
  
  // Find routers (always search both directions for maximum discovery)
  const routers = this._getFilteredNodes({
    options: { router: true },
    down: true,
    up: true
  })
  
  if (routers.length > 0) {
    const routerNode = this._selectNode(routers, event)
    const _scope = _private.get(this)
    
    _scope.logger.debug(`[Router Fallback] Forwarding requestAny to router: ${routerNode}`)
    
    // Send proxy request to router via system event
    return this.request({
      to: routerNode,
      event: '_system:proxy_request',
      data: {
        originalEvent: event,
        originalData: data,
        filter: filterOptions
      },
      metadata: {
        routing: {
          timeout,
          down,
          up,
          requestor: this.getId()
        }
      },
      timeout
    })
  }
  
  // ============================================================================
  // 3. NO MATCH (neither local nor router)
  // ============================================================================
  throw new NodeError({
    code: NodeErrorCode.NO_NODES_MATCH_FILTER,
    message: 'No nodes match filter and no routers available',
    context: { filter, down, up, event }
  })
}
```

#### **Similarly for `tickAny()`:**

```javascript
tickAny({ event, data, filter, down = true, up = true } = {}) {
  const filterOptions = filter?.options || (filter?.predicate ? undefined : filter)
  const filterPredicate = filter?.predicate
  
  // 1. Try local discovery
  const filteredNodes = this._getFilteredNodes({ 
    options: filterOptions, 
    predicate: filterPredicate, 
    down, 
    up 
  })
  
  if (filteredNodes.length > 0) {
    const targetNode = this._selectNode(filteredNodes, event)
    return this.tick({ to: targetNode, event, data })
  }
  
  // 2. Router fallback
  if (filterPredicate) {
    // Ticks fail silently (fire-and-forget semantics)
    const _scope = _private.get(this)
    _scope.logger.warn('[Router Fallback] Predicate filters cannot be forwarded to router for tickAny')
    return
  }
  
  const routers = this._getFilteredNodes({
    options: { router: true },
    down: true,
    up: true
  })
  
  if (routers.length > 0) {
    const routerNode = this._selectNode(routers, event)
    const _scope = _private.get(this)
    
    _scope.logger.debug(`[Router Fallback] Forwarding tickAny to router: ${routerNode}`)
    
    // Send proxy tick to router via system event
    this.tick({
      to: routerNode,
      event: '_system:proxy_tick',
      data: {
        originalEvent: event,
        originalData: data,
        filter: filterOptions
      },
      metadata: {
        routing: {
          down,
          up,
          requestor: this.getId()
        }
      }
    })
    return
  }
  
  // 3. No match - ticks fail silently
  const _scope = _private.get(this)
  _scope.logger.debug(`[Node] No nodes match filter for tickAny event: ${event}`)
}
```

---

### **Step 2: Router Node Implementation**

#### **Enable routing on a node:**

```javascript
// In src/node.js

/**
 * Enable routing - allows this node to act as a router
 * Routers forward requests/ticks from other nodes that can't find local matches
 */
enableRouting() {
  const _scope = _private.get(this)
  
  // Set router flag in options
  this.setOptions({ ...this.getOptions(), router: true })
  
  // Register system event handlers for proxy requests/ticks
  this.onRequest('_system:proxy_request', this._handleProxyRequest.bind(this))
  this.onTick('_system:proxy_tick', this._handleProxyTick.bind(this))
  
  _scope.logger.info('[Node] Routing enabled')
}

/**
 * Disable routing
 */
disableRouting() {
  const _scope = _private.get(this)
  
  // Remove router flag
  const options = { ...this.getOptions() }
  delete options.router
  this.setOptions(options)
  
  // Unregister handlers
  this.offRequest('_system:proxy_request', this._handleProxyRequest)
  this.offTick('_system:proxy_tick', this._handleProxyTick)
  
  _scope.logger.info('[Node] Routing disabled')
}

/**
 * Handle incoming proxy request from another node
 * @private
 */
async _handleProxyRequest(envelope, reply) {
  const _scope = _private.get(this)
  const { originalEvent, originalData, filter } = envelope.data
  const { timeout, down, up } = envelope.metadata?.routing || {}
  
  _scope.logger.debug(`[Router] Proxying requestAny for event: ${originalEvent}`)
  
  try {
    // Router performs requestAny on its own network
    const result = await this.requestAny({
      event: originalEvent,
      data: originalData,
      filter,
      down,
      up,
      timeout
    })
    
    reply(result)
  } catch (error) {
    _scope.logger.warn(`[Router] Failed to route request: ${error.message}`)
    reply(null, error)
  }
}

/**
 * Handle incoming proxy tick from another node
 * @private
 */
_handleProxyTick(envelope) {
  const _scope = _private.get(this)
  const { originalEvent, originalData, filter } = envelope.data
  const { down, up } = envelope.metadata?.routing || {}
  
  _scope.logger.debug(`[Router] Proxying tickAny for event: ${originalEvent}`)
  
  try {
    // Router performs tickAny on its own network
    this.tickAny({
      event: originalEvent,
      data: originalData,
      filter,
      down,
      up
    })
  } catch (error) {
    _scope.logger.warn(`[Router] Failed to route tick: ${error.message}`)
  }
}
```

---

## 📋 **Usage Examples**

### **Example 1: Simple Service Discovery**

```javascript
// Create router
const router = new Node({
  bind: 'tcp://127.0.0.1:3000',
  options: { name: 'router' }
})
await router.bind()
router.enableRouting()  // ← Enable routing

// Create service A (connected to router)
const serviceA = new Node({
  bind: 'tcp://127.0.0.1:3001',
  options: { service: 'auth' }
})
await serviceA.bind()
await serviceA.connect({ address: router.getAddress() })

// Register handler
serviceA.onRequest('verify', (envelope, reply) => {
  reply({ valid: true })
})

// Create service B (connected to router)
const serviceB = new Node({
  bind: 'tcp://127.0.0.1:3002',
  options: { service: 'payment' }
})
await serviceB.bind()
await serviceB.connect({ address: router.getAddress() })

// Service B discovers and calls Service A via router
const result = await serviceB.requestAny({
  filter: { service: 'auth' },
  event: 'verify',
  data: { token: 'abc123' }
})
// → Router automatically forwards request to Service A
// → Service A replies
// → Router forwards response back to Service B
```

### **Example 2: Multiple Routers (Round-Robin)**

```javascript
// Service connects to multiple routers for redundancy
const service = new Node({ bind: 'tcp://127.0.0.1:3001' })
await service.bind()
await service.connect({ address: 'tcp://router1:3000' })
await service.connect({ address: 'tcp://router2:3000' })

// requestAny will use round-robin to select router if needed
const result = await service.requestAny({
  filter: { service: 'worker' },
  event: 'process',
  data: { job: 123 }
})
// → Tries local first
// → Falls back to router1 or router2 (round-robin)
```

---

## 🔍 **Key Design Decisions**

### **1. Why System Events?**
- ✅ **Protected**: `_system:` prefix prevents user spoofing
- ✅ **Existing infrastructure**: Already validated in Protocol layer
- ✅ **Request/response semantics**: System events support replies
- ✅ **No new envelope types needed**: Reuses existing infrastructure

### **2. Why Metadata for Routing Info?**
- ✅ **Clean separation**: User data (`data`) vs. system info (`metadata`)
- ✅ **Extensible**: Can add more routing fields later
- ✅ **Optional**: Doesn't affect non-routing messages

### **3. Predicate Functions?**
- ❌ **Cannot be routed**: Functions can't be serialized
- ✅ **Error for requests**: Throw explicit error
- ✅ **Silent for ticks**: Log warning, fail gracefully

### **4. Router Discovery**
- ✅ **Always search both directions**: `down: true, up: true`
- ✅ **Automatic**: Finds nodes with `{ router: true }`
- ✅ **Round-robin**: Fair distribution across multiple routers

---

## 🚨 **Edge Cases & Safety**

### **1. Cascading Routers**
**Problem**: Router A forwards to Router B?

**Solution**: Router calls its own `requestAny()`, which tries local first. If Router B is connected to Router A and has the service, it works. If not, Router A would try to forward to another router (cascading).

**Options:**
- **Allow cascading**: Simple, but risk of loops
- **Prevent cascading**: Routers don't use router fallback (only local)
- **Hop limit**: Add hop count in metadata, max 3 hops

**Recommendation**: Start with **allow cascading** but add logging to detect loops.

### **2. Circular Routes**
**Problem**: Node A → Router → Node A

**Solution**: Router's `requestAny()` excludes the original requestor (already different node ID, so won't match).

### **3. Router Dies**
**Problem**: Router crashes mid-request

**Solution**: Request timeout fires, client can retry with another router (if available).

---

## 📊 **Performance Impact**

### **Overhead:**
- **Local match**: 0ms (no change)
- **Router fallback**: +1 network hop (~1-5ms on LAN)
- **Metadata**: +~50-100 bytes per routed message

### **Benefits:**
- **Service discovery**: No need for external service registry
- **Dynamic routing**: Services can join/leave freely
- **Fault tolerance**: Multiple routers provide redundancy

---

## 🛠️ **Implementation Plan**

### **Phase 1: Basic Router Fallback** ✅ Ready to implement
1. Update `Node.requestAny()` with router fallback logic
2. Update `Node.tickAny()` with router fallback logic
3. Add `Node.enableRouting()` / `disableRouting()`
4. Add `_handleProxyRequest()` / `_handleProxyTick()` handlers
5. Add `NodeErrorCode.PREDICATE_NOT_ROUTABLE`

### **Phase 2: Testing**
1. Unit tests for router fallback logic
2. Integration tests with router + services
3. Test predicate rejection
4. Test multiple routers (round-robin)

### **Phase 3: Advanced Features** (Optional)
1. Hop limit for cascading
2. Router statistics (requests routed, success rate)
3. Router health checks
4. Priority routing (prefer certain routers)

---

## 🤔 **Questions for You:**

1. **Cascading**: Allow routers to forward to other routers? Or prevent it?
2. **Hop limit**: Should we add a hop count to prevent infinite loops?
3. **Router selection**: Round-robin good? Or prefer closest/fastest router?
4. **Statistics**: Should routers track routing metrics?

---

## 💡 **My Recommendation:**

Start with the **simple approach**:
- ✅ Allow cascading (simple, works for most cases)
- ✅ Add debug logging to detect loops
- ✅ Use round-robin for router selection
- ✅ No hop limit initially (add later if needed)

This keeps the implementation clean and easy to reason about. We can add hop limits and advanced features later if needed.

**Ready to implement?** 🚀

