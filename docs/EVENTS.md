# Events Reference

Zeronode has **4 events**:

```javascript
import { Node, NodeEvent } from 'zeronode'

node.on(NodeEvent.PEER_JOINED, ({ peerId, direction, peerOptions }) => {})
node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason }) => {})
node.on(NodeEvent.ERROR, ({ source, error }) => {})
node.on(NodeEvent.STOPPED, () => {})
```

---

## PEER_JOINED

A peer connected.

```javascript
node.on(NodeEvent.PEER_JOINED, ({ peerId, direction, peerOptions }) => {
  // direction: 'upstream' (we connected to them) or 'downstream' (they connected to us)
  // peerOptions: peer metadata
})
```

---

## PEER_LEFT

A peer disconnected.

```javascript
node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason }) => {
  // reason: 'TIMEOUT', 'not_ready', 'server_left', etc.
  // Always handle this to clean up resources
})
```

---

## ERROR

An error occurred.

```javascript
node.on(NodeEvent.ERROR, ({ source, error }) => {
  console.error(`Error from ${source}:`, error.message)
})

node.on('error', (err) => {
  // Always add error handler to prevent crashes
})
```

---

## STOPPED

Node stopped.

```javascript
node.on(NodeEvent.STOPPED, () => {
  console.log('Stopped')
})
```

---

## Example

```javascript
import { Node, NodeEvent } from 'zeronode'

const node = new Node({ id: 'my-node', bind: 'tcp://0.0.0.0:5000' })

node.on(NodeEvent.PEER_JOINED, ({ peerId }) => console.log(`🤝 ${peerId} joined`))
node.on(NodeEvent.PEER_LEFT, ({ peerId }) => console.log(`👋 ${peerId} left`))
node.on(NodeEvent.ERROR, ({ error }) => console.error(`❌ ${error.message}`))
node.on(NodeEvent.STOPPED, () => console.log('🛑 Stopped'))

node.on('error', (err) => {
  if (err.code !== 'NO_NODES_MATCH_FILTER') console.error(err)
})
```

That's it! 🎉
