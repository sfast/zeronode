# Middleware Architecture Analysis

## Overview

This document analyzes the implementation of Express-style middleware for ZeroNode's request handling layer.

---

## Current Architecture Flow

```
User Code (Any Layer)
  ↓
node.onRequest('pattern', handler)
  ├─→ handlerRegistry.request.on('pattern', handler)
  ├─→ nodeServer.onRequest('pattern', handler)
  └─→ nodeClients.forEach(c => c.onRequest('pattern', handler))
       ↓
Server/Client.onRequest('pattern', handler)
  ↓
Protocol.onRequest('pattern', handler)
  ↓
requestEmitter.on('pattern', handler)
  
  
[REQUEST ARRIVES]
  ↓
TransportEvent.MESSAGE
  ↓
Protocol._handleIncomingMessage(buffer, sender)
  ↓ (switch on envelope.type)
  ↓
Protocol._handleRequest(buffer)   ← MIDDLEWARE GOES HERE
  ↓
const handlers = requestEmitter.getMatchingListeners(envelope.tag)
  ↓
handler(envelope, reply)  ← Currently only calls first handler
```

---

## Key Components

### 1. **Envelope Structure**
```javascript
{
  type: EnvelopType.REQUEST,  // 1 byte
  timestamp: 1699999999,       // 4 bytes
  id: BigInt,                  // 8 bytes (unique per owner+timestamp+counter)
  owner: 'node-a',             // Original sender (requester)
  recipient: 'node-b',         // Target recipient (responder)
  tag: 'api:user:get',         // Event/route pattern
  data: { userId: 123 }        // Payload
}
```

### 2. **Response Envelope Flow** (CRITICAL!)

When responding to a request, the envelope fields are **swapped**:

```javascript
// INCOMING REQUEST
{
  owner: 'node-a',        ← Original requester
  recipient: 'node-b',    ← Us (the responder)
  id: 12345n
}

// OUTGOING RESPONSE
{
  owner: 'node-b',        ← Us (socket.getId())
  recipient: 'node-a',    ← Original requester (envelope.owner)
  id: 12345n              ← Same ID for matching
}
```

**⚠️ CRITICAL**: Never read `envelope.recipient` after modification! Always use `envelope.owner` as the response destination.

---

## Middleware Requirements

### 1. **Handler Signatures** (Arity-based detection)

```javascript
// 2 params: Auto-continue (Moleculer style)
(envelope, reply) => {
  console.log('Request received')
  // Auto-continues to next handler if no reply/return
}

// 3 params: Manual control (Express style)
(envelope, reply, next) => {
  if (!isValid(envelope.data)) {
    return next(new Error('Invalid'))
  }
  next()
}

// 4 params: Error handler
(error, envelope, reply, next) => {
  console.error('Error:', error.message)
  // Send error response or transform it
}
```

### 2. **Reply Function**

```javascript
const reply = (responseData) => {
  if (replyCalled) return
  replyCalled = true
  
  const responseBuffer = Envelope.createBuffer({
    type: EnvelopType.RESPONSE,
    id: envelope.id,              // Same ID for matching
    data: responseData,
    owner: socket.getId(),        // ← Our ID
    recipient: envelope.owner     // ← Original requester (NOT envelope.recipient!)
  }, config.BUFFER_STRATEGY)
  
  socket.sendBuffer(responseBuffer, envelope.owner)
}
```

### 3. **Next Function**

```javascript
const next = (err) => {
  if (replyCalled) return
  
  if (err) {
    // Skip to next error handler
    const errorHandler = findErrorHandler(handlers, currentIndex + 1)
    if (errorHandler) {
      errorHandler(err, envelope, reply, next)
    } else {
      sendErrorResponse(envelope, err)
    }
    return
  }
  
  // Continue to next middleware
  currentIndex++
  if (currentIndex < handlers.length) {
    executeHandler(handlers[currentIndex])
  }
}
```

---

## Implementation Strategy

### Option 1: Keep in Protocol (Minimal Changes)
**Pros:**
- ✅ Single file change
- ✅ All logic in one place
- ✅ Easy to understand

**Cons:**
- ❌ Protocol.js becomes larger (~800+ lines)
- ❌ Mixed concerns (protocol + middleware)

### Option 2: Separate middleware.js (Recommended)
**Pros:**
- ✅ Clean separation of concerns
- ✅ Protocol stays focused on message handling
- ✅ Middleware logic is testable independently
- ✅ Easier to maintain/extend

**Cons:**
- ❌ One more file to understand

---

## Proposed Structure

```
src/protocol/
├── protocol.js          # Protocol layer (uses MiddlewareChain)
├── middleware.js        # NEW: Middleware chain executor
├── client.js            # Client protocol (unchanged)
├── server.js            # Server protocol (unchanged)
├── envelope.js          # Envelope format (unchanged)
├── peer.js              # Peer management (unchanged)
└── protocol-errors.js   # Errors (unchanged)
```

---

## Middleware.js Responsibilities

1. **Handler Execution**
   - Detect handler arity (2, 3, or 4 params)
   - Execute handlers in sequence
   - Handle sync/async results

2. **Error Handling**
   - Catch sync errors (try/catch)
   - Catch async errors (promise.catch)
   - Route errors to error handlers
   - Send error responses

3. **Reply Management**
   - Ensure reply is called only once
   - Support callback style (reply function)
   - Support return value style (return data)
   - Send RESPONSE or ERROR envelopes

4. **Flow Control**
   - `next()` continues to next handler
   - `next(error)` skips to error handler
   - Auto-continue for 2-param handlers

---

## Protocol.js Changes

### Before
```javascript
_handleRequest (buffer) {
  const envelope = new Envelope(buffer)
  const handlers = requestEmitter.getMatchingListeners(envelope.tag)
  
  if (handlers.length === 0) {
    sendErrorResponse(envelope, 'No handler')
    return
  }
  
  const handler = handlers[0]  // Only first handler
  const result = handler(envelope, reply)
  // ... handle result
}
```

### After
```javascript
_handleRequest (buffer) {
  const envelope = new Envelope(buffer)
  const handlers = requestEmitter.getMatchingListeners(envelope.tag)
  
  if (handlers.length === 0) {
    sendErrorResponse(envelope, 'No handler')
    return
  }
  
  // Execute middleware chain
  const chain = new MiddlewareChain(handlers, envelope, this)
  chain.execute()
}
```

---

## Usage Examples

### Example 1: Logging Middleware (Auto-continue)
```javascript
node.onRequest('api:*', (envelope, reply) => {
  console.log(`[${envelope.tag}] from ${envelope.owner}`)
  // No return, no reply → auto-continues
})
```

### Example 2: Auth Middleware (Manual control)
```javascript
node.onRequest('api:*', (envelope, reply, next) => {
  if (!envelope.data.token) {
    return next(new Error('Missing token'))
  }
  
  if (!validateToken(envelope.data.token)) {
    return next(new Error('Invalid token'))
  }
  
  next()  // Continue to business logic
})
```

### Example 3: Business Logic (Return value)
```javascript
node.onRequest('api:user:get', async (envelope, reply) => {
  const user = await db.getUser(envelope.data.userId)
  return { user }  // Auto-sends response
})
```

### Example 4: Error Handler
```javascript
node.onRequest('*', (error, envelope, reply, next) => {
  console.error(`[${envelope.tag}] Error:`, error.message)
  
  // Send error response
  reply.error({
    message: error.message,
    code: error.code || 'INTERNAL_ERROR'
  })
})
```

---

## Testing Strategy

1. **Unit Tests** (middleware.js)
   - Handler arity detection
   - Sync/async execution
   - Error propagation
   - Reply once guarantee

2. **Integration Tests** (protocol.js)
   - Multiple middlewares in sequence
   - Error handlers
   - Mixed 2-param and 3-param handlers
   - Promise rejection handling

3. **End-to-End Tests** (node.js)
   - Real request/response flow
   - Node → Node middleware chain
   - Client → Server middleware chain

---

## Next Steps

1. ✅ Create `middleware.js` with `MiddlewareChain` class
2. ✅ Update `protocol.js` to use `MiddlewareChain`
3. ✅ Add `reply.error()` helper method
4. ✅ Write unit tests for middleware chain
5. ✅ Update integration tests
6. ✅ Update documentation and examples

---

## Design Decisions

### Why separate file?
- **Single Responsibility**: Protocol handles message routing, Middleware handles execution
- **Testability**: Middleware logic can be tested independently
- **Maintainability**: Easier to understand and modify
- **Extensibility**: Future middleware features (e.g., hooks, plugins) live here

### Why arity detection?
- **Flexibility**: Support both simple (2-param) and advanced (3-param) cases
- **Familiarity**: Express developers recognize the pattern
- **Gradual adoption**: Users can start simple, add complexity when needed

### Why `next(error)` instead of `throw`?
- **Control**: Explicitly route errors to error handlers
- **Clarity**: Error handlers are clearly identified (4 params)
- **Compatibility**: `throw` still works (caught by try/catch)

