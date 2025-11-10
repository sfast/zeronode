# Cursor Configuration Summary

## 📁 Files Created/Updated

### 1. `.cursorignore`

**Purpose:** Tell Cursor which files to ignore (for better performance and relevance)

**Ignores:**
- `node_modules/` - Dependencies
- `dist/` - Build output
- `coverage/` - Test coverage reports
- `*.log` - Log files
- `.nyc_output/` - Test coverage data
- `package-lock.json` - Lock file
- IDE folders (`.idea/`, `.vscode/`, etc.)
- OS files (`.DS_Store`, `Thumbs.db`)
- Temporary files

**Why:** Improves Cursor's search/indexing performance by excluding generated/unnecessary files.

---

### 2. `.cursorrules`

**Purpose:** Guide Cursor AI on how to work with this codebase

**Key Rules:**

#### **Documentation Location**
```
✅ cursor_docs/FEATURE_NAME.md
❌ FEATURE_NAME.md (root)
❌ docs/FEATURE_NAME.md (user docs)
```

#### **Document Length**
- Maximum **400 lines** per document
- Split large topics into multiple focused docs

#### **Context Rule (Rule of 7)**
Always show **7 lines of context** before/after changes:

```javascript
// Line 1 (context)
// Line 2 (context)
// Line 3 (context)
// CHANGE HERE
// Line 4 (context)
// Line 5 (context)
// Line 6 (context)
// Line 7 (context)
```

**Why:** Helps verify Cursor's suggestions are correct in context.

#### **Code Style**
- **Standard.js** (no semicolons, 2 spaces)
- **WeakMap** for private state
- **Layered architecture** (Envelope → Transport → Protocol → Application)
- **ES6+** with Babel

#### **Naming Conventions**
- **Classes:** `PascalCase`
- **Public methods:** `camelCase`
- **Private methods:** `_camelCase`
- **Constants:** `SCREAMING_SNAKE_CASE`
- **Documents:** `SCREAMING_SNAKE_CASE.md`

---

## 📊 Repository Structure

```
zeronode/
├── src/                    # Source code
│   ├── envelope.js         # Binary protocol layer
│   ├── protocol.js         # Request/response semantics
│   ├── client.js           # Client application layer
│   ├── server.js           # Server application layer
│   ├── node.js             # Orchestrator
│   └── sockets/            # ZeroMQ transport wrappers
├── test/                   # Tests
├── dist/                   # Built code (ignored by Cursor)
├── coverage/               # Coverage reports (ignored)
├── cursor_docs/            # ✅ ALL AI-GENERATED DOCS GO HERE
├── docs/                   # User documentation (public)
├── examples/               # Example code
├── benchmark/              # Performance benchmarks
├── .cursorignore          # Files for Cursor to ignore
├── .cursorrules           # Cursor AI guidelines
└── README.md              # Main readme (keep in root)
```

---

## 🎯 Guidelines Summary

### When Creating Documents

1. **Location:** Always `cursor_docs/DOCUMENT_NAME.md`
2. **Length:** Maximum 400 lines
3. **Naming:** `SCREAMING_SNAKE_CASE.md`
4. **Structure:**
   ```markdown
   # Title
   ## 🎯 Goal
   ## 📊 Context (with 7-line code snippets)
   ## 🏗️ Implementation
   ## ✅ Verification
   ## 📝 Summary
   ```

### When Suggesting Code Changes

1. **Always show 7 lines of context** before/after the change
2. **Explain why** the change is needed
3. **Show impact** on related code
4. **Include tests** if applicable

### Architecture Principles

1. **Layer separation:**
   - Envelope (binary) → Transport (ZeroMQ) → Protocol (semantics) → Application (Client/Server/Node)
2. **Lazy evaluation:**
   - Parse envelope fields on-demand only
3. **WeakMap for private state:**
   - `let _private = new WeakMap()`
4. **Public vs Internal API:**
   - Public: Validates, blocks system events
   - Internal (`_method`): For subclasses only
   - Private (`_method`): Implementation details

---

## 🔧 Common Tasks

### Adding New Features

```bash
1. Design   → cursor_docs/FEATURE_DESIGN.md
2. Implement → src/feature.js
3. Test     → test/feature.test.js
4. Document → cursor_docs/FEATURE_IMPLEMENTATION.md
5. Verify   → npm test
```

### Refactoring

```bash
1. Analyze  → cursor_docs/REFACTOR_ANALYSIS.md
2. Plan     → cursor_docs/REFACTOR_PLAN.md
3. Implement → Show 7-line context
4. Test     → npm test
5. Document → cursor_docs/REFACTOR_COMPLETE.md
```

---

## 📝 Quick Reference

### File Locations

| Type | Location | Example |
|------|----------|---------|
| **AI-generated docs** | `cursor_docs/` | `cursor_docs/PROTOCOL_DESIGN.md` |
| **User docs** | `docs/` | `docs/CONFIGURE.md` |
| **Source code** | `src/` | `src/protocol.js` |
| **Tests** | `test/` | `test/protocol.test.js` |
| **Examples** | `examples/` | `examples/simple-request.js` |
| **Benchmarks** | `benchmark/` | `benchmark/throughput-benchmark.js` |

### Commands

```bash
npm test                  # Run tests
npm run build             # Build with Babel
npm run standard          # Lint
npm run format            # Auto-fix linting
```

---

## ✅ Benefits

### For Cursor AI

1. **Faster indexing** - Ignores irrelevant files
2. **Better suggestions** - Understands codebase patterns
3. **Consistent docs** - All in `cursor_docs/`
4. **Context-aware** - Always shows 7-line context

### For Developers

1. **Clear guidelines** - Knows where things go
2. **Consistent style** - Follows Standard.js
3. **Organized docs** - All in one place
4. **Easy verification** - 7-line context makes reviews easy

---

## 📚 Related Files

- `.cursorignore` - Files to ignore
- `.cursorrules` - AI guidelines
- `cursor_docs/` - All AI-generated documentation
- `.gitignore` - Git ignore (similar to cursorignore)
- `package.json` - Project config
- `README.md` - Main project readme

---

## 🎉 Summary

**Cursor is now configured to:**
- ✅ Ignore unnecessary files (node_modules, dist, logs)
- ✅ Generate all docs in `cursor_docs/`
- ✅ Keep docs under 400 lines
- ✅ Always show 7-line context for changes
- ✅ Follow Zeronode coding conventions
- ✅ Maintain layer separation
- ✅ Use WeakMap for private state

**Result:** Better AI suggestions, cleaner codebase, organized documentation!

