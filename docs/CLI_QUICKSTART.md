# Zeronode CLI Quick Start

This guide shows you how to run a router and connect two nodes to it, all from the command line.

## Prerequisites

Make sure you're in the zeronode directory:
```bash
cd /path/to/zeronode
```

## Step-by-Step Guide

### Step 1: Start the Router

Open **Terminal 1** and run:

```bash
node bin/zeronode.js --router --bind tcp://127.0.0.1:8087 --stats 5000
```

You should see:
```
🚀 Zeronode Router Started
============================================================
ID:       router-37738
Address:  tcp://127.0.0.1:8087
Options:  {"router":true,"_id":"router-37738"}
============================================================
Router is ready to accept connections...
Press Ctrl+C to stop
```

✅ **Router is now running on port 8087!**

---

### Step 2: Start First Node (Auth Service)

Open **Terminal 2** and run:

```bash
node bin/zeronode.js --node --name auth \
  --bind tcp://127.0.0.1:3001 \
  --connect tcp://127.0.0.1:8087
```

You should see:
```
🚀 Zeronode Service Started
============================================================
ID:       auth-37739
Address:  tcp://127.0.0.1:3001
Options:  {"service":"auth","_id":"auth-37739"}
============================================================

📡 Connecting to servers...
✅ Connected to tcp://127.0.0.1:8087

✅ Node is ready!
Press Ctrl+C to stop
```

✅ **Auth service is connected to the router!**

---

### Step 3: Start Second Node (Payment Service)

Open **Terminal 3** and run:

```bash
node bin/zeronode.js --node --name payment \
  --bind tcp://127.0.0.1:3002 \
  --connect tcp://127.0.0.1:8087
```

You should see:
```
🚀 Zeronode Service Started
============================================================
ID:       payment-37740
Address:  tcp://127.0.0.1:3002
Options:  {"service":"payment","_id":"payment-37740"}
============================================================

📡 Connecting to servers...
✅ Connected to tcp://127.0.0.1:8087

✅ Node is ready!
Press Ctrl+C to stop
```

✅ **Payment service is connected to the router!**

---

### Step 4: Test Communication (Interactive Client)

Open **Terminal 4** and run:

```bash
node bin/zeronode.js --node --name test-client \
  --connect tcp://127.0.0.1:8087 \
  --interactive
```

You should see:
```
🚀 Zeronode Service Started
============================================================
ID:       test-client-37741
Address:  Not bound
Options:  {"service":"test-client","_id":"test-client-37741"}
============================================================

📡 Connecting to servers...
✅ Connected to tcp://127.0.0.1:8087

✅ Node is ready!
Press Ctrl+C to stop

📝 Interactive mode enabled
   Commands:
     send <service> <data>             - Send message (event=message)
     list                              - List connected peers
     exit                              - Exit

> 
```

> ℹ️ CLI nodes keep retrying their `--connect` addresses if a router drops unexpectedly (e.g., crash, network blip). When a router stops cleanly, reconnect attempts pause until you restart the CLI.

Now you can test the communication!

#### Test 1: Send message to Auth
```bash
> send auth {"message":"hello from client"}
```

Expected output:
```
📤 Sending message to service=auth, event=message
   Data: {"message":"hello from client","sender":"test-client-37741","timestamp":1700000000000}
✅ Response: {
  "received": true,
  "timestamp": 1234567890,
  "echo": {
    "message": "hello from client",
    "sender": "test-client-37741",
    "timestamp": 1700000000000
  }
}
```

Receiver terminal output:
```
💬 Message from client-37741
   Sender: test-client-37741
   Message: hello from client
```

#### Test 2: Send to Payment
```bash
> send payment {"invoice":42,"status":"pending"}
```

#### Test 3: List Connected Peers
```bash
> list
```

Expected output:
```
📋 Connected Peers:
   Downstream: 0
   Upstream: 1
     - router-37738
```

---

## What's Happening?

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│               Router (Port 8087)                    │
│          { router: true, _id: "..." }              │
│                                                     │
└──────────┬──────────────────────────┬───────────────┘
           │                          │
           │                          │
    ┌──────▼──────┐            ┌──────▼──────┐
    │             │            │             │
    │    Auth     │            │   Payment   │
    │ Port 3001   │            │ Port 3002   │
    │             │            │             │
    └─────────────┘            └─────────────┘
    service: auth              service: payment
```

1. **Router** acts as a central hub
2. **Auth** and **Payment** services connect to the router
3. **Client** connects to the router
4. When client sends `send auth {...}`:
   - Request goes to router
   - Router discovers auth service (filter: `{ service: 'auth' }`)
   - Router forwards request to auth
   - Auth sends response back through router to client

---

## Automated Demo

Instead of opening 4 terminals manually, you can use the demo script:

```bash
bash examples/cli-demo.sh
```

This automatically starts:
- Router on port 8087
- Auth service on port 3001
- Payment service on port 3002
- Interactive client

Press `Ctrl+C` to stop all services.

---

## Clean Up

To stop all services:
1. Press `Ctrl+C` in each terminal
2. Or kill processes:

```bash
# Find processes
ps aux | grep zeronode

# Kill specific process
kill <PID>

# Or kill all node processes (careful!)
pkill -f "node bin/zeronode.js"
```

---

## Troubleshooting

### "Address already in use"
```bash
# Kill process using the port
lsof -ti:8087 | xargs kill -9
lsof -ti:3001 | xargs kill -9
lsof -ti:3002 | xargs kill -9
```

### "Connection refused"
Make sure the router started successfully before starting the nodes.

### "No response"
Wait 1-2 seconds after starting services before sending requests to allow connections to stabilize.

---

## Next Steps

- Read [CLI Documentation](./CLI.md) for all options
- Check [Router Example](../examples/router-example.js) for programmatic usage
- See [README](../README.md) for API documentation
- Run [Router Benchmark](../benchmark/router-overhead.js) to measure performance

---

## Advanced: Multiple Routers

You can connect to multiple routers:

```bash
# Node connecting to two routers
node bin/zeronode.js --node --name worker \
  --connect tcp://127.0.0.1:8087 \
  --connect tcp://192.168.1.100:8087
```

## Advanced: Custom Options

Add custom metadata to your services:

```bash
node bin/zeronode.js --node --name api \
  --bind tcp://127.0.0.1:3003 \
  --connect tcp://127.0.0.1:8087 \
  --option version=2.0 \
  --option region=us-east \
  --option environment=production
```

Then filter by these options:
```bash
> request api ping
# This will find any service with name "api"
```

