# Envelope with Error Property Analysis

**Date:** November 11, 2025  
**Proposal:** Add `error` property to envelope itself

---

## Current Envelope Structure

```javascript
class Envelope {
  get type()       // TICK, REQUEST, RESPONSE, ERROR
  get id()         // Request ID
  get owner()      // Sender
  get recipient()  // Target
  get tag()        // Event name
  get timestamp()  // When sent
  get data()       // Payload (lazy deserialized)
}
```

---

## Proposed: Add `error` Property to Envelope

### Option A: `error` as Top-Level Property

```javascript
class Envelope {
  // ... existing properties ...
  get data()   // Success data OR null
  get error()  // Error object OR null
}

// Usage in handler
server.onRequest('api:user', (envelope, reply, next) => {
  // Check if request came with error
  if (envelope.error) {
    console.error('Client sent error:', envelope.error)
    return reply.error(envelope.error)
  }
  
  // Normal processing
  const userId = envelope.data.userId
  const user = await db.getUser(userId)
  
  reply.send({ user })
})
```

### Option B: Unified Handler Signature

```javascript
// Single signature handles both success and error!
server.onRequest('api:user', (envelope, reply, next) => {
  // envelope.data - request data (or null if error)
  // envelope.error - error object (or null if success)
  
  if (envelope.error) {
    // Handle error case
    console.error('Error from upstream:', envelope.error)
    return reply.error(envelope.error)
  }
  
  // Handle success case
  const user = await db.getUser(envelope.data.userId)
  reply.send({ user })
})
```

---

## Benefits of This Approach

### 1. **Unified Handler Signature** ✅

**Before (two signatures):**
```javascript
// Regular handler (3 params)
server.onRequest('api:user', (envelope, reply, next) => { ... })

// Error handler (4 params)
server.onRequest('*', (error, envelope, reply, next) => { ... })
```

**After (one signature):**
```javascript
// Single handler for both!
server.onRequest('api:user', (envelope, reply, next) => {
  if (envelope.error) {
    // Handle error
  } else {
    // Handle success
  }
})
```

### 2. **Error Context Preserved** ✅

```javascript
server.onRequest('api:user', (envelope, reply, next) => {
  if (envelope.error) {
    // You have BOTH error AND full envelope context!
    console.error('Error from:', envelope.owner)
    console.error('Request ID:', envelope.id)
    console.error('Error:', envelope.error.message)
    console.error('Original request data:', envelope.data)
    
    reply.error(envelope.error)
  }
})
```

### 3. **Middleware Can Check Errors Early** ✅

```javascript
// Logging middleware
server.onRequest('*', (envelope, reply, next) => {
  if (envelope.error) {
    console.error(`[ERROR] ${envelope.tag}: ${envelope.error.message}`)
    // Can still pass to next error handler
    return next()
  }
  
  console.log(`[REQUEST] ${envelope.tag}`)
  next()
})
```

### 4. **Natural Flow** ✅

```javascript
// Auth middleware
server.onRequest('api:*', (envelope, reply, next) => {
  if (envelope.error) {
    // Don't try to auth if there's already an error
    return next()
  }
  
  const { token } = envelope.data
  if (!verifyToken(token)) {
    // Set error on envelope!
    envelope.error = new Error('Unauthorized')
    envelope.error.code = 'AUTH_FAILED'
    return next()
  }
  
  next()
})

// Business logic
server.onRequest('api:user', (envelope, reply, next) => {
  if (envelope.error) {
    return reply.error(envelope.error)
  }
  
  // Only runs if no error
  const user = await db.getUser(envelope.data.userId)
  reply.send({ user })
})
```

---

## Implementation Details

### Enhanced Envelope Class

```javascript
class Envelope {
  constructor(buffer) {
    this._buffer = buffer
    this._data = undefined
    this._error = undefined
    this._parsed = false
  }
  
  // ... existing getters (type, id, owner, etc.) ...
  
  get data() {
    if (!this._parsed) {
      this._parseData()
    }
    return this._data
  }
  
  get error() {
    if (!this._parsed) {
      this._parseData()
    }
    return this._error
  }
  
  // Allow setting error (for middleware)
  set error(err) {
    this._error = err
  }
  
  _parseData() {
    if (this._parsed) return
    this._parsed = true
    
    // Parse data from buffer
    const dataBuffer = this._buffer.slice(93)
    if (dataBuffer.length === 0) {
      this._data = null
      this._error = null
      return
    }
    
    try {
      const parsed = msgpack.decode(dataBuffer)
      
      // If envelope type is ERROR, treat data as error
      if (this.type === EnvelopType.ERROR) {
        this._error = {
          message: parsed.message || 'Unknown error',
          code: parsed.code,
          stack: parsed.stack,
          ...parsed
        }
        this._data = null
      } else {
        this._data = parsed
        this._error = null
      }
    } catch (err) {
      this._error = err
      this._data = null
    }
  }
  
  // Check if envelope represents success
  get isSuccess() {
    return this.type !== EnvelopType.ERROR && !this.error
  }
  
  // Check if envelope represents error
  get isError() {
    return this.type === EnvelopType.ERROR || !!this.error
  }
}
```

---

## Usage Patterns

### Pattern 1: Simple Success/Error Check

```javascript
server.onRequest('api:user', (envelope, reply, next) => {
  // Quick check
  if (envelope.isError) {
    return reply.error(envelope.error)
  }
  
  // Process success
  const user = await db.getUser(envelope.data.userId)
  reply.send({ user })
})
```

### Pattern 2: Early Return Middleware

```javascript
// Auth middleware
server.onRequest('api:*', (envelope, reply, next) => {
  // Skip auth if already errored
  if (envelope.error) return next()
  
  // Verify auth
  if (!envelope.data.token) {
    envelope.error = new Error('No token')
    envelope.error.code = 'AUTH_TOKEN_MISSING'
    return next()  // Pass to next handler with error set
  }
  
  next()
})

// Rate limit middleware
server.onRequest('api:*', (envelope, reply, next) => {
  // Skip if already errored
  if (envelope.error) return next()
  
  // Check rate limit
  if (isRateLimited(envelope.owner)) {
    envelope.error = new Error('Rate limit exceeded')
    envelope.error.code = 'RATE_LIMIT'
    return next()
  }
  
  next()
})

// Final handler
server.onRequest('api:user', (envelope, reply, next) => {
  // Check for any errors from middleware
  if (envelope.error) {
    return reply.error(envelope.error)
  }
  
  // All checks passed!
  const user = await db.getUser(envelope.data.userId)
  reply.send({ user })
})
```

### Pattern 3: Error Transformation

```javascript
server.onRequest('*', (envelope, reply, next) => {
  if (envelope.error) {
    // Transform error before sending
    envelope.error = {
      message: envelope.error.message,
      code: envelope.error.code || 'INTERNAL_ERROR',
      requestId: envelope.id,
      timestamp: Date.now(),
      path: envelope.tag
    }
    
    return reply.error(envelope.error)
  }
  
  next()
})
```

### Pattern 4: Conditional Error Handling

```javascript
server.onRequest('api:*', (envelope, reply, next) => {
  if (envelope.error) {
    // Only handle auth errors, let others pass through
    if (envelope.error.code === 'AUTH_FAILED') {
      return reply.status(401).error(envelope.error)
    }
    
    // Pass to next error handler
    return next()
  }
  
  next()
})
```

---

## Comparison: With vs Without `envelope.error`

### Without `envelope.error` (Separate Error Handlers)

```javascript
// Regular middleware (3 params)
server.onRequest('api:*', (envelope, reply, next) => {
  if (!envelope.data.token) {
    // Create error and pass to error handler
    const error = new Error('No token')
    error.code = 'AUTH_FAILED'
    return next(error)
  }
  next()
})

// Error handler (4 params - detected by arity)
server.onRequest('*', (error, envelope, reply, next) => {
  console.error('Error:', error.message)
  reply.error(error)
})
```

### With `envelope.error` (Unified)

```javascript
// Single handler type
server.onRequest('api:*', (envelope, reply, next) => {
  if (envelope.error) {
    // Already has error, skip processing
    return next()
  }
  
  if (!envelope.data.token) {
    // Set error on envelope
    envelope.error = new Error('No token')
    envelope.error.code = 'AUTH_FAILED'
    return next()
  }
  
  next()
})

// Final handler
server.onRequest('*', (envelope, reply, next) => {
  if (envelope.error) {
    console.error('Error:', envelope.error.message)
    return reply.error(envelope.error)
  }
  
  next()
})
```

---

## Pros and Cons

### ✅ Pros

1. **Unified Signature** - All handlers use `(envelope, reply, next)`
2. **Simpler Mental Model** - No need to remember 3-param vs 4-param
3. **Natural Flow** - Error flows through middleware chain
4. **Full Context** - Error + original request data + metadata all together
5. **Flexible** - Middleware can check/set/transform errors
6. **TypeScript Friendly** - One handler type instead of two

### ❌ Cons

1. **Not Express Standard** - Express uses separate error handlers
2. **Manual Checking** - Every handler needs `if (envelope.error)` check
3. **Mutability** - Middleware can modify `envelope.error`
4. **Less Explicit** - Not obvious which handlers handle errors
5. **Mixed Concerns** - Success and error logic in same handler

---

## Hybrid Approach: Best of Both Worlds?

### Support BOTH Patterns!

```javascript
// Pattern 1: Check envelope.error yourself
server.onRequest('api:user', (envelope, reply, next) => {
  if (envelope.error) {
    return reply.error(envelope.error)
  }
  
  const user = await db.getUser(envelope.data.userId)
  reply.send({ user })
})

// Pattern 2: Dedicated error handler (4 params)
server.onRequest('*', (error, envelope, reply, next) => {
  // Auto-called when envelope.error exists!
  console.error('Error:', error.message)
  reply.error(error)
})

// Implementation: Check handler arity
if (handler.length === 4) {
  // Error handler - only call if envelope.error exists
  if (envelope.error) {
    handler(envelope.error, envelope, reply, next)
  } else {
    next()  // Skip error handlers if no error
  }
} else {
  // Regular handler - always call
  handler(envelope, reply, next)
}
```

---

## Real-World Example: Complete Flow

```javascript
import Node from 'zeronode'

const server = new Node({ id: 'api-server' })
await server.bind('tcp://0.0.0.0:8000')

// 1. Logging middleware (runs for all requests)
server.onRequest('*', (envelope, reply, next) => {
  if (envelope.error) {
    console.error(`[ERROR] ${envelope.tag}: ${envelope.error.message}`)
  } else {
    console.log(`[REQUEST] ${envelope.tag} from ${envelope.owner}`)
  }
  next()
})

// 2. Auth middleware
server.onRequest('api:*', (envelope, reply, next) => {
  // Skip if already errored
  if (envelope.error) return next()
  
  const { token } = envelope.data
  if (!token) {
    envelope.error = new Error('No token provided')
    envelope.error.code = 'AUTH_TOKEN_MISSING'
    return next()
  }
  
  try {
    envelope.user = verifyToken(token)
    next()
  } catch (err) {
    envelope.error = err
    envelope.error.code = 'AUTH_TOKEN_INVALID'
    next()
  }
})

// 3. Rate limiting middleware
server.onRequest('api:*', (envelope, reply, next) => {
  // Skip if already errored
  if (envelope.error) return next()
  
  if (isRateLimited(envelope.owner)) {
    envelope.error = new Error('Rate limit exceeded')
    envelope.error.code = 'RATE_LIMIT'
    return next()
  }
  
  next()
})

// 4. Business logic handlers
server.onRequest('api:user:get', async (envelope, reply, next) => {
  // Check for errors from middleware
  if (envelope.error) {
    return reply.error(envelope.error)
  }
  
  // All middleware passed!
  const userId = envelope.data.userId
  const user = await db.getUser(userId)
  
  reply.send({ user })
})

server.onRequest('api:user:create', async (envelope, reply, next) => {
  if (envelope.error) {
    return reply.error(envelope.error)
  }
  
  const user = await db.createUser(envelope.data)
  reply.send({ user, created: true })
})

// 5. Global error handler (catches any unhandled errors)
server.onRequest('*', (error, envelope, reply, next) => {
  // This runs if envelope.error exists and wasn't handled above
  console.error('Unhandled error:', error.message)
  
  reply.error({
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId: envelope.id
  })
})
```

---

## Recommendation

### ✅ **YES - Add `envelope.error` Property!**

**But support BOTH patterns:**

1. **Manual checking:** `if (envelope.error) { ... }`
2. **Dedicated error handlers:** 4-param handlers auto-called when `envelope.error` exists

### Implementation Strategy

```javascript
class Envelope {
  // Add error property
  get error() { ... }
  set error(err) { ... }
  
  // Helper methods
  get isSuccess() { return !this.error }
  get isError() { return !!this.error }
}

// In middleware chain executor
function executeHandler(handler) {
  if (handler.length === 4) {
    // Error handler - only call if error exists
    if (envelope.error) {
      handler(envelope.error, envelope, reply, next)
    } else {
      next()  // Skip error handlers
    }
  } else {
    // Regular handler - always call
    handler(envelope, reply, next)
  }
}
```

### Usage Examples

```javascript
// Option 1: Manual check (more control)
server.onRequest('api:user', (envelope, reply, next) => {
  if (envelope.error) {
    // Handle error your way
    return reply.error(envelope.error)
  }
  // Success logic
})

// Option 2: Dedicated error handler (cleaner separation)
server.onRequest('api:user', (envelope, reply, next) => {
  // Only success logic here
  const user = await db.getUser(envelope.data.userId)
  reply.send({ user })
})

server.onRequest('*', (error, envelope, reply, next) => {
  // Only error logic here
  reply.error(error)
})
```

---

## Benefits of This Approach

1. ✅ **Flexible** - Developers choose their style
2. ✅ **Error Context** - Full envelope + error together
3. ✅ **Natural Flow** - Errors flow through middleware
4. ✅ **Express-Compatible** - Also supports 4-param error handlers
5. ✅ **Type-Safe** - Clear types for both patterns
6. ✅ **Testable** - Easy to test error scenarios

**This gives you the best of both worlds!** 🎉

