# Quick Start Guide

## ✅ Examples Are Ready!

Your Router and Dealer examples are working! Here's how to use them:

---

## **Method 1: Automated Test (Quick Verification)**

```bash
cd /Users/fast/workspace/kargin/zeronode
bash src/sockets/example/run-test.sh
```

**What it does:**
- Starts Router server
- Starts Dealer client
- Lets them communicate for 5 seconds
- Stops both automatically

**Expected output:**
```
🚀 Starting Router server...
✅ Router is listening on tcp://127.0.0.1:5555
🚀 Starting Dealer client...
✅ Connected to router!
📤 Sent message #1
📨 Received message: 29 bytes
📤 Sent message #2
📨 Received message: 29 bytes
```

---

## **Method 2: Manual Testing (Recommended for Learning)**

### Terminal 1 - Router Server:
```bash
cd /Users/fast/workspace/kargin/zeronode
node dist/sockets/example/router-server.js
```

You'll see:
```
============================================================
ROUTER SERVER EXAMPLE
============================================================

🚀 Binding to tcp://127.0.0.1:5555...
✅ Router is listening on tcp://127.0.0.1:5555

📡 Router is ready! Waiting for clients...
   Press Ctrl+C to stop
```

**Keep this running!** ⬆️

---

### Terminal 2 - Dealer Client:
```bash
cd /Users/fast/workspace/kargin/zeronode
node dist/sockets/example/dealer-client.js
```

You'll see:
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

---

### What You'll See (Both Terminals):

**Terminal 1 (Router):**
```
🔌 Client connected from tcp://127.0.0.1:xxxxx
📨 Received message: 36 bytes
   Buffer (hex): 48656c6c6f2066726f6d204465616c6572212...
📨 Received message: 36 bytes
   Buffer (hex): 48656c6c6f2066726f6d204465616c6572212...
```

**Terminal 2 (Dealer):**
```
📤 Sent message #1
📤 Sent message #2
📤 Sent message #3
```

---

## **Test Automatic Reconnection** 🔄

This is the coolest feature! Try this:

1. **Keep both terminals running**
2. **Stop the Router** (Ctrl+C in Terminal 1)
3. **Watch the Dealer** terminal:
   ```
   ❌ Disconnected from router
   🔄 ZeroMQ will automatically attempt to reconnect...
   ⏸️  Waiting for connection...
   ⏸️  Waiting for connection...
   ```
4. **Restart the Router** (run Terminal 1 command again)
5. **Watch the Dealer reconnect automatically**:
   ```
   ✅ Reconnected to router!
   📤 Sent message #7
   📤 Sent message #8
   ```

**This is ZeroMQ's automatic reconnection in action!** 🚀

---

## **Stop the Examples**

Press **Ctrl+C** in each terminal.

You'll see a clean shutdown:
```
🛑 Shutting down...
✅ Router closed
```

---

## **Key Features Demonstrated**

### ✅ Router Server (`router-server.js`):
- Binds to TCP address
- Accepts multiple client connections
- Receives messages from any client
- Event monitoring (LISTEN, ACCEPT, DISCONNECT)
- Clean shutdown

### ✅ Dealer Client (`dealer-client.js`):
- Connects to Router server
- Sends messages periodically (every 2 seconds)
- **Automatic reconnection** if connection lost
- Connection timeout handling
- Event monitoring (CONNECT, DISCONNECT, RECONNECT)
- Clean shutdown

---

## **Configuration Options**

Both examples use production-ready ZeroMQ options:

```javascript
config: {
  ZMQ_LINGER: 0,               // Fast shutdown (discard unsent)
  ZMQ_RECONNECT_IVL: 100,      // Reconnect every 100ms
  ZMQ_SNDHWM: 1000,            // Max 1000 queued outgoing messages
  ZMQ_RCVHWM: 1000,            // Max 1000 queued incoming messages
  CONNECTION_TIMEOUT: 5000,    // 5s initial connection timeout
  RECONNECTION_TIMEOUT: 30000  // 30s max reconnection attempts
}
```

---

## **Troubleshooting**

### "Address already in use"
```bash
# Kill lingering processes
killall node

# Or change the port in both files
const ADDRESS = 'tcp://127.0.0.1:5556'  # Change 5555 to 5556
```

### "Connection timeout"
- Make sure Router is started **first**
- Check that both use the same address (`tcp://127.0.0.1:5555`)
- Verify no firewall blocking

### Messages not appearing
- Ensure Router is running in Terminal 1
- Ensure Dealer is running in Terminal 2
- Check for error messages

---

## **Next Steps**

1. ✅ Run the examples and watch them communicate
2. ✅ Test the automatic reconnection feature
3. ✅ Read the full documentation: `README.md`
4. 📚 Study the Client/Server layer (higher level): `../../client.js`, `../../server.js`
5. 📚 Study the Protocol layer (message handling): `../../protocol.js`
6. 📚 Study the Node layer (full microservice): `../../node.js`

---

## **Architecture Layers**

```
Your Application
    ↓
Node (full microservice with discovery)
    ↓
Client / Server (application logic)
    ↓
Protocol (request/response, handlers)
    ↓
Dealer / Router (ZeroMQ wrappers) ← YOU ARE HERE
    ↓
Socket (pure transport)
    ↓
ZeroMQ (native C library)
```

---

## **Files**

- `router-server.js` - Router (server) example
- `dealer-client.js` - Dealer (client) example
- `run-test.sh` - Automated test script
- `README.md` - Full documentation
- `QUICK_START.md` - This file

---

**Happy Coding!** 🚀

**The examples are production-ready and demonstrate best practices for:**
- ✅ Socket configuration
- ✅ Event handling
- ✅ Automatic reconnection
- ✅ Clean shutdown
- ✅ Error handling
- ✅ Logging

