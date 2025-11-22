# 📦 ZeroNode - NPM Publishing Guide

## ✅ **Quick Publishing Checklist**

### **1. Pre-Publishing Verification** ✓

```bash
# Run all tests
npm test

# Check what will be published
npm pack --dry-run

# Verify key files are included:
# ✅ index.d.ts (20.5kB)
# ✅ dist/ folder (all compiled files)
# ✅ README.md, LICENSE, CHANGELOG.md
```

---

### **2. Version Bump**

```bash
# Patch version (2.0.1 → 2.0.2) - for bug fixes
npm version patch

# Minor version (2.0.1 → 2.1.0) - for new features
npm version minor

# Major version (2.0.1 → 3.0.0) - for breaking changes
npm version major
```

This will:
- ✅ Update `package.json` version
- ✅ Create a git commit
- ✅ Create a git tag

---

### **3. Publish to NPM**

```bash
# Login to NPM (first time only)
npm login

# Publish the package
npm publish

# Or for scoped packages
npm publish --access public
```

---

## 🔍 **What Gets Published (Verified)**

### **✅ Included Files:**
```
zeronode@2.0.1
├── index.d.ts              ← 20.5kB (TypeScript definitions)
├── dist/                   ← All compiled JavaScript
│   ├── index.js
│   ├── node.js
│   ├── protocol/
│   └── transport/
├── package.json
├── README.md
├── CHANGELOG.md
└── LICENSE
```

### **❌ Excluded Files (via .npmignore):**
```
✗ src/                 ← Source code
✗ test/                ← Test files
✗ docs/                ← Documentation
✗ examples/            ← Example files
✗ benchmark/           ← Benchmark scripts
✗ coverage/            ← Coverage reports
✗ cursor_docs/         ← Cursor documentation
```

---

## 📋 **Step-by-Step Publishing Process**

### **Complete Flow:**

```bash
# 1. Ensure you're on main/master branch
git checkout main
git pull origin main

# 2. Run all tests
npm test
# ✅ Expected: 699 tests passing, 96.33% coverage

# 3. Update CHANGELOG.md (manually)
# Add your changes under a new version section

# 4. Commit any pending changes
git add .
git commit -m "chore: prepare for release"

# 5. Bump version (choose one)
npm version patch    # 2.0.1 → 2.0.2
# or
npm version minor    # 2.0.1 → 2.1.0
# or
npm version major    # 2.0.1 → 3.0.0

# This automatically:
# - Updates package.json
# - Creates git commit "2.0.2"
# - Creates git tag "v2.0.2"

# 6. Push to GitHub (tags AND commits)
git push origin main --follow-tags

# 7. Verify package contents (optional but recommended)
npm pack --dry-run

# 8. Login to NPM (if not already logged in)
npm whoami
# If not logged in:
npm login

# 9. Publish to NPM
npm publish

# 10. Verify published package
npm view zeronode
```

---

## 🎯 **Important Notes**

### **The `prepare` Script Runs Automatically:**

Your `package.json` has:
```json
{
  "scripts": {
    "prepare": "npm run build && npm run snyk-protect"
  }
}
```

**This means:**
- ✅ `npm publish` automatically runs `prepare`
- ✅ `prepare` runs `build` (compiles `src/` → `dist/`)
- ✅ Fresh build before every publish
- ✅ No manual build step needed

---

## ⚠️ **Common Pitfalls to Avoid**

### **1. Don't Forget to Update CHANGELOG.md**
```bash
# Before version bump, update:
vim CHANGELOG.md

## [2.0.2] - 2024-XX-XX
### Fixed
- Fixed TypeScript definitions for event payloads
```

### **2. Don't Publish Without Testing**
```bash
# Always run tests first!
npm test
# ✅ 699 passing
```

### **3. Don't Forget to Push Tags**
```bash
# This publishes to GitHub:
git push origin main --follow-tags

# Without --follow-tags, version tags won't be on GitHub!
```

### **4. Verify Package Size**
```bash
npm pack --dry-run

# Should be around ~1-2 MB
# If much larger, check .npmignore
```

---

## 🔐 **NPM Account Setup (First Time)**

### **1. Create NPM Account**
```bash
# Go to https://www.npmjs.com/signup
# or
npm adduser
```

### **2. Verify Email**
```bash
# NPM will send verification email
# Click the link to verify
```

### **3. Enable 2FA (Recommended)**
```bash
npm profile enable-2fa auth-and-writes

# Or via web: https://www.npmjs.com/settings/YOUR_USERNAME/tfa
```

### **4. Login**
```bash
npm login

# Enter:
# - Username
# - Password
# - Email
# - 2FA code (if enabled)
```

---

## 📊 **Post-Publishing Verification**

### **1. Check NPM Registry**
```bash
# View published version
npm view zeronode

# Check latest version
npm view zeronode version

# Download and inspect
npm pack zeronode
tar -xzf zeronode-2.0.2.tgz
ls -la package/
```

### **2. Test Installation**
```bash
# Create test directory
mkdir test-install
cd test-install
npm init -y

# Install your package
npm install zeronode

# Verify TypeScript types work
cat > test.ts << 'EOF'
import Node from 'zeronode';

const node = new Node({ id: 'test' });
node.bind('tcp://0.0.0.0:5000');
EOF

# Check if types are detected
npx tsc --noEmit test.ts
```

### **3. Check GitHub Release**
```bash
# Create GitHub release from tag (optional)
# Go to: https://github.com/sfast/zeronode/releases/new
# Select tag: v2.0.2
# Copy CHANGELOG.md content
# Publish release
```

---

## 🚀 **Quick Publish Command**

For experienced maintainers:

```bash
# One-liner (patch release)
npm test && npm version patch && git push origin main --follow-tags && npm publish

# Or create an alias in package.json:
{
  "scripts": {
    "release:patch": "npm test && npm version patch && git push origin main --follow-tags && npm publish",
    "release:minor": "npm test && npm version minor && git push origin main --follow-tags && npm publish",
    "release:major": "npm test && npm version major && git push origin main --follow-tags && npm publish"
  }
}

# Then use:
npm run release:patch
```

---

## 📝 **Example Publishing Session**

```bash
$ cd /path/to/zeronode

$ npm test
✅ 699 tests passing

$ vim CHANGELOG.md
# Add changes...

$ git add CHANGELOG.md
$ git commit -m "chore: update changelog"

$ npm version patch
v2.0.2

$ git push origin main --follow-tags

$ npm publish
+ zeronode@2.0.2

$ npm view zeronode version
2.0.2

✅ Published successfully!
```

---

## 🎯 **Summary**

### **To Publish ZeroNode:**

1. ✅ Run tests: `npm test`
2. ✅ Update CHANGELOG.md
3. ✅ Bump version: `npm version patch|minor|major`
4. ✅ Push to GitHub: `git push origin main --follow-tags`
5. ✅ Publish to NPM: `npm publish`

### **Your Package Includes:**
- ✅ `index.d.ts` (TypeScript definitions) - 20.5kB
- ✅ `dist/` (Compiled JavaScript)
- ✅ `README.md`, `LICENSE`, `CHANGELOG.md`

### **Automatic Build:**
- ✅ `prepare` script runs before publish
- ✅ Compiles `src/` → `dist/` automatically
- ✅ No manual build needed

**You're ready to publish! 🚀**

