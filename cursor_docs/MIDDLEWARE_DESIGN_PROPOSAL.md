# Middleware Design: Industry Standards & Error Handling

**Date:** November 11, 2025  
**Goal:** Design middleware API consistent with Express.js/Next.js + robust error handling

---

## 1. Industry Standard Middleware Patterns

### Express.js Pattern

```javascript
// Express middleware signature
app.use((req, res, next) => {
  // req - request object
  // res - response object with methods (res.json(), res.status())
  // next - continue to next middleware
  // next(error) - pass to error handler
})

// Error handling middleware (4 params!)
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})
```

### Koa.js Pattern

```javascript
// Koa uses async/await with ctx
app.use(async (ctx, next) => {
  await next()  // Wait for downstream middleware
  // Can modify response after downstream completes
})

// Error handling with try/catch
app.use(async (ctx, next) => {
  try {
    await next()
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
})
```

### Fastify Pattern

```javascript
// Fastify uses hooks
fastify.addHook('onRequest', async (request, reply) => {
  // Async hooks
})

fastify.addHook('preHandler', async (request, reply) => {
  // Can modify request/reply
})
```

---

## 2. Proposed ZeroNode Middleware API

### Design Goals

1. ✅ **Consistent with Express** (most familiar pattern)
2. ✅ **Async-first** (native Promise/async-await support)
3. ✅ **Type-safe** (clear parameter types)
4. ✅ **Error propagation** (detailed error info)
5. ✅ **Backwards compatible** (optional)

---

## 3. Proposed Handler Signature

### Standard Middleware

```javascript
/**
 * Standard request handler
 * @param {Envelope} envelope - Request envelope with all metadata
 * @param {Reply} reply - Reply helper with methods
 * @param {Function} next - Continue to next handler or pass error
 */
server.onRequest('event', (envelope, reply, next) => {
  // Access request data
  const data = envelope.data
  const sender = envelope.owner
  const event = envelope.tag
  
  // Send response (stops chain)
  reply({ success: true })
  
  // OR continue to next middleware
  next()
  
  // OR pass error to error handler
  next(new Error('Something went wrong'))
})
```

### Async Middleware

```javascript
// Async handlers automatically supported
server.onRequest('event', async (envelope, reply, next) => {
  try {
    const result = await someAsyncOperation()
    reply({ result })
  } catch (err) {
    next(err)  // Pass to error handler
  }
})

// OR use return (Promise.resolve auto-handled)
server.onRequest('event', async (envelope, reply, next) => {
  const result = await someAsyncOperation()
  return { result }  // Auto-calls reply()
})
```

### Error Handler (4 params!)

```javascript
/**
 * Error handling middleware (detected by 4 params!)
 * @param {Error} error - The error object
 * @param {Envelope} envelope - Request envelope
 * @param {Reply} reply - Reply helper
 * @param {Function} next - Continue to next error handler
 */
server.onRequest('*', (error, envelope, reply, next) => {
  // Log error
  console.error('Request error:', error)
  
  // Send error response
  reply.error({
    message: error.message,
    code: error.code || 'INTERNAL_ERROR',
    requestId: envelope.id
  })
  
  // OR pass to next error handler
  next(error)
})
```

---

## 4. Reply Helper Object

Instead of just a function, provide a helper object with methods:

```javascript
class Reply {
  constructor(envelope, socket, config) {
    this._envelope = envelope
    this._socket = socket
    this._config = config
    this._sent = false
  }
  
  // Send success response
  send(data) {
    if (this._sent) return
    this._sent = true
    
    const buffer = Envelope.createBuffer({
      type: EnvelopType.RESPONSE,
      id: this._envelope.id,
      data: data,
      owner: this._socket.getId(),
      recipient: this._envelope.owner
    }, this._config.BUFFER_STRATEGY)
    
    this._socket.sendBuffer(buffer, this._envelope.owner)
  }
  
  // Send error response
  error(error) {
    if (this._sent) return
    this._sent = true
    
    const errorData = {
      message: error.message || error || 'Unknown error',
      code: error.code || 'INTERNAL_ERROR',
      ...(this._config.DEBUG && { stack: error.stack })
    }
    
    const buffer = Envelope.createBuffer({
      type: EnvelopType.ERROR,
      id: this._envelope.id,
      data: errorData,
      owner: this._socket.getId(),
      recipient: this._envelope.owner
    }, this._config.BUFFER_STRATEGY)
    
    this._socket.sendBuffer(buffer, this._envelope.owner)
  }
  
  // Send with status code (HTTP-like)
  status(code) {
    this._statusCode = code
    return this
  }
  
  // Check if reply was sent
  get sent() {
    return this._sent
  }
}
```

---

## 5. Complete Implementation

### Protocol._handleRequest()

```javascript
_handleRequest(buffer) {
  const { socket, requestEmitter, config } = _private.get(this)
  const envelope = new Envelope(buffer)
  
  const handlers = requestEmitter.getMatchingListeners(envelope.tag)
  
  if (handlers.length === 0) {
    return this._sendErrorResponse(envelope, {
      message: `No handler for request: ${envelope.tag}`,
      code: 'NO_HANDLER'
    })
  }
  
  // Separate regular handlers and error handlers
  const regularHandlers = handlers.filter(h => h.length <= 3)
  const errorHandlers = handlers.filter(h => h.length === 4)
  
  let currentIndex = 0
  const reply = new Reply(envelope, socket, config)
  
  // next() - continue to next middleware
  const next = (error) => {
    // If reply already sent, ignore
    if (reply.sent) return
    
    // If error, run error handlers
    if (error) {
      return runErrorHandlers(error)
    }
    
    // Move to next regular handler
    currentIndex++
    
    if (currentIndex >= regularHandlers.length) {
      // No more handlers - send error
      return reply.error({
        message: 'No handler completed the request',
        code: 'NO_HANDLER_COMPLETION'
      })
    }
    
    // Execute next handler
    executeHandler(regularHandlers[currentIndex])
  }
  
  // Execute regular handler
  const executeHandler = async (handler) => {
    try {
      const result = handler(envelope, reply, next)
      
      // If handler returns a value, auto-reply
      if (result !== undefined && !reply.sent) {
        const resolved = await Promise.resolve(result)
        reply.send(resolved)
      }
    } catch (err) {
      // Sync error caught, pass to error handlers
      runErrorHandlers(err)
    }
  }
  
  // Run error handlers
  let errorIndex = 0
  const runErrorHandlers = (error) => {
    if (reply.sent) return
    
    if (errorIndex >= errorHandlers.length) {
      // No error handlers, send default error response
      return reply.error(error)
    }
    
    const errorNext = (err) => {
      if (reply.sent) return
      
      errorIndex++
      if (errorIndex >= errorHandlers.length) {
        return reply.error(err || error)
      }
      
      runErrorHandlers(err || error)
    }
    
    try {
      errorHandlers[errorIndex](error, envelope, reply, errorNext)
    } catch (err) {
      // Error in error handler!
      reply.error({
        message: 'Error in error handler',
        code: 'ERROR_HANDLER_FAILED',
        originalError: error.message,
        handlerError: err.message
      })
    }
  }
  
  // Start middleware chain
  executeHandler(regularHandlers[0])
}
```

---

## 6. Usage Examples

### Example 1: Authentication + Error Handling

```javascript
import Node from 'zeronode'

const server = new Node({ id: 'api-server' })
await server.bind('tcp://0.0.0.0:8000')

// Error handler (4 params - runs on errors)
server.onRequest('*', (error, envelope, reply, next) => {
  console.error('Request failed:', error.message)
  
  // Send structured error response
  reply.error({
    message: error.message,
    code: error.code || 'INTERNAL_ERROR',
    timestamp: Date.now(),
    requestId: envelope.id,
    path: envelope.tag
  })
})

// Auth middleware
server.onRequest('api:*', async (envelope, reply, next) => {
  const { token } = envelope.data
  
  if (!token) {
    // Create error with code
    const error = new Error('No token provided')
    error.code = 'AUTH_TOKEN_MISSING'
    return next(error)  // ← Goes to error handler
  }
  
  try {
    const user = await verifyToken(token)
    envelope.user = user
    next()  // ← Continue to next middleware
  } catch (err) {
    err.code = 'AUTH_TOKEN_INVALID'
    next(err)  // ← Goes to error handler
  }
})

// Logging middleware
server.onRequest('api:*', (envelope, reply, next) => {
  console.log(`[${envelope.user.id}] ${envelope.tag}`)
  next()
})

// Business logic
server.onRequest('api:users:get', async (envelope, reply) => {
  const users = await db.getUsers()
  reply.send({ users })  // ← Explicit send
})

// OR return value (auto-send)
server.onRequest('api:users:count', async (envelope, reply) => {
  const count = await db.getUserCount()
  return { count }  // ← Auto-calls reply.send()
})
```

### Example 2: Request Validation

```javascript
// Schema validation middleware
server.onRequest('api:users:create', (envelope, reply, next) => {
  const schema = {
    name: 'string',
    email: 'string',
    age: 'number'
  }
  
  const errors = validateSchema(envelope.data, schema)
  if (errors.length > 0) {
    const error = new Error('Validation failed')
    error.code = 'VALIDATION_ERROR'
    error.details = errors
    return next(error)
  }
  
  next()
})

// Handler (only runs if validation passes)
server.onRequest('api:users:create', async (envelope, reply) => {
  const user = await db.createUser(envelope.data)
  return { user, created: true }
})

// Validation error handler
server.onRequest('api:*', (error, envelope, reply, next) => {
  if (error.code === 'VALIDATION_ERROR') {
    return reply.status(400).error({
      message: 'Invalid request data',
      code: 'VALIDATION_ERROR',
      errors: error.details
    })
  }
  next(error)  // Pass to next error handler
})
```

### Example 3: Rate Limiting

```javascript
const rateLimiter = new Map()

server.onRequest('api:*', async (envelope, reply, next) => {
  const clientId = envelope.owner
  const now = Date.now()
  
  if (!rateLimiter.has(clientId)) {
    rateLimiter.set(clientId, { count: 0, resetAt: now + 60000 })
  }
  
  const limit = rateLimiter.get(clientId)
  
  if (now > limit.resetAt) {
    limit.count = 0
    limit.resetAt = now + 60000
  }
  
  limit.count++
  
  if (limit.count > 100) {
    const error = new Error('Rate limit exceeded')
    error.code = 'RATE_LIMIT_EXCEEDED'
    error.retryAfter = Math.ceil((limit.resetAt - now) / 1000)
    return next(error)
  }
  
  next()
})

// Rate limit error handler
server.onRequest('*', (error, envelope, reply, next) => {
  if (error.code === 'RATE_LIMIT_EXCEEDED') {
    return reply.status(429).error({
      message: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: error.retryAfter
    })
  }
  next(error)
})
```

### Example 4: Timing & Metrics

```javascript
// Timing middleware
server.onRequest('*', async (envelope, reply, next) => {
  const start = Date.now()
  
  // Store original send method
  const originalSend = reply.send.bind(reply)
  const originalError = reply.error.bind(reply)
  
  // Wrap send to capture timing
  reply.send = (data) => {
    const duration = Date.now() - start
    metrics.recordSuccess(envelope.tag, duration)
    originalSend(data)
  }
  
  reply.error = (error) => {
    const duration = Date.now() - start
    metrics.recordError(envelope.tag, duration, error.code)
    originalError(error)
  }
  
  next()
})
```

### Example 5: Request/Response Transformation

```javascript
// Parse incoming data
server.onRequest('api:*', (envelope, reply, next) => {
  // Normalize data
  envelope.data = {
    ...envelope.data,
    timestamp: Date.now(),
    requestId: envelope.id,
    clientId: envelope.owner
  }
  next()
})

// Transform outgoing response
server.onRequest('api:*', async (envelope, reply, next) => {
  // Wrap original send
  const originalSend = reply.send.bind(reply)
  
  reply.send = (data) => {
    // Add metadata to response
    const wrapped = {
      success: true,
      data: data,
      meta: {
        timestamp: Date.now(),
        version: '1.0.0'
      }
    }
    originalSend(wrapped)
  }
  
  next()
})
```

---

## 7. Error Information on Client Side

### Client Request with Error Handling

```javascript
import Node, { ProtocolError } from 'zeronode'

const client = new Node({ id: 'client' })
await client.connect({ address: 'tcp://server:8000' })

try {
  const response = await client.request({
    to: 'api-server',
    event: 'api:users:create',
    data: { name: 'John' },  // Missing required fields
    timeout: 5000
  })
  
  console.log('Success:', response)
} catch (error) {
  // Error information from server
  console.error('Request failed:')
  console.error('  Message:', error.message)
  console.error('  Code:', error.code)
  console.error('  Request ID:', error.requestId)
  
  if (error.code === 'VALIDATION_ERROR') {
    console.error('  Validation errors:', error.details)
  }
  
  if (error.code === 'RATE_LIMIT_EXCEEDED') {
    console.error('  Retry after:', error.retryAfter, 'seconds')
  }
  
  if (error.code === 'AUTH_TOKEN_INVALID') {
    console.error('  Need to re-authenticate')
  }
}
```

### Enhanced Error Response Format

```javascript
// Server sends detailed error
reply.error({
  // Standard fields
  message: 'User creation failed',
  code: 'VALIDATION_ERROR',
  
  // Context
  requestId: envelope.id,
  timestamp: Date.now(),
  path: envelope.tag,
  
  // Specific details
  details: [
    { field: 'email', message: 'Invalid email format' },
    { field: 'age', message: 'Must be >= 18' }
  ],
  
  // Stack trace (only in DEBUG mode)
  ...(config.DEBUG && { stack: error.stack })
})

// Client receives
{
  message: 'User creation failed',
  code: 'VALIDATION_ERROR',
  requestId: 'abc-123',
  timestamp: 1699999999999,
  path: 'api:users:create',
  details: [...]
}
```

---

## 8. Backwards Compatibility

### Detect Handler Type by Arity

```javascript
function getHandlerType(handler) {
  if (handler.length === 4) {
    return 'error'  // (error, envelope, reply, next)
  } else if (handler.length === 3) {
    return 'middleware'  // (envelope, reply, next)
  } else if (handler.length === 2) {
    return 'legacy'  // (envelope, reply) - old style
  } else {
    return 'simple'  // (envelope) - simple handler
  }
}

// Handle legacy handlers
if (handlerType === 'legacy') {
  const result = handler(envelope, reply)
  if (result !== undefined && !reply.sent) {
    Promise.resolve(result).then(data => reply.send(data))
  } else if (!reply.sent) {
    next()  // Auto-continue if no reply sent
  }
}
```

---

## 9. Comparison with Express

| Feature | Express | ZeroNode (Proposed) |
|---------|---------|---------------------|
| **Handler Signature** | `(req, res, next)` | `(envelope, reply, next)` |
| **Error Handler** | `(err, req, res, next)` | `(error, envelope, reply, next)` |
| **Async Support** | Via promises | Native async/await |
| **Response Helper** | `res.json()`, `res.status()` | `reply.send()`, `reply.error()` |
| **Error Detection** | 4 params | 4 params |
| **Middleware Chain** | Yes | Yes (proposed) |
| **Pattern Matching** | String + RegExp | String + RegExp ✅ |

---

## 10. Benefits Summary

### ✅ **Developer Experience**

- **Familiar** - Same pattern as Express/Koa/Fastify
- **Intuitive** - Clear separation: data (envelope), response (reply), flow (next)
- **Type-safe** - Clear parameter types
- **Error-first** - Robust error handling built-in

### ✅ **Architecture**

- **Separation of Concerns** - Auth, validation, logging as separate middleware
- **Reusable** - Write middleware once, use everywhere
- **Testable** - Test each middleware in isolation
- **Composable** - Mix and match middleware

### ✅ **Error Handling**

- **Detailed Errors** - Code, message, context, stack traces
- **Error Handlers** - Centralized error handling
- **Client-Friendly** - Structured error responses
- **Debug Mode** - Stack traces in development

---

## 11. Implementation Checklist

- [ ] Update `Protocol._handleRequest()` with middleware chain
- [ ] Create `Reply` helper class
- [ ] Support 4-param error handlers
- [ ] Add backwards compatibility for legacy handlers
- [ ] Update error response format
- [ ] Add tests for middleware execution order
- [ ] Add tests for error handler execution
- [ ] Update documentation (MIDDLEWARE.md, README.md)
- [ ] Create middleware examples (auth, logging, validation)
- [ ] Update TypeScript definitions (if any)

---

## Recommendation

✅ **Implement Express-style middleware with error handlers**

This provides:
1. **Industry-standard** API (familiar to all Node.js developers)
2. **Robust error handling** with detailed error information
3. **Backwards compatible** (can detect old handlers by arity)
4. **Production-ready** (auth, rate limiting, validation patterns)
5. **Well-documented** (abundant Express middleware examples to learn from)

**Estimated effort:** 200-300 lines of code + tests + docs  
**Breaking changes:** None (if using backwards compatibility)  
**Value:** High (enables proper microservice patterns)

