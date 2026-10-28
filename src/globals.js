import { BufferStrategy } from './protocol/envelope.js'

export default {
  // Request timeout (10s)
  PROTOCOL_REQUEST_TIMEOUT: 10000,   
  // Buffer strategy (EXACT) or POWER_OF_2 to kind of make data buffers power of 2 sizes
  PROTOCOL_BUFFER_STRATEGY: BufferStrategy.EXACT,
  // Client ping interval (10s)
  CLIENT_PING_INTERVAL: 10000,
  // Once client connected Server health checks client pings in this interval (5s)
  CLIENT_HEALTH_CHECK_INTERVAL: 5000,
  // Client considered GHOST after 30s (3 x ping interval) without ping
  CLIENT_GHOST_TIMEOUT: 30000,
  // Client: requests pending when the transport drops survive a reconnect
  // within this time (2s), then fail with PEER_UNREACHABLE
  RECONNECT_GRACE_MS: 2000,
  // Router proxying: max nodes on a proxy path (caller + routers) before a
  // router refuses to forward again (bounds router↔router loops)
  PROXY_MAX_HOPS: 8,
  // Router proxying: each hop answers up to this much (at most a quarter of its
  // budget) before the previous hop's timer fires, so the caller sees the real
  // error instead of REQUEST_TIMEOUT. The budget is relative (immune to clock
  // skew) and starts on receipt, so the margin also covers per-hop transit
  // and event-loop delay
  PROXY_HOP_MARGIN_MS: 50,
  // Router proxying: a hop with less budget than this does not forward
  PROXY_MIN_BUDGET_MS: 5,
  // Router proxying: max routers reported as explored for one request
  PROXY_MAX_VISITED: 64
}
