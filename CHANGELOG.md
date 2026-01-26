# Changelog

All notable changes to ZeroNode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.11] - 2026-01-25

### Fixed
- **Ping Resurrection**: Implemented REQUEST_HANDSHAKE mechanism to fully recover client state after network timeouts
  - Server now requests fresh handshake when detecting client resurrection via ping
  - Client resends complete handshake with full options on REQUEST_HANDSHAKE
  - Added `pendingHandshakes` tracking to prevent duplicate handshake requests
  - Fixes issue where timed-out clients would lose their options/metadata after reconnection
  - Properly synchronizes Server and Node layers after timeout recovery
- **Test Suite**: Fixed 5 pre-existing failing tests
  - Resolved "Address already in use" errors with dynamic port allocation using `getUniquePort()`
  - Fixed timing-related assertion failures with event-based waiting (`waitForNotReady()`)
  - All 811 tests now passing with 95%+ coverage

### Added
- `ProtocolSystemEvent.REQUEST_HANDSHAKE` internal event for server-initiated client handshake
- Comprehensive test suite for ping resurrection scenarios (`test/protocol/server-ping-resurrection.test.js`)
  - Tests client resurrection after timeout
  - Verifies REQUEST_HANDSHAKE is sent exactly once
  - Validates full options recovery including custom client metadata
  - Confirms proper state synchronization between Server and Node layers

---

## [2.0.0] - 2025

### 🎉 Major Release - Transport Abstraction & Architecture Redesign

### Added
- **Transport Abstraction Layer**: Pluggable transport system with factory pattern
  - `Transport.register()` for custom transports
  - `Transport.setDefault()` for global configuration
  - `Transport.createClientSocket()` and `Transport.createServerSocket()` factories
  - `ZeroMQTransport` as default implementation
- **Express-Style Middleware**: Full middleware chain support
  - 2-param handlers: `(envelope, reply)` - auto-continue
  - 3-param handlers: `(envelope, reply, next)` - manual control
  - 4-param handlers: `(error, envelope, reply, next)` - error handling
  - Pattern-based routing with RegExp support
  - Fast path optimization for single handlers
- **Comprehensive Event System**:
  - `NodeEvent`: High-level peer discovery and lifecycle
  - `ClientEvent`: Connection state management
  - `ServerEvent`: Client tracking and timeouts
  - `ProtocolEvent`: Internal protocol events
  - `TransportEvent`: Low-level transport events
- **Configuration System**: Complete config management
  - `PROTOCOL_REQUEST_TIMEOUT`: Request timeout (default: 10s)
  - `PROTOCOL_BUFFER_STRATEGY`: Buffer allocation strategy (EXACT/POWER_OF_2)
  - `CLIENT_PING_INTERVAL`: Client ping interval (default: 10s)
  - `CLIENT_HEALTH_CHECK_INTERVAL`: Server health check interval (default: 30s)
  - `CLIENT_GHOST_TIMEOUT`: Ghost client timeout (default: 60s)
  - `DEBUG`: Verbose debug logging
- **Client Lifecycle States**:
  - `IDLE`: Initial state before connection
  - `CONNECTING`: Connection in progress
  - `CONNECTED`: Transport connected
  - `HEALTHY`: Pinging normally
  - `GHOST`: No ping within timeout
  - `FAILED`: Timed out, being removed
  - `STOPPED`: Gracefully disconnected
- **Professional Documentation**:
  - `CONFIGURATION.md`: Complete configuration guide
  - `ENVELOPE.md`: Binary format specification
  - `EVENTS.md`: Comprehensive event reference
  - `ROUTING.md`: Routing strategies and patterns
  - `MIDDLEWARE.md`: Middleware system guide
  - `EXAMPLES.md`: Real-world production examples
  - `ARCHITECTURE.md`: System architecture deep-dive
  - `TESTING.md`: Testing guide and strategies
  - `BENCHMARKS.md`: Performance benchmarks

### Changed
- **Handler Signatures**: Standardized to `(envelope, reply[, next])` format
  - Removed legacy `(data, envelope)` signature
  - `envelope.event` replaces `envelope.tag` (breaking change)
  - `envelope.data` is now read-only
- **Protocol Layer Refactoring**: Split monolithic `protocol.js` into modules
  - `config.js`: Configuration management
  - `request-tracker.js`: Request/response matching
  - `handler-executor.js`: Middleware chain execution
  - `message-dispatcher.js`: Event routing
  - `lifecycle.js`: Lifecycle management
- **Test Organization**: Reorganized test suite for better maintainability
  - Protocol tests moved to `src/protocol/tests/`
  - Transport tests moved to `src/transport/tests/`
  - Node tests consolidated into `test/node-*.test.js`
  - 699 tests with 95%+ coverage
- **Error Handling**: Normalized error payloads across layers
  - `NodeError`, `ProtocolError`, `TransportError` with error codes
  - `ERROR` event on all layers with structured payload
  - `reply.error()` for middleware error responses
- **Connection Management**:
  - Client handshake with `_system:handshake_init_from_client` and `_system:handshake_ack_from_server`
  - Automatic ping/pong for health monitoring
  - Ghost client detection and removal
  - Graceful disconnect with `CLIENT_STOP` message

### Removed
- **Deprecated Config Options**:
  - `CONNECTION_TIMEOUT` (removed, ZeroMQ handles connection)
  - `RECONNECTION_TIMEOUT` (removed, ZeroMQ handles reconnection)
  - `CLIENT_MUST_HEARTBEAT_INTERVAL` (replaced by `CLIENT_HEALTH_CHECK_INTERVAL`)
  - `REQUEST_TIMEOUT` (renamed to `PROTOCOL_REQUEST_TIMEOUT`)
- **Legacy Features**:
  - Old handler signature `(data, envelope)`
  - `envelope.tag` property (use `envelope.event`)
  - `serverData` in `ClientEvent.READY` payload
  - `Protocol.isReady()` (use `Client.isReady()` or `Server.isReady()`)

### Fixed
- **Race Conditions**: Fixed multiple test race conditions with proper timing
- **Memory Leaks**: Proper client cleanup on disconnect/timeout
- **Event Listener Leaks**: Detach socket handlers on close
- **Config Merging**: Fixed `mergeProtocolConfig` to preserve all user configs
- **Pattern Matching**: Fixed RegExp pattern matching in middleware dispatcher
- **Client State Management**: Proper state transitions (IDLE → CONNECTING → CONNECTED → HEALTHY/GHOST/FAILED)

### Performance
- **Fast Path**: Single-handler optimization (no middleware overhead)
- **Inline Execution**: Zero-allocation middleware chain
- **Lazy Parsing**: Parse envelope fields only when accessed
- **Buffer Strategies**: EXACT (zero waste) or POWER_OF_2 (less GC)
- **Sub-millisecond Latency**: Average 0.3ms request-response time

---

## [1.1.31] - 2019-06-23

### Added
- Metric documentation
- Security vulnerability fix

---

## [1.1.7] - 2018-04-08

### Added
- Request rejection with `.error(err)`
- Metrics collection

### Fixed
- Changelog date

---

## [1.1.6] - 2018-02-09

### Changed
- Test coverage increased to ~90%
- README updates
- Benchmark improvements

### Fixed
- Bug fixes

---

## [1.1.5] - 2017-12-22

### Changed
- Test coverage increased to ~70%
- README updates

### Fixed
- Bug fixes

---

## [1.1.4] - 2017-12-09

### Added
- `getClientInfo()` and `getServerInfo()` functions
- Full actor information in events (online, options, etc.)
- Tagged releases for version transparency

### Fixed
- Monitor bug (changed zmq to zeromq package)

---

## [1.1.0] - 2017-12-06

### Changed
- **Breaking**: Request and tick method signatures
- `CLIENT_PING_INTERVAL` can be set via `setOptions()`
- Fixed `onRequest()` handler ordering

### Added
- Snyk vulnerability testing
- ZeroMQ monitor events

---

## [1.0.12] - 2017-11-17

### Added
- `Buffer.alloc` shim for Node < 4.5.0
- Automatic ZeroMQ installation script (Debian, Mac)

---

## Migration Guide

### From 1.x to 2.0

#### Handler Signatures
```javascript
// Old (1.x)
node.onRequest('event', (data, envelope) => {
  console.log(data)
  envelope.reply({ success: true })
})

// New (2.0)
node.onRequest('event', (envelope, reply) => {
  console.log(envelope.data)
  reply({ success: true })
  // or: return { success: true }
})
```

#### envelope.tag → envelope.event
```javascript
// Old (1.x)
console.log(envelope.tag)

// New (2.0)
console.log(envelope.event)
```

#### Configuration
```javascript
// Old (1.x)
new Node({
  config: {
    REQUEST_TIMEOUT: 15000,
    CLIENT_MUST_HEARTBEAT_INTERVAL: 30000
  }
})

// New (2.0)
new Node({
  config: {
    PROTOCOL_REQUEST_TIMEOUT: 15000,
    CLIENT_HEALTH_CHECK_INTERVAL: 30000,
    CLIENT_GHOST_TIMEOUT: 60000
  }
})
```

---

**For complete documentation, see [README.md](../README.md)**

