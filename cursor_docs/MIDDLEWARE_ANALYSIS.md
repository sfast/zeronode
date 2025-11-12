# Middleware Chain Analysis & Proposal

**Date:** November 11, 2025  
**Issue:** Current implementation doesn't support middleware chains with `next()`

---

## Current Implementation Analysis

### How It Works Now

```javascript
// src/protocol/protocol.js - _handleRequest() (lines 469-544)

const handlers = requestEmitter.getMatchingListeners(envelope.tag)

if (handlers.length === 0) {
  // Send "No handler" error
  return
}

// ❌ PROBLEM: Only calls the FIRST handler!
const handler = handlers[0]

const reply = (responseData) => { /* send response */ }

try {
  const result = handler(envelope, reply)
  if (result !== undefined && !replyCalled) {
    Promise.resolve(result).then(reply).catch(replyError)
  }
} catch (err) {
  replyError(err)
}
```

### Current Handler Signature

```javascript
// Current: (envelope, reply)
server.onRequest('api:user', (envelope, reply) => {
  // envelope.data - request data
  // envelope.tag - event name
  // reply(data) - send response
  
  return { user: 'John' }  // OR use reply({ user: 'John' })
})
```

---

## ❌ Problems with Current Approach

### 1. **Multiple Handlers Ignored**

```javascript
server.onRequest('api:user', (envelope, reply) => {
  console.log('Handler 1')  // ✅ Executes
  return { step: 1 }
})

server.onRequest('api:user', (envelope, reply) => {
  console.log('Handler 2')  // ❌ NEVER EXECUTES!
  return { step: 2 }
})

// Result: Only "Handler 1" runs!
```

### 2. **No Middleware Chain**

Can't do Express-style middleware:

```javascript
// ❌ NOT POSSIBLE with current implementation

// Authentication middleware
server.onRequest('api:*', (envelope, next) => {
  if (!envelope.data.token) {
    return reply({ error: 'Unauthorized' })
  }
  next()  // ← No next() function!
})

// Business logic
server.onRequest('api:user', (envelope, reply) => {
  return { user: 'John' }
})
```

### 3. **Can't Transform Request Data**

```javascript
// ❌ NOT POSSIBLE

// Logging middleware
server.onRequest('*', (envelope, next) => {
  console.log('Request:', envelope.tag)
  envelope.data.timestamp = Date.now()  // Add metadata
  next()
})

// Handler
server.onRequest('api:user', (envelope, reply) => {
  // ❌ timestamp not added because first handler never called next()
})
```

### 4. **Can't Build Reusable Middleware**

```javascript
// ❌ NOT POSSIBLE

// Reusable auth middleware
function authMiddleware(envelope, next) {
  if (verifyToken(envelope.data.token)) {
    next()
  } else {
    reply({ error: 'Unauthorized' })
  }
}

// Reusable logging middleware
function loggingMiddleware(envelope, next) {
  console.log(envelope.tag, envelope.data)
  next()
}

// ❌ Can't compose these!
server.onRequest('api:*', authMiddleware)    // Only this runs
server.onRequest('api:*', loggingMiddleware) // Never runs
server.onRequest('api:user', userHandler)     // Never runs
```

---

## ✅ Proposed Solution: Middleware Chain

### New Handler Signature

```javascript
// Proposed: (envelope, reply, next)
server.onRequest('api:user', (envelope, reply, next) => {
  // envelope - request envelope
  // reply(data) - send response and stop chain
  // next() - pass to next handler
  // next(error) - pass error and stop chain
})
```

### Implementation

```javascript
// src/protocol/protocol.js - _handleRequest()

_handleRequest (buffer) {
  const { socket, requestEmitter, config } = _private.get(this)
  const envelope = new Envelope(buffer)
  
  const handlers = requestEmitter.getMatchingListeners(envelope.tag)
  
  if (handlers.length === 0) {
    // Send "No handler" error
    return this._sendErrorResponse(envelope, 'No handler for request')
  }
  
  // ✅ NEW: Middleware chain execution
  let currentIndex = 0
  let replyCalled = false
  
  const reply = (responseData) => {
    if (replyCalled) return
    replyCalled = true
    
    const responseBuffer = Envelope.createBuffer({
      type: EnvelopType.RESPONSE,
      id: envelope.id,
      data: responseData,
      owner: socket.getId(),
      recipient: envelope.owner
    }, config.BUFFER_STRATEGY)
    socket.sendBuffer(responseBuffer, envelope.owner)
  }
  
  const replyError = (err) => {
    if (replyCalled) return
    replyCalled = true
    
    const errorBuffer = Envelope.createBuffer({
      type: EnvelopType.ERROR,
      id: envelope.id,
      data: {
        message: err.message || err || 'Handler error',
        code: err.code,
        stack: config.DEBUG ? err.stack : undefined
      },
      owner: socket.getId(),
      recipient: envelope.owner
    }, config.BUFFER_STRATEGY)
    socket.sendBuffer(errorBuffer, envelope.owner)
  }
  
  // ✅ NEW: next() function for middleware chain
  const next = (err) => {
    if (replyCalled) return
    
    // If error passed, stop chain and send error
    if (err) {
      replyError(err)
      return
    }
    
    // Move to next handler
    currentIndex++
    
    if (currentIndex >= handlers.length) {
      // No more handlers - send error
      replyError(new Error('No handler completed the request'))
      return
    }
    
    // Execute next handler
    executeHandler(handlers[currentIndex])
  }
  
  const executeHandler = (handler) => {
    try {
      // Call handler with (envelope, reply, next)
      const result = handler(envelope, reply, next)
      
      // If handler returns a value (not using callback), handle it
      if (result !== undefined && !replyCalled) {
        Promise.resolve(result).then((responseData) => {
          reply(responseData)
        }).catch((err) => {
          replyError(err)
        })
      }
    } catch (err) {
      replyError(err)
    }
  }
  
  // Start middleware chain
  executeHandler(handlers[0])
}
```

---

## Usage Examples

### Example 1: Authentication Middleware

```javascript
import Node from 'zeronode'

const server = new Node({ id: 'api-server' })
await server.bind('tcp://0.0.0.0:8000')

// 1. Authentication middleware (runs first)
server.onRequest('api:*', (envelope, reply, next) => {
  const { token } = envelope.data
  
  if (!token) {
    return reply({ error: 'Unauthorized', code: 401 })
  }
  
  // Verify token
  const user = verifyToken(token)
  if (!user) {
    return reply({ error: 'Invalid token', code: 401 })
  }
  
  // Add user to envelope for next handlers
  envelope.user = user
  
  // Continue to next handler
  next()
})

// 2. Logging middleware (runs second)
server.onRequest('api:*', (envelope, reply, next) => {
  console.log(`[${envelope.user.id}] ${envelope.tag}`)
  next()
})

// 3. Business logic (runs third)
server.onRequest('api:users:get', (envelope, reply) => {
  // envelope.user is available from auth middleware!
  return {
    users: getUsersByRole(envelope.user.role)
  }
})
```

### Example 2: Request Transformation

```javascript
// 1. Parse and validate
server.onRequest('api:*', (envelope, reply, next) => {
  try {
    // Validate request schema
    validateSchema(envelope.data)
    
    // Transform data
    envelope.data.parsedAt = Date.now()
    envelope.data.normalized = normalizeData(envelope.data)
    
    next()
  } catch (err) {
    reply({ error: err.message, code: 400 })
  }
})

// 2. Rate limiting
server.onRequest('api:*', async (envelope, reply, next) => {
  const clientId = envelope.owner
  const allowed = await checkRateLimit(clientId)
  
  if (!allowed) {
    return reply({ error: 'Rate limit exceeded', code: 429 })
  }
  
  next()
})

// 3. Handler
server.onRequest('api:process', (envelope, reply) => {
  // Data is already validated and normalized!
  return processData(envelope.data.normalized)
})
```

### Example 3: Error Handling Middleware

```javascript
// 1. Try/catch wrapper
server.onRequest('*', async (envelope, reply, next) => {
  try {
    await next()  // ← Wait for next handlers
  } catch (err) {
    // Centralized error handling
    logError(err)
    reply({
      error: 'Internal server error',
      code: 500,
      requestId: envelope.id
    })
  }
})

// 2. Business logic (can throw errors freely)
server.onRequest('api:user', async (envelope, reply) => {
  const user = await db.getUser(envelope.data.id)
  if (!user) {
    throw new Error('User not found')  // ← Caught by wrapper
  }
  return user
})
```

### Example 4: Conditional Middleware

```javascript
// Only apply to specific routes
server.onRequest(/^api:admin:/, (envelope, reply, next) => {
  // Admin-only middleware
  if (envelope.user.role !== 'admin') {
    return reply({ error: 'Forbidden', code: 403 })
  }
  next()
})

server.onRequest('api:admin:users', (envelope, reply) => {
  // Only admins reach here
  return getAllUsers()
})
```

### Example 5: Reusable Middleware Functions

```javascript
// Reusable middleware library
function authMiddleware(envelope, reply, next) {
  const user = verifyToken(envelope.data.token)
  if (!user) {
    return reply({ error: 'Unauthorized', code: 401 })
  }
  envelope.user = user
  next()
}

function loggingMiddleware(envelope, reply, next) {
  console.log(`[${new Date().toISOString()}] ${envelope.tag}`)
  next()
}

function timingMiddleware(envelope, reply, next) {
  const start = Date.now()
  envelope.once = (eventName, handler) => {
    if (eventName === 'complete') {
      const duration = Date.now() - start
      console.log(`Request took ${duration}ms`)
      handler()
    }
  }
  next()
}

// Compose middleware
server.onRequest('api:*', authMiddleware)
server.onRequest('api:*', loggingMiddleware)
server.onRequest('api:*', timingMiddleware)

// Handler
server.onRequest('api:user', (envelope, reply) => {
  const result = { user: 'John' }
  envelope.once('complete', () => {})  // Trigger timing
  return result
})
```

---

## Comparison: Old vs New

### Old MIDDLEWARE.md Example

```javascript
// From old docs
a.onRequest('foo', ({ body, error, reply, next, head }) => {
  console.log('In first middleware.')
  next()
})

a.onRequest('foo', ({ body, error, reply, next, head }) => {
  console.log('in second middleware.')
  reply()
})
```

### New Proposed API

```javascript
// Cleaner, more standard
server.onRequest('foo', (envelope, reply, next) => {
  console.log('In first middleware.')
  next()
})

server.onRequest('foo', (envelope, reply, next) => {
  console.log('in second middleware.')
  reply({ success: true })
})
```

**Key Differences:**

| Old Docs | New Proposal |
|----------|--------------|
| `{ body, error, reply, next, head }` | `(envelope, reply, next)` |
| Multiple destructured params | Clean, ordered params |
| `body` separate from envelope | `envelope.data` (full access) |
| `head` (unclear purpose) | `envelope` (all metadata) |

---

## Benefits of Middleware Chain

### 1. **Separation of Concerns**

```javascript
// Each middleware does ONE thing
server.onRequest('api:*', authMiddleware)      // Auth
server.onRequest('api:*', loggingMiddleware)   // Logging
server.onRequest('api:*', validationMiddleware)// Validation
server.onRequest('api:user', userHandler)      // Business logic
```

### 2. **Reusability**

```javascript
// Write once, use everywhere
function corsMiddleware(envelope, reply, next) {
  envelope.headers = {
    ...envelope.headers,
    'Access-Control-Allow-Origin': '*'
  }
  next()
}

// Apply to multiple routes
server.onRequest('api:*', corsMiddleware)
server.onRequest('public:*', corsMiddleware)
```

### 3. **Testability**

```javascript
// Test middleware in isolation
import { expect } from 'chai'

it('should reject unauthorized requests', (done) => {
  const envelope = { data: {} }  // No token
  const reply = (data) => {
    expect(data.error).to.equal('Unauthorized')
    done()
  }
  const next = () => {
    throw new Error('Should not call next')
  }
  
  authMiddleware(envelope, reply, next)
})
```

### 4. **Flexibility**

```javascript
// Stop chain at any point
server.onRequest('api:*', (envelope, reply, next) => {
  if (envelope.data.cached) {
    return reply(getFromCache(envelope.data.key))  // Stop here
  }
  next()  // Continue
})
```

---

## Migration Strategy

### Option 1: Breaking Change (Recommended)

Update handler signature to always include `next`:

```javascript
// Old (current)
server.onRequest('event', (envelope, reply) => { ... })

// New (proposed)
server.onRequest('event', (envelope, reply, next) => { ... })
```

**Migration:**
- Update all existing handlers to accept 3 params
- Handlers that don't use `next` can ignore it
- Version bump: `2.0.0`

### Option 2: Backwards Compatible

Make `next` optional by checking handler arity:

```javascript
const executeHandler = (handler) => {
  // Check if handler expects 3 params (has next)
  if (handler.length === 3) {
    // Middleware-style: (envelope, reply, next)
    handler(envelope, reply, next)
  } else {
    // Old-style: (envelope, reply)
    const result = handler(envelope, reply)
    if (result !== undefined) {
      Promise.resolve(result).then(reply).catch(replyError)
    } else {
      // If no return value, assume next handler should run
      next()
    }
  }
}
```

**Benefits:**
- No breaking changes
- Old handlers still work
- New handlers can use middleware pattern

---

## Recommendation

### ✅ **Implement Middleware Chain with `next()`**

**Reasons:**

1. **Industry Standard** - Express, Koa, Fastify all use this pattern
2. **More Flexible** - Enables auth, logging, validation, rate limiting
3. **Better Architecture** - Separation of concerns
4. **Easier Testing** - Test middleware in isolation
5. **Already Documented** - Old MIDDLEWARE.md shows users expect this!

**Implementation Effort:**

- **Low** - ~100 lines of code change in `protocol.js`
- **Tests** - Add middleware chain tests (~50 lines)
- **Docs** - Update examples to show middleware

**Breaking Changes:**

- Handler signature: `(envelope, reply)` → `(envelope, reply, next)`
- But can be backwards compatible with Option 2

---

## Next Steps

1. **Implement middleware chain** in `src/protocol/protocol.js`
2. **Add tests** for middleware execution order
3. **Update documentation** (MIDDLEWARE.md, README.md)
4. **Create examples** showing common middleware patterns
5. **Version bump** to `2.0.0` (or use backwards-compatible approach)

---

## Conclusion

**Current implementation is incomplete** - it only runs the first handler and ignores the rest.

**Middleware chains are essential** for building production-grade microservices with cross-cutting concerns like auth, logging, validation.

**Recommendation:** Implement the proposed middleware chain with `next()` function. This aligns with industry standards and enables powerful composition patterns.

