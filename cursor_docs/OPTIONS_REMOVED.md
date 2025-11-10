# Options Completely Removed from Protocol/Client/Server

## Architectural Decision

**Options are ONLY managed by Node** (high-level orchestrator).

Protocol, Client, and Server are messaging/communication layers and should NOT handle application metadata.

---

## What Changed

### ✅ Protocol
```javascript
// Before:
constructor (socket, options = {}) { ... }

// After:
constructor (socket) { ... }  // No options!
```

### ✅ Client
```javascript
// Before:
constructor ({ id, options, config }) {
  this._scope.options = options
}
getOptions() { ... }
setOptions(options) { ... }

// After:
constructor ({ id, config }) {  // No options parameter!
  // No options storage
}
// No getOptions(), no setOptions()
```

### ✅ Server
```javascript
// Before:
constructor ({ id, options, config }) {
  this._scope.options = options
}
getOptions() { ... }
setOptions(options) { ... }

// After:
constructor ({ id, config }) {  // No options parameter!
  // No options storage
}
// No getOptions(), no setOptions()
```

---

## Removed Features

### Client:
- ❌ `getOptions()`
- ❌ `setOptions(options, notify)`
- ❌ `events.OPTIONS_SYNC` handling
- ❌ Sending `clientOptions` in handshake

### Server:
- ❌ `getOptions()`
- ❌ `setOptions(options, notify)`
- ❌ `events.OPTIONS_SYNC` handling
- ❌ Sending `serverOptions` in handshake
- ❌ Broadcasting options changes

### Protocol:
- ❌ `options` parameter
- ❌ `getOptions()`
- ❌ `setOptions(options)`
- ❌ Peer tracking (also removed)

---

## Simplified Handshakes

### Client → Server Handshake:
```javascript
// Before:
this.tick({
  event: events.CLIENT_CONNECTED,
  data: {
    clientId: this.getId(),
    clientOptions: this.getOptions(),  // ❌ Removed
    timestamp: Date.now()
  }
})

// After:
this.tick({
  event: events.CLIENT_CONNECTED,
  data: {
    clientId: this.getId(),
    timestamp: Date.now()
  }
})
```

### Server → Client Welcome:
```javascript
// Before:
this.tick({
  to: peerId,
  event: events.CLIENT_CONNECTED,
  data: {
    serverId: this.getId(),
    serverOptions: this.getOptions()  // ❌ Removed
  }
})

// After:
this.tick({
  to: peerId,
  event: events.CLIENT_CONNECTED,
  data: {
    serverId: this.getId()
  }
})
```

---

## Architecture: Where Options Belong

```
┌─────────────────────────────────────────┐
│ Node (High-level)                       │
│ ✅ Options stored HERE                  │
│ ✅ Application metadata                 │
│ ✅ Service discovery                    │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼──────┐       ┌───────▼──────┐
│ Server       │       │ Client       │
│ ❌ No options│       │ ❌ No options│
│ ✅ Messaging │       │ ✅ Messaging │
│ ✅ Peers     │       │ ✅ Server    │
└───────┬──────┘       └───────┬──────┘
        │                      │
        └──────────┬───────────┘
                   │
        ┌──────────▼──────────┐
        │ Protocol            │
        │ ❌ No options       │
        │ ✅ Request/Response │
        │ ✅ Event Translation│
        └──────────┬──────────┘
                   │
        ┌──────────▼──────────┐
        │ Socket              │
        │ ❌ No options       │
        │ ✅ Pure Transport   │
        └─────────────────────┘
```

---

## Benefits

### 🎯 Single Responsibility
- **Node:** Application orchestration + metadata (options)
- **Server/Client:** Messaging + peer management
- **Protocol:** Message protocol
- **Socket:** Transport

### 🧹 Simpler Codebase
- **Removed ~100 lines** of options handling
- No options syncing
- No options broadcasting
- Cleaner constructors

### 📉 Less Network Traffic
- No `OPTIONS_SYNC` messages
- Smaller handshakes
- Less overhead

### 🐛 Fewer Edge Cases
- No options sync conflicts
- No broadcast issues
- No state duplication

---

## If You Need Options

**Use Node:**
```javascript
const node = new Node({
  id: 'my-node',
  bind: 'tcp://127.0.0.1:5000',
  options: {
    service: 'auth-service',
    version: '1.0.0',
    region: 'us-west'
  }
})

// Access options
node.getOptions()
node.setOptions({ ... })
```

**NOT in Client/Server:**
```javascript
// ❌ DON'T DO THIS (no longer supported):
const server = new Server({ 
  id: 'server-1', 
  options: { ... }  // ❌ Removed!
})

// ✅ DO THIS instead - use Node:
const node = new Node({ 
  options: { ... }  // ✅ Correct layer
})
```

---

## Migration Guide

### Before (OLD):
```javascript
// OLD: Options in Server/Client
const server = new Server({
  id: 'server-1',
  options: { service: 'auth' },
  config: { ... }
})

server.getOptions()
server.setOptions({ ... })
```

### After (NEW):
```javascript
// NEW: No options in Server/Client
const server = new Server({
  id: 'server-1',
  config: { ... }  // Only config
})

// Use Node for options
const node = new Node({
  bind: '...',
  options: { service: 'auth' }
})
```

---

## Summary

✅ **Protocol:** Pure messaging layer (no options)  
✅ **Client:** Pure client messaging (no options)  
✅ **Server:** Pure server messaging (no options)  
✅ **Node:** Application layer (ONLY place for options)

**Result:** Clean, simple, single-responsibility architecture!

