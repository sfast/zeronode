# Events Reference

## Overview

ZeroNode uses an **event-driven architecture** with clear separation between different layers. This document covers all events emitted by ZeroNode components and how to use them effectively.

---

## Event Layers

ZeroNode has four distinct event layers:

```
┌─────────────────────────────────────────────────┐
│              Node Events                        │
│  (High-level: peer discovery, lifecycle)        │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│          Client/Server Events                   │
│  (Connection state, client management)          │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│          Protocol Events                        │
│  (Internal: handshake, ping, timeout)           │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│          Transport Events                       │
│  (Low-level: TCP connect/disconnect, bytes)     │
└─────────────────────────────────────────────────┘
```

**Most applications only need Node Events and Client/Server Events.**

---

## Node Events

**Import:**
```javascript
import { NodeEvent } from 'zeronode'
```

**Events:**
- `node:ready` - Node fully initialized and ready
- `node:peer_joined` - New peer discovered
- `node:peer_left` - Peer disconnected
- `node:stopped` - Node stopped
- `node:error` - Node-level error

---

### `NodeEvent.READY`

**When:** Node is fully initialized and ready (server bound or client connected)

**Payload:** None

```javascript
node.on(NodeEvent.READY, () => {
  console.log(`Node ${node.getId()} is ready`)
})
```

**Use Cases:**
- Start accepting requests
- Begin sending messages
- Initialize application logic

---

### `NodeEvent.PEER_JOINED`

**When:** New peer discovered (either upstream connection or downstream client)

**Payload:**
```javascript
{
  peerId: string,          // Peer node ID
  peerOptions: object,     // Peer metadata (role, version, etc.)
  direction: string        // 'upstream' or 'downstream'
}
```

**Example:**
```javascript
node.on(NodeEvent.PEER_JOINED, ({ peerId, peerOptions, direction }) => {
  console.log(`Peer ${peerId} joined (${direction})`)
  console.log('Peer metadata:', peerOptions)
  
  if (peerOptions.role === 'api') {
    console.log('API server joined the network')
  }
})
```

**Use Cases:**
- Track available peers
- Update service registry
- Trigger rebalancing
- Log topology changes

---

### `NodeEvent.PEER_LEFT`

**When:** Peer disconnected (cleanly or via timeout)

**Payload:**
```javascript
{
  peerId: string,          // Peer node ID
  direction: string        // 'upstream' or 'downstream'
}
```

**Example:**
```javascript
node.on(NodeEvent.PEER_LEFT, ({ peerId, direction }) => {
  console.log(`Peer ${peerId} left (${direction})`)
  
  // Update routing table
  routingTable.remove(peerId)
  
  // Failover to backup
  if (direction === 'upstream') {
    connectToBackupServer()
  }
})
```

**Use Cases:**
- Remove from routing table
- Trigger failover
- Update load balancer
- Clean up resources

---

### `NodeEvent.STOPPED`

**When:** Node explicitly stopped via `node.stop()`

**Payload:** None

```javascript
node.on(NodeEvent.STOPPED, () => {
  console.log('Node stopped gracefully')
  // Cleanup, flush logs, etc.
})
```

**Use Cases:**
- Graceful shutdown
- Resource cleanup
- Final logging

---

### `NodeEvent.ERROR`

**When:** Node-level error (connection failure, protocol error, etc.)

**Payload:**
```javascript
{
  code: string,            // Error code (e.g., 'BIND_FAILED')
  message: string,         // Error message
  error?: Error           // Original error object
}
```

**Example:**
```javascript
node.on(NodeEvent.ERROR, ({ code, message, error }) => {
  console.error(`Node error [${code}]: ${message}`)
  
  if (code === 'BIND_FAILED') {
    console.error('Failed to bind server, trying different port...')
    retryBind()
  }
  
  // Send to monitoring
  monitoring.trackError({ code, message, stack: error?.stack })
})
```

**Use Cases:**
- Error monitoring
- Alerting
- Automatic recovery
- Debugging

---

## Client Events

**Import:**
```javascript
import { ClientEvent } from 'zeronode'
```

**Events:**
- `client:ready` - Client handshake complete
- `client:disconnected` - Server disconnected
- `client:failed` - Connection permanently failed
- `client:stopped` - Client explicitly stopped
- `client:error` - Client-level error

---

### `ClientEvent.READY`

**When:** Handshake complete with server, client can send requests

**Payload:**
```javascript
{
  serverId: string,        // Server node ID
  serverOptions: object    // Server metadata
}
```

**Example:**
```javascript
const client = node.getClient(address)

client.on(ClientEvent.READY, ({ serverId, serverOptions }) => {
  console.log(`Connected to server: ${serverId}`)
  console.log('Server info:', serverOptions)
  
  // Now safe to send requests
  node.request({ to: serverId, event: 'init' })
})
```

**Use Cases:**
- Wait for connection before sending requests
- Discover server capabilities
- Initialize session

---

### `ClientEvent.DISCONNECTED`

**When:** Lost connection to server (will auto-reconnect)

**Payload:**
```javascript
{
  serverId: string,        // Server node ID
  address: string          // Server address
}
```

**Example:**
```javascript
client.on(ClientEvent.DISCONNECTED, ({ serverId, address }) => {
  console.warn(`Disconnected from ${serverId} at ${address}`)
  
  // Switch to backup server
  if (servers.length > 1) {
    node.connect({ address: backupServer })
  }
})
```

**Use Cases:**
- Failover to backup
- Pause request queue
- Alert monitoring
- Update UI status

---

### `ClientEvent.FAILED`

**When:** Connection permanently failed (after retries exhausted)

**Payload:**
```javascript
{
  serverId: string,        // Server node ID
  address: string,         // Server address
  error?: Error           // Failure reason
}
```

**Example:**
```javascript
client.on(ClientEvent.FAILED, ({ serverId, address, error }) => {
  console.error(`Connection to ${serverId} failed permanently`)
  
  // Remove from routing table
  routingTable.remove(serverId)
  
  // Try different server
  connectToNextServer()
})
```

---

### `ClientEvent.STOPPED`

**When:** Client explicitly stopped via `node.disconnect()`

**Payload:**
```javascript
{
  serverId: string,        // Server node ID
  address: string          // Server address
}
```

**Example:**
```javascript
client.on(ClientEvent.STOPPED, ({ serverId, address }) => {
  console.log(`Client stopped for ${serverId}`)
})
```

---

### `ClientEvent.ERROR`

**When:** Client-level error (transport or protocol failure)

**Payload:**
```javascript
{
  code: string,            // Error code
  message: string,         // Error message
  error?: Error           // Original error
}
```

**Example:**
```javascript
client.on(ClientEvent.ERROR, ({ code, message, error }) => {
  console.error(`Client error [${code}]: ${message}`)
  
  // Log to monitoring
  monitoring.trackError({ layer: 'client', code, message })
})
```

---

## Server Events

**Import:**
```javascript
import { ServerEvent } from 'zeronode'
```

**Events:**
- `server:ready` - Server ready to accept clients
- `server:not_ready` - Server transport not ready
- `server:closed` - Server closed
- `server:client_joined` - New client connected
- `server:client_left` - Client disconnected
- `server:client_timeout` - Client timed out (ghost)

---

### `ServerEvent.READY`

**When:** Server bound and ready to accept clients

**Payload:**
```javascript
{
  address: string          // Bound address
}
```

**Example:**
```javascript
const server = node.getServer()

server.on(ServerEvent.READY, ({ address }) => {
  console.log(`Server ready at ${address}`)
})
```

---

### `ServerEvent.NOT_READY`

**When:** Server transport not ready (before bind or after unbind)

**Payload:** None

```javascript
server.on(ServerEvent.NOT_READY, () => {
  console.warn('Server not ready')
})
```

---

### `ServerEvent.CLOSED`

**When:** Server closed gracefully

**Payload:** None

```javascript
server.on(ServerEvent.CLOSED, () => {
  console.log('Server closed')
})
```

---

### `ServerEvent.CLIENT_JOINED`

**When:** New client completed handshake and authenticated

**Payload:**
```javascript
{
  clientId: string,        // Client node ID
  clientOptions: object    // Client metadata
}
```

**Example:**
```javascript
server.on(ServerEvent.CLIENT_JOINED, ({ clientId, clientOptions }) => {
  console.log(`Client ${clientId} joined`)
  console.log('Client metadata:', clientOptions)
  
  // Track active clients
  activeClients.set(clientId, clientOptions)
  
  // Update metrics
  metrics.gauge('active_clients', activeClients.size)
})
```

**Use Cases:**
- Track connected clients
- Update metrics
- Initialize client session
- Log connections

---

### `ServerEvent.CLIENT_LEFT`

**When:** Client disconnected gracefully (sent `CLIENT_STOP` message)

**Payload:**
```javascript
{
  clientId: string         // Client node ID
}
```

**Example:**
```javascript
server.on(ServerEvent.CLIENT_LEFT, ({ clientId }) => {
  console.log(`Client ${clientId} left gracefully`)
  
  // Clean up client session
  activeClients.delete(clientId)
  
  // Update metrics
  metrics.gauge('active_clients', activeClients.size)
})
```

---

### `ServerEvent.CLIENT_TIMEOUT`

**When:** Client timed out (no ping within `CLIENT_GHOST_TIMEOUT`)

**Payload:**
```javascript
{
  clientId: string,        // Client node ID
  lastPingTime: number     // Timestamp of last ping (ms)
}
```

**Example:**
```javascript
server.on(ServerEvent.CLIENT_TIMEOUT, ({ clientId, lastPingTime }) => {
  const elapsed = Date.now() - lastPingTime
  console.warn(`Client ${clientId} timed out (${elapsed}ms since last ping)`)
  
  // Clean up resources
  activeClients.delete(clientId)
  
  // Alert if critical client
  if (criticalClients.has(clientId)) {
    alerting.send(`Critical client ${clientId} timed out`)
  }
})
```

**Use Cases:**
- Detect ghost clients
- Clean up stale sessions
- Alert on critical client failures
- Update connection metrics

---

## Transport Events

**Import:**
```javascript
import { TransportEvent } from 'zeronode'
```

**Events:**
- `transport:ready` - Transport can send/receive
- `transport:not_ready` - Transport cannot send/receive
- `transport:message` - Received bytes
- `transport:error` - Transport-level error
- `transport:closed` - Transport closed

**⚠️ Note:** Most applications should NOT listen to transport events directly. Use Client/Server events instead.

---

### `TransportEvent.READY`

**When:** Transport layer ready (TCP connected or bound)

**Payload:** None

```javascript
transport.on(TransportEvent.READY, () => {
  console.log('Transport ready (low-level)')
})
```

**Note:** This fires BEFORE handshake. Use `ClientEvent.READY` for application logic.

---

### `TransportEvent.NOT_READY`

**When:** Transport disconnected or unbound

**Payload:** None

```javascript
transport.on(TransportEvent.NOT_READY, () => {
  console.log('Transport not ready (low-level)')
})
```

---

### `TransportEvent.MESSAGE`

**When:** Received raw bytes from remote

**Payload:**
```javascript
{
  buffer: Buffer,          // Raw message bytes
  sender?: string          // Sender ID (Router only)
}
```

**⚠️ Internal Use Only:** Protocol layer handles message parsing.

---

### `TransportEvent.ERROR`

**When:** Transport-level error (socket error, bind failure, etc.)

**Payload:**
```javascript
{
  code: string,            // Error code
  message: string,         // Error message
  error?: Error           // Original error
}
```

**Example:**
```javascript
transport.on(TransportEvent.ERROR, ({ code, message }) => {
  console.error(`Transport error [${code}]: ${message}`)
})
```

---

### `TransportEvent.CLOSED`

**When:** Transport closed (socket closed)

**Payload:** None

```javascript
transport.on(TransportEvent.CLOSED, () => {
  console.log('Transport closed')
})
```

---

## Complete Example

```javascript
import Node, { NodeEvent, ClientEvent, ServerEvent } from 'zeronode'

const node = new Node({
  id: 'api-server',
  options: { role: 'api', version: 1 }
})

// ============================================================================
// Node-level events (high-level)
// ============================================================================

node.on(NodeEvent.READY, () => {
  console.log('✅ Node ready')
})

node.on(NodeEvent.PEER_JOINED, ({ peerId, peerOptions, direction }) => {
  console.log(`👋 Peer joined: ${peerId} (${direction})`)
  console.log('   Peer info:', peerOptions)
})

node.on(NodeEvent.PEER_LEFT, ({ peerId, direction }) => {
  console.log(`👋 Peer left: ${peerId} (${direction})`)
})

node.on(NodeEvent.ERROR, ({ code, message }) => {
  console.error(`❌ Node error [${code}]: ${message}`)
})

// ============================================================================
// Server events (if binding)
// ============================================================================

await node.bind('tcp://127.0.0.1:3000')

const server = node.getServer()

server.on(ServerEvent.CLIENT_JOINED, ({ clientId, clientOptions }) => {
  console.log(`📥 Client joined: ${clientId}`)
  console.log('   Client info:', clientOptions)
})

server.on(ServerEvent.CLIENT_LEFT, ({ clientId }) => {
  console.log(`📤 Client left: ${clientId}`)
})

server.on(ServerEvent.CLIENT_TIMEOUT, ({ clientId, lastPingTime }) => {
  const elapsed = Math.floor((Date.now() - lastPingTime) / 1000)
  console.warn(`⏱️  Client timeout: ${clientId} (${elapsed}s since last ping)`)
})

// ============================================================================
// Client events (if connecting)
// ============================================================================

await node.connect({ address: 'tcp://127.0.0.1:4000' })

const client = node.getClient('tcp://127.0.0.1:4000')

client.on(ClientEvent.READY, ({ serverId, serverOptions }) => {
  console.log(`🔗 Connected to server: ${serverId}`)
  console.log('   Server info:', serverOptions)
})

client.on(ClientEvent.DISCONNECTED, ({ serverId, address }) => {
  console.warn(`⚠️  Disconnected from: ${serverId} at ${address}`)
})

client.on(ClientEvent.FAILED, ({ serverId, address }) => {
  console.error(`❌ Connection failed: ${serverId} at ${address}`)
})
```

---

## Event Best Practices

### 1. Use the Right Layer

```javascript
// ✅ Good: Use high-level events
node.on(NodeEvent.PEER_JOINED, handlePeerJoined)

// ❌ Bad: Using transport events for application logic
transport.on(TransportEvent.READY, handlePeerJoined)  // Too low-level!
```

### 2. Handle Errors

```javascript
// ✅ Good: Always handle errors
node.on(NodeEvent.ERROR, ({ code, message }) => {
  logger.error({ code, message })
  monitoring.trackError(code)
})

// ❌ Bad: Ignoring errors
// (errors will crash if unhandled)
```

### 3. Clean Up Listeners

```javascript
// ✅ Good: Remove listeners when done
const handler = () => { /* ... */ }
node.on(NodeEvent.PEER_JOINED, handler)

// Later...
node.off(NodeEvent.PEER_JOINED, handler)

// Or use once()
node.once(NodeEvent.READY, () => {
  console.log('Ready (fires once)')
})
```

### 4. Use Async Handlers Carefully

```javascript
// ✅ Good: Async handler with error handling
node.on(NodeEvent.PEER_JOINED, async ({ peerId }) => {
  try {
    await updateDatabase(peerId)
  } catch (err) {
    console.error('Failed to update database:', err)
  }
})

// ❌ Bad: Unhandled promise rejection
node.on(NodeEvent.PEER_JOINED, async ({ peerId }) => {
  await updateDatabase(peerId)  // Might throw!
})
```

---

## Summary

✅ **Node Events**: High-level peer discovery and lifecycle  
✅ **Client Events**: Connection state and readiness  
✅ **Server Events**: Client management and timeouts  
✅ **Transport Events**: Low-level (usually not needed)  
✅ **Layered Architecture**: Clear separation of concerns  
✅ **Type-Safe**: Export constants for all events  

**Use events to build reactive, resilient distributed systems!** 🎯

