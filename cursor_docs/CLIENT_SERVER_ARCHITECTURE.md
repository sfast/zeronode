# Client-Server Architecture: Complete Guide

## Overview

Client and Server are the **application-level messaging layers** in Zeronode, built on top of Protocol, which itself uses DealerSocket and RouterSocket.

```
Application Layer:  Client ←──────────→ Server
                       ↓                    ↓
Protocol Layer:    Protocol  ←────────→  Protocol
                       ↓                    ↓
Transport Layer:  DealerSocket  ←────→  RouterSocket
                       ↓                    ↓
ZeroMQ:           DEALER socket  ←────→  ROUTER socket
```

---

## Client Architecture

### Responsibilities

1. **Connect to Server** - Establish connection to a single server
2. **Server Peer Management** - Track server state (CONNECTING → CONNECTED → HEALTHY)
3. **Heartbeat (Ping)** - Send periodic pings to server
4. **Handshake** - Send CLIENT_CONNECTED on connection/reconnection
5. **Request/Tick** - Inherited from Protocol
6. **Reconnection Handling** - Respond to connection lifecycle events

### Lifecycle

```
┌────────────────────────────────────────────────────────────┐
│                    Client Lifecycle                        │
└────────────────────────────────────────────────────────────┘

1. Construction
   ├─ new Client({ id, config })
   ├─ Creates DealerSocket
   ├─ Passes socket to Protocol (super)
   ├─ Initializes: routerAddress, serverPeerInfo, pingInterval
   └─ Attaches event handlers

2. Connection
   ├─ client.connect(routerAddress, timeout)
   ├─ Creates serverPeerInfo (state: CONNECTING)
   ├─ socket.connect(routerAddress)
   └─ Waits for ProtocolEvent.READY

3. Connected (READY)
   ├─ serverPeerInfo.setState('CONNECTED')
   ├─ Starts ping interval
   ├─ Sends CLIENT_CONNECTED handshake to server
   └─ Emits events.CLIENT_READY

4. Active Communication
   ├─ Sends CLIENT_PING every PING_INTERVAL
   ├─ Can send requests: client.request({ event, data })
   ├─ Can send ticks: client.tick({ event, data })
   ├─ Listens for SERVER_STOP tick
   └─ Responds to connection events

5. Connection Lost (temporary)
   ├─ ProtocolEvent.CONNECTION_LOST
   ├─ serverPeerInfo.setState('GHOST')
   ├─ Stops ping
   ├─ Pending requests survive (might reconnect!)
   └─ Emits events.SERVER_DISCONNECTED

6. Connection Restored
   ├─ ProtocolEvent.CONNECTION_RESTORED
   ├─ serverPeerInfo.setState('HEALTHY')
   ├─ Restarts ping
   ├─ Re-sends CLIENT_CONNECTED handshake
   └─ Emits events.SERVER_RECONNECTED

7. Connection Failed (fatal)
   ├─ ProtocolEvent.CONNECTION_FAILED
   ├─ serverPeerInfo.setState('FAILED')
   ├─ Stops ping
   ├─ All pending requests rejected
   └─ Emits events.SERVER_RECONNECT_FAILURE

8. Graceful Disconnect
   ├─ client.disconnect()
   ├─ Stops ping
   ├─ Sends CLIENT_STOP tick to server
   ├─ socket.disconnect()
   └─ serverPeerInfo.setState('STOPPED')

9. Close
   ├─ client.close()
   ├─ Calls disconnect()
   └─ socket.close()
```

### State Transitions (serverPeerInfo)

```
                    connect()
  [NONE] ────────────────────────→ [CONNECTING]
                                         │
                         ProtocolEvent.READY
                                         ↓
                                   [CONNECTED]
                                         │
                         SERVER_CONNECTED tick
                                         ↓
                                    [HEALTHY] ←──┐
                                         │       │
                         CONNECTION_LOST │       │ CLIENT_PING
                                         ↓       │
                                     [GHOST] ────┘
                                         │
                                         ├─ CONNECTION_RESTORED → [HEALTHY]
                                         ├─ CONNECTION_FAILED   → [FAILED]
                                         └─ disconnect()        → [STOPPED]
```

### Events Client Listens To

**From Protocol (ProtocolEvent):**
- `READY` → Start ping, send handshake
- `CONNECTION_LOST` → Mark GHOST, stop ping
- `CONNECTION_RESTORED` → Restart ping, re-handshake
- `CONNECTION_FAILED` → Mark FAILED, stop ping

**From Server (Application Ticks via Protocol):**
- `CLIENT_CONNECTED` → Server acknowledges, mark HEALTHY
- `SERVER_STOP` → Server stopping, mark STOPPED

### Events Client Emits

**Application Events:**
- `CLIENT_READY` - Client is connected and ready
- `SERVER_DISCONNECTED` - Connection lost
- `SERVER_RECONNECTED` - Connection restored
- `SERVER_RECONNECT_FAILURE` - Connection failed
- `CLIENT_CONNECTED` - Forwarded from server acknowledgment
- `SERVER_STOP` - Forwarded from server

### Ticks Client Sends

1. **CLIENT_PING** - Heartbeat
   - Sent every PING_INTERVAL (default: 10s)
   - Data: `{ clientId, timestamp }`

2. **CLIENT_CONNECTED** - Handshake
   - Sent on READY and CONNECTION_RESTORED
   - Data: `{ clientId, timestamp }`

3. **CLIENT_STOP** - Graceful shutdown notification
   - Sent on disconnect()
   - Data: `{ clientId }`

### Public API

```javascript
// Constructor
const client = new Client({ id, config })

// Connection
await client.connect(routerAddress, timeout)
await client.disconnect()
await client.close()

// Messaging (inherited from Protocol)
await client.request({ event, data, timeout })
client.tick({ event, data })
client.onRequest(pattern, handler)
client.onTick(pattern, handler)

// State
client.isReady()
client.isOnline()
client.getId()

// Peer info
client.getServerPeerInfo()

// Config
client.getConfig()
client.setLogger(logger)
client.debug = true  // getter/setter
```

---

## Server Architecture

### Responsibilities

1. **Bind to Address** - Listen for client connections
2. **Client Peer Management** - Track multiple clients (Map of PeerInfo)
3. **Health Checks** - Detect GHOST clients (no ping for threshold)
4. **Handshake** - Send CLIENT_CONNECTED welcome to new clients
5. **Request/Tick Handling** - Inherited from Protocol
6. **Broadcast Support** - Notify all clients

### Lifecycle

```
┌────────────────────────────────────────────────────────────┐
│                    Server Lifecycle                        │
└────────────────────────────────────────────────────────────┘

1. Construction
   ├─ new Server({ id, config })
   ├─ Creates RouterSocket
   ├─ Passes socket to Protocol (super)
   ├─ Initializes: bindAddress, clientPeers Map, healthCheckInterval
   └─ Attaches event handlers

2. Bind
   ├─ server.bind(bindAddress)
   ├─ socket.bind(bindAddress)
   └─ Waits for ProtocolEvent.READY

3. Ready (LISTEN)
   ├─ Starts health check interval
   └─ Emits events.SERVER_READY

4. Client Connects
   ├─ ProtocolEvent.PEER_CONNECTED { peerId, endpoint }
   ├─ Creates PeerInfo(peerId, state: CONNECTED)
   ├─ Stores in clientPeers Map
   ├─ Sends CLIENT_CONNECTED welcome tick to client
   └─ Emits events.CLIENT_CONNECTED { clientId, endpoint }

5. Client Active
   ├─ Receives CLIENT_PING ticks
   ├─ Updates peerInfo.lastSeen
   ├─ Sets peerInfo.state = 'HEALTHY'
   └─ Receives CLIENT_CONNECTED handshake → mark HEALTHY

6. Client Goes Silent (Health Check)
   ├─ No CLIENT_PING for GHOST_THRESHOLD (default: 60s)
   ├─ peerInfo.setState('GHOST')
   └─ Emits events.CLIENT_GHOST { clientId, lastSeen, timeSinceLastSeen }

7. Client Stops Gracefully
   ├─ Receives CLIENT_STOP tick
   ├─ peerInfo.setState('STOPPED')
   └─ Emits events.CLIENT_STOP { clientId }

8. Client Disconnects (ZeroMQ level)
   ├─ ProtocolEvent.PEER_DISCONNECTED { peerId }
   │  (Note: This rarely fires for Router sockets!)
   ├─ peerInfo.setState('STOPPED')
   └─ Emits events.CLIENT_DISCONNECTED { clientId }

9. Graceful Unbind
   ├─ server.unbind()
   ├─ Stops health checks
   ├─ Sends SERVER_STOP tick to all clients (loop through clientPeers)
   └─ socket.unbind()

10. Close
   ├─ server.close()
   ├─ Calls unbind()
   └─ socket.close()
```

### State Transitions (Client PeerInfo)

```
                    PEER_CONNECTED
  [NONE] ────────────────────────→ [CONNECTED]
                                         │
                         CLIENT_CONNECTED tick
                                         ↓
                                    [HEALTHY] ←──┐
                                         │       │
                         No ping for 60s │       │ CLIENT_PING
                                         ↓       │
                                     [GHOST] ────┘
                                         │
                                         ├─ CLIENT_STOP      → [STOPPED]
                                         └─ PEER_DISCONNECTED → [STOPPED]
```

### Events Server Listens To

**From Protocol (ProtocolEvent):**
- `READY` → Start health checks
- `PEER_CONNECTED` → New client, create PeerInfo, send welcome
- `PEER_DISCONNECTED` → Client gone, mark STOPPED (rarely fires!)

**From Clients (Application Ticks via Protocol):**
- `CLIENT_PING` → Update lastSeen, mark HEALTHY
- `CLIENT_STOP` → Client stopping, mark STOPPED
- `CLIENT_CONNECTED` → Client handshake, mark HEALTHY

### Events Server Emits

**Application Events:**
- `SERVER_READY` - Server is bound and accepting clients
- `CLIENT_CONNECTED` - New client connected
- `CLIENT_DISCONNECTED` - Client disconnected
- `CLIENT_GHOST` - Client hasn't pinged for threshold
- `CLIENT_STOP` - Client sent graceful stop

### Ticks Server Sends

1. **CLIENT_CONNECTED** - Welcome/acknowledgment
   - Sent when client connects (PEER_CONNECTED)
   - Sent to specific client (to: peerId)
   - Data: `{ serverId }`

2. **SERVER_STOP** - Graceful shutdown notification
   - Sent on unbind()
   - Sent to ALL clients (loop through clientPeers)
   - Data: `{ serverId }`

### Public API

```javascript
// Constructor
const server = new Server({ id, config })

// Binding
await server.bind(bindAddress)
await server.unbind()
await server.close()

// Messaging (inherited from Protocol)
await server.request({ to, event, data, timeout })  // to specific client
server.tick({ to, event, data })                     // to specific client
server.onRequest(pattern, handler)
server.onTick(pattern, handler)

// State
server.isReady()
server.isOnline()
server.getId()

// Client management
server.getClientPeerInfo(clientId)
server.getAllClientPeers()
server.getConnectedClientCount()

// Config
server.getConfig()
server.setLogger(logger)
server.debug = true  // getter/setter
```

---

## Communication Flow

### Example: Client Request → Server Response

```
┌─────────┐                                    ┌─────────┐
│ Client  │                                    │ Server  │
└────┬────┘                                    └────┬────┘
     │                                              │
     │  1. client.request({ event: 'getUser', ... })
     ├──────────────────────────────────────────────→
     │              REQUEST envelope                 │
     │           (type: REQUEST, tag: 'getUser')     │
     │                                              │
     │  2. Server receives, finds handler          │
     │     server.onRequest('getUser', handler)    │
     │                                              │
     │  3. Handler executes, returns data          │
     │                                              │
     │           RESPONSE envelope                  │
     │  ←──────────────────────────────────────────┤
     │           (type: RESPONSE, data: {...})      │
     │                                              │
     │  4. Client promise resolves                  │
     │                                              │
```

### Example: Client Ping Flow

```
┌─────────┐                                    ┌─────────┐
│ Client  │                                    │ Server  │
└────┬────┘                                    └────┬────┘
     │                                              │
     │  Every 10 seconds:                          │
     │  client.tick({ event: 'CLIENT_PING', ... }) │
     ├──────────────────────────────────────────────→
     │              TICK envelope                   │
     │                                              │
     │                                Server receives
     │                         Updates peerInfo.lastSeen
     │                         Sets peerInfo = 'HEALTHY'
     │                                              │
```

### Example: Connection Lost → Restored

```
┌─────────┐                                    ┌─────────┐
│ Client  │                                    │ Server  │
└────┬────┘                                    └────┬────┘
     │                                              │
     │  1. Network issue / Server restart          │
     │     Socket.DISCONNECT                        │
     │                                              │
     │  2. Protocol.CONNECTION_LOST                │
     │     - serverPeerInfo → GHOST                │
     │     - Stop ping                             │
     │     - Pending requests still alive!         │
     │                                              │
     │  3. ZeroMQ auto-reconnect (native)          │
     │     Socket.RECONNECT                         │
     │                                              │
     │  4. Protocol.CONNECTION_RESTORED            │
     │     - serverPeerInfo → HEALTHY              │
     │     - Restart ping                          │
     │                                              │
     │  5. Re-handshake                            │
     │     client.tick({ event: 'CLIENT_CONNECTED' })
     ├──────────────────────────────────────────────→
     │                                              │
     │  6. Server welcomes back                    │
     │              CLIENT_CONNECTED tick           │
     │  ←──────────────────────────────────────────┤
     │                                              │
```

---

## Health & Monitoring

### Client-Side

**Ping Mechanism:**
- Sends `CLIENT_PING` every `PING_INTERVAL` (default: 10s)
- Automatically starts on READY
- Automatically stops on CONNECTION_LOST
- Automatically restarts on CONNECTION_RESTORED

### Server-Side

**Health Check Mechanism:**
- Runs every `HEALTH_CHECK_INTERVAL` (default: 30s)
- Checks `peerInfo.lastSeen` for all clients
- If `now - lastSeen > GHOST_THRESHOLD` (default: 60s):
  - Mark client as GHOST
  - Emit `CLIENT_GHOST` event

**Why GHOST instead of removing?**
- Client might reconnect
- Allows application to decide cleanup policy
- Preserves client history

---

## Key Design Principles

### 1. **Clean Separation of Concerns**
- **Client/Server:** Application-level messaging, peer management
- **Protocol:** Message protocol, request/response, event translation
- **Socket:** Pure transport (Dealer/Router wrappers)

### 2. **No Duplication**
- Client tracks ONE server (serverPeerInfo)
- Server tracks MANY clients (clientPeers Map)
- Protocol does NOT track peers (only emits events)

### 3. **Resilient Reconnection**
- Pending requests survive temporary disconnections
- Automatic ZeroMQ reconnection
- Application-level handshake on reconnection

### 4. **Event-Driven**
- Client listens to ProtocolEvent (not SocketEvent)
- Server listens to ProtocolEvent (not SocketEvent)
- Clear event hierarchy

### 5. **No Options**
- Client/Server are pure messaging layers
- Options belong in Node (high-level orchestrator)

---

## Configuration Options

### Client Config
```javascript
const client = new Client({
  id: 'client-1',
  config: {
    // ZeroMQ socket options
    CONNECTION_TIMEOUT: 30000,      // Connection timeout
    RECONNECTION_TIMEOUT: 60000,    // How long to retry reconnection
    REQUEST_TIMEOUT: 30000,         // Request timeout
    
    // Application options
    PING_INTERVAL: 10000,           // How often to ping server
    
    // Socket-level (passed to DealerSocket)
    ZMQ_RECONNECT_IVL: 100,
    ZMQ_RECONNECT_IVL_MAX: 0,
    ZMQ_LINGER: 0,
    ZMQ_SNDHWM: 1000,
    ZMQ_RCVHWM: 1000
  }
})
```

### Server Config
```javascript
const server = new Server({
  id: 'server-1',
  config: {
    // Application options
    HEALTH_CHECK_INTERVAL: 30000,   // How often to check client health
    GHOST_THRESHOLD: 60000,         // No ping → GHOST
    
    // Socket-level (passed to RouterSocket)
    ZMQ_ROUTER_MANDATORY: false,
    ZMQ_ROUTER_HANDOVER: false,
    ZMQ_LINGER: 0,
    ZMQ_SNDHWM: 1000,
    ZMQ_RCVHWM: 1000
  }
})
```

---

## Summary

✅ **Client:** Connects to ONE server, tracks server state, sends pings  
✅ **Server:** Binds and accepts MANY clients, tracks client states, health checks  
✅ **Both:** Built on Protocol (request/response, event translation)  
✅ **Resilient:** Pending requests survive reconnection  
✅ **Clean:** No options, no transport details, pure messaging  

Perfect for building distributed microservices! 🚀

