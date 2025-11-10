# Configuration Naming Changes

## Summary

Renamed configuration properties to uppercase constants for better consistency and clarity.

---

## Changes Made

### 1. **New Export: `TIMEOUT_INFINITY`**

```javascript
// OLD
import { ZMQConfigDefaults } from './transport/zeromq/index.js'
const timeout = ZMQConfigDefaults.INFINITY  // -1

// NEW
import { TIMEOUT_INFINITY } from './transport/zeromq/index.js'
const timeout = TIMEOUT_INFINITY  // -1
```

**Why?**
- `INFINITY` was just a constant value, not really a config
- Now it's a standalone constant: `TIMEOUT_INFINITY`
- More descriptive name (timeout-specific)

---

### 2. **Renamed Config Properties to Uppercase**

```javascript
// OLD
{
  dealerIoThreads: 1,
  routerIoThreads: 2,
  debug: false,
  INFINITY: -1  // ❌ Removed from config
}

// NEW
{
  DEALER_IO_THREADS: 1,
  ROUTER_IO_THREADS: 2,
  DEBUG: false
}
```

---

## Migration Guide

### Before (Old Code)

```javascript
import { Dealer, ZMQConfigDefaults } from './transport/zeromq/index.js'

const dealer = new Dealer({
  id: 'my-dealer',
  config: {
    dealerIoThreads: 2,        // ❌ Old name
    debug: true,               // ❌ Old name
    RECONNECTION_TIMEOUT: ZMQConfigDefaults.INFINITY  // ❌ Old usage
  }
})
```

### After (New Code)

```javascript
import { Dealer, TIMEOUT_INFINITY } from './transport/zeromq/index.js'

const dealer = new Dealer({
  id: 'my-dealer',
  config: {
    DEALER_IO_THREADS: 2,      // ✅ New name (uppercase)
    DEBUG: true,               // ✅ New name (uppercase)
    RECONNECTION_TIMEOUT: TIMEOUT_INFINITY  // ✅ Standalone constant
  }
})
```

---

## Complete Example

### Production Client Configuration

```javascript
import { Dealer, Router, TIMEOUT_INFINITY } from './transport/zeromq/index.js'

// Dealer (Client)
const dealer = new Dealer({
  id: 'production-client',
  config: {
    // Threading
    DEALER_IO_THREADS: 1,               // ✅ Uppercase
    
    // Timeouts
    CONNECTION_TIMEOUT: TIMEOUT_INFINITY,     // ✅ Use constant
    RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,   // ✅ Use constant
    
    // ZeroMQ Native
    ZMQ_RECONNECT_IVL: 100,
    ZMQ_RECONNECT_IVL_MAX: 0,
    ZMQ_LINGER: 0,
    ZMQ_SNDHWM: 50000,
    ZMQ_RCVHWM: 50000,
    
    // Logging
    DEBUG: false,                       // ✅ Uppercase
    logger: myLogger
  }
})

// Router (Server)
const router = new Router({
  id: 'production-server',
  config: {
    // Threading
    ROUTER_IO_THREADS: 4,               // ✅ Uppercase for high-throughput
    
    // ZeroMQ Native
    ZMQ_LINGER: 5000,
    ZMQ_SNDHWM: 100000,
    ZMQ_RCVHWM: 100000,
    
    // Logging
    DEBUG: false,                       // ✅ Uppercase
    logger: myLogger
  }
})
```

---

## All Changed Properties

| Old Name | New Name | Type | Default |
|----------|----------|------|---------|
| `dealerIoThreads` | `DEALER_IO_THREADS` | number | `1` |
| `routerIoThreads` | `ROUTER_IO_THREADS` | number | `2` |
| `debug` | `DEBUG` | boolean | `false` |
| `INFINITY` (in config) | `TIMEOUT_INFINITY` (standalone) | number | `-1` |

---

## Unchanged Properties

These remain the same (already uppercase or special):

```javascript
{
  // ZeroMQ Native Options (unchanged)
  ZMQ_LINGER: 0,
  ZMQ_SNDHWM: 10000,
  ZMQ_RCVHWM: 10000,
  ZMQ_SNDTIMEO: undefined,
  ZMQ_RCVTIMEO: undefined,
  ZMQ_RECONNECT_IVL: 100,
  ZMQ_RECONNECT_IVL_MAX: 0,
  ZMQ_ROUTER_MANDATORY: false,
  ZMQ_ROUTER_HANDOVER: false,
  
  // Application-Level (unchanged)
  CONNECTION_TIMEOUT: -1,
  RECONNECTION_TIMEOUT: -1,
  
  // Special (unchanged)
  logger: console  // lowercase because it's an object reference
}
```

---

## Benefits

1. **Consistency** ✅
   - All config constants are now uppercase
   - Follows JavaScript constant naming convention

2. **Clarity** ✅
   - `DEALER_IO_THREADS` is more descriptive than `dealerIoThreads`
   - `TIMEOUT_INFINITY` is clearer than `INFINITY`

3. **Better Exports** ✅
   - `TIMEOUT_INFINITY` is now a top-level export
   - No need to access through `ZMQConfigDefaults`

4. **Type Safety** ✅
   - Constants are clearly distinguished from variables
   - Uppercase signals "don't modify this"

---

## Backward Compatibility

⚠️ **Breaking Change**: Old config property names will NOT work.

If you're upgrading, you must rename:
- `dealerIoThreads` → `DEALER_IO_THREADS`
- `routerIoThreads` → `ROUTER_IO_THREADS`  
- `debug` → `DEBUG`
- `ZMQConfigDefaults.INFINITY` → `TIMEOUT_INFINITY`

---

## Updated Files

### Core Files
- ✅ `src/transport/zeromq/config.js` - Config definitions
- ✅ `src/transport/zeromq/dealer.js` - Uses `DEALER_IO_THREADS`
- ✅ `src/transport/zeromq/router.js` - Uses `ROUTER_IO_THREADS`
- ✅ `src/transport/zeromq/socket.js` - Uses `DEBUG`
- ✅ `src/transport/zeromq/index.js` - Exports `TIMEOUT_INFINITY`

### Test Files
- ✅ `src/transport/zeromq/tests/integration.test.js` - Updated to `TIMEOUT_INFINITY`
- ✅ `src/transport/zeromq/tests/reconnection.test.js` - Updated to `TIMEOUT_INFINITY`

### Documentation
- 📝 Will need updating: `CONFIGURATION_GUIDE.md`, `QUICK_REFERENCE.md`

---

## Quick Reference Card

```javascript
// ============================================
// ZEROMQ TRANSPORT CONFIGURATION
// ============================================

import { 
  Dealer, 
  Router, 
  TIMEOUT_INFINITY,           // ✅ Standalone constant
  ZMQConfigDefaults           // Full defaults object
} from './transport/zeromq/index.js'

const config = {
  // === THREADING ===
  DEALER_IO_THREADS: 1,        // Client threads (uppercase)
  ROUTER_IO_THREADS: 2,        // Server threads (uppercase)
  
  // === TIMEOUTS ===
  CONNECTION_TIMEOUT: TIMEOUT_INFINITY,    // Use constant
  RECONNECTION_TIMEOUT: TIMEOUT_INFINITY,  // Use constant
  
  // === ZMQ NATIVE ===
  ZMQ_RECONNECT_IVL: 100,      // Already uppercase
  ZMQ_LINGER: 0,               // Already uppercase
  ZMQ_SNDHWM: 10000,           // Already uppercase
  ZMQ_RCVHWM: 10000,           // Already uppercase
  
  // === LOGGING ===
  DEBUG: false,                // Now uppercase
  logger: console              // lowercase (object reference)
}

// Create sockets
const dealer = new Dealer({ id: 'my-dealer', config })
const router = new Router({ id: 'my-router', config })
```

---

## Notes

- **All config constants are now UPPERCASE** (except `logger` which is an object)
- **`TIMEOUT_INFINITY` is a module-level constant**, not in config object
- **ZMQ_* options were already uppercase** (no change)
- **Validation functions updated** to check new property names

