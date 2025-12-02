# Zeronode CLI

Run a Zeronode Router or Service Node from the command line.

## Installation

```bash
npm install -g zeronode
# or use with npx
npx zeronode --help
```

## Usage

### Router
```bash
npx zeronode --router --bind <address> [options]
```

### Service Node
```bash
npx zeronode --node --name <name> [--bind <address>] --connect <router> [options]
```

## Options

### Router Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--router` | - | Run as a router | Required |
| `--bind <address>` | `-b` | Bind address | Required |
| `--id <id>` | - | Router ID | `router-{pid}` |
| `--stats <ms>` | - | Print statistics interval | - |

### Node Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--node` | - | Run as a node/service | Required |
| `--name <name>` | - | Service name | Required |
| `--bind <address>` | `-b` | Bind address (optional) | - |
| `--connect <addr>` | `-c` | Router address (repeatable) | Required |
| `--id <id>` | - | Node ID | `{name}-{pid}` |
| `--option <k=v>` | `-o` | Custom option key=value | - |
| `--interactive` | `-i` | Enable interactive mode | `false` |
| `--stats <ms>` | - | Print statistics interval | - |

### Common Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--debug` | `-d` | Enable debug logging | `false` |
| `--help` | `-h` | Show help message | - |

## Examples

### 1. Start a Router

```bash
npx zeronode --router --bind tcp://0.0.0.0:8087
```

**With debug logging:**
```bash
npx zeronode --router --bind tcp://0.0.0.0:8087 --debug
```

Output:
```
🚀 Zeronode Router Started
============================================================
ID:       router-12345
Address:  tcp://0.0.0.0:8087
Options:  {"router":true}
============================================================
Router is ready to accept connections...
Press Ctrl+C to stop
```

### 2. Start Service Nodes

**Auth Service:**
```bash
npx zeronode --node --name auth \
  --bind tcp://0.0.0.0:3001 \
  --connect tcp://127.0.0.1:8087
```

**Payment Service:**
```bash
npx zeronode --node --name payment \
  --connect tcp://127.0.0.1:8087
```

**Worker with Options:**
```bash
npx zeronode --node --name worker \
  --bind tcp://0.0.0.0:3002 \
  --connect tcp://127.0.0.1:8087 \
  --option version=1.0 \
  --option region=us-east \
  --option capacity=100
```

Output:
```
🚀 Zeronode Service Started
============================================================
ID:       auth-12346
Address:  tcp://0.0.0.0:3001
Options:  {"service":"auth"}
============================================================

📡 Connecting to servers...
✅ Connected to tcp://127.0.0.1:8087

✅ Node is ready!
Press Ctrl+C to stop

📥 Registered handlers: echo, ping
```

### 3. Interactive Client

Send requests from command line:

```bash
npx zeronode --node --name client \
  --connect tcp://127.0.0.1:8087 \
  --interactive
```

**Interactive Commands (default event `message`):**

```bash
# Send a message (event = "message")
> send auth {"message":"hello router!"}
📤 Sending message to service=auth, event=message
   Data: {"message":"hello router!","sender":"client-12345","timestamp":1700000000000}
✅ Response: {
  "received": true,
  "timestamp": 1700000000001,
  "echo": {
    "message": "hello router!",
    "sender": "client-12345",
    "timestamp": 1700000000000
  }
}

# On the receiving node (auth terminal):
💬 Message from client-12345
   Sender: client-12345
   Message: hello router!

# List connected peers
> list
📋 Connected Peers:
   Upstream: 1
     - router-12345

# Exit
> exit
👋 Exiting...
```

> ℹ️ Interactive nodes automatically reconnect to `--connect` addresses if the router drops unexpectedly (network hiccup, crash, etc.). If the router shuts down gracefully (`server_left`), reconnect attempts stop until you restart the CLI.

### 4. Complete Example

**Terminal 1 - Start Router:**
```bash
npx zeronode --router --bind tcp://127.0.0.1:8087 --stats 10000
```

**Terminal 2 - Start Auth Service:**
```bash
npx zeronode --node --name auth \
  --bind tcp://127.0.0.1:3001 \
  --connect tcp://127.0.0.1:8087
```

**Terminal 3 - Start Payment Service:**
```bash
npx zeronode --node --name payment \
  --bind tcp://127.0.0.1:3002 \
  --connect tcp://127.0.0.1:8087
```

**Terminal 4 - Interactive Client (single messages):**
```bash
npx zeronode --node --name client \
  --connect tcp://127.0.0.1:8087 \
  --interactive

> send auth {"message":"hello from client"}
> send payment {"status":"need-approval"}
> list
```

## Built-in Handlers

Every CLI node automatically registers these handlers:

### `echo` Handler
Echoes back the data you send:
```bash
> request auth echo {"message":"hello"}
✅ Response: { "echo": { "message": "hello" }, "timestamp": 1234567890 }
```

### `ping` Handler
Simple health check:
```bash
> request auth ping
✅ Response: { "pong": true, "timestamp": 1234567890 }
```

### `message` Handler (Interactive CLI)
Automatically handled when you use `--interactive` + `send` command:
```bash
> send auth {"message":"hello"}
✅ Response: {
  "received": true,
  "echo": {
    "message": "hello",
    "sender": "client-12345",
    "timestamp": 1700000000000
  }
}
```
Receiver terminal:
```
💬 Message from client-12345
   Sender: client-12345
   Message: hello
```

## Production Deployment

### Using PM2

```bash
# Start router
pm2 start npx --name router -- zeronode --router --bind tcp://0.0.0.0:8087

# Start services
pm2 start npx --name auth -- zeronode --node --name auth \
  --bind tcp://0.0.0.0:3001 \
  --connect tcp://127.0.0.1:8087

pm2 start npx --name payment -- zeronode --node --name payment \
  --bind tcp://0.0.0.0:3002 \
  --connect tcp://127.0.0.1:8087
```

### Using Docker

**Router:**
```dockerfile
FROM node:22
WORKDIR /app
RUN npm install -g zeronode
EXPOSE 8087
CMD ["npx", "zeronode", "--router", "--bind", "tcp://0.0.0.0:8087", "--stats", "60000"]
```

**Service:**
```dockerfile
FROM node:22
WORKDIR /app
RUN npm install -g zeronode
ENV SERVICE_NAME=auth
ENV ROUTER_ADDRESS=tcp://router:8087
EXPOSE 3001
CMD npx zeronode --node --name $SERVICE_NAME \
    --bind tcp://0.0.0.0:3001 \
    --connect $ROUTER_ADDRESS
```

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  router:
    image: zeronode-router
    ports:
      - "8087:8087"
    command: npx zeronode --router --bind tcp://0.0.0.0:8087
  
  auth:
    image: zeronode-service
    environment:
      SERVICE_NAME: auth
      ROUTER_ADDRESS: tcp://router:8087
    depends_on:
      - router
  
  payment:
    image: zeronode-service
    environment:
      SERVICE_NAME: payment
      ROUTER_ADDRESS: tcp://router:8087
    depends_on:
      - router
```

### Using systemd

**Router Service:**
```ini
[Unit]
Description=Zeronode Router
After=network.target

[Service]
Type=simple
User=zeronode
WorkingDirectory=/opt/zeronode
ExecStart=/usr/bin/npx zeronode --router --bind tcp://0.0.0.0:8087 --stats 60000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Service Node:**
```ini
[Unit]
Description=Zeronode Auth Service
After=network.target zeronode-router.service
Requires=zeronode-router.service

[Service]
Type=simple
User=zeronode
WorkingDirectory=/opt/zeronode
ExecStart=/usr/bin/npx zeronode --node --name auth \
  --bind tcp://0.0.0.0:3001 \
  --connect tcp://127.0.0.1:8087
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Monitoring

### Live Statistics (Router)

```bash
npx zeronode --router --bind tcp://0.0.0.0:8087 --stats 5000
```

Output every 5 seconds:
```
📊 Router Statistics
------------------------------------------------------------
Proxy Requests:     150
Proxy Ticks:        30
Successful Routes:  178
Failed Routes:      2
Total Messages:     180
Uptime:             3600s
Requests/sec:       0.05
------------------------------------------------------------
```

### Graceful Shutdown

```bash
# Press Ctrl+C or:
kill -SIGTERM <pid>
```

Output:
```
⏹️  Shutting down Router...

📊 Final Statistics
------------------------------------------------------------
Total Proxy Requests:  150
Total Proxy Ticks:     30
Successful Routes:     178
Failed Routes:         2
Total Uptime:          3600s
------------------------------------------------------------
✅ Router stopped gracefully
```

## Troubleshooting

### Port Already in Use

```bash
# Error: Failed to bind to tcp://0.0.0.0:8087: Address already in use
lsof -ti:8087 | xargs kill -9
```

### Permission Denied

```bash
# Error: Failed to bind to tcp://0.0.0.0:80: Permission denied
# Solution: Use port > 1024 or run with appropriate permissions
npx zeronode --router --bind tcp://0.0.0.0:8087
```

### Connection Refused

```bash
# Make sure router is running first
npx zeronode --router --bind tcp://0.0.0.0:8087

# Then connect services
npx zeronode --node --name auth --connect tcp://127.0.0.1:8087
```

### Test Connectivity

```bash
# Test if router port is open
nc -zv 127.0.0.1 8087
# or
telnet 127.0.0.1 8087
```

## Demo Script

Run the complete demo:

```bash
bash examples/cli-demo.sh
```

This starts:
1. Router on port 8087
2. Auth service on port 3001
3. Payment service on port 3002
4. Interactive client

## See Also

- [Router Documentation](../README.md#router-based-discovery)
- [Router Example](../examples/router-example.js)
- [Router Benchmark](../benchmark/router-overhead.js)
- [API Documentation](../docs/API.md)
