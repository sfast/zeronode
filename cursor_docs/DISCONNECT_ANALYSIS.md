# Disconnect Detection Analysis - Why No Immediate PEER_LEFT Event?

## The Question

When we kill node-2 (client) with Ctrl+C, why don't we see an immediate `PEER_LEFT` event on node-1 (server)? Why do we have to wait ~10 seconds for the timeout to detect the disconnection?

Shouldn't the TCP connection close event fire immediately and notify the server?

## The Answer: It's a ZeroMQ Architecture Decision

### Short Answer

**ZeroMQ Router sockets (used by the server) do NOT emit disconnect events when a peer disconnects.** This is by design in ZeroMQ.

### Detailed Explanation

#### 1. **ZeroMQ Router Behavior**

```
TCP Layer:                 ZeroMQ Layer:               Application Layer:
-----------               --------------              ------------------

[Client Dies]
     |
     v
[TCP FIN]  ---------->  [ZeroMQ Detects]
     |                        |
     |                        v
     |                  [SILENTLY ignores]
     |                        |
     |                        v
     v                   [NO EVENT EMITTED]  ----X---> [No notification]
[Connection Closed]            |
                              v
                        [Just stops routing 
                         messages to that peer]
```

**Why?** ZeroMQ Router sockets are designed for **message-oriented** communication, not connection-oriented. They:
- Track which peers exist based on **messages received**
- Don't monitor connection state actively
- Don't emit events when peers disconnect
- Simply drop messages silently if a peer is gone

#### 2. **The Two Types of Disconnect Detection**

```
┌─────────────────────────────────────────────────────────────────┐
│                     Disconnect Detection Methods                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. TRANSPORT-LEVEL (Immediate)                                  │
│     ✗ Not available for ZeroMQ Router                           │
│     ✓ Available for Dealer (client side)                        │
│                                                                   │
│     When: TCP connection closes                                  │
│     How: ZeroMQ emits transport events                          │
│     Speed: Immediate (milliseconds)                              │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  2. APPLICATION-LEVEL (Timeout-based)                           │
│     ✓ Available (Required for Router)                           │
│                                                                   │
│     When: Client stops sending pings                             │
│     How: Server tracks last-seen timestamps                      │
│     Speed: Configurable timeout (we set 10s)                     │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

#### 3. **Why Client (Dealer) Detects Server Disconnect Immediately**

```javascript
// CLIENT SIDE (Dealer socket)
client.on(ProtocolEvent.TRANSPORT_NOT_READY, () => {
  // ✓ This DOES fire immediately when server dies
  // Because Dealer sockets DO emit disconnect events
})
```

**Dealer sockets (client)** can detect server disconnect immediately because:
- They maintain a single connection (to one server)
- ZeroMQ can emit events when that connection fails
- They're connection-oriented in practice

#### 4. **Why Server (Router) Cannot Detect Client Disconnect Immediately**

```javascript
// SERVER SIDE (Router socket)
server.on('some-disconnect-event', () => {
  // ✗ This event DOESN'T EXIST for Router sockets
  // Router sockets don't emit per-peer disconnect events
})
```

**Router sockets (server)** cannot detect client disconnect immediately because:
- They handle N connections simultaneously
- ZeroMQ Router is designed for message routing, not connection tracking
- No per-peer disconnect events are available
- It's a fundamental ZeroMQ design decision

### 5. **The Workaround: Application-Level Heartbeating**

This is why **every production ZeroMQ system** implements application-level heartbeating:

```
Timeline when client is killed:

t=0s   Client dies
       ├─> TCP connection closes
       ├─> ZeroMQ detects at transport layer
       └─> Router socket: "meh, whatever" (no event)

t=2s   Server checks: "When did I last hear from client-node?"
       └─> Last ping: 2 seconds ago (still ok)

t=4s   Server checks: "When did I last hear from client-node?"
       └─> Last ping: 4 seconds ago (still ok)

t=6s   Server checks: "When did I last hear from client-node?"
       └─> Last ping: 6 seconds ago (still ok)

t=8s   Server checks: "When did I last hear from client-node?"
       └─> Last ping: 8 seconds ago (still ok)

t=10s  Server checks: "When did I last hear from client-node?"
       └─> Last ping: 10 seconds ago (TIMEOUT!)
       └─> Emits CLIENT_LEFT event with reason: 'TIMEOUT'
```

### 6. **Could We Get Immediate Detection?**

**Option A: Use TCP Socket Monitoring (Not Recommended)**
```javascript
// ZeroMQ supports socket monitoring but it's:
// - Complex to implement
// - Platform-specific
// - Not reliable across all transports (ipc, inproc)
// - Adds significant complexity
```

**Option B: Use Different Transport (Not ZeroMQ)**
```javascript
// Use TCP sockets directly or WebSockets
// - You'd lose ZeroMQ's benefits
// - Have to implement your own message routing
// - Have to handle reconnection logic
```

**Option C: Reduce Timeout (✓ What We Did)**
```javascript
config: {
  PING_INTERVAL: 2000,           // Ping every 2s
  CLIENT_HEALTH_CHECK_INTERVAL: 2000,  // Check every 2s
  CLIENT_GHOST_TIMEOUT: 10000    // Timeout after 10s
}
```

### 7. **Industry Standard Approach**

**What every major system does:**

| System | Approach |
|--------|----------|
| **RabbitMQ** | Heartbeat timeout (configurable, default 60s) |
| **Redis** | Client timeout (configurable, default 300s) |
| **Kafka** | Session timeout (configurable, default 10s) |
| **MongoDB** | Heartbeat interval (configurable, default 10s) |
| **Zeronode** | Application-level pings (configurable, we set 10s) |

### 8. **The Trade-off**

```
Fast Detection (1-2s)          Slower Detection (30-60s)
├────────────┼────────────┼────────────┼────────────┤
             │            │            │
   ✓ Quick   │   ✓ Good   │  ✓ Stable  │ ✓ Efficient
   ✗ Chatty  │            │            │ ✗ Slow
   ✗ CPU     │            │            │
```

**Our Configuration (10s timeout):**
- Good balance between responsiveness and overhead
- Detects disconnects fast enough for most use cases
- Doesn't overwhelm the network with constant pings
- Industry standard for many systems

## Conclusion

**You SHOULD expect transport-level events, BUT:**
- ZeroMQ Router sockets don't emit per-peer disconnect events
- This is by design, not a bug
- Application-level heartbeating is the standard solution
- Our 10-second timeout is a reasonable balance

**If you need faster detection:**
- Reduce `PING_INTERVAL` to 1000 (1s)
- Reduce `CLIENT_GHOST_TIMEOUT` to 5000 (5s)
- But be aware: more pings = more network traffic + CPU usage

**The pattern:**
```
Transport disconnect → ZeroMQ knows → Router doesn't emit event
→ Application heartbeat times out → PEER_LEFT event fires
```

This is **exactly how production systems work**. It's not a limitation of Zeronode—it's how ZeroMQ (and most message-oriented systems) are designed! 🎯

