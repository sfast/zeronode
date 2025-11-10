# Test Coverage Analysis & Recommendations

## Current Coverage Status
- **Overall**: 72.86% statements | 50.74% branches | 70.03% functions | 72.9% lines
- **Thresholds**: 88% statements | 72% branches | 91% functions | 89% lines

---

## 📊 Highest-Impact Testing Opportunities

### 🥇 **1. Config Validation (`src/transport/zeromq/config.js`)**
**Coverage**: 15.62% | **Uncovered Lines**: 185, 199-274 (90 lines)
**Impact**: ⭐⭐⭐⭐⭐ (Highest)

**Uncovered Code**:
- `validateConfig()` function (lines 220-274) - **54 lines**
- `createDealerConfig()` (lines 198-200)
- `createRouterConfig()` (lines 209-211)
- `mergeConfig()` validation call (line 185)

**Test Recommendations**:
```javascript
describe('ZMQ Configuration', () => {
  describe('validateConfig()', () => {
    it('should validate DEALER_IO_THREADS range (1-16)')
    it('should throw on invalid DEALER_IO_THREADS')
    it('should validate ROUTER_IO_THREADS range (1-16)')
    it('should throw on invalid ROUTER_IO_THREADS')
    it('should validate DEBUG as boolean')
    it('should validate ZMQ_LINGER (-1 or >= 0)')
    it('should validate HWM values (> 0)')
    it('should validate reconnection intervals (> 0)')
    it('should validate timeouts (-1 or >= 0)')
  })
  
  describe('createDealerConfig()', () => {
    it('should create dealer config with defaults')
    it('should merge user config with defaults')
  })
  
  describe('createRouterConfig()', () => {
    it('should create router config with defaults')
    it('should merge user config with defaults')
  })
  
  describe('mergeConfig() with validation', () => {
    it('should validate merged config when validate=true')
  })
})
```

**Estimated Coverage Gain**: +6-8% overall

---

### 🥈 **2. Utils Query Operators (`src/utils.js`)**
**Coverage**: 39.02% | **Uncovered Lines**: 5-7, 21, 34, 41-77 (40+ lines)
**Impact**: ⭐⭐⭐⭐ (High)

**Uncovered Code**:
- `checkNodeReducer()` edge cases (lines 5-7)
- Many query operators not tested (lines 41-77):
  - `$gt`, `$gte`, `$lt`, `$lte` (numeric comparisons)
  - `$between` (range checking)
  - `$regex` (pattern matching)
  - `$in`, `$nin` (array membership)
  - `$contains`, `$containsAny`, `$containsNone` (substring/array operations)

**Test Recommendations**:
```javascript
describe('optionsPredicateBuilder - Advanced Operators', () => {
  describe('Numeric Comparisons', () => {
    it('$gt should match greater than')
    it('$gte should match greater than or equal')
    it('$lt should match less than')
    it('$lte should match less than or equal')
  })
  
  describe('Range & Pattern Matching', () => {
    it('$between should match values in range [min, max]')
    it('$regex should match regex patterns')
  })
  
  describe('Array Operations', () => {
    it('$in should match values in array')
    it('$nin should match values NOT in array')
    it('$contains should match substring in string')
    it('$containsAny should match if ANY value exists')
    it('$containsNone should match if NO values exist')
  })
})

describe('checkNodeReducer', () => {
  it('should handle nodes with empty options')
  it('should handle predicate returning false')
  it('should work with custom predicate functions')
})
```

**Estimated Coverage Gain**: +3-5% overall

---

### 🥉 **3. Transport Error Helpers (`src/transport/errors.js`)**
**Coverage**: 66.66% | **Uncovered Lines**: 88-142 (55 lines)
**Impact**: ⭐⭐⭐⭐ (High)

**Uncovered Code**:
- `toJSON()` method (lines 87-103)
- `isCode()` method (lines 111-113)
- `isConnectionError()` method (lines 120-123)
- `isBindError()` method (lines 130-134)
- `isSendError()` method (lines 141-143)

**Test Recommendations**:
```javascript
describe('TransportError', () => {
  describe('toJSON()', () => {
    it('should serialize error to JSON')
    it('should include cause details when present')
    it('should include context when present')
    it('should handle errors without cause')
  })
  
  describe('Helper Methods', () => {
    it('isCode() should check error code')
    it('isConnectionError() should identify connection errors')
    it('isBindError() should identify bind errors')
    it('isSendError() should identify send errors')
  })
})
```

**Estimated Coverage Gain**: +2-3% overall

---

### 4. **Peer State Transitions (`src/protocol/peer.js`)**
**Coverage**: 54.16% | **Uncovered Lines**: 97-128, 136-142, 159-163, 175-176
**Impact**: ⭐⭐⭐ (Medium)

**Uncovered Code**:
- Some state transition edge cases
- `mergeOptions()` not mutating original

**Test Recommendations**:
```javascript
describe('PeerInfo - Additional Edge Cases', () => {
  it('should not mutate original options in mergeOptions()')
  it('should handle state transitions from all states')
  it('should preserve STOPPED state on setOffline()')
})
```

**Estimated Coverage Gain**: +1-2% overall

---

### 5. **Context Error Handling (`src/transport/zeromq/context.js`)**
**Coverage**: 40% | **Uncovered Lines**: 47-61
**Impact**: ⭐⭐ (Low)

**Uncovered Code**:
- `terminateContext()` error handling path (lines 60-61)

**Test Recommendations**:
```javascript
describe('Context Management', () => {
  it('should handle terminateContext() errors gracefully')
  it('should remove from cache on terminate')
})
```

**Estimated Coverage Gain**: +0.5% overall

---

### 6. **Globals (`src/globals.js`)**
**Coverage**: 0% | **Impact**: ⭐ (Negligible)

**Reason**: Just constant exports, no logic to test. Low priority.

---

## 🎯 **Recommended Testing Priority**

### **Phase 1: Quick Wins (Highest ROI)**
1. ✅ **Config validation tests** → +6-8% coverage
2. ✅ **Transport error helper tests** → +2-3% coverage

**Estimated Gain**: +8-11% overall coverage

### **Phase 2: Medium Effort**
3. ✅ **Utils query operators** → +3-5% coverage
4. ✅ **Peer edge cases** → +1-2% coverage

**Estimated Gain**: +4-7% overall coverage

### **Phase 3: Optional**
5. ✅ **Context error handling** → +0.5% coverage

---

## 📈 **Projected Coverage After Phase 1 + 2**

- **Current**: 72.86%
- **After Phase 1**: ~81-84%
- **After Phase 2**: ~85-91% ✅ (meets threshold!)

---

## 🔍 **Coverage Gaps in Current Tests**

### Files with Good Coverage (No Action Needed)
- ✅ `enum.js` - 100%
- ✅ `events.js` - 100%
- ✅ `envelope.js` - 75.49% (acceptable)
- ✅ `protocol.js` - 77.77% (acceptable)
- ✅ `dealer.js` - 83.83% (good)
- ✅ `router.js` - 82.08% (good)
- ✅ `socket.js` - 75.32% (acceptable)
- ✅ `server.js` - 89.53% (excellent)

---

## 📝 **Summary**

**Focus on these 3 test files to maximize coverage:**

1. `test/transport/zeromq/config.test.js` - **NEW**
2. `test/utils-operators.test.js` - **NEW** (or extend existing)
3. `test/transport/errors.test.js` - **NEW**

**Expected Outcome**: Achieve 85-91% overall coverage with ~50-80 new test cases.

