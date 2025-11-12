# Example Files Update - New Handler Signatures

**Date:** November 12, 2025  
**Status:** ✅ COMPLETED  
**Files Updated:** 11 example files

---

## Overview

Updated all example files in the `examples/` directory to use the new handler signatures:

- **Request handlers**: `(envelope, reply)` or `(envelope, reply, next)`
- **Tick handlers**: `(envelope)`

---

## Updated Files

### 1. Request Examples

| File | Old Signature | New Signature |
|------|---------------|---------------|
| `simple-request.js` | `({ body, reply }) => { ... }` | `(envelope, reply) => { ... }` |
| `requestAny.js` | `({ body, reply }) => { ... }` | `(envelope, reply) => { ... }` |
| `request-many-handlers.js` | `(req) => { req.body, req.next(), req.reply() }` | `(envelope, reply, next) => { envelope.data, next(), reply() }` |
| `request-error.js` | `(req) => { req.body, req.next('error'), req.reply() }` | `(envelope, reply, next) => { envelope.data, next('error'), reply() }` |

### 2. Tick Examples

| File | Old Signature | New Signature |
|------|---------------|---------------|
| `simple-tick.js` | `(msg) => { ... }` | `(envelope) => { envelope.data }` |
| `tickAny.js` | `(msg) => { ... }` | `(envelope) => { envelope.data }` |
| `tickAll.js` | `(msg) => { ... }` | `(envelope) => { envelope.data }` |
| `node-cycle.js` | `(msg) => { ... }` | `(envelope) => { envelope.data }` |

### 3. Filter Examples

| File | Old Signature | New Signature |
|------|---------------|---------------|
| `regexpFilter.js` | `(msg) => { ... }` | `(envelope) => { envelope.data }` |
| `predicateFilter.js` | `(msg) => { ... }` | `(envelope) => { envelope.data }` |
| `objectFilter.js` | `(msg) => { ... }` | `(envelope) => { envelope.data }` |

---

## Changes Made

### Before (Old Signature)

#### Request Handlers - Destructured Object
```javascript
// OLD: Used destructuring or req object
znode.onRequest('foo', ({ body, reply }) => {
  console.log(body)
  reply('response')
})

// OR with middleware
znode.onRequest('foo', (req) => {
  console.log(req.body)
  req.body++
  req.next()
})
```

#### Tick Handlers - Direct Message
```javascript
// OLD: Received message directly
znode.onTick('foo', (msg) => {
  console.log(msg)
})
```

---

### After (New Signature)

#### Request Handlers - Envelope + Reply Function
```javascript
// NEW: Receive envelope and reply function
znode.onRequest('foo', (envelope, reply) => {
  console.log(envelope.data)
  reply('response')
})

// With middleware (3-param)
znode.onRequest('foo', (envelope, reply, next) => {
  console.log(envelope.data)
  envelope.data++
  next()
})
```

#### Tick Handlers - Envelope Only
```javascript
// NEW: Receive envelope with .data property
znode.onTick('foo', (envelope) => {
  console.log(envelope.data)
})
```

---

## Key Differences

### Data Access

| Old | New |
|-----|-----|
| `body` or `msg` | `envelope.data` |
| Direct message parameter | Envelope wrapper with `.data` property |

### Reply Method

| Old | New |
|-----|-----|
| `reply()` from destructured object | `reply()` as function parameter |
| `req.reply()` method call | `reply()` function call |

### Middleware Control

| Old | New |
|-----|-----|
| `req.next()` method | `next()` function parameter |
| `req.next('error')` | `next('error')` function call |

---

## Migration Guide

For users migrating their own code:

### Request Handler Migration

```javascript
// BEFORE
onRequest('event', ({ body, reply }) => {
  // Use body
  reply(result)
})

// AFTER
onRequest('event', (envelope, reply) => {
  // Use envelope.data
  reply(result)
})
```

### Middleware Migration

```javascript
// BEFORE
onRequest('event', (req) => {
  console.log(req.body)
  req.next()
})

// AFTER
onRequest('event', (envelope, reply, next) => {
  console.log(envelope.data)
  next()
})
```

### Tick Handler Migration

```javascript
// BEFORE
onTick('event', (msg) => {
  console.log(msg)
})

// AFTER
onTick('event', (envelope) => {
  console.log(envelope.data)
})
```

---

## Benefits of New Signature

### 1. **Consistency**
- All handlers receive the same `envelope` object
- No special destructuring or wrapper objects

### 2. **Express.js Style**
- `(envelope, reply, next)` mirrors Express `(req, res, next)`
- Familiar pattern for Node.js developers

### 3. **Extensibility**
- `envelope` provides access to all message metadata:
  - `envelope.data` - The message payload
  - `envelope.tag` - The event/tag name
  - `envelope.owner` - Original sender ID
  - `envelope.recipient` - Target recipient ID
  - `envelope.type` - Envelope type (REQUEST, TICK, etc.)

### 4. **Middleware Support**
- Native support for middleware chains
- `next()` for sequential execution
- `next(error)` for error propagation

---

## Verification

All examples still demonstrate the same functionality:
- ✅ Simple request/response
- ✅ Fire-and-forget ticks
- ✅ Middleware chains
- ✅ Error handling
- ✅ Filtering (object, RegExp, predicate)
- ✅ Routing (tickAny, tickAll, requestAny)
- ✅ Complex topologies (node cycles)

---

## Related Documentation

- **Handler Signatures**: See `HANDLER_SIGNATURE_MIGRATION.md` (archived)
- **Middleware**: See `MIDDLEWARE_IMPLEMENTATION_SUMMARY.md`
- **Async Fix**: See `ASYNC_MIDDLEWARE_FIX.md`

---

## Conclusion

✅ All 11 example files updated  
✅ Consistent with new handler signatures  
✅ Ready for production use  
✅ Documentation complete

