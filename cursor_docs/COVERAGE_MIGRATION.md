# Coverage Migration: NYC → C8

## ✅ Migration Complete

Successfully migrated from legacy NYC/Istanbul coverage to modern C8.

---

## Cleanup Performed

### Removed Packages
```bash
✅ npm uninstall nyc babel-plugin-istanbul
```

- **nyc** (17.1.0) - Legacy coverage tool
- **babel-plugin-istanbul** (7.0.1) - Istanbul instrumentation plugin

### Removed Configuration
- ✅ Removed `"plugins": ["istanbul"]` from `.babelrc` test environment
- ✅ Removed `nyc` configuration block from `package.json`
- ✅ Removed `.nyc_output/` directory

### Added Packages
```bash
✅ npm install --save-dev c8@latest
```

- **c8** (10.1.3) - Modern coverage tool using V8's native coverage API

---

## New Configuration

### `.babelrc`
```json
{
  "presets": ["@babel/preset-env"],
  "plugins": [
    ["@babel/transform-runtime", {
      "helpers": false,
      "regenerator": true
    }]
  ],
  "sourceMaps": "inline",
  "retainLines": true
}
```

### `package.json` - Scripts
```json
{
  "scripts": {
    "test": "npx c8 mocha --exit --timeout 10000",
    "test:no-coverage": "mocha --exit --timeout 10000",
    "test:coverage:html": "npx c8 --reporter=html --reporter=text mocha --exit --timeout 10000"
  }
}
```

### `package.json` - C8 Configuration
```json
{
  "c8": {
    "reporter": ["text", "text-summary", "html", "lcov"],
    "exclude": [
      "**/*.test.js",
      "test/**",
      "dist/**",
      "coverage/**",
      "benchmark/**",
      "examples/**",
      "src/transport/zeromq/example/**",
      "src/transport/zeromq/tests/**"
    ],
    "src": ["src"],
    "all": true,
    "clean": true,
    "check-coverage": false,
    "lines": 80,
    "functions": 80,
    "branches": 70,
    "statements": 80
  }
}
```

---

## Usage

### Run Tests with Coverage (Default)
```bash
npm test
```

**Output:**
```
✅ 483 passing (53s)

----------------------|---------|----------|---------|---------|----
File                  | % Stmts | % Branch | % Funcs | % Lines |
----------------------|---------|----------|---------|---------|----
All files             |   91.23 |    85.78 |   93.84 |   91.23 |
 src                  |   88.27 |    86.18 |    90.9 |   88.27 |
 src/protocol         |   90.52 |     80.5 |   92.85 |   90.52 |
 src/transport        |     100 |    93.33 |     100 |     100 |
 src/transport/zeromq |   93.55 |    92.16 |   97.87 |   93.55 |
----------------------|---------|----------|---------|---------|----
```

### Run Tests WITHOUT Coverage (Faster)
```bash
npm run test:no-coverage
```

### Generate HTML Coverage Report
```bash
npm run test:coverage:html
```

Then open `coverage/index.html` in your browser.

---

## Coverage Report Locations

### 1. Terminal Output
- Displayed automatically after each `npm test` run
- Shows summary table with percentages

### 2. HTML Report (Interactive)
- **Location**: `coverage/index.html`
- **Open**: `open coverage/index.html` (Mac) or `xdg-open coverage/index.html` (Linux)
- **Features**:
  - Color-coded line-by-line coverage
  - Clickable file navigation
  - Detailed branch coverage
  - Untested code highlighting

### 3. LCOV Report (CI/CD Integration)
- **Location**: `coverage/lcov.info`
- **Use with**: Codecov, Coveralls, SonarQube, etc.

---

## Current Coverage Status

### Excellent Coverage (>90%)
- ✅ **node.js** - 93.27%
- ✅ **server.js** - 95.84%
- ✅ **config.js** - 100%
- ✅ **utils.js** - 100%
- ✅ **peer.js** - 100%
- ✅ **dealer.js** - 100%
- ✅ **context.js** - 100%
- ✅ **errors.js** (transport) - 100%
- ✅ **events.js** - 100%

### Good Coverage (85-90%)
- ⚠️ **client.js** - 84.59%
- ⚠️ **envelope.js** - 88.35%

### Needs Attention
- ❌ **src/errors.js** - 0% (not imported/used anywhere)
- ❌ **src/index.js** - 0% (entry point, tested via integration)

---

## Why C8 is Better than NYC

### Technical Advantages
1. **Native V8 Coverage**: Uses V8's built-in coverage instead of instrumentation
2. **Faster**: No code transformation overhead
3. **More Accurate**: Directly measures what's executed, not what's instrumented
4. **Modern**: Actively maintained by Node.js ecosystem
5. **Better Source Map Support**: Works seamlessly with Babel/TypeScript

### Configuration Simplicity
- **Before (NYC)**: Required `babel-plugin-istanbul` + complex Babel env setup
- **After (C8)**: Works out-of-the-box with inline source maps

### Performance
- **NYC**: ~55-60s test runs (with instrumentation overhead)
- **C8**: ~52-53s test runs (native coverage)

---

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run tests with coverage
  run: npm test

- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
    flags: unittests
```

### Coverage Badge (README.md)
```markdown
[![Coverage](https://codecov.io/gh/sfast/zeronode/branch/main/graph/badge.svg)](https://codecov.io/gh/sfast/zeronode)
```

---

## Troubleshooting

### Coverage shows 0%
**Solution**: Ensure source maps are enabled:
```json
// .babelrc
{
  "sourceMaps": "inline",
  "retainLines": true
}
```

### Coverage missing for specific files
**Check**: File might be in `exclude` list in `package.json` → `c8` config

### Tests fail with c8 but pass without
**Cause**: Timing/cleanup issues exposed by coverage overhead
**Solution**: Add proper cleanup in `afterEach` hooks (already fixed)

---

## Migration Date
- **Date**: November 10, 2025
- **Packages Removed**: nyc, babel-plugin-istanbul
- **Packages Added**: c8@10.1.3
- **Test Suite**: ✅ All 483 tests passing
- **Coverage**: ✅ 91.23% (target: 80%)

