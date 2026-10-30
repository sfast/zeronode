# Changelog

All notable changes to ZeroNode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0-rc.2] - 2026-10-30

Fixes from a Codex (gpt-6-astra) review of everything since feature/pingfix
(b00e31e, 2.0.15) up to 2.1.0-rc.1 (aki docs 18, 19). Regression tests: the
"2.1.0-rc.2" block of `test/regressions/peer-lifecycle-2.1.test.js` and the
updated alias case in `bug10-router-restart-rekey.test.js` (each fails on
2.1.0-rc.1). No wire change.

### Fixed
- **A restarted pre-2.0.16 client is announced again.** Clients older than
  2.0.16 send no instance id, so a restart under the same id and options
  cannot be told from a transport blip; 2.1.0-rc.1 then suppressed its
  `PEER_JOINED` (edge-triggered events), and applications initializing per-peer
  state on `PEER_JOINED` never did so for the new process. A re-handshake is
  now treated as the same session only when the same instance id proves it;
  every handshake of an older client is announced, as in 2.0.15
  (`ServerEvent.CLIENT_JOINED` carries `sameSession`).
- **RegExp handlers with the `g` or `y` flag no longer skip messages.** Such
  a pattern keeps state between matches (`lastIndex`), so since the 2.0.16
  receive-loop isolation a tick handler saw only every other matching tick
  (requests were affected before). Handlers are registered under a view of
  the pattern that matches from index 0 every time; its key, `offTick` /
  `offRequest` with the original pattern, and sticky (`y`) semantics are
  unchanged, and `/x/g` stays a registration distinct from `/x/`.
- **A receive timeout no longer ends reception.** With `ZMQ_RCVTIMEO` set, a
  socket idle past it stopped receiving for good (pre-existing). The receive
  loop now receives again while the socket is open (with `ZMQ_RCVTIMEO: 0` it
  waits 20 ms between empty receives; the option has no use for zeronode).
- **One server reached through two addresses:** the newer connection now
  replaces the older one, which is closed silently (no `CLIENT_STOP`, which
  would end the shared session) and whose address and reconnect target are
  forgotten; no peer events (the peer stays joined). Before, the older client
  stayed open, kept retrying, was not released by `close()`, and
  `disconnect()` of the older address closed the newer connection.
- `unbind()` rejects the requests still pending on its downstream clients
  (`PEER_LEFT`) instead of leaving them to their timeout.
- A dealer reused after `disconnect()` no longer accumulates monitor
  listeners (the zeromq.js observer has no `removeAllListeners()`), which
  duplicated `READY` and handshakes on each reconnect.
- `Client.close({ notify: false })` closes without telling the server.
- **A server and its clients closing at the same time no longer abort the
  process (mitigation).** A process shutting down a server and its clients
  together (e.g. `Promise.all([router.close(), ...nodes.map(n => n.close())])`,
  or a test suite's teardown) could abort inside libzmq 4.3.5
  (`Assertion failed: _state == active ...` `pipe.cpp:305`,
  `Assertion failed: erased` `socket_base.cpp:2140`, or a segfault): within
  25 rounds of a 3-client parallel close, also with the 2.0.15 JavaScript on
  the current zeromq.js 6.8.0 (not re-tested with the zeromq.js 6.5 that 2.0.15
  locked); it was the one segfault in ~25 full test runs seen while preparing
  2.1. Observed: the abort needs the server's `unbind()` to run while its
  clients' `disconnect()` of the same endpoint is in flight; raw zeromq.js
  sockets doing the same calls did not abort. The server now waits
  `Globals.TEARDOWN_SETTLE_MS` (5 ms, a timer turn, not a `setImmediate`)
  between telling its clients it stops and unbinding (server side only; the
  same delay on both sides re-synchronised them). 1000 protocol-level and 500
  Node-level rounds clean afterwards; serial close orders were never affected.
  The exact native sequence is not proven and a delay is not a barrier, so
  this is a mitigation, not a guarantee; a 60-round parallel close runs as a
  regression test.

### Docs / typings
- CONFIGURATION.md: real health-check / ghost defaults (5 s, 3 × `PING_INTERVAL`);
  the real option names `ZMQ_SNDHWM` / `ZMQ_RCVHWM` (default 10000) and
  `ZMQ_SNDTIMEO` / `ZMQ_RCVTIMEO` (the documented `ZMQ_SEND_HWM`,
  `ZMQ_RECV_HWM`, `ZMQ_SEND_TIMEOUT`, `ZMQ_RECV_TIMEOUT` were never read).
- API.md: `requestAny` retries another peer only for `PEER_UNREACHABLE` with
  `delivered: false`; `filter: { predicate }` (no top-level `predicate`); no
  `metadata` on `requestAny` / `tickAny` / `tickAll`; the non-existent
  `requestAll()` removed; `tickAll` reaches directly connected peers only.
- EVENTS.md: when pending requests fail after `PEER_LEFT` (at once, or after the
  2 s reconnect grace for a dropped link); `NodeEvent.ERROR` source `'node'`.
- index.d.ts: deprecated `PROTOCOL_BUFFER_STRATEGY` accepts its old values
  again (`'EXACT'` / `'POWER_OF_2'`, a compile break in 2.1.0-rc.1);
  `bind(address?)` resolves with the bound address; `disconnect()` resolves
  `true`; `unbind()` documents `TRANSPORT_UNBIND_FAILED`.

---

## [2.1.0-rc.1] - 2026-10-30

From the PEER_LEFT / reconnectionTimeout analysis (aki doc 15) as refined by
the Codex plan review (aki doc 16). Regression tests:
`test/regressions/transport-lifecycle-2.0.17.test.js` (each fails on 2.0.16).
No wire change.

### Fixed (patch-safe: 2.0.17 candidates)
- An explicit disconnect reports `NOT_READY` once: `Dealer.close()` after
  `disconnect()` (what `Client.close()` does) reported it again, so a client
  closing itself got one more `PEER_LEFT` for its server. Monitor events still
  queued from the old link are ignored after an explicit disconnect.
- `unbind()` and `close()` no longer leave downstream peers joined in the Node
  (they stayed in `getPeers()` and were picked by `requestAny` with no route).
  Still no events for them, as before. A pending resurrection handshake is
  forgotten on unbind too.
- `bind()` after `unbind()` receives again: the receive loop stopped by
  `unbind()` was never restarted, so a rebound server dropped its first
  message and received nothing more (clients never rejoined).
- DEALER transport events carry the endpoint: `READY` / `NOT_READY` are
  `{ address }`, `RECONNECT_RETRY` is `{ address, interval }` (they carried
  the zeromq.js event object as `fd` and an undefined `endpoint`).
- `getServerIdByAddress()` returns the id of a live session only (an online,
  joined upstream session re-keyed to that client); it returned a server id
  that had left, also while the transport was back but no handshake had been
  answered.

### Deprecated
- `connect({ reconnectionTimeout })` has had no effect since 2.0 (the
  transport timer it configured was removed; ZeroMQ reconnects without giving
  up). It is no longer copied into an unread config key, and `connect()` logs
  a warning once when it is given.
- `index.d.ts` `NodeConfig.reconnectInterval`, `reconnectMaxInterval`,
  `heartbeatInterval`, `heartbeatTimeout`, `heartbeatTtl` were never read:
  marked deprecated. The keys that are read are now typed: `ZMQ_RECONNECT_IVL`,
  `ZMQ_RECONNECT_IVL_MAX`, `ZMQ_LINGER`, `ZMQ_SNDHWM`, `ZMQ_RCVHWM`,
  `ZMQ_SNDTIMEO`, `ZMQ_RCVTIMEO`, `ZMQ_ROUTER_MANDATORY`, `ZMQ_ROUTER_HANDOVER`,
  `DEALER_IO_THREADS`, `ROUTER_IO_THREADS`.

### Changed (behaviour: 2.1 candidates)
Regression tests: `test/regressions/peer-lifecycle-2.1.test.js`. Cut a 2.0.17
patch from the commit before these if they are not wanted yet.
- **Peer events are edge-triggered**: `PEER_JOINED` once when a session
  starts, `PEER_LEFT` once when it ends, per direction; later signals for the
  same session are not reported (a graceful server stop gave a client up to
  five `PEER_LEFT`, its own `close()` three). A re-handshake of a joined peer
  (e.g. after a blip the other side never noticed) emits nothing, or
  `PEER_UPDATED` if its options changed. **Consumers that count these events
  or wait for a second `reason` see fewer events.**
- `PEER_LEFT` carries `category`: `graceful`, `lost`, `replaced` or `local`
  (`PeerLeftCategory`). `reason` strings are unchanged; the category names the
  signal that arrived first, not a proven cause.
- Peer state is kept per direction: two nodes connected to each other have
  two sessions (one ending no longer drops the other). Routing to such a peer
  prefers this node's own connection to it.
- `unbind()` / `close()` emit one `PEER_LEFT` per downstream peer: `CLIENT_STOP`
  (`graceful`) if the client answered the server's stop in time, otherwise
  `UNBOUND` (`local`).
- Server: `CLIENT_STOP` from a client that is not joined no longer emits
  `CLIENT_LEFT`; a ping from a timed-out client asks it to handshake (again
  after a ping interval if unanswered) without marking it joined, so its
  re-handshake is no longer reported as `REPLACED`.
- **Reconnect policies apply to the connection**: `disabled` ends an upstream
  connection when its session is lost or the server stops; `on_failure` when
  the server stops gracefully (`always` is unchanged). Before, only the
  Node's retry timer followed the policy and ZeroMQ reconnected anyway.
  Pending requests then fail with `PEER_UNREACHABLE`. **If you relied on
  `disabled` still reconnecting, use `always`.**
- **ZMTP heartbeats on client sockets by default** (`ZMQ_HEARTBEAT_IVL` 5000,
  `ZMQ_HEARTBEAT_TIMEOUT` 15000; `ZMQ_HEARTBEAT_IVL: 0` turns them off): a
  server that stops answering while TCP stays up (frozen, partitioned) is
  reported `PEER_LEFT` (`lost`) instead of never. Answered by libzmq itself,
  so servers on any version work (verified against 2.0.15). Server sockets
  are unchanged.
- `connect()` on an address that is still connected returns peer info only
  for a live session (`null` while the server is gone).
- A server accepts no handshake once `unbind()` / `close()` has started (also
  when a `PEER_LEFT` / `PEER_JOINED` listener starts it), and a client this
  node is ending (`disconnect()`, reconnect policy) joins nothing: listeners
  can tear down from inside peer events without the session coming back.
  `bind()` and `unbind()` calls run one at a time in call order; sessions are
  accepted while the transport is bound and the latest successful bind is
  newer than the latest unbind/close request (a bind that fails changes
  nothing). `close()` refuses later binds and waits for queued ones, so no
  bind is under way when the transport closes; a Node closed before its
  constructor's bind ran does not bind, and `bind()` on a closed Node (or a
  closed ZeroMQ router socket) is refused (`TRANSPORT_BIND_FAILED`). If libzmq
  refuses the transport unbind, `unbind()` now rejects
  (`TRANSPORT_UNBIND_FAILED`): the server has told its clients it stops and
  accepts no session, but stays bound; `bind()` at the same address resumes
  serving, `close()` always releases the transport; `bind()` to another
  address while still bound is refused (`TRANSPORT_ALREADY_BOUND`) and changes
  nothing. A `bind()` retried after a failed one (e.g. address in use) really
  binds (it returned at once without binding).
- A client whose link to its server stayed up while the session ended (the
  server said it stops without dropping the link, or an ack was lost) asks
  for a session again from its reconnect timer (`reconnect: 'always'`);
  ZeroMQ only re-handshakes after the link drops.
- `requestAny` / `tickAny` / `tickAll` with `down` / `up` send through a
  connection of the selected direction (a peer joined both ways was reached
  through the other one).

### Added (2.1 candidates)
- `NodeEvent.RECONNECT_ATTEMPT` `{ address, interval, peerId }`
  (`ClientEvent.RECONNECTING`, `ProtocolEvent.TRANSPORT_RECONNECTING`): the
  transport retrying an upstream connection; observability only.
- `PeerLeftCategory`; typed `ZMQ_HEARTBEAT_IVL` / `_TIMEOUT` / `_TTL`, the
  `RECONNECT_ATTEMPT` listener overloads and `connect()`'s result;
  `ZMQ_RECONNECT_IVL_MAX` is validated (its default stays 0).

### Not done (designs in the task notes)
- A "suspect" state before `PEER_LEFT` for short blips, and a finite
  reconnect deadline (a new option, not `reconnectionTimeout`): both need a
  per-address session generation first.
- Server-side disconnect detection via `ZMQ_ROUTER_NOTIFY` (draft): needs a
  per-option capability check and a model of ROUTER handover first.
- `READY` on the ZMTP `handshake` event instead of TCP `connect`.
- Router-side ZMTP heartbeats, and a different `ZMQ_RECONNECT_IVL_MAX` default.

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
- **A server restarting under a new id is routable again (#10)**
  [d736e0f6 F1]: a node that stays up while its upstream server (e.g. a
  `Router`) restarts at the same address under a new id used to re-handshake
  (the DEALER reconnects by itself) without re-keying its connection: the new
  id was joined but had no route, so `requestAny` ended
  `NO_NODES_MATCH_FILTER`, `request`/`tick({ to })` `NODE_NOT_FOUND` and
  `tickAny` a routing miss until the process restarted (2.0.15 too). The
  connection now moves to the new id before `PEER_JOINED` (the old id gets
  `PEER_LEFT` `replaced` if it was still joined; `getPeerOptions(oldId)` is
  `null`); `disconnect(address)` and auto-reconnect use the new id. A re-key
  never takes over an id another connection already holds (warning).
- The auto-reconnect timer no longer reports "Successfully reconnected" and
  stops for an address whose client has no session (no joined server id,
  e.g. the transport is up again but nothing answered the handshake); it
  keeps checking with backoff (up to every 30s, one info log line each) until
  the client's own re-handshake ends it (g1).
- The first `PEER_JOINED` of a `connect()` is emitted once the peer is
  routable: a synchronous listener can `request({ to: peerId })`. A
  `connect()` cancelled during its handshake no longer emits
  `PEER_JOINED`/`PEER_LEFT` (g2). A `PEER_JOINED` listener that throws there
  is reported as `NodeEvent.ERROR` (`source: 'node'`, `stage: 'listener'`)
  and `connect()` still resolves (it used to end in a handshake timeout with
  the peer half registered).
- `requestAny`/`tickAny` ignore a caller-supplied `_routing` (internal proxy
  routing info: it could exclude the caller's own routers or forge the
  `requestor`) (f2).
- `MessageDispatcher.offRequest(pattern)` without a handler no longer throws.
- Reporting a failed tick handler never throws, whatever it threw or
  rejected with (e.g. a `Symbol`); it used to become an unhandled rejection.
- A `Client` reused after `disconnect()` keeps its reconnect grace period.
- Re-sending options changed during a handshake no longer extends
  `connect()`'s timeout or delays `disconnect()`/`close()`.
- Server client-instance ids are released on unbind/close. Forwarded-tick
  records expire after `Globals.PROXY_TICK_RECORD_MS` (a sweep runs while any
  exist) and none remain after `close()`.
- Concurrent `Client.disconnect()`/`close()` calls share one teardown. A
  `Client.connect()` called while it is in progress, or once `close()` has
  started, is refused at once (`TRANSPORT_ALREADY_CONNECTED`) instead of
  disturbing the teardown; a closed `Client` cannot connect again (use a new
  one; `Node` always does).

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
- `index.d.ts` declares the config keys that are read: `PING_INTERVAL` and
  `BUFFER_STRATEGY` (`null` | `'power-of-2'`). `CLIENT_PING_INTERVAL` and
  `PROTOCOL_BUFFER_STRATEGY` were never read; they stay typed, deprecated,
  and are still ignored. Also typed: `tickAny`/`tickDownAny`/`tickUpAny`
  return `void | Promise<void>`, `ProtocolError.context.delivered`, and the
  real health check / ghost defaults (5s / 3 × ping = 30s).
- Server-side tick handler failures and malformed incoming frames are now
  reported as `NodeEvent.ERROR` (`source: 'server'`) and logged at error
  level, once per occurrence (they used to kill the receive loop silently).
  A misbehaving peer can therefore produce many error events/log lines.

### Dependencies
- `underscore` 1.13.8 (security fix); `zeromq` 6.8.0
  (libzmq 4.3.5); `msgpack-lite` 0.1.27 (encoding verified byte-identical to
  0.1.26). `npm audit --omit=dev`: 0 vulnerabilities.
- Removed unused runtime dependencies `bluebird`, `lokijs`, `nats` and `uuid`
  (nothing in zeronode imports them). If your code imported one of them
  without declaring it, add it to your own `package.json`.
- Removed `preinstall.sh`: installing zeronode no longer tries to install
  `libzmq` with `sudo apt-get` / `yum` / `brew`. zeromq 6 ships its own
  prebuilt binary.
- Removed the `prepare` script (it ran `snyk-protect` against an empty
  `.snyk`). Installing zeronode from git (`github:sfast/zeronode#...`) no
  longer installs its dev tooling, so it no longer needs the newer Node the
  test tools require.
- Dev: mocha 12, chai 6, c8 12, snyk 1.1308; removed unused `seneca`,
  `js-yaml`, `cross-env`. Running the test suite needs Node `^20.19 || >=22.12`
  (mocha 12); the library still supports Node >= 18.

### Wire (all additive; older peers ignore it)
Older peers have no built-in handler for the new system ticks, but an
application's catch-all tick handler on an older peer (e.g. a RegExp matching
every event) can see `_system:options_update` / `_system:proxy_tick_miss`.
Handshakes from clients older than 2.0.16 carry no instance id: a restart of
such a client under the same id cannot be detected (since 2.1.0-rc.2 each of
its handshakes is announced as `PEER_JOINED`).
- New system ticks `_system:options_update` and `_system:proxy_tick_miss`.
- Handshake metadata `instance` (client instance id).
- `metadata.routing` on proxied messages: `path`, `visited`, `budget`
  (requests), `tick` and `forwards` (ticks); a router's own miss replies
  carry `routing.{miss, visited, unexplored}` (requests) and
  `_system:proxy_tick_miss` carries `routing.{tick, visited, unexplored,
  forwards}` (ticks).

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
- A ROUTER **reply** to a live peer whose queue is full (`ZMQ_SNDHWM`) is
  dropped (`EAGAIN` with the default send timeout 0) and not reported; the
  requester waits for its own timeout. Requests fail fast in that case
  (`SEND_FAILED`), replies do not. `ZMQ_SNDTIMEO` is configurable: a positive
  value makes the router wait up to that long for queue space first (but see
  the infinite-timeout note above).
- Options propagation does not reach peers on < 2.0.16. Loop protection needs
  every router on >= 2.0.16: an old router is recorded as visited by the new
  ones next to it, but between two or more old routers requests can still
  loop until the caller's timeout and **ticks can loop indefinitely**. Misses
  from old routers are not marked, so a request search does not continue past
  them (it fails rather than risk running a handler twice).
- In meshes of more than `Globals.PROXY_MAX_VISITED` (64) routers, the
  earliest explored routers may be explored again (bounded by the hop limit,
  for requests by the budget, and for ticks by `PROXY_TICK_MAX_FORWARDS`).
- Router tick stats are per router: `failedRoutes` counts ticks a router could
  not place, even if another router delivered them later.
- Proxied ticks are best-effort. Each node remembers the ticks it forwarded
  (`Globals.PROXY_TICK_RECORDS`, 10k, for `PROXY_TICK_RECORD_MS`, 10s) to
  match misses coming back; above ~1k proxied ticks/s per node a slow miss can
  find its record evicted and the tick is dropped.
- `tickAny`/`tickAll` take no `metadata`.
- One Node connecting to the same server through two addresses (e.g.
  `127.0.0.1` and `localhost`): both connections carry the node's id, so at
  the server the newer one takes over (ROUTER handover). Since 2.1.0-rc.2 the
  newer connection replaces the older one (closed silently, its address
  forgotten); keep one address per server anyway.
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

