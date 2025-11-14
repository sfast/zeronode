# Middleware System Guide

## Overview

ZeroNode's middleware system brings **Express.js-style** middleware chains to microservices communication. This powerful pattern allows you to compose request handling logic in a clean, reusable way.

---

## Quick Start

### Basic Middleware (2 Parameters)

```javascript
// Auto-continue after execution
server.onRequest(/^api:/, (envelope, reply) => {
  console.log(`Request: ${envelope.tag}`)
  // Automatically continues to next handler
})
```

### Manual Control (3 Parameters)

```javascript
// Explicit control over chain execution
server.onRequest(/^api:/, (envelope, reply, next) => {
  if (!envelope.data.token) {
    return reply.error('Unauthorized')
  }
  envelope.user = decodeToken(envelope.data.token)
  next()  // Must explicitly continue
})
```

### Error Handlers (4 Parameters)

```javascript
// Catch errors from previous middleware
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  console.error('Error:', error)
  reply.error({ code: 'MIDDLEWARE_ERROR', message: error.message })
})
```

---

## Handler Signatures

| Parameters | Signature | Behavior | Use Case |
|------------|-----------|----------|----------|
| **2** | `(envelope, reply)` | Auto-continue | Logging, metrics, side effects |
| **3** | `(envelope, reply, next)` | Manual control | Auth, validation, conditional logic |
| **4** | `(error, envelope, reply, next)` | Error handling | Error logging, recovery, fallbacks |

---

## Execution Flow

### Example Chain

```javascript
// 1. Logging (auto-continue)
server.onRequest(/^api:/, (envelope, reply) => {
  logger.info(`${envelope.tag} from ${envelope.owner}`)
})

// 2. Auth (manual control)
server.onRequest(/^api:/, (envelope, reply, next) => {
  if (!envelope.data.token) {
    return reply.error('Unauthorized')
  }
  envelope.user = verifyToken(envelope.data.token)
  next()
})

// 3. Rate limiting (manual control)
server.onRequest(/^api:/, (envelope, reply, next) => {
  if (rateLimiter.isExceeded(envelope.user.id)) {
    return reply.error('Rate limit exceeded')
  }
  next()
})

// 4. Error handler
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  metrics.increment('errors')
  reply.error(error)
})

// 5. Business logic
server.onRequest('api:user:get', async (envelope, reply) => {
  return await getUser(envelope.data.userId)
})
```

**Execution order:**
```
Request arrives → Logging → Auth → Rate Limiting → Business Logic → Response
                                              ↓
                                        Error Handler (if error occurs)
```

---

## Advanced Patterns

### Async Middleware

```javascript
// Async middleware (2-param): Auto-continues after Promise resolves
server.onRequest(/^api:/, async (envelope, reply) => {
  await logToDatabase(envelope.tag)
  // Auto-continues after await completes
})

// Async middleware (3-param): Must call next()
server.onRequest(/^api:/, async (envelope, reply, next) => {
  const user = await authenticateUser(envelope.data.token)
  if (!user) return reply.error('Unauthorized')
  envelope.user = user
  next()  // Must explicitly continue
})
```

### Error Recovery

```javascript
// Middleware throws error
server.onRequest(/^api:/, (envelope, reply, next) => {
  next(new Error('Temporary failure'))
})

// Error handler can recover
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  if (error.retryable) {
    console.warn('Recoverable error, continuing...')
    next()  // Continue to next handler (recovery!)
  } else {
    reply.error(error)  // Stop chain
  }
})

// This still executes if error was recovered
server.onRequest('api:test', (envelope, reply) => {
  return { success: true }
})
```

### Error Chaining

```javascript
// First error handler
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  logError(error)
  if (shouldTransform(error)) {
    next(new Error('Transformed error'))  // Pass new error
  } else {
    next(error)  // Pass original error
  }
})

// Second error handler
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  sendToMonitoring(error)
  next()  // Recover
})
```

### Pattern-Based Middleware

```javascript
// Global middleware (all requests)
server.onRequest(/.*/, (envelope, reply) => {
  metrics.increment('requests.total')
})

// Namespace middleware (all api:* requests)
server.onRequest(/^api:/, (envelope, reply, next) => {
  authenticateRequest(envelope)
  next()
})

// Sub-namespace middleware (all api:user:* requests)
server.onRequest(/^api:user:/, (envelope, reply, next) => {
  validateUserPermissions(envelope)
  next()
})

// Specific handler
server.onRequest('api:user:get', (envelope, reply) => {
  return getUserData(envelope.data.userId)
})

// Execution: All 4 handlers run in order for 'api:user:get'
```

---

## Reply Methods

### `reply(data)`
Send a successful response.

```javascript
reply({ success: true, data: result })
```

### `reply.error(error)`
Send an error response.

```javascript
reply.error('Something went wrong')
reply.error({ code: 'VALIDATION_ERROR', message: 'Invalid input' })
reply.error(new Error('Server error'))
```

### Return Value
Alternative to calling `reply()`.

```javascript
server.onRequest('api:test', (envelope, reply) => {
  return { success: true }  // Same as reply({ success: true })
})
```

---

## Best Practices

### 1. Use 2-Param for Side Effects

```javascript
// ✅ Good: Side effects with auto-continue
server.onRequest(/^api:/, (envelope, reply) => {
  logger.info(envelope.tag)
  metrics.increment('requests')
})

// ❌ Bad: Side effects don't need manual control
server.onRequest(/^api:/, (envelope, reply, next) => {
  logger.info(envelope.tag)
  next()  // Unnecessary!
})
```

### 2. Use 3-Param for Control Flow

```javascript
// ✅ Good: Conditional execution
server.onRequest(/^api:/, (envelope, reply, next) => {
  if (!authorized(envelope)) {
    return reply.error('Unauthorized')
  }
  next()
})

// ❌ Bad: Can't stop the chain
server.onRequest(/^api:/, (envelope, reply) => {
  if (!authorized(envelope)) {
    // Too late! Chain already continuing
  }
})
```

### 3. Handle Errors Gracefully

```javascript
// ✅ Good: Structured error handling
server.onRequest(/^api:/, (error, envelope, reply, next) => {
  logger.error(error)
  reply.error({
    code: 'API_ERROR',
    message: error.message,
    requestId: envelope.id
  })
})

// ❌ Bad: Letting errors crash the process
server.onRequest('api:test', (envelope, reply) => {
  const data = dangerousOperation()  // Might throw
  return data
})
```

### 4. Keep Middleware Focused

```javascript
// ✅ Good: Single responsibility
server.onRequest(/^api:/, authMiddleware)
server.onRequest(/^api:/, rateLimitMiddleware)
server.onRequest(/^api:/, validationMiddleware)

// ❌ Bad: Doing too much
server.onRequest(/^api:/, (envelope, reply, next) => {
  // Auth logic
  // Rate limiting logic
  // Validation logic
  // Logging logic
  next()
})
```

---

## Performance Considerations

### Fast Path (Single Handler)

When only one handler matches, ZeroNode uses an optimized fast path:

```javascript
// Single handler = fast path (no middleware overhead)
server.onRequest('exact:match', (envelope, reply) => {
  return { data: 'fast' }
})
```

### Middleware Chain Overhead

Multiple handlers trigger the middleware chain:

```javascript
// Multiple handlers = middleware chain
server.onRequest(/^api:/, middleware1)  // ~5ns overhead per handler
server.onRequest(/^api:/, middleware2)
server.onRequest('api:test', handler)
```

**Optimization:** Middleware execution is inline (no object allocation) for minimal overhead.

---

## Common Patterns

### API Gateway

```javascript
const gateway = new Node({ id: 'gateway' })

// 1. Request logging
gateway.onRequest(/^api:/, (envelope, reply) => {
  logger.info(`${envelope.owner} → ${envelope.tag}`)
})

// 2. Authentication
gateway.onRequest(/^api:/, async (envelope, reply, next) => {
  const user = await verifyToken(envelope.data.token)
  if (!user) return reply.error('Unauthorized')
  envelope.user = user
  next()
})

// 3. Rate limiting
gateway.onRequest(/^api:/, (envelope, reply, next) => {
  if (rateLimiter.isExceeded(envelope.user.id)) {
    return reply.error('Rate limit exceeded')
  }
  next()
})

// 4. Error handling
gateway.onRequest(/^api:/, (error, envelope, reply, next) => {
  monitoring.trackError(error)
  reply.error({ code: 'GATEWAY_ERROR', message: error.message })
})

// 5. Route to backend
gateway.onRequest(/^api:/, async (envelope, reply) => {
  return await gateway.requestAny({
    event: 'backend:' + envelope.tag,
    data: envelope.data,
    filter: { role: 'backend' }
  })
})
```

### Circuit Breaker

```javascript
const breaker = createCircuitBreaker({ threshold: 5, timeout: 60000 })

server.onRequest(/^external:/, async (envelope, reply, next) => {
  if (breaker.isOpen()) {
    return reply.error('Service unavailable')
  }
  
  try {
    const result = await callExternalService(envelope.data)
    breaker.recordSuccess()
    return result
  } catch (err) {
    breaker.recordFailure()
    throw err
  }
})
```

### Request Transformation

```javascript
// Transform request
server.onRequest(/^api:/, (envelope, reply, next) => {
  envelope.data = {
    ...envelope.data,
    timestamp: Date.now(),
    requestId: generateId()
  }
  next()
})

// Transform response
server.onRequest('api:test', async (envelope, reply) => {
  const data = await processRequest(envelope.data)
  
  // Return transformed response
  return {
    success: true,
    data,
    meta: {
      requestId: envelope.data.requestId,
      processingTime: Date.now() - envelope.data.timestamp
    }
  }
})
```

---

## Debugging

### Enable Debug Logs

```javascript
const node = new Node({
  config: { DEBUG: true }
})

// Logs middleware execution:
// [Middleware] Handler executed { arity: 2, resultType: 'undefined', ... }
```

### Add Timing Middleware

```javascript
server.onRequest(/.*/, (envelope, reply, next) => {
  const start = process.hrtime.bigint()
  
  // Continue chain
  next = ((originalNext) => {
    return (...args) => {
      const duration = Number(process.hrtime.bigint() - start) / 1e6
      console.log(`${envelope.tag} took ${duration}ms`)
      return originalNext(...args)
    }
  })(next)
  
  next()
})
```

---

## Migration from Old Signatures

### Before (Old Style)

```javascript
server.onRequest('event', (req) => {
  console.log(req.body)
  req.reply({ success: true })
})
```

### After (New Style)

```javascript
server.onRequest('event', (envelope, reply) => {
  console.log(envelope.data)
  reply({ success: true })
  // Or: return { success: true }
})
```

---

## Summary

✅ **2-param**: Auto-continue (logging, metrics)  
✅ **3-param**: Manual control (auth, validation)  
✅ **4-param**: Error handling (recovery, logging)  
✅ **Async**: Fully supported (auto-continue for 2-param)  
✅ **Pattern matching**: RegExp for flexible routing  
✅ **Performance**: Fast path for single handlers, inline chain for multiple  

**The middleware system makes building robust microservices feel like writing Express.js apps!** 🎭
