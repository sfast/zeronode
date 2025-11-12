# Handler Signature Analysis: envelope vs (head, body)

**Date:** November 11, 2025  
**Question:** `(envelope, error, reply, next)` vs `(head, body, error, reply, next)`?

---

## Option 1: `(envelope, error, reply, next)`

### Structure

```javascript
server.onRequest('api:user', (envelope, error, reply, next) => {
  // Access everything through envelope
  const data = envelope.data      // Request body
  const sender = envelope.owner   // Who sent it
  const event = envelope.tag      // Event name
  const id = envelope.id          // Request ID
  const timestamp = envelope.timestamp
  
  // Error (if error handler)
  if (error) {
    console.error('Error:', error.message)
    return reply.error(error)
  }
  
  // Continue or reply
  next() // OR reply.send({ ... })
})
```

### Pros ✅

1. **Clean Signature** - Only 4 parameters
2. **Type-Safe** - One envelope object with defined structure
3. **Extensible** - Easy to add new envelope fields without changing signature
4. **Standard Pattern** - Like Express `req` object
5. **Full Access** - All envelope metadata available when needed
6. **Autocomplete-Friendly** - IDEs can show `envelope.` properties

### Cons ❌

1. **Extra Typing** - `envelope.data` instead of just `body`
2. **Not Obvious** - Need to know what's in envelope
3. **Verbose for Simple Cases** - Most handlers just need `data`

---

## Option 2: `(head, body, error, reply, next)`

### Structure

```javascript
server.onRequest('api:user', (head, body, error, reply, next) => {
  // Direct access to common fields
  const name = body.name          // Request body (direct!)
  const sender = head.owner       // Metadata in head
  const event = head.tag
  const id = head.id
  
  // Error (if error handler)
  if (error) {
    console.error('Error:', error.message)
    return reply.error(error)
  }
  
  // Continue or reply
  next() // OR reply.send({ ... })
})
```

### What would be in `head` vs `body`?

```javascript
// head - Envelope metadata (routing, tracking)
{
  id: string,           // Request ID
  owner: string,        // Sender node ID
  recipient: string,    // Target node ID
  tag: string,          // Event name
  timestamp: number,    // When sent
  type: number          // Message type (REQUEST, RESPONSE, etc.)
}

// body - Actual request data (user payload)
{
  // Whatever the client sent
  userId: 123,
  name: 'John',
  email: 'john@example.com'
  // ...
}
```

### Pros ✅

1. **Convenient** - Direct access to `body` (most common use case)
2. **Clear Separation** - Metadata vs payload
3. **Less Typing** - `body.name` vs `envelope.data.name`
4. **Explicit** - Forces you to think about head vs body

### Cons ❌

1. **More Parameters** - 5 params instead of 4
2. **Rigid** - Hard to add new envelope fields (would need new params)
3. **Confusing Order** - `(head, body, error, reply, next)` - error in middle?
4. **Destructuring Issues** - Can't easily skip params you don't need
5. **Not Standard** - Express/Koa use `(req, res, next)` not separate objects

---

## Deep Dive: Real-World Usage

### Scenario 1: Simple Handler (90% of cases)

**With `envelope`:**
```javascript
server.onRequest('api:user:get', (envelope, error, reply, next) => {
  const userId = envelope.data.userId  // ← Extra .data
  const user = await db.getUser(userId)
  reply.send({ user })
})
```

**With `head, body`:**
```javascript
server.onRequest('api:user:get', (head, body, error, reply, next) => {
  const userId = body.userId  // ← Cleaner!
  const user = await db.getUser(userId)
  reply.send({ user })
})
```

**Winner:** `head, body` (less typing)

---

### Scenario 2: Need Metadata (10% of cases)

**With `envelope`:**
```javascript
server.onRequest('api:user:get', (envelope, error, reply, next) => {
  const userId = envelope.data.userId
  const requestId = envelope.id        // ← Easy access
  const sender = envelope.owner        // ← Easy access
  
  logRequest(requestId, sender, userId)
  
  const user = await db.getUser(userId)
  reply.send({ user })
})
```

**With `head, body`:**
```javascript
server.onRequest('api:user:get', (head, body, error, reply, next) => {
  const userId = body.userId
  const requestId = head.id      // ← Also easy
  const sender = head.owner      // ← Also easy
  
  logRequest(requestId, sender, userId)
  
  const user = await db.getUser(userId)
  reply.send({ user })
})
```

**Winner:** Tie (both work well)

---

### Scenario 3: Middleware That Doesn't Need Body

**With `envelope`:**
```javascript
// Logging middleware - only needs metadata
server.onRequest('*', (envelope, error, reply, next) => {
  console.log(`${envelope.tag} from ${envelope.owner}`)
  // Don't need envelope.data at all!
  next()
})
```

**With `head, body`:**
```javascript
// Logging middleware
server.onRequest('*', (head, body, error, reply, next) => {
  console.log(`${head.tag} from ${head.owner}`)
  // body is unused but still in signature
  next()
})
```

**Winner:** `envelope` (can ignore what you don't need)

---

### Scenario 4: Error Handler

**With `envelope`:**
```javascript
// Error handler (4 params - error first!)
server.onRequest('*', (error, envelope, reply, next) => {
  console.error('Error:', error.message)
  console.error('Request:', envelope.tag, envelope.data)
  
  reply.error({
    message: error.message,
    code: error.code,
    requestId: envelope.id
  })
})
```

**With `head, body`:**
```javascript
// Error handler - awkward parameter order!
server.onRequest('*', (error, head, body, reply, next) => {
  console.error('Error:', error.message)
  console.error('Request:', head.tag, body)
  
  reply.error({
    message: error.message,
    code: error.code,
    requestId: head.id
  })
})
```

**Winner:** `envelope` (error handlers are cleaner)

---

## Hybrid Approach: Best of Both Worlds?

### Option 3: `(envelope, reply, next)` with Destructuring

```javascript
// Can destructure what you need!
server.onRequest('api:user', ({ data, owner, id }, reply, next) => {
  const userId = data.userId  // Direct access
  const sender = owner        // Metadata when needed
  const requestId = id        // Also available
  
  const user = await db.getUser(userId)
  reply.send({ user })
})

// Or use full envelope when needed
server.onRequest('api:user', (envelope, reply, next) => {
  logRequest(envelope)  // Pass whole envelope
  
  const user = await db.getUser(envelope.data.userId)
  reply.send({ user })
})
```

### Even Shorter with Nested Destructuring

```javascript
// Destructure nested data!
server.onRequest('api:user', ({ data: { userId }, owner }, reply, next) => {
  const user = await db.getUser(userId)  // ← Super clean!
  reply.send({ user })
})
```

---

## Option 4: Helper Properties on Envelope

Add convenience properties directly on envelope:

```javascript
class Envelope {
  // ... existing properties ...
  
  // Convenience getters
  get body() {
    return this.data  // Alias for data
  }
  
  get head() {
    return {
      id: this.id,
      owner: this.owner,
      recipient: this.recipient,
      tag: this.tag,
      timestamp: this.timestamp,
      type: this.type
    }
  }
}

// Usage
server.onRequest('api:user', (envelope, reply, next) => {
  const userId = envelope.body.userId  // ← Like head/body!
  const sender = envelope.head.owner
  
  // OR still use .data
  const userId = envelope.data.userId
})
```

---

## Parameter Order Analysis

### Standard Middleware: What should the order be?

#### Option A: `(envelope, error, reply, next)` ❌
**Problem:** Error in middle is confusing for regular handlers

```javascript
// Regular handler - error param is null/undefined
server.onRequest('api:user', (envelope, error, reply, next) => {
  // error is always null here - confusing!
  const userId = envelope.data.userId
  reply.send({ user })
})
```

#### Option B: `(envelope, reply, next, error)` ❌
**Problem:** Error at end, hard to detect error handlers

```javascript
// Error handler needs 4 params
server.onRequest('*', (envelope, reply, next, error) => {
  // Awkward - error should be first in error handlers
})
```

#### Option C: Express Pattern - Separate Signatures ✅

**Regular Handler:** `(envelope, reply, next)` - 3 params  
**Error Handler:** `(error, envelope, reply, next)` - 4 params

```javascript
// Regular handler (3 params)
server.onRequest('api:user', (envelope, reply, next) => {
  const userId = envelope.data.userId
  reply.send({ user })
})

// Error handler (4 params - detected automatically!)
server.onRequest('*', (error, envelope, reply, next) => {
  console.error('Error:', error)
  reply.error(error)
})
```

**Winner:** Separate signatures (industry standard)

---

## Comparison Table

| Aspect | `envelope` | `head, body` | `envelope` + destructuring |
|--------|-----------|--------------|---------------------------|
| **Parameter Count** | 3 (regular), 4 (error) | 5 (always) | 3 (regular), 4 (error) |
| **Simple Cases** | `envelope.data.x` | `body.x` ✅ | `{ data: { x } }` ✅ |
| **Metadata Access** | `envelope.owner` ✅ | `head.owner` ✅ | `{ owner }` ✅ |
| **Error Handlers** | Clean ✅ | Awkward ❌ | Clean ✅ |
| **Extensibility** | Easy ✅ | Hard ❌ | Easy ✅ |
| **Type Safety** | Easy ✅ | Harder ❌ | Easy ✅ |
| **IDE Support** | Good ✅ | OK | Excellent ✅ |
| **Learning Curve** | Low ✅ | Medium | Low ✅ |
| **Industry Standard** | Yes (like `req`) ✅ | No ❌ | Yes ✅ |

---

## Real Developer Examples

### Express.js (Industry Standard)

```javascript
app.get('/user', (req, res, next) => {
  const userId = req.body.userId    // Body via req.body
  const sender = req.ip              // Metadata via req.*
  const user = getUser(userId)
  res.json({ user })
})

// Error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})
```

**Pattern:** Single request object (`req`) with properties

### Fastify

```javascript
fastify.get('/user', (request, reply) => {
  const userId = request.body.userId
  const sender = request.ip
  const user = getUser(userId)
  reply.send({ user })
})
```

**Pattern:** Single request object (`request`)

### Koa

```javascript
app.use(async (ctx, next) => {
  const userId = ctx.request.body.userId
  const sender = ctx.ip
  const user = await getUser(userId)
  ctx.body = { user }
})
```

**Pattern:** Context object (`ctx`) with nested request

**Verdict:** All major frameworks use single request object!

---

## Final Recommendation

### ✅ **Option: `(envelope, reply, next)` with Destructuring Support**

#### Regular Handler (3 params)

```javascript
// Option 1: Use full envelope
server.onRequest('api:user', (envelope, reply, next) => {
  const userId = envelope.data.userId
  const user = await db.getUser(userId)
  reply.send({ user })
})

// Option 2: Destructure what you need
server.onRequest('api:user', ({ data, owner }, reply, next) => {
  const userId = data.userId
  const user = await db.getUser(userId)
  reply.send({ user })
})

// Option 3: Deep destructure
server.onRequest('api:user', ({ data: { userId }, owner }, reply, next) => {
  const user = await db.getUser(userId)
  reply.send({ user })
})
```

#### Error Handler (4 params)

```javascript
server.onRequest('*', (error, envelope, reply, next) => {
  console.error('Error:', error.message)
  console.error('Request:', envelope.tag)
  
  reply.error({
    message: error.message,
    code: error.code,
    requestId: envelope.id
  })
})
```

---

## Why This is Best

### 1. **Industry Standard** ✅
- Same pattern as Express (`req`), Fastify (`request`), Koa (`ctx`)
- Familiar to millions of developers

### 2. **Flexible** ✅
- Can use full envelope: `envelope.data.userId`
- Can destructure: `{ data, owner }`
- Can deep destructure: `{ data: { userId } }`

### 3. **Clean Error Handlers** ✅
```javascript
// Error handler clearly has 4 params
(error, envelope, reply, next) => { ... }

// Regular handler has 3 params
(envelope, reply, next) => { ... }
```

### 4. **Extensible** ✅
- Add new envelope fields without breaking signature
- No need to add new parameters

### 5. **Type-Safe** ✅
```typescript
interface Envelope {
  data: any
  owner: string
  tag: string
  id: string
  timestamp: number
  // Easy to add more!
}

type Handler = (envelope: Envelope, reply: Reply, next: Next) => void
type ErrorHandler = (error: Error, envelope: Envelope, reply: Reply, next: Next) => void
```

### 6. **Backwards Compatible** ✅
```javascript
// Old style (2 params)
function oldHandler(envelope, reply) { ... }

// New style (3 params)
function newHandler(envelope, reply, next) { ... }

// Detect by handler.length!
```

---

## Optional: Add Convenience Alias

If you really want `body` for convenience:

```javascript
// In Envelope class
class Envelope {
  get body() {
    return this.data  // Alias
  }
}

// Usage
server.onRequest('api:user', (envelope, reply, next) => {
  const userId = envelope.body.userId  // ← Like "body"!
  // OR
  const userId = envelope.data.userId  // ← Also works!
})
```

**Best of both worlds:** Use `envelope.body` if you like, or `envelope.data`!

---

## Conclusion

### ✅ **Recommended Signature**

**Regular Handler:**
```javascript
(envelope, reply, next) => { ... }
```

**Error Handler:**
```javascript
(error, envelope, reply, next) => { ... }
```

**Why:**
1. Industry standard (Express, Fastify, Koa all use single request object)
2. Flexible (can destructure any way you want)
3. Clean (3 params for regular, 4 for error)
4. Extensible (add envelope fields without signature changes)
5. Type-safe (easy TypeScript definitions)
6. Backwards compatible (detect by arity)

**Optional Enhancement:**
- Add `envelope.body` as alias for `envelope.data`
- Best of both worlds!

### ❌ **Not Recommended: `(head, body, error, reply, next)`**

**Why not:**
1. Too many parameters (5)
2. Not industry standard
3. Rigid (hard to extend)
4. Awkward error handler signature
5. Can't skip params you don't need

