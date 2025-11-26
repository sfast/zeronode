# Zeronode Architecture Guide

## Overview

Zeronode is a **layered microservices framework** built on ZeroMQ, providing a clean abstraction for building distributed systems. This guide explains the architecture, event flow, and design decisions.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                            │
│                 (Your Business Logic)                            │
├─────────────────────────────────────────────────────────────────┤
│                          NODE                                    │
│   • Mesh network orchestration (N clients + 1 server)          │
│   • Peer state management (joined/left)                        │
│   • Smart routing (by ID, filter, broadcast)                   │
│   • Central handler registry                                    │
│   • NodeEvent: PEER_JOINED, PEER_LEFT, READY, ERROR           │
├─────────────────────────────────────────────────────────────────┤
│           SERVER                        CLIENT                   │
│   • Router socket wrapper      • Dealer socket wrapper          │
│   • Health checks              • Ping mechanism                 │
│   • Client discovery           • Handshake initiation           │
│   • ServerEvent: CLIENT_       • ClientEvent: SERVER_           │
│     JOINED, CLIENT_LEFT          JOINED, SERVER_LEFT            │
├─────────────────────────────────────────────────────────────────┤
│                        PROTOCOL                                  │
│   • Message routing (request/reply, tick)                       │
│   • Envelope management (serialization/deserialization)         │
│   • Handler management (PatternEmitter)                         │
│   • Request tracking (timeouts, promises)                       │
│   • System events (handshake, ping, stop)                       │
│   • ProtocolEvent: TRANSPORT_READY, TRANSPORT_NOT_READY        │
├─────────────────────────────────────────────────────────────────┤
│                       TRANSPORT                                  │
│   • ZeroMQ socket abstraction (Router/Dealer)                   │
│   • Connection management                                        │
│   • Buffer send/receive                                          │
│   • Transport lifecycle (bind, connect, close)                  │
│   • TransportEvent: READY, NOT_READY, CLOSED, MESSAGE          │
└─────────────────────────────────────────────────────────────────┘
```

## Event Flow: The Complete Picture

### 1. Transport Layer Events

**Transport emits:**
- `TransportEvent.READY` - Socket can send/receive
- `TransportEvent.NOT_READY` - Socket lost connection
- `TransportEvent.CLOSED` - Socket permanently closed
- `TransportEvent.MESSAGE` - Received message buffer

**Key characteristic:** Transport layer is **connection-oriented** (especially for Dealer/client sockets).

### 2. Protocol Layer Events

**Protocol listens to Transport and emits:**
- `ProtocolEvent.TRANSPORT_READY` - Bubbled from Transport.READY
- `ProtocolEvent.TRANSPORT_NOT_READY` - Bubbled from Transport.NOT_READY
- `ProtocolEvent.TRANSPORT_CLOSED` - Bubbled from Transport.CLOSED
- `ProtocolEvent.ERROR` - Protocol-level errors

**Protocol also handles:**
- System messages (handshake, ping, stop)
- Application messages (requests, ticks, replies)
- Request tracking and timeouts

### 3. Server Layer Events

**Server listens to Protocol and emits:**

```javascript
// FROM PROTOCOL
ProtocolEvent.TRANSPORT_READY    → ServerEvent.READY
ProtocolEvent.TRANSPORT_NOT_READY → ServerEvent.NOT_READY
ProtocolEvent.TRANSPORT_CLOSED   → ServerEvent.CLOSED

// FROM APPLICATION LOGIC (Message-Based Discovery)
HANDSHAKE_INIT_FROM_CLIENT → ServerEvent.CLIENT_JOINED
CLIENT_PING → (update lastSeen timestamp)
CLIENT_STOP → ServerEvent.CLIENT_LEFT
TIMEOUT     → ServerEvent.CLIENT_LEFT (reason: 'TIMEOUT')
```

**Server tracks clients via:**
- `clientLastSeen` Map (clientId → timestamp)
- Health check interval (default: 30s)
- Ghost timeout (default: 60s)

### 4. Client Layer Events

**Client listens to Protocol and emits:**

```javascript
// FROM PROTOCOL
ProtocolEvent.TRANSPORT_READY    → ClientEvent.READY (then sends handshake)
ProtocolEvent.TRANSPORT_NOT_READY → ClientEvent.NOT_READY
ProtocolEvent.TRANSPORT_CLOSED   → ClientEvent.CLOSED or NOT_READY

// FROM APPLICATION LOGIC (System Messages)
HANDSHAKE_ACK_FROM_SERVER → ClientEvent.SERVER_JOINED (starts ping)
SERVER_STOP               → ClientEvent.SERVER_LEFT
```

**Client tracks server via:**
- `serverId` (null until handshake complete)
- Ping interval (default: 10s)

### 5. Node Layer Events

**Node listens to Server/Client and emits:**

```javascript
// FROM SERVER
ServerEvent.CLIENT_JOINED → NodeEvent.PEER_JOINED (direction: 'downstream')
ServerEvent.CLIENT_LEFT   → NodeEvent.PEER_LEFT (direction: 'downstream')

// FROM CLIENT
ClientEvent.SERVER_JOINED → NodeEvent.PEER_JOINED (direction: 'upstream')
ClientEvent.NOT_READY     → NodeEvent.PEER_LEFT (direction: 'upstream')
ClientEvent.CLOSED        → NodeEvent.PEER_LEFT (direction: 'upstream')
ClientEvent.SERVER_LEFT   → NodeEvent.PEER_LEFT (direction: 'upstream')
```

**Node tracks peers via:**
- `joinedPeers` Set (peerId → boolean)
- `peerOptions` Map (peerId → options)
- `peerDirection` Map (peerId → 'upstream' | 'downstream')

## Complete Event Flow: Client Death Scenario

Let's trace what happens when a client dies (killed with Ctrl+C):

```
TIME  LAYER       EVENT                           ACTION
────  ─────────   ─────────────────────────────   ──────────────────────────
t=0   Process     Client killed (Ctrl+C)
      
t=0   Transport   TCP connection closes
      (Client)    
      
t=0   Transport   Detects connection loss         Emits: Transport.NOT_READY
      (Client)
      
t=0   Protocol    Receives Transport.NOT_READY    Emits: Protocol.TRANSPORT_NOT_READY
      (Client)
      
t=0   Client      Receives Protocol.TRANSPORT_    Stops ping
                  NOT_READY                        Emits: Client.NOT_READY
      
t=0   Node        Receives Client.NOT_READY       Removes from joinedPeers
      (Client)                                     Emits: Node.PEER_LEFT
                                                   (direction: 'upstream')

─────────────────────────────────────────────────────────────────────────
      
      Meanwhile, on the SERVER side...
      
t=0   Transport   ZeroMQ Router socket...          (NO EVENT - by design)
      (Server)    
      
t=2   Server      Health check runs                clientLastSeen: 2s ago (OK)
      
t=4   Server      Health check runs                clientLastSeen: 4s ago (OK)
      
t=6   Server      Health check runs                clientLastSeen: 6s ago (OK)
      
t=8   Server      Health check runs                clientLastSeen: 8s ago (OK)
      
t=10  Server      Health check runs                clientLastSeen: 10s ago (TIMEOUT!)
                                                   Deletes from clientLastSeen
                                                   Emits: Server.CLIENT_LEFT
                                                   (reason: 'TIMEOUT')
      
t=10  Node        Receives Server.CLIENT_LEFT     Removes from joinedPeers
      (Server)                                     Emits: Node.PEER_LEFT
                                                   (direction: 'downstream')
```

## Key Design Decisions

### 1. Why Server Uses Timeout-Based Detection

**ZeroMQ Router sockets (server)** do NOT emit per-peer disconnect events. This is intentional:

- **Message-oriented design**: Router focuses on message routing, not connection tracking
- **Multi-peer scalability**: Tracking N connections would add overhead
- **Transport independence**: Works same for tcp://, ipc://, inproc://

**Solution: Application-level heartbeating**
- Standard pattern in all message-oriented systems
- RabbitMQ, Kafka, Redis all use this approach
- Configurable: balance between responsiveness and overhead

### 2. Why Client Gets Immediate Notification

**ZeroMQ Dealer sockets (client)** CAN detect server disconnect immediately:

- **Single connection**: Only talks to one server
- **Connection-oriented**: ZeroMQ can emit events for this use case
- **Transport layer**: Dealer socket gets TCP FIN/RST notifications

**Result: Client-side disconnects are immediate (milliseconds)**

### 3. State Management: Single Source of Truth

**Node layer maintains THE authoritative peer state:**

```javascript
// In joinedPeers Set → routable
// NOT in joinedPeers Set → not routable

_addJoinedPeer(peerId) {
  joinedPeers.add(peerId)      // NOW routable
}

_removeJoinedPeer(peerId) {
  joinedPeers.delete(peerId)   // NOW not routable
}
```

**Benefits:**
- No querying Server/Client during routing (fast)
- No state divergence
- Clear semantics: in Set = online, not in Set = offline

### 4. Handshake Protocol

**Client → Server handshake:**

```
1. Client: TRANSPORT_READY → sends HANDSHAKE_INIT_FROM_CLIENT (with options)
2. Server: Receives handshake → stores clientId in clientLastSeen
3. Server: Emits CLIENT_JOINED → sends HANDSHAKE_ACK_FROM_SERVER (with options)
4. Client: Receives ack → stores serverId → starts ping
5. Client: Emits SERVER_JOINED
```

**Why this design:**
- **Peer discovery**: Server doesn't know clients until they announce
- **Options exchange**: Both peers learn each other's metadata
- **Graceful**: Works with any transport (tcp, ipc, inproc)

## Configuration

### Server Configuration

```javascript
const server = new Node({
  id: 'server-node',
  config: {
    CLIENT_HEALTH_CHECK_INTERVAL: 2000,  // Check every 2 seconds
    CLIENT_GHOST_TIMEOUT: 10000          // Timeout after 10 seconds
  }
})
```

### Client Configuration

```javascript
const client = new Node({
  id: 'client-node',
  config: {
    PING_INTERVAL: 2000,  // Ping every 2 seconds
    CLIENT_HANDSHAKE_TIMEOUT: 10000  // Handshake timeout
  }
})
```

### Timeout Tuning Guide

| Use Case | Ping Interval | Health Check | Timeout | Trade-off |
|----------|--------------|--------------|---------|-----------|
| **Low latency** | 1s | 1s | 3s | Fast detection, more traffic |
| **Balanced** | 2s | 2s | 10s | Good balance (recommended) |
| **Efficient** | 10s | 30s | 60s | Low overhead, slow detection |

## Peer Lifecycle

### Upstream Peer (Client connecting TO server)

```
1. client.connect({ address })
2. Transport connects → TRANSPORT_READY
3. Client sends handshake
4. Server receives → CLIENT_JOINED
5. Server sends ack
6. Client receives → SERVER_JOINED
7. Node emits PEER_JOINED (direction: 'upstream')

[... peer is active ...]

8. Disconnect (any reason)
9. Client emits NOT_READY/CLOSED/SERVER_LEFT
10. Node emits PEER_LEFT (direction: 'upstream')
```

### Downstream Peer (Client connected FROM server)

```
1. Client connects to our server
2. Server receives handshake → CLIENT_JOINED
3. Node emits PEER_JOINED (direction: 'downstream')

[... peer is active, pings arrive ...]

4. Ping stops arriving (client died)
5. Health check timeout expires
6. Server emits CLIENT_LEFT (reason: 'TIMEOUT')
7. Node emits PEER_LEFT (direction: 'downstream')
```

## Error Handling

### Transport Errors

```javascript
// Emitted by Protocol, bubbled to Node
node.on(NodeEvent.ERROR, ({ source, error }) => {
  if (source === 'server') {
    // Server transport error
  } else if (source === 'client') {
    // Client transport error
  }
})
```

### Application Errors

```javascript
// NO_NODES_MATCH_FILTER - no peers match routing criteria
node.on('error', (err) => {
  if (err.code === 'NO_NODES_MATCH_FILTER') {
    console.log('No peers available for routing')
  }
})
```

## Best Practices

### 1. Always Handle PEER_LEFT

```javascript
node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason }) => {
  console.log(`Peer ${peerId} left (${direction}): ${reason}`)
  // Clean up any peer-specific resources
})
```

### 2. Track Connected Peers

```javascript
const connectedPeers = new Set()

node.on(NodeEvent.PEER_JOINED, ({ peerId }) => {
  connectedPeers.add(peerId)
})

node.on(NodeEvent.PEER_LEFT, ({ peerId }) => {
  connectedPeers.delete(peerId)
})
```

### 3. Only Send When Peers Exist

```javascript
if (connectedPeers.size > 0) {
  node.tickAny({ event: 'heartbeat', data: { ... } })
}
```

### 4. Use Appropriate Timeouts

```javascript
// For request/reply - use timeout
const response = await node.request({
  to: 'peer-id',
  event: 'operation',
  data: payload,
  timeout: 5000  // 5 second timeout
})
```

## Performance Characteristics

### Latency

- **Request/Reply**: ~0.3ms average (measured)
- **Tick (fire-and-forget)**: < 0.1ms (no response tracking)
- **Peer discovery**: Immediate (message-based)
- **Disconnect detection (server)**: Configurable (2-60 seconds)
- **Disconnect detection (client)**: Immediate (< 100ms)

### Overhead

- **Per peer**: Minimal (just tracking in Maps/Sets)
- **Ping traffic**: 1 message per interval per client
- **Health check**: Single timer per server

## Summary

Zeronode provides a **clean, layered architecture** where:

1. **Transport** handles raw socket connections
2. **Protocol** handles message serialization and routing
3. **Server/Client** handle lifecycle and peer management
4. **Node** provides unified API and smart routing

The event flow is **straightforward and predictable**, with clear separation of concerns. Disconnect detection works differently for client vs. server due to ZeroMQ's design, but this is standard in message-oriented systems.

The architecture is **production-ready** and follows industry best practices for distributed systems.
