# Router Implementation - Clean Design ✅

## 🎯 **Key Insight: Use Envelope Fields Naturally**

### **❌ Old Approach (Nesting):**
```javascript
// BAD: Everything nested in data
node.request({
  to: 'router',
  event: '_system:proxy_request',
  data: {
    originalEvent: 'verify',      // ← Redundant nesting
    originalData: { token: 'abc' }, // ← Redundant nesting
    filter: { service: 'auth' }
  },
  metadata: { timeout, down, up }
})
```

### **✅ New Approach (Natural):**
```javascript
// GOOD: Use envelope fields as intended
node.request({
  to: 'router',
  event: '_system:proxy_request',  // System event (router knows to proxy)
  data: { token: 'abc' },          // ACTUAL user data
  metadata: {
    routing: {
      event: 'verify',               // The real event to route
      filter: { service: 'auth' },   // Where to route it
      down: true,
      up: true,
      timeout: 5000
    }
  }
})
```

---

## 📦 **Message Structure**

### **Proxy Request Flow:**

```
Step 1: Client → Router
┌────────────────────────────────────────────┐
│ Envelope (PROXY_REQUEST to router)         │
├────────────────────────────────────────────┤
│ type:      REQUEST                         │
│ event:     '_system:proxy_request'         │
│ data:      { token: 'abc-123' }  ← USER DATA
│ metadata:  {                               │
│   routing: {                               │
│     event: 'verify',         ← REAL EVENT  │
│     filter: { service: 'auth' },           │
│     down: true,                            │
│     up: true,                              │
│     timeout: 5000,                         │
│     requestor: 'payment-service'           │
│   }                                        │
│ }                                          │
└────────────────────────────────────────────┘

Step 2: Router → Auth Service
┌────────────────────────────────────────────┐
│ Envelope (REGULAR REQUEST)                 │
├────────────────────────────────────────────┤
│ type:      REQUEST                         │
│ event:     'verify'          ← REAL EVENT  │
│ data:      { token: 'abc-123' }  ← USER DATA
│ (no metadata needed for final request)    │
└────────────────────────────────────────────┘

Step 3: Auth Service → Router → Client
┌────────────────────────────────────────────┐
│ Envelope (RESPONSE)                        │
├────────────────────────────────────────────┤
│ type:      RESPONSE                        │
│ data:      { valid: true, userId: '123' }  │
│ (automatically routed back by request ID) │
└────────────────────────────────────────────┘
```

---

## 🏗️ **Updated Router Implementation**

### **Router._handleProxyRequest():**

```javascript
async _handleProxyRequest(envelope, reply) {
  // Extract routing info from metadata
  const routing = envelope.metadata?.routing || {}
  const { event, filter, timeout, down, up } = routing
  
  // User data is in envelope.data (clean!)
  const data = envelope.data
  
  // Router performs requestAny with the REAL event and data
  const result = await this.requestAny({
    event,    // ← Real event from metadata
    data,     // ← Real data from envelope
    filter,   // ← Filter from metadata
    down,
    up,
    timeout
  })
  
  reply(result)
}
```

### **Router._handleProxyTick():**

```javascript
_handleProxyTick(envelope) {
  // Extract routing info from metadata
  const routing = envelope.metadata?.routing || {}
  const { event, filter, down, up } = routing
  
  // User data is in envelope.data (clean!)
  const data = envelope.data
  
  // Router performs tickAny with the REAL event and data
  this.tickAny({
    event,    // ← Real event from metadata
    data,     // ← Real data from envelope
    filter,   // ← Filter from metadata
    down,
    up
  })
}
```

---

## ✅ **Benefits of This Approach**

### **1. Clean Separation:**
```javascript
envelope.data      // ← Always user payload (never touched by routing)
envelope.metadata  // ← Always system info (routing, tracing, etc.)
```

### **2. No Data Manipulation:**
```javascript
// Client sends:
data: { token: 'abc-123', amount: 100 }

// Router forwards SAME data (zero-copy):
data: { token: 'abc-123', amount: 100 }

// Service receives EXACT same data:
envelope.data  // { token: 'abc-123', amount: 100 }
```

### **3. Routing Info in Metadata:**
```javascript
metadata: {
  routing: {
    event: 'verify',              // What to call
    filter: { service: 'auth' },  // Where to send
    down: true,                   // Search downstream
    up: true,                     // Search upstream
    timeout: 5000,                // Request timeout
    requestor: 'payment-service'  // Who asked
  }
}
```

### **4. Type Safety:**
```javascript
// Service handlers work the same whether called directly or via router!

// Direct call:
node.request({ to: 'auth', event: 'verify', data: { token: 'abc' } })

// Via router:
node.requestAny({ filter: { service: 'auth' }, event: 'verify', data: { token: 'abc' } })

// Handler receives SAME envelope structure:
authService.onRequest('verify', (envelope, reply) => {
  envelope.data  // { token: 'abc' } ← SAME in both cases!
  envelope.metadata  // null (for direct) or routing info (internal, can be ignored)
})
```

---

## 📊 **Metadata Fields**

### **Routing Metadata Structure:**

```typescript
metadata: {
  routing: {
    event: string,        // The actual event to route
    filter: Object,       // Filter for finding target nodes
    down: boolean,        // Search downstream connections
    up: boolean,          // Search upstream connections
    timeout?: number,     // Request timeout (requests only)
    requestor: string     // Original requestor node ID
  }
}
```

### **Example Values:**

```javascript
metadata: {
  routing: {
    event: 'verify',
    filter: { service: 'auth', version: '1.0' },
    down: true,
    up: true,
    timeout: 5000,
    requestor: 'payment-service-abc'
  }
}
```

---

## 🎉 **Summary of Changes**

### **Node.js:**
```javascript
// requestAny fallback
data,  // ← User data (unchanged)
metadata: {
  routing: {
    event,   // ← Real event moved here
    filter,  // ← Filter here
    down, up, timeout
  }
}
```

### **Router.js:**
```javascript
// Extract from correct places
const { event, filter, down, up, timeout } = envelope.metadata.routing
const data = envelope.data  // ← User data

// Forward with real event/data
this.requestAny({ event, data, filter, down, up, timeout })
```

---

## ✨ **Why This is Better**

1. **User data never modified** - Services see exact same data structure
2. **Natural envelope usage** - `event` is the event, `data` is the data
3. **Metadata for system info** - Routing information stays in metadata where it belongs
4. **Clean abstractions** - Each field has one clear purpose
5. **Easy debugging** - Can log `envelope.data` without seeing routing noise

**This is the clean, correct design!** 🎯

