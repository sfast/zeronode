# API Reference

Complete API documentation for Zeronode.

## Node Class

The primary interface for creating network nodes.

### Constructor

```javascript
import { Node } from 'zeronode'

const node = new Node(options)
```

**Parameters:**
- `options` (Object)
  - `id` (string, optional): Node identifier (auto-generated if not provided)
  - `options` (Object, optional): Node metadata for routing
  - `bind` (string, optional): Address to auto-bind to
  - `config` (Object, optional): System configuration

**Example:**
```javascript
const node = new Node({
  id: 'api-server-1',
  options: {
    role: 'api-server',
    region: 'us-east-1',
    version: '2.0.0'
  },
  bind: 'tcp://0.0.0.0:5000',
  config: {
    PING_INTERVAL: 2000,
    CLIENT_GHOST_TIMEOUT: 10000
  }
})
```

---

## Router Class

The `Router` is a specialized `Node` subclass designed for service discovery and message forwarding in distributed systems.

### Constructor

```javascript
import { Router } from 'zeronode'

const router = new Router(options)
```

**Parameters:** Same as `Node` constructor (automatically sets `options.router = true`)

**Example:**
```javascript
const router = new Router({
  id: 'main-router',
  bind: 'tcp://0.0.0.0:8080',
  config: {
    DEBUG: false
  }
})
```

### How Routers Work

When a node cannot find a matching peer locally:
1. Node attempts local `requestAny` / `tickAny`
2. If no match found, checks for connected routers (`router: true` option)
3. Forwards request to router via system proxy message
4. Router performs its own `requestAny` / `tickAny` across its connections
5. Router returns result back to original requesting node

**Architecture:**
```
Client Node → (no local match) → Router → Worker Nodes
     ↓                                           ↓
  Receives ←──────────────────────────────── Response
```

### Router-Specific Methods

#### `getRoutingStats()`

Get routing statistics for monitoring router performance.

**Returns:** `Object` - Statistics object

**Example:**
```javascript
const stats = router.getRoutingStats()
console.log(stats)
// {
//   proxyRequests: { total: 150, successful: 145, failed: 5 },
//   proxyTicks: { total: 300 },
//   uptime: 3600.5,
//   averageResponseTime: 23.4
// }
```

#### `resetRoutingStats()`

Reset routing statistics to zero.

**Returns:** `void`

**Example:**
```javascript
router.resetRoutingStats()
```

### Router Example

```javascript
import { Router, Node } from 'zeronode'

// Start router
const router = new Router({
  id: 'main-router',
  bind: 'tcp://0.0.0.0:8080'
})

// Service node registers with router
const service = new Node({
  id: 'auth-service',
  options: { role: 'auth' },
  bind: 'tcp://0.0.0.0:9000'
})

await service.connect({ address: 'tcp://127.0.0.1:8080' })

service.onRequest('auth:login', async ({ data }) => {
  return { token: 'abc123', userId: data.username }
})

// Client node connects to router
const client = new Node({ id: 'api-client' })
await client.connect({ address: 'tcp://127.0.0.1:8080' })

// Client requests auth service through router
const result = await client.requestAny({
  event: 'auth:login',
  data: { username: 'john', password: 'secret' },
  filter: { role: 'auth' }
})
// Router automatically forwards to auth-service and returns response
console.log(result)  // { token: 'abc123', userId: 'john' }
```

See [Router-Based Discovery](./ROUTING.md#router-based-discovery) for more details.

---

## Server Methods

### `bind(address)`

Bind server to an address (makes this node accept connections).

**Parameters:**
- `address` (string): Bind address (e.g., `'tcp://0.0.0.0:5000'`)

**Returns:** `Promise<void>`

**Example:**
```javascript
await node.bind('tcp://0.0.0.0:5000')
```

**Supported protocols:**
- `tcp://host:port` - TCP transport
- `ipc:///path/to/socket` - IPC transport (Unix sockets)
- `inproc://name` - In-process transport

### `unbind()`

Unbind server (stop accepting connections).

**Returns:** `Promise<void>`

**Example:**
```javascript
await node.unbind()
```

### `getAddress()`

Get the current bind address.

**Returns:** `string | null`

**Example:**
```javascript
const address = node.getAddress()
console.log(`Bound to: ${address}`)
```

---

## Client Methods

### `connect(options)`

Connect to a remote node.

**Parameters:**
- `options` (Object)
  - `address` (string): Remote address (e.g., `'tcp://127.0.0.1:5000'`)
  - `timeout` (number, optional): Connection timeout in milliseconds
  - `reconnectionTimeout` (number, optional): Reconnection timeout

**Returns:** `Promise<Object>` - Remote node info `{ id, options }`

**Example:**
```javascript
const remote = await node.connect({
  address: 'tcp://127.0.0.1:5000',
  timeout: 10000
})

console.log(`Connected to: ${remote.id}`)
console.log(`Server options:`, remote.options)
```

### `disconnect(peerId)`

Disconnect from a specific peer.

**Parameters:**
- `peerId` (string): Peer node ID

**Returns:** `Promise<void>`

**Example:**
```javascript
await node.disconnect('server-node-1')
```

---

## Messaging Methods

### `request(options)`

Send request to specific node, wait for response.

**Parameters:**
- `options` (Object)
  - `to` (string): Target node ID
  - `event` (string): Event name
  - `data` (any): Request data
  - `timeout` (number, optional): Request timeout in milliseconds (default: 10000)
  - `metadata` (Object, optional): Additional routing metadata

**Returns:** `Promise<any>` - Response data

**Example:**
```javascript
const response = await node.request({
  to: 'api-server',
  event: 'user:get',
  data: { userId: 123 },
  timeout: 5000
})

console.log(response)  // { id: 123, name: 'John' }
```

**Throws:**
- `NodeError` with code `NODE_NOT_FOUND` if peer not found
- `NodeError` with code `REQUEST_TIMEOUT` if timeout exceeded
- `NodeError` with code `ROUTING_FAILED` if routing fails

### `tick(options)`

Send one-way message to specific node (no response).

**Parameters:**
- `options` (Object)
  - `to` (string): Target node ID
  - `event` (string): Event name
  - `data` (any): Message data
  - `metadata` (Object, optional): Additional routing metadata

**Returns:** `void`

**Example:**
```javascript
node.tick({
  to: 'logger-node',
  event: 'log:info',
  data: { message: 'User logged in', userId: 123 }
})
```

### `requestAny(options)`

Send request to any node matching filter (automatic load balancing).

**Parameters:**
- `options` (Object)
  - `event` (string): Event name
  - `data` (any): Request data
  - `filter` (Object, optional): Filter criteria
  - `predicate` (Function, optional): Custom filter function
  - `down` (boolean, optional): Include downstream peers (default: true)
  - `up` (boolean, optional): Include upstream peers (default: true)
  - `timeout` (number, optional): Request timeout
  - `metadata` (Object, optional): Additional routing metadata

**Returns:** `Promise<any>` - Response data

**Example:**
```javascript
const response = await node.requestAny({
  event: 'job:process',
  data: { jobId: 456 },
  filter: {
    role: 'worker',
    status: 'idle',
    capacity: { $gte: 50 }
  },
  timeout: 30000
})
```

**Filter operators:**
- `$gte`, `$lte`, `$gt`, `$lt` - Comparison
- `$in`, `$nin` - Array membership
- `$regex` - Regular expression
- `$contains` - String/Array contains
- `$containsAny`, `$containsNone` - Array operations

### `tickAny(options)`

Send one-way message to any node matching filter.

**Parameters:**
- `options` (Object)
  - `event` (string): Event name
  - `data` (any): Message data
  - `filter` (Object, optional): Filter criteria
  - `predicate` (Function, optional): Custom filter function
  - `down` (boolean, optional): Include downstream peers (default: true)
  - `up` (boolean, optional): Include upstream peers (default: true)
  - `metadata` (Object, optional): Additional routing metadata

**Returns:** `void`

**Example:**
```javascript
node.tickAny({
  event: 'cache:invalidate',
  data: { key: 'user:123' },
  filter: { role: 'cache' }
})
```

### `requestAll(options)`

Send request to all nodes matching filter.

**Parameters:** Same as `requestAny`

**Returns:** `Promise<Array<{ nodeId, response, error }>>` - Results from all peers

**Example:**
```javascript
const results = await node.requestAll({
  event: 'status:get',
  data: {},
  filter: { role: 'worker' }
})

results.forEach(({ nodeId, response, error }) => {
  if (error) {
    console.error(`${nodeId} error:`, error)
  } else {
    console.log(`${nodeId} status:`, response)
  }
})
```

### `tickAll(options)`

Send one-way message to all nodes matching filter (broadcast).

**Parameters:** Same as `requestAll` (without timeout)

**Returns:** `void`

**Example:**
```javascript
node.tickAll({
  event: 'config:reload',
  data: { version: '2.0', config: newConfig },
  filter: { role: 'worker' }
})
```

### `requestDownAny(options)`

Send request to any **downstream** node matching filter.

**Parameters:** Same as `requestAny` (automatically sets `down: true, up: false`)

**Returns:** `Promise<any>` - Response data

**Example:**
```javascript
// Request only downstream clients
const response = await node.requestDownAny({
  event: 'task:process',
  data: { taskId: 789 },
  filter: { role: 'worker' }
})
```

### `requestUpAny(options)`

Send request to any **upstream** node matching filter.

**Parameters:** Same as `requestAny` (automatically sets `down: false, up: true`)

**Returns:** `Promise<any>` - Response data

**Example:**
```javascript
// Request only upstream servers
const response = await node.requestUpAny({
  event: 'auth:verify',
  data: { token: 'abc123' },
  filter: { role: 'auth-server' }
})
```

### `tickDownAny(options)`

Send one-way message to any **downstream** node matching filter.

**Parameters:** Same as `tickAny` (automatically sets `down: true, up: false`)

**Returns:** `void`

**Example:**
```javascript
node.tickDownAny({
  event: 'cache:invalidate',
  data: { key: 'user:123' },
  filter: { role: 'cache' }
})
```

### `tickUpAny(options)`

Send one-way message to any **upstream** node matching filter.

**Parameters:** Same as `tickAny` (automatically sets `down: false, up: true`)

**Returns:** `void`

**Example:**
```javascript
node.tickUpAny({
  event: 'metrics:report',
  data: { cpu: 80, memory: 60 },
  filter: { role: 'monitor' }
})
```

### `tickDownAll(options)`

Send one-way message to all **downstream** nodes matching filter.

**Parameters:** Same as `tickAll` (automatically sets `down: true, up: false`)

**Returns:** `void`

**Example:**
```javascript
node.tickDownAll({
  event: 'config:reload',
  data: { newConfig },
  filter: { role: 'worker' }
})
```

### `tickUpAll(options)`

Send one-way message to all **upstream** nodes matching filter.

**Parameters:** Same as `tickAll` (automatically sets `down: false, up: true`)

**Returns:** `void`

**Example:**
```javascript
node.tickUpAll({
  event: 'health:report',
  data: { status: 'healthy', uptime: 3600 },
  filter: { role: 'monitor' }
})
```

---

## Handler Methods

### `onRequest(pattern, handler)`

Register handler for incoming requests.

**Parameters:**
- `pattern` (string | RegExp): Event pattern to match
- `handler` (Function): Handler function

**Handler signatures:**
- `(envelope, reply)` - Auto-continue (2 parameters)
- `(envelope, reply, next)` - Manual control (3 parameters)
- `(error, envelope, reply, next)` - Error handler (4 parameters)

**Returns:** `void`

**Example:**
```javascript
// Simple handler
node.onRequest('user:get', async ({ data }) => {
  return await database.users.findOne({ id: data.userId })
})

// With reply
node.onRequest('user:get', ({ data }, reply) => {
  const user = database.users.findOne({ id: data.userId })
  reply(user)
})

// Pattern matching
node.onRequest(/^api:user:/, ({ event, data }, reply) => {
  const action = event.split(':')[2]  // 'get', 'create', 'update'
  
  switch (action) {
    case 'get':
      return getUser(data)
    case 'create':
      return createUser(data)
  }
})

// Middleware
node.onRequest(/^api:/, ({ data }, reply, next) => {
  if (!data.token) {
    return reply.error('Unauthorized')
  }
  next()
})
```

### `onTick(pattern, handler)`

Register handler for incoming one-way messages.

**Parameters:**
- `pattern` (string | RegExp): Event pattern to match
- `handler` (Function): Handler function

**Returns:** `void`

**Example:**
```javascript
node.onTick('log:info', ({ data }) => {
  console.log(`[INFO] ${data.message}`)
  logToDatabase(data)
})
```

### `offRequest(pattern, handler)`

Unregister request handler.

**Parameters:**
- `pattern` (string | RegExp): Event pattern
- `handler` (Function, optional): Specific handler to remove (if not provided, removes all)

**Returns:** `void`

### `offTick(pattern, handler)`

Unregister tick handler.

**Parameters:** Same as `offRequest`

**Returns:** `void`

---

## Event Methods

### `on(event, listener)`

Register event listener.

**Parameters:**
- `event` (string): Event name (see [Events Reference](./EVENTS.md))
- `listener` (Function): Event listener

**Returns:** `void`

**Example:**
```javascript
import { NodeEvent } from 'zeronode'

node.on(NodeEvent.PEER_JOINED, ({ peerId, direction, peerOptions }) => {
  console.log(`Peer ${peerId} joined (${direction})`)
})

node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason }) => {
  console.log(`Peer ${peerId} left: ${reason}`)
})

node.on(NodeEvent.ERROR, ({ source, error }) => {
  console.error(`Error from ${source}:`, error.message)
})
```

### `once(event, listener)`

Register one-time event listener.

**Parameters:** Same as `on`

**Returns:** `void`

### `off(event, listener)`

Unregister event listener.

**Parameters:** Same as `on`

**Returns:** `void`

---

## Info Methods

### `getId()`

Get this node's ID.

**Returns:** `string`

**Example:**
```javascript
const id = node.getId()
console.log(`My ID: ${id}`)
```

### `getOptions()`

Get this node's options/metadata.

**Returns:** `Object`

**Example:**
```javascript
const options = node.getOptions()
console.log(`My options:`, options)
```

### `setOptions(options)`

Update this node's options/metadata (propagates to connected peers).

**Parameters:**
- `options` (Object): New options (merged with existing)

**Returns:** `Promise<void>`

**Example:**
```javascript
// Update status
await node.setOptions({ status: 'busy' })

// Update multiple fields
await node.setOptions({
  status: 'ready',
  capacity: 80,
  lastUpdate: Date.now()
})
```

### `getPeers(options)`

Get all connected peers with optional filtering by direction.

**Parameters:**
- `options` (Object, optional)
  - `direction` (string, optional): Filter by direction (`'upstream'` or `'downstream'`)

**Returns:** `Array<Object>` - Array of peer info objects `{ id, options, direction }`

**Example:**
```javascript
// Get all peers
const peers = node.getPeers()
console.log(peers)
// [
//   { id: 'server-node-1', options: { role: 'api' }, direction: 'upstream' },
//   { id: 'worker-node-2', options: { role: 'worker' }, direction: 'downstream' }
// ]

// Get only downstream peers
const downstreamPeers = node.getPeers({ direction: 'downstream' })

// Get only upstream peers
const upstreamPeers = node.getPeers({ direction: 'upstream' })
```

### `getNodesDownstream()`

Get IDs of all downstream peers (clients connected to this node).

**Returns:** `Array<string>` - Array of peer IDs

**Example:**
```javascript
const downstream = node.getNodesDownstream()
console.log(`Downstream peers:`, downstream)
// ['worker-node-1', 'worker-node-2', 'worker-node-3']
```

### `getNodesUpstream()`

Get IDs of all upstream peers (servers this node is connected to).

**Returns:** `Array<string>` - Array of peer IDs

**Example:**
```javascript
const upstream = node.getNodesUpstream()
console.log(`Upstream peers:`, upstream)
// ['router-1', 'router-2']
```

### `getPeerOptions(peerId)`

Get a specific peer's options/metadata.

**Parameters:**
- `peerId` (string): Peer node ID

**Returns:** `Object | null`

**Example:**
```javascript
const peerOptions = node.getPeerOptions('worker-node-1')
console.log(`Worker options:`, peerOptions)
// { role: 'worker', status: 'idle', capacity: 100 }
```

### `getFilteredNodes(filter)`

Get IDs of all nodes matching a filter criteria.

**Parameters:**
- `filter` (Object): Filter criteria (same format as `requestAny` filter)

**Returns:** `Array<string>` - Array of matching peer IDs

**Example:**
```javascript
const workers = node.getFilteredNodes({ role: 'worker', status: 'idle' })
console.log(`Available workers:`, workers)
// ['worker-1', 'worker-3']
```

### `getServerIdByAddress(address)`

Get the peer ID of a server at a specific address.

**Parameters:**
- `address` (string): Server address

**Returns:** `string | null` - Peer ID or null if not found

**Example:**
```javascript
const serverId = node.getServerIdByAddress('tcp://127.0.0.1:5000')
console.log(`Server ID:`, serverId)
// 'router-1'
```

### `getLogger()`

Get the node's Winston logger instance.

**Returns:** `winston.Logger`

**Example:**
```javascript
const logger = node.getLogger()
logger.info('Custom log message')
logger.error('Error occurred', { details: errorData })
```

---

## Lifecycle Methods

### `close()`

Stop the node (unbind server, disconnect all clients, cleanup).

**Returns:** `Promise<void>`

**Example:**
```javascript
await node.close()
console.log('Node stopped')
```

---

## Constants

### `NodeEvent`

Node-level events (application layer).

```javascript
import { NodeEvent } from 'zeronode'

NodeEvent.PEER_JOINED   // 'node:peer_joined'
NodeEvent.PEER_LEFT     // 'node:peer_left'
NodeEvent.STOPPED       // 'node:stopped'
NodeEvent.ERROR         // 'node:error'
```

See [Events Reference](./EVENTS.md) for complete documentation.

### `ReconnectPolicy`

Auto-reconnection policy for upstream peers.

```javascript
import { ReconnectPolicy } from 'zeronode'

ReconnectPolicy.ALWAYS      // 'always' - Always reconnect (graceful or crash)
ReconnectPolicy.ON_FAILURE  // 'on_failure' - Only reconnect on unexpected failures
ReconnectPolicy.DISABLED    // 'disabled' - No automatic reconnection
```

**Example:**
```javascript
const node = new Node({
  id: 'my-node',
  config: {
    reconnect: ReconnectPolicy.ALWAYS  // Default behavior
  }
})
```

### `ServerEvent`

Server-level events (internal, advanced use).

```javascript
import { ServerEvent } from 'zeronode'

ServerEvent.READY          // 'server:ready'
ServerEvent.NOT_READY      // 'server:not_ready'
ServerEvent.CLOSED         // 'server:closed'
ServerEvent.CLIENT_JOINED  // 'server:client_joined'
ServerEvent.CLIENT_LEFT    // 'server:client_left'
```

### `ClientEvent`

Client-level events (internal, advanced use).

```javascript
import { ClientEvent } from 'zeronode'

ClientEvent.READY          // 'client:ready'
ClientEvent.NOT_READY      // 'client:not_ready'
ClientEvent.CLOSED         // 'client:closed'
ClientEvent.SERVER_JOINED  // 'client:server_joined'
ClientEvent.SERVER_LEFT    // 'client:server_left'
ClientEvent.ERROR          // 'client:error'
```

---

## Error Codes

### `NodeErrorCode`

```javascript
import { NodeErrorCode } from 'zeronode'

NodeErrorCode.NO_NODES_MATCH_FILTER  // No peers match routing criteria
NodeErrorCode.ROUTING_FAILED         // Message routing failed
NodeErrorCode.NODE_NOT_FOUND         // Target node not found
NodeErrorCode.REQUEST_TIMEOUT        // Request timed out
```

**Example:**
```javascript
try {
  await node.request({ to: 'unknown-node', event: 'ping' })
} catch (err) {
  if (err.code === NodeErrorCode.NODE_NOT_FOUND) {
    console.log('Peer is offline')
  }
}
```

---

## TypeScript Support

Zeronode includes full TypeScript definitions.

```typescript
import { Node, NodeEvent, NodeErrorCode } from 'zeronode'

interface UserData {
  userId: number
  name: string
}

const node = new Node({ id: 'api-server' })

node.onRequest<UserData>('user:get', async ({ data }) => {
  const user: UserData = await database.users.findOne({ id: data.userId })
  return user
})

const response = await node.request<UserData>({
  to: 'api-server',
  event: 'user:get',
  data: { userId: 123 }
})

console.log(response.name)  // TypeScript knows response is UserData
```

---

## See Also

- [Architecture Guide](./ARCHITECTURE.md) - Deep dive into internals
- [Events Reference](./EVENTS.md) - All events and lifecycle hooks
- [Configuration](./CONFIGURATION.md) - All configuration options
- [Routing Guide](./ROUTING.md) - Smart routing and filtering
- [Middleware Guide](./MIDDLEWARE.md) - Middleware patterns
- [Examples](./EXAMPLES.md) - Real-world examples

