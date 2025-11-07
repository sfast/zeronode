# ZeroMQ Socket Examples

Simple examples demonstrating how to use Router and Dealer sockets.

## Quick Start

### 1. Build the project
```bash
cd /Users/fast/workspace/kargin/zeronode
npm run build
```

### 2. Run the Router Server (Terminal 1)
```bash
node dist/sockets/example/router-server.js
```

You should see:
```
============================================================
ROUTER SERVER EXAMPLE
============================================================

🚀 Binding to tcp://127.0.0.1:5555...
✅ Router is listening on tcp://127.0.0.1:5555

📡 Router is ready! Waiting for clients...
   Press Ctrl+C to stop
```

### 3. Run the Dealer Client (Terminal 2)
```bash
node dist/sockets/example/dealer-client.js
```

You should see:
```
============================================================
DEALER CLIENT EXAMPLE
============================================================

🚀 Connecting to tcp://127.0.0.1:5555...
✅ Connected to router!

✅ Connected! Starting to send messages...

📤 Sent message #1
📤 Sent message #2
📤 Sent message #3
...
```

### 4. Test Reconnection

While both are running:
1. Stop the router (Ctrl+C in Terminal 1)
2. Watch the dealer detect disconnection and attempt to reconnect
3. Restart the router
4. Watch the dealer automatically reconnect!

---

## What Each Example Does

### `router-server.js`

**Router Socket** acts as a **server**:
- ✅ Binds to `tcp://127.0.0.1:5555`
- ✅ Accepts connections from multiple Dealer clients
- ✅ Receives messages from any connected client
- ✅ Can send messages to specific clients (by ID)
- ✅ Handles client disconnections gracefully

**Key Features:**
- Event monitoring (LISTEN, ACCEPT, DISCONNECT)
- Message reception
- Clean shutdown

### `dealer-client.js`

**Dealer Socket** acts as a **client**:
- ✅ Connects to Router server
- ✅ Sends messages to server
- ✅ Receives responses from server
- ✅ **Automatic reconnection** if connection is lost
- ✅ Connection timeout handling

**Key Features:**
- Event monitoring (CONNECT, DISCONNECT, RECONNECT)
- Periodic message sending
- Automatic reconnection (ZeroMQ handles this!)
- Clean shutdown

---

## Socket Events

### Router Events
```javascript
SocketEvent.LISTEN         // Server started listening
SocketEvent.ACCEPT         // Client connected
SocketEvent.DISCONNECT     // Client disconnected
SocketEvent.BIND_ERROR     // Bind failed
SocketEvent.CLOSE          // Socket closed
```

### Dealer Events
```javascript
SocketEvent.CONNECT            // Connected to router
SocketEvent.DISCONNECT         // Lost connection
SocketEvent.RECONNECT          // Reconnection successful
SocketEvent.RECONNECT_FAILURE  // Reconnection gave up
SocketEvent.CLOSE              // Socket closed
```

---

## ZeroMQ Socket Options

### Common Options (All Sockets)
```javascript
config: {
  ZMQ_LINGER: 0,        // Fast shutdown (0 = discard unsent)
  ZMQ_SNDHWM: 1000,     // Max outgoing queue (prevent memory exhaustion)
  ZMQ_RCVHWM: 1000,     // Max incoming queue
  ZMQ_SNDTIMEO: 5000,   // Send timeout (ms)
  ZMQ_RCVTIMEO: 5000    // Receive timeout (ms)
}
```

### Dealer-Specific Options
```javascript
config: {
  ZMQ_RECONNECT_IVL: 100,        // Reconnect every 100ms
  ZMQ_RECONNECT_IVL_MAX: 30000,  // Max reconnect interval (exponential backoff)
  CONNECTION_TIMEOUT: 5000,       // Initial connection timeout
  RECONNECTION_TIMEOUT: 30000     // Give up reconnecting after 30s
}
```

### Router-Specific Options
```javascript
config: {
  ZMQ_ROUTER_MANDATORY: true,   // Fail on send to unknown client
  ZMQ_ROUTER_HANDOVER: false    // Allow identity takeover (HA)
}
```

---

## Testing Scenarios

### Scenario 1: Basic Communication
1. Start router
2. Start dealer
3. Watch messages flow

**Expected:** Dealer sends messages every 2 seconds, Router receives them

### Scenario 2: Reconnection
1. Start router
2. Start dealer
3. Stop router (Ctrl+C)
4. Start router again

**Expected:** 
- Dealer detects disconnection
- Shows "🔄 ZeroMQ will automatically attempt to reconnect..."
- Reconnects automatically when router comes back
- Messages resume

### Scenario 3: Multiple Clients
1. Start router
2. Start dealer #1
3. Start dealer #2 (change PORT in code)
4. Watch both clients send messages

**Expected:** Router receives messages from both clients

### Scenario 4: Connection Timeout
1. Start dealer (WITHOUT starting router)

**Expected:**
- Dealer attempts to connect
- After 5 seconds: "❌ Connection error: Connection timeout"

---

## Advanced Usage

### Sending Messages Back (Router → Dealer)

Router needs to track client IDs to send messages back:

```javascript
// In router-server.js
const clients = new Map()

router.on('message', ({ buffer }) => {
  // Extract client ID from ZeroMQ frame
  // [client_id, delimiter, payload]
  
  // Store client ID
  const clientId = extractClientId(buffer)
  clients.set(clientId, { lastSeen: Date.now() })
  
  // Send response back to this client
  const response = Buffer.from('Hello from Router!')
  router.sendBuffer(response, clientId)  // Send to specific client
})
```

### Request/Response Pattern

For request/response, use the **Protocol layer** (Client/Server classes):

```javascript
// See: src/client.js, src/server.js
// These provide request/response on top of Dealer/Router
```

---

## Troubleshooting

### "Address already in use"
```bash
# Kill any lingering node processes
killall node

# Or use a different port
const ADDRESS = 'tcp://127.0.0.1:5556'  // Change port
```

### "Connection timeout"
- Make sure router is running first
- Check firewall settings
- Verify address/port match

### Messages not appearing
- Check that both processes are running
- Verify they're using the same address
- Look for error messages in logs

---

## Next Steps

1. ✅ Understand basic Dealer/Router communication
2. ✅ Test reconnection behavior
3. ✅ Explore socket configuration options
4. 📚 Study Protocol layer for request/response (`src/protocol.js`)
5. 📚 Study Client/Server for application logic (`src/client.js`, `src/server.js`)
6. 📚 Study Node for full microservice features (`src/node.js`)

---

## Architecture Layers

```
Node.js (your app)
    ↓
Node (full microservice)
    ↓
Client / Server (application layer)
    ↓
Protocol (message layer)
    ↓
Dealer / Router (ZeroMQ wrappers) ← YOU ARE HERE
    ↓
Socket (transport layer)
    ↓
ZeroMQ (native library)
```

---

## Additional Resources

- **ZeroMQ Guide:** http://zguide.zeromq.org/
- **ZeroMQ v6 Docs:** https://zeromq.org/
- **Our ZeroMQ Compliance:** `../../ZEROMQ6_COMPLIANCE.md`

---

**Happy Coding!** 🚀

