# Changelog

All notable changes to ZeroNode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.16] - 2026-10-28

Reliability fixes from the 2026-10-28 review. Every fix is a better default:
no new config keys. The public API stays source-compatible; wire changes are
additive only (see "Wire"). Each bug has a regression test in
`test/regressions/` that fails on 2.0.15 (`b00e31e`); the review repro is
named in brackets.

### Fixed
- **Receive loop survives handler errors (#1)** [r2-tick-throw]: a throwing
  tick handler (sync or async) or a malformed frame no longer ends the socket
  receive loop. Each tick handler runs in isolation; failures surface as
  `NodeEvent.ERROR` (`HANDLER_ERROR` / `INVALID_ENVELOPE`), on the server too
  (new `ServerEvent.ERROR`).
- **Router proxy loops are bounded (#2)** [r6-router-loop]: routers no longer
  bounce an unroutable `requestAny`/`tickAny` between each other (~28k proxy
  requests per router in 1.5s before; now one per router). Proxied messages
  carry the proxy `path`, the routers already `visited` and, for requests, a
  relative time `budget`. Routers are searched depth-first: a router that
  cannot place a request answers with what it explored and the previous hop
  tries its next router; a router that cannot place a tick sends it back
  (`_system:proxy_tick_miss`) for the same purpose. Each router is tried at
  most once per message; a path is limited to `Globals.PROXY_MAX_HOPS` (8)
  nodes (`PROXY_HOP_LIMIT`, only when a router really went unexplored). Each
  hop answers inside its budget (margin `min(50ms, budget/4)`), so callers get
  the real error (`NO_NODES_MATCH_FILTER`, `PROXY_DEADLINE_EXCEEDED`) instead
  of `REQUEST_TIMEOUT`. Only a miss a router produced itself (marked
  `routing.miss`) lets the previous hop try another router; an error thrown by
  a service handler, whatever its code, is relayed as the final answer, so a
  handler never runs twice. A proxied tick has a total forward budget
  (`Globals.PROXY_TICK_MAX_FORWARDS`, 256) shared by all branches. Malformed
  routing metadata fails closed before anything is delivered locally; a tick
  miss is accepted only from the router the tick was forwarded to, once.
- **Crashed peers fail fast (#3)** [r4-crash-stale]: the ROUTER socket now
  defaults to `mandatory` with a send timeout of 0, so a send to a dead peer
  fails with `EHOSTUNREACH` at once: the request rejects with
  `PEER_UNREACHABLE` (`context.delivered === false`), the peer leaves
  (`PEER_LEFT` reason `UNREACHABLE`), and `requestAny` sends it to another
  matching peer — only in this case, where the message provably never left.
  A request that may have been delivered (`context.delivered === 'unknown'`)
  is never resent (at-most-once). A full queue (`EAGAIN`, slow peer) fails only
  that send (`SEND_FAILED`) and keeps the peer.
- **`disconnect()` stays disconnected (#4)** [r1-disconnect-reconnects]:
  auto-reconnect no longer undoes an explicit `disconnect()`; the client
  socket is released too.
- **Failed `connect()` leaks nothing (#5)** [r5-connect-fail-leak]: the client
  is closed on failure, so no ghost upstream peer appears later. A `connect()`
  still in its handshake is cancelled by `disconnect()`/`close()`
  (`CONNECT_CANCELLED`); `connect()` after `close()` rejects. Concurrent
  `connect()` calls to one address share one attempt; each caller waits at
  most its own timeout, and no longer than the first caller's.
- **`tick()` delivers metadata (#6)** [r3-tick-metadata].
- **Pending requests fail when their peer leaves (#7)**: requests to a peer
  that stops, times out, becomes unreachable or is replaced reject at once
  (`PEER_LEFT` / `PEER_UNREACHABLE`). Client requests survive a transport
  blip of up to `Globals.RECONNECT_GRACE_MS` (2s), then fail with
  `PEER_UNREACHABLE`; a reconnect that reaches a different server id rejects
  what the old server owed (`PEER_LEFT`).
- **`setOptions()` propagates (#8)** [r7-setoptions-propagation]: connected
  peers receive the new options (`_system:options_update`), update
  `getPeerOptions()` and filtered routing, and emit the new
  `NodeEvent.PEER_UPDATED`; later handshakes (and a `connect()` still in its
  handshake) carry the current options. `await setOptions()` resolves when
  the updates are handed to the transport (no acknowledgement; at most
  `RECONNECT_GRACE_MS` while a connection is re-establishing). Options
  replace the previous ones; `setOptions()` no longer mutates the caller's
  object (the constructor still adds `_id` to the object it is given). A
  `Router` keeps `router: true`.
- **A restarted peer reusing its id is accepted (#9)** [f6-router-handover]:
  `ZMQ_ROUTER_HANDOVER` now defaults to on (the most recent connection with an
  id wins). A handshake from a new *instance* of a joined id emits
  `PEER_LEFT` (`REPLACED`) then `PEER_JOINED`; a re-handshake of the same
  instance (after a blip) does not.
- `MessageDispatcher.offRequest(pattern)` without a handler no longer throws.
- Reporting a failed tick handler never throws, whatever it threw or
  rejected with (e.g. a `Symbol`); it used to become an unhandled rejection.
- A `Client` reused after `disconnect()` keeps its reconnect grace period.
- Re-sending options changed during a handshake no longer extends
  `connect()`'s timeout or delays `disconnect()`/`close()`.
- Server client-instance ids and forwarded-tick records are released on
  unbind/close and on expiry.

### Added
- `NodeEvent.PEER_UPDATED`, `ServerEvent.ERROR`,
  `ServerEvent.CLIENT_OPTIONS_UPDATED`, `ClientEvent.SERVER_OPTIONS_UPDATED`,
  `ProtocolEvent.PEER_UNREACHABLE`, `TransportEvent.SEND_FAILED`.
- Error codes: `NodeErrorCode.CONNECT_CANCELLED`, `PROXY_HOP_LIMIT`,
  `PROXY_DEADLINE_EXCEEDED`; `ProtocolErrorCode.PEER_UNREACHABLE`,
  `PEER_LEFT`, `SEND_FAILED`; `TransportErrorCode.MESSAGE_HANDLER_FAILED`.
- `error.context.delivered` on request rejections: `false` (never sent, safe
  to resend) or `'unknown'` (may have run).
- `TickOptions.metadata` in `index.d.ts`.
- Test suite fails on unhandled promise rejections.

### Changed (defaults)
- ROUTER: `ZMQ_ROUTER_MANDATORY` true, send timeout 0 (unless
  `ZMQ_SNDTIMEO` is set), `ZMQ_ROUTER_HANDOVER` true. Explicit config wins.
- `CLIENT_HEALTH_CHECK_INTERVAL` 5s (was 30s). Unless `CLIENT_GHOST_TIMEOUT`
  is set, a client is a ghost after 3 × the ping interval (30s with the
  default 10s ping; was 60s). A client whose event loop stalls for longer is
  now dropped after 30s instead of 60s. The server assumes its clients ping at
  the server's own configured `PING_INTERVAL`.
- A ROUTER `sendBuffer()` returns the send promise (it returned `true`).
- Server-side tick handler failures and malformed incoming frames are now
  reported as `NodeEvent.ERROR` (`source: 'server'`) and logged at error
  level, once per occurrence (they used to kill the receive loop silently).
  A misbehaving peer can therefore produce many error events/log lines.

### Wire (all additive; older peers ignore it)
- New system ticks `_system:options_update` and `_system:proxy_tick_miss`.
- Handshake metadata `instance` (client instance id).
- `metadata.routing` on proxied messages: `path`, `visited`, `budget`
  (requests), `tick` (ticks); error replies of proxied requests carry
  `routing.{visited, unexplored}`.

### Known limitations
- Node ids must be unique per process. Two live processes sharing an id now
  take it over from each other alternately (each takeover is `REPLACED`, with
  a warning, and rejects requests pending to the id) instead of one being
  silently invisible. Check this before rolling out to deployments with
  stable ids (e.g. `${GAME_NAME}-${name}`).
- If a client's connection blips while the server sends to it, the server
  sees `EHOSTUNREACH`: `PEER_LEFT` (`UNREACHABLE`) then `PEER_JOINED` when it
  re-handshakes, requests the server had pending to it are rejected, and a
  reply sent in that window is lost (as before, when the ROUTER dropped it
  silently), so the client waits for its own timeout.
- Narrow windows: a request the server sends to the new instance between an
  id takeover and its handshake is rejected as `REPLACED`; a request a client
  sends after reconnecting but before a *different* server's handshake ack is
  rejected as `PEER_LEFT`.
- With an infinite `ZMQ_SNDTIMEO` on the router, a peer leaving does not fail
  pending requests early (their sends never settle).
- Options propagation does not reach peers on < 2.0.16. Loop protection needs
  every router on >= 2.0.16: an old router is recorded as visited by the new
  ones next to it, but between two or more old routers requests can still
  loop until the caller's timeout and **ticks can loop indefinitely**. Misses
  from old routers are not marked, so a request search does not continue past
  them (it fails rather than risk running a handler twice).
- In meshes of more than `Globals.PROXY_MAX_VISITED` (64) routers, the
  earliest explored routers may be explored again (bounded by the hop limit,
  and for requests by the budget).
- Router tick stats are per router: `failedRoutes` counts ticks a router could
  not place, even if another router delivered them later.
- Proxied ticks are best-effort. Each node remembers the ticks it forwarded
  (`Globals.PROXY_TICK_RECORDS`, 10k, for `PROXY_TICK_RECORD_MS`, 10s) to
  match misses coming back; above ~1k proxied ticks/s per node a slow miss can
  find its record evicted and the tick is dropped.
- `tickAny`/`tickAll` take no `metadata`.
- Repeated handshakes may still emit duplicate `PEER_JOINED`/`PEER_LEFT`
  events (unchanged).

---

## [2.0.12] – [2.0.15]

No changelog entries were written for these versions. Note: 2.0.13 widened
the envelope `dataLength` field to 4 bytes, so nodes on <= 2.0.12 and
>= 2.0.13 cannot talk to each other.

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

