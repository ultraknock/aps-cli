---
name: install-aps-cli
description: Use this skill when installing the APS CLI from source.
---

# Install APS CLI

## 1. Check Dependencies

Run each check in order. If a dependency is missing, follow the fix before continuing.

### Node.js 22+
```bash
node --version
```
Version must start with `v22` or higher. If not installed or outdated, download from [nodejs.org](https://nodejs.org/).

### Git
```bash
git --version
```
If missing, install via your OS package manager:
- **Linux**: `sudo apt install git` (Debian/Ubuntu) or `sudo dnf install git` (Fedora)
- **macOS**: `xcode-select --install`
- **Windows**: [git-scm.com](https://git-scm.com/)

### npm
```bash
npm --version
```
npm ships with Node.js. If missing, reinstall Node.js.

### TypeScript Compiler (global)
```bash
tsc --version
```
If not found, install globally:
```bash
npm install -g typescript
```

---

## 2. Install

Clone the repository to an OS-appropriate location.

### Linux / macOS
```bash
git clone https://github.com/adskdimitrii/aps-cli.git ~/.local/share/aps-cli
cd ~/.local/share/aps-cli
```

### Windows (PowerShell)
```powershell
git clone https://github.com/adskdimitrii/aps-cli.git "$env:LOCALAPPDATA\aps-cli"
cd "$env:LOCALAPPDATA\aps-cli"
```

### Build

From inside the cloned directory, run:

```bash
git clone https://github.com/adskdimitrii/aps-ai-friendly-docs docs
npm install
npm run build
```

> The docs clone is required — the build step copies AEC Data Model docs into the output directory.

### Verify
```bash
node ./dist/index.js --help
```

---

## 3. Get Latest Changes

From the install directory, pull the latest code and rebuild:

### Linux / macOS
```bash
cd ~/.local/share/aps-cli
git pull
npm install
npm run build
```

### Windows (PowerShell)
```powershell
cd "$env:LOCALAPPDATA\aps-cli"
git pull
npm install
npm run build
```
