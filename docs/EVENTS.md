# Events Reference

Zeronode has **5 events**:

```javascript
import { Node, NodeEvent } from 'zeronode'

node.on(NodeEvent.PEER_JOINED, ({ peerId, direction, peerOptions }) => {})
node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason, category }) => {})
node.on(NodeEvent.PEER_UPDATED, ({ peerId, direction, peerOptions }) => {})
node.on(NodeEvent.ERROR, ({ source, error }) => {})
node.on(NodeEvent.STOPPED, () => {})
```

Peer events are **edge-triggered** (2.1): one `PEER_JOINED` when a session with
a peer starts, one `PEER_LEFT` when it ends, per direction. A peer may be joined
both ways (two nodes connected to each other); each direction is a session of
its own. A re-handshake of a peer that is still joined (e.g. after a transport
blip the other side never noticed) emits nothing, or `PEER_UPDATED` if its
options changed.

---

## PEER_JOINED

A peer connected.

```javascript
node.on(NodeEvent.PEER_JOINED, ({ peerId, direction, peerOptions }) => {
  // direction: 'upstream' (we connected to them) or 'downstream' (they connected to us)
  // peerOptions: peer metadata
  // The peer is routable when this fires: request({ to: peerId }) works here.
  // A server that restarts under a new id at a connected address joins under
  // that id (the old id is gone: getPeerOptions(oldId) === null).
})
```

---

## PEER_LEFT

A peer disconnected.

```javascript
node.on(NodeEvent.PEER_LEFT, ({ peerId, direction, reason, category }) => {
  // Once per session, for a peer that was joined: the first signal wins
  // (a server's stop message and the dropped link race), later ones are
  // not reported.
  // category (PeerLeftCategory): 'graceful' (the peer said it stops),
  //   'lost' (the link or the peer went away), 'replaced' (another session
  //   took its place), 'local' (this node ended it: disconnect(), close(),
  //   unbind()). It names the observed signal, not a proven cause.
  // reason (downstream): 'CLIENT_STOP', 'TIMEOUT' (no ping),
  //   'UNREACHABLE' (a send found no route: crashed/killed),
  //   'REPLACED' (a new instance connected with the same id),
  //   'UNBOUND' (this node's server was unbound or closed)
  // reason (upstream): 'TRANSPORT_NOT_READY', 'TRANSPORT_FAILED',
  //   'server_left', 'closed',
  //   'replaced' (the server at that address answered under a new id while
  //   the old one was still joined; a PEER_JOINED for the new id follows).
  //   Note the case: upstream 'replaced', downstream 'REPLACED'.
  // Requests pending on that peer are rejected at once (PEER_LEFT /
  // PEER_UNREACHABLE) instead of waiting for their timeout.
  // Always handle this to clean up resources
})
```

---

## PEER_UPDATED

A joined peer changed its options with `setOptions()`, or re-handshook with
different options (e.g. changed while its connection was down).

```javascript
node.on(NodeEvent.PEER_UPDATED, ({ peerId, direction, peerOptions }) => {
  // peerOptions: the peer's complete new options (also in getPeerOptions(peerId))
})
```

---

## ERROR

An error occurred.

```javascript
node.on(NodeEvent.ERROR, ({ source, error }) => {
  // source: 'server' or 'client'. Includes failures of tick handlers
  // (error.code 'HANDLER_ERROR') and malformed incoming messages
  // ('INVALID_ENVELOPE'); the node keeps receiving after either.
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
