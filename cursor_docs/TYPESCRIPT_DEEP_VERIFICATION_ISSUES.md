# TypeScript Definitions - Deep Verification Issues Found

## 🔍 **Issues Discovered**

### **1. ConnectOptions - Incorrect `config` Parameter**

❌ **Type Definition:**
```typescript
export interface ConnectOptions {
  address: string;
  timeout?: number;
  reconnectionTimeout?: number;
  config?: NodeConfig;  // ❌ NOT in implementation
}
```

✅ **Actual Implementation** (`src/node.js:284`):
```javascript
async connect ({ address, timeout, reconnectionTimeout } = {}) {
  // NO config parameter!
}
```

**Fix**: Remove `config` from `ConnectOptions`

---

### **2. PeerLeftPayload - Missing `reason` Field**

❌ **Type Definition:**
```typescript
export interface PeerLeftPayload {
  peerId: string;
  direction: 'upstream' | 'downstream';
  // ❌ Missing 'reason' field
}
```

✅ **Actual Implementation** (`src/node.js:248,256,432,441,452`):
```javascript
this.emit(NodeEvent.PEER_LEFT, {
  peerId: clientId,
  direction: 'downstream',
  reason: 'timeout'  // ✅ reason field exists
})
```

**Fix**: Add optional `reason?` field

---

### **3. NodeErrorPayload - Missing Fields**

❌ **Type Definition:**
```typescript
export interface NodeErrorPayload {
  code: string;
  message: string;
  error?: Error;
}
```

✅ **Actual Implementation** (`src/node.js:110,230,414,771`):
```javascript
this.emit(NodeEvent.ERROR, {
  source: 'server',        // ✅ Missing in types
  stage: 'bind',           // ✅ Missing in types
  address: bind,           // ✅ Missing in types
  serverId: serverId,      // ✅ Missing in types
  category: 'filter',      // ✅ Missing in types
  error: err
})
```

**Fix**: Make flexible with optional fields

---

### **4. ClientReadyPayload - Inconsistent serverId**

⚠️ **Type Definition:**
```typescript
export interface ClientReadyPayload {
  serverId: string;
  serverOptions: Record<string, any>;
}
```

⚠️ **Actual Implementation** (`src/protocol/client.js:144,158`):
```javascript
this.emit(ClientEvent.DISCONNECTED, { serverId: 'server' })
// ⚠️ Uses literal 'server' instead of actual ID in some places
```

**Status**: Types are OK, but implementation is inconsistent (hardcoded 'server')

---

### **5. ServerReadyPayload - Incorrect Field**

❌ **Type Definition:**
```typescript
export interface ServerReadyPayload {
  address: string;
}
```

✅ **Actual Implementation** (`src/protocol/server.js:73`):
```javascript
this.emit(ServerEvent.READY, { serverId: this.getId() })
// ✅ Uses 'serverId', NOT 'address'
```

**Fix**: Change `address` to `serverId`

---

### **6. ServerClientTimeoutPayload - Missing Fields**

❌ **Type Definition:**
```typescript
export interface ServerClientTimeoutPayload {
  clientId: string;
  lastPingTime: number;
}
```

✅ **Actual Implementation** (`src/protocol/server.js:300,311`):
```javascript
this.emit(ServerEvent.CLIENT_TIMEOUT, { 
  clientId, 
  lastSeen: peerInfo.getLastSeen(),     // ✅ Uses 'lastSeen' not 'lastPingTime'
  timeSinceLastSeen,                     // ✅ Missing in types
  final: true                            // ✅ Missing in types
})
```

**Fix**: Replace `lastPingTime` with `lastSeen`, add `timeSinceLastSeen` and `final`

---

## 📊 **Summary of Required Fixes**

| Issue | Type | Severity | Impact |
|-------|------|----------|--------|
| ConnectOptions.config | Extra field | Medium | Users may pass invalid parameter |
| PeerLeftPayload.reason | Missing field | Low | Missing optional metadata |
| NodeErrorPayload fields | Missing fields | Medium | Incomplete error context |
| ServerReadyPayload | Wrong field | High | Incorrect event payload |
| ServerClientTimeoutPayload | Wrong/Missing fields | High | Incorrect event payload |

**Total Issues:** 5 type definition mismatches

---

## ✅ **Verification Sources**

- `src/node.js` - lines 110, 230, 239, 248, 256, 284, 414, 423, 432, 441, 452, 771
- `src/protocol/client.js` - lines 144, 158, 198, 216
- `src/protocol/server.js` - lines 73, 79, 85, 115, 167, 300, 311

