# Protocol Events & Heartbeat Design

## Philosophy: What Does the Application Layer Need to Know?

The application (Client/Server) should be aware of:
1. **Operational state** - Can I send messages?
2. **Peer health** - Is my peer alive?
3. **Network changes** - Connection lost/restored
4. **Failure detection** - Peer is dead, stop trying

The application should NOT care about:
- Transport-level retries
- Socket reconnection attempts
- Low-level socket events

---

## Protocol Events (Client & Server Perspective)

### Core Principle: Semantic, Not Technical

Events should describe **what happened** at the application level, not the transport level.

### Proposed Events:

#### 1. **Connection Lifecycle (Both Client & Server)**

```javascript
ProtocolEvent.READY
// Meaning: "You can now send/receive messages"
// When: Initial connection OR after reconnection
// Action: Application can start normal operations

ProtocolEvent.DISCONNECTED
// Meaning: "Connection is lost, but might come back"
// When: Network issue, server restart, temporary failure
// Action: Stop sending, wait for reconnection
// Important: Pending requests survive! (might complete after reconnect)

ProtocolEvent.RECONNECTED
// Meaning: "Connection restored after temporary loss"
// When: After DISCONNECTED, connection re-established
// Action: Resume normal operations, re-sync state if needed

ProtocolEvent.FAILED
// Meaning: "Connection definitively failed, stop trying"
// When: Reconnection timeout exceeded, fatal error
// Action: Clean up resources, notify user, possibly retry at app level
```

#### 2. **Peer Management (Server Only)**

```javascript
ProtocolEvent.PEER_JOINED
// Meaning: "New peer connected and ready"
// When: Client connects AND completes handshake
// Data: { peerId, endpoint, metadata }
// Action: Add to peer list, send welcome

ProtocolEvent.PEER_LEFT
// Meaning: "Peer gracefully disconnected"
// When: Client sent disconnect message
// Data: { peerId, reason: 'graceful' }
// Action: Remove from active peers

ProtocolEvent.PEER_LOST
// Meaning: "Peer disappeared (no goodbye)"
// When: No heartbeat for threshold, network issue
// Data: { peerId, reason: 'timeout' }
// Action: Mark as ghost, possibly clean up later
```

---

## Heartbeat Strategy

### Questions to Answer:

1. **Who pings whom?**
2. **What's the purpose of the ping?**
3. **How often?**
4. **What happens if ping fails?**

### Option 1: Client → Server (Current Implementation)

```
┌────────┐                      ┌────────┐
│ Client │ ─────ping────────→   │ Server │
│        │                      │        │
│        │ ←────(no response)─  │        │
└────────┘                      └────────┘
```

**Pros:**
- Server knows which clients are alive (easy to track)
- Server-side health check is simple
- Scales well (server tracks N clients)

**Cons:**
- Client doesn't get immediate feedback on server health
- Relies on request timeout to detect server failure

### Option 2: Bidirectional Ping

```
┌────────┐                      ┌────────┐
│ Client │ ─────ping────────→   │ Server │
│        │                      │        │
│        │ ←────pong───────────  │        │
└────────┘                      └────────┘
```

**Pros:**
- Client gets immediate server health confirmation
- Server knows client is alive
- Clear contract: ping/pong pair

**Cons:**
- More network traffic (2x messages)
- More complex (need to track pong timeouts)

### Option 3: Server → Client Heartbeat

```
┌────────┐                      ┌────────┐
│ Client │                      │ Server │
│        │ ←───heartbeat────────  │        │
│        │                      │        │
└────────┘                      └────────┘
```

**Pros:**
- Client knows immediately if server is alive
- Client-side reconnection logic is simpler

**Cons:**
- Server must send to ALL clients (doesn't scale)
- Server doesn't know if client received it (one-way)

---

## Recommended Design

### Strategy: Client Pings, Server Monitors

**Client Behavior:**
```
Every PING_INTERVAL (10s):
  ├─ If connected:
  │   └─ Send CLIENT_PING { timestamp }
  └─ If disconnected:
      └─ Don't ping (wait for reconnection)

On READY:
  ├─ Start ping interval
  └─ Send CLIENT_HANDSHAKE { clientId, metadata }

On DISCONNECTED:
  └─ Stop ping (but keep interval reference)

On RECONNECTED:
  ├─ Restart ping
  └─ Re-send CLIENT_HANDSHAKE
```

**Server Behavior:**
```
On CLIENT_HANDSHAKE:
  ├─ Create/update peer: state = ACTIVE
  └─ Send SERVER_WELCOME { serverId }

On CLIENT_PING:
  ├─ Update peer.lastSeen = now
  └─ peer.state = HEALTHY

Every HEALTH_CHECK_INTERVAL (30s):
  └─ For each peer:
      ├─ If (now - lastSeen) > GHOST_THRESHOLD (60s):
      │   ├─ peer.state = GHOST
      │   └─ Emit PEER_LOST { peerId, reason: 'timeout' }
      └─ If (now - lastSeen) > DEAD_THRESHOLD (180s):
          ├─ peer.state = DEAD
          └─ Remove from peers
```

### Thresholds:

```
PING_INTERVAL:        10s   // How often client pings
HEALTH_CHECK_INTERVAL: 30s   // How often server checks
GHOST_THRESHOLD:      60s   // No ping → GHOST (6 missed pings)
DEAD_THRESHOLD:       180s  // No ping → DEAD (18 missed pings)
```

**Why these values?**
- 10s ping: Reasonable balance (not too chatty, not too slow)
- 60s ghost: Allows for temporary network issues (6 missed pings)
- 180s dead: Really dead, safe to clean up

---

## Failure Detection

### Client Detecting Server Failure:

**Fast Detection (Request-Based):**
```
await client.request({ ... }, timeout: 5s)
  → Timeout → Server might be down
  → Error → Network issue
```

**Slow Detection (Protocol Events):**
```
ProtocolEvent.DISCONNECTED
  → Wait for reconnection...
  → 60s later: ProtocolEvent.FAILED
```

**Recommendation:** Use both!
- Request timeout for immediate feedback
- Protocol FAILED event for definitive failure

### Server Detecting Client Failure:

**Only Detection Method:**
```
No CLIENT_PING for 60s → GHOST
No CLIENT_PING for 180s → DEAD
```

**Why no fast detection?**
- Server doesn't send requests to clients (by design)
- Fire-and-forget ticks don't have acks
- Health check is sufficient

---

## Proposed Event Set (Refined)

### ProtocolEvent (Application Layer):

```javascript
export const ProtocolEvent = {
  // Connection Lifecycle
  READY: 'protocol:ready',
  DISCONNECTED: 'protocol:disconnected',
  RECONNECTED: 'protocol:reconnected',
  FAILED: 'protocol:failed',
  
  // Peer Management (Server only)
  PEER_JOINED: 'protocol:peer_joined',
  PEER_LEFT: 'protocol:peer_left',
  PEER_LOST: 'protocol:peer_lost'
}
```

### Application Messages (Client ↔ Server):

```javascript
// Client → Server
CLIENT_HANDSHAKE  // On connect/reconnect, metadata
CLIENT_PING       // Heartbeat, timestamp
CLIENT_GOODBYE    // Graceful disconnect

// Server → Client
SERVER_WELCOME    // Acknowledge handshake
SERVER_SHUTDOWN   // Server going down
```

---

## State Machine

### Client States:

```
DISCONNECTED ──connect()──→ CONNECTING
                               │
                      READY (handshake)
                               │
                          CONNECTED
                               │
                    ┌──────────┴──────────┐
                    │                     │
            Network issue           Graceful
                    ↓                     ↓
              DISCONNECTED            STOPPED
                    │
        ┌───────────┴───────────┐
        │                       │
    Reconnect             Timeout
        ↓                       ↓
    RECONNECTED              FAILED
```

### Server's View of Client:

```
PEER_JOINED ──ping──→ HEALTHY
                         │
                 (no ping for 60s)
                         ↓
                      GHOST
                         │
        ┌────────────────┴────────────────┐
        │                                 │
    ping arrives                  (no ping for 180s)
        ↓                                 ↓
    HEALTHY                            DEAD
                                         │
                                      Remove
```

---

## Comparison with Current Implementation

### What We Have Now ✅

- Client pings server ✅
- Server health check ✅
- READY/CONNECTION_LOST/CONNECTION_RESTORED ✅
- PEER_CONNECTED ✅

### What We Should Change 🔄

1. **Rename Events** (more semantic):
   ```javascript
   // Current:
   CONNECTION_LOST → DISCONNECTED
   CONNECTION_RESTORED → RECONNECTED
   CONNECTION_FAILED → FAILED
   PEER_CONNECTED → PEER_JOINED
   PEER_DISCONNECTED → PEER_LEFT (only for graceful)
   ```

2. **Add Missing Event**:
   ```javascript
   PEER_LOST // For timeout-based detection
   ```

3. **Remove Confusing Event**:
   ```javascript
   PEER_DISCONNECTED // ZeroMQ Router doesn't reliably emit this
   ```

4. **Clarify Handshake**:
   ```javascript
   // Current: CLIENT_CONNECTED (ambiguous)
   // Better: CLIENT_HANDSHAKE (explicit intent)
   ```

---

## Questions to Consider

### 1. Should Client Know Server Health Immediately?

**Current:** Client only knows on request timeout  
**Alternative:** Server sends heartbeat to clients

**Recommendation:** Keep current approach
- Request timeout is sufficient for most cases
- Avoids N broadcast messages from server
- Client can always send a health check request

### 2. Should We Support Pub/Sub Patterns?

**Current:** Request/response + fire-and-forget ticks  
**Alternative:** Add subscription mechanism

**Recommendation:** Keep simple for now
- Ticks can be used for notifications
- True pub/sub adds complexity
- Can be added later if needed

### 3. What About Multi-Server?

**Current:** Client connects to ONE server  
**Question:** Should Client support multiple servers?

**Recommendation:** Separate concern
- Node layer can manage multiple servers
- Keep Client simple (1:1 relationship)

---

## Summary

### Minimal, Complete Protocol Events:

**Client:**
- `READY` - Can send messages
- `DISCONNECTED` - Lost connection (temporary)
- `RECONNECTED` - Connection restored
- `FAILED` - Definitely failed

**Server:**
- `READY` - Can accept clients
- `PEER_JOINED` - New client ready (after handshake)
- `PEER_LEFT` - Client gracefully left
- `PEER_LOST` - Client timed out

### Heartbeat Strategy:

- Client pings every 10s
- Server checks every 30s
- GHOST after 60s (6 missed pings)
- DEAD after 180s (18 missed pings)

### Key Principles:

1. **Events describe application state, not transport details**
2. **Client is responsible for staying alive (pings)**
3. **Server is responsible for tracking health**
4. **Temporary failures don't kill pending requests**
5. **Graceful shutdown sends goodbye message**

This is clean, simple, and covers all real-world scenarios! 🎯

