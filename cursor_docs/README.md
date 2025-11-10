# Zeronode Tests

## Structure

```
test/
├── sockets/               # Transport layer tests
│   ├── socket.test.js     # Pure Socket (base transport)
│   ├── dealer.test.js     # Dealer socket (client transport)
│   ├── router.test.js     # Router socket (server transport)
│   └── integration.test.js # Router-Dealer communication
└── README.md              # This file
```

## Test Coverage

### Socket Tests (`socket.test.js`)

Tests the **pure transport layer** - message I/O and request/response tracking:

- ✅ ID generation and management
- ✅ Online/offline state transitions
- ✅ Config and options storage
- ✅ Message reception (TICK, REQUEST) → emits 'message' event
- ✅ Request/response tracking (Promise resolution)
- ✅ Request timeout handling
- ✅ Error response handling
- ✅ Message sending validation (online check)

**Key Insight**: Socket has NO business logic handlers - it's pure transport.

### Dealer Tests (`dealer.test.js`)

Tests the **ZeroMQ Dealer wrapper** (client-side transport):

- ✅ Constructor and state initialization
- ✅ Address management (set/get router address)
- ✅ State transitions (DISCONNECTED → CONNECTED)
- ✅ Message formatting for Dealer (no recipient routing)
- ✅ Request/tick envelope creation
- ✅ Disconnect and close operations

**Key Insight**: Dealer extends Socket, adds ZeroMQ Dealer specifics.

### Router Tests (`router.test.js`)

Tests the **ZeroMQ Router wrapper** (server-side transport):

- ✅ Constructor and state initialization
- ✅ Address management (set/get bind address)
- ✅ Bind/unbind operations
- ✅ Bind validation (no double-binding to different addresses)
- ✅ Message formatting for Router ([recipient, '', buffer])
- ✅ Request/tick envelope creation
- ✅ Close operations

**Key Insight**: Router extends Socket, adds ZeroMQ Router specifics + routing.

### Integration Tests (`integration.test.js`)

Tests **actual Router-Dealer communication**:

- ✅ Connection establishment (bind + connect)
- ✅ REQUEST/RESPONSE flow
- ✅ TICK (one-way) messaging
- ✅ Request timeout behavior
- ✅ ERROR response handling
- ✅ Multiple dealer connections

**Key Insight**: Verifies the complete message flow end-to-end.

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- test/sockets/socket.test.js

# Run with coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

## Test Philosophy

### What We Test

1. **Transport Layer Only** - These tests focus on message I/O, not business logic
2. **State Management** - Connection states, online/offline transitions
3. **Message Format** - Proper envelope creation and routing
4. **Error Handling** - Timeouts, connection failures, error responses

### What We DON'T Test (Yet)

- ❌ Handler execution (that's protocol layer - Client/Server)
- ❌ Node orchestration (that's application layer)
- ❌ Pattern matching (that's business logic)

## Architecture Insights

### Current Clean Architecture:

```
┌─────────────────────────────────────────┐
│ Transport Layer (Socket, Dealer, Router)│
│  - Pure message I/O                     │
│  - Request/response tracking            │
│  - Connection management                │
│  - NO business logic                    │
└─────────────────────────────────────────┘
```

### What Socket Does:

```javascript
// ✅ TRANSPORT (tested here)
- Listen for messages → emit('message', buffer)
- Send messages → sendBuffer(buffer)
- Track requests → requestBuffer() returns Promise
- Handle responses → resolve/reject Promise

// ❌ NOT Socket's job (protocol layer)
- Parse messages
- Execute handlers
- Route to handlers
- Business logic
```

### Next Testing Phases:

1. **Phase 1** ✅ - Transport tests (current)
2. **Phase 2** 🔄 - Protocol tests (Client/Server with handlers)
3. **Phase 3** 🔄 - Application tests (Node orchestration)
4. **Phase 4** 🔄 - Integration tests (full stack)

## Mock Strategy

### Mock ZeroMQ Socket

We use a **lightweight mock** that:
- Implements async iterator for message reception
- Tracks sent messages
- Simulates incoming messages
- Provides event emitter for socket events

**Why?** Real ZeroMQ sockets require actual network connections, making tests slow and brittle.

## Test Utilities

### Creating Mock Socket

```javascript
const mockSocket = createMockZmqSocket()

// Simulate incoming message
mockSocket.simulateIncomingMessage(['', buffer])

// Check sent messages
expect(mockSocket.sentMessages).to.have.lengthOf(1)
```

## Running Integration Tests

Integration tests use **real ZeroMQ sockets** to verify actual communication:

```bash
# Integration tests may take longer
npm test -- test/sockets/integration.test.js
```

⚠️ **Note**: Integration tests use actual network ports (7000-7999). Make sure ports are available.

## Contributing

When adding new transport features:

1. Add unit tests to respective file
2. Add integration test if it affects message flow
3. Update this README with coverage information
4. Ensure tests are isolated (no shared state)
5. Clean up connections in `afterEach`

## Test Patterns

### Good Test Structure

```javascript
describe('Feature', () => {
  let socket
  
  beforeEach(() => {
    socket = new Socket({ ... })
  })
  
  afterEach(async () => {
    if (socket.isOnline()) {
      await socket.close()
    }
  })
  
  it('should do something specific', () => {
    // Arrange
    // Act
    // Assert
  })
})
```

### Async Test Pattern

```javascript
it('should handle async operation', async () => {
  const promise = socket.requestBuffer(buffer, 'recipient', 1000)
  
  // Simulate response
  setTimeout(() => {
    mockSocket.simulateIncomingMessage(responseBuffer)
  }, 10)
  
  const result = await promise
  expect(result).to.deep.equal(expected)
})
```

## Debugging Tests

```bash
# Run with verbose output
npm test -- --reporter spec

# Run single test
npm test -- --grep "should track pending requests"

# Debug mode
NODE_ENV=test node --inspect-brk node_modules/.bin/mocha test/**/*.test.js
```

