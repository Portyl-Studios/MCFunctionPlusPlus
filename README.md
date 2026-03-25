# MCFunctionPlusPlus

MCFunction++ streamlines professional datapack workflows with a unified IDE for authoring, validation, and release-ready packaging.

## App Showcase And Usage

### Who is MCFunction++ For?
MCFunction++ is built for developers who want a faster, more reliable Minecraft datapack workflow.

- New datapack creators who need an approachable IDE with useful feedback while learning commands and structure.
- Experienced datapack developers who want stronger editing, validation, and packaging workflows for larger projects.
- Teams and collaborators who need a consistent toolchain for building and shipping datapacks across environments.
- Creators who want flexibility: a desktop app for full local workflows and a web app for lightweight access.

### What MCFunction++ Offers

- A unified environment for authoring, validating, and packaging datapacks.
- Desktop and web experiences built on a shared core workflow.
- Release-ready Windows installer distribution with auto-update support.

### How to Use It

1. Install the Windows desktop app from the latest GitHub release, or run it from source.
2. Open or create a datapack workspace.
3. Author datapack files, use validation feedback, and package for release.
4. Receive update checks once per app launch when using packaged desktop builds.

### Installing from GitHub Releases

1. Open the latest release in `Portyl-Studios/MCFunctionPlusPlus`.
2. Download the Windows installer file matching `mcfunctionplusplus-setup-<version>.exe`.
3. Run the installer and choose your installation directory.
4. Launch MCFunction++ after installation.

For normal installation, you only need the `mcfunctionplusplus-setup-<version>.exe` file.

### Desktop Auto-Update (NSIS)

Desktop auto-updates use `electron-builder` + `electron-updater` with GitHub Releases.

- Provider repo: `Portyl-Studios/MCFunctionPlusPlus`
- Windows update channel: NSIS artifacts + `latest.yml`
- Update check behavior: exactly once per app launch (no background polling until restart)

This behavior is implemented in the Electron main process and only runs in packaged builds.

### Windows Installer Format

Windows packaging is configured for NSIS installer only (no portable target).
Installer behavior allows users to choose install directory.

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [npm](https://www.npmjs.com/) (v10 or higher, comes with Node.js)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Portyl-Studios/MCFunctionPlusPlus.git
   cd MCFunctionPlusPlus
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Development Workflow

Start the development server with hot module replacement:
```bash
npm run dev
```

This will launch Vite's dev server with hot reload enabled. Edit files in `src/renderer/` and see changes instantly.

### Running Locally

Launch the Electron application:
```bash
npm start
```

Or build and run in one command:
```bash
npm run electron
```

### Building

Compile TypeScript and build the React application:
```bash
npm run build
```

This will:
1. Compile TypeScript files from `src/main/` to `out/main/`
2. Bundle the React application from `src/renderer/` to `out/renderer/`

### Testing

Run the unit/integration suite:
```bash
npm run test
```

Run with coverage gate (phase-1 target modules):
```bash
npm run test:coverage
```

Run Playwright E2E scaffolding:
```bash
npm run test:e2e
```

Run aggregate CI test command:
```bash
npm run test:ci
```

### Building Distributables

Create a distributable executable for Windows:
```bash
npm run dist:win
```

This will create an NSIS installer in the `release/` folder.

**Other platforms:**
- macOS: `npm run dist:mac` (DMG and ZIP)
- Linux: `npm run dist:linux` (AppImage and DEB)
- All platforms: `npm run dist`

### App Icon And Installer Art Assets

Required app icon files:

- Windows: `assets/icon.ico` (256x256 or multi-size ICO)
- macOS: `assets/icon.icns` (512x512@2x recommended)
- Linux: `assets/icon.png` (512x512 recommended)

Required NSIS installer art files:

- Installer header: `assets/installer-header.bmp` (150x57)
- Installer sidebar: `assets/installer-sidebar.bmp` (164x314)

You can generate icon formats from a single PNG using:

- https://www.icoconverter.com/
- https://cloudconvert.com/png-to-icns
- https://www.img2go.com/convert-to-icon

### Desktop CI/CD (Auto Version + Release)

Five GitHub Actions workflows are used:

1. `.github/workflows/desktop-test.yml`
   - Trigger: push and pull request on `main`
   - Action: runs `npm ci` and `npm run test:coverage`
   - Purpose: enforce baseline test + coverage gate before release packaging

2. `.github/workflows/desktop-auto-version-and-tag.yml`
   - Trigger: push to `main`
   - Action: reads `major.minor` from `package.json`, computes patch from existing tags (`vMAJOR.MINOR.*`), then sets `MAJOR.MINOR.NEXT_PATCH`
   - Behavior: patch resets to `0` automatically when you change major/minor to a new series
   - Behavior: if your pushed commit already has the exact target version (for example `2.1.0` when starting a new series), it only creates the tag and does not create an extra bump commit
3. `.github/workflows/desktop-build-and-publish-nsis.yml`
   - Trigger: push of `vX.Y.Z` tag, or successful `Desktop Auto Version And Tag` on `main`
   - Action: builds and publishes Windows NSIS installer artifacts to GitHub Releases (`--publish always`)
   - Safeguard: skips publish when installer assets already exist for the target tag
4. `.github/workflows/desktop-enforce-version-policy.yml`
   - Trigger: pull requests to `main` (and pushes to `main`)
   - Action: blocks manual patch edits for the same major/minor line, and enforces patch `0` when major/minor is changed manually
5. `.github/workflows/desktop-ensure-github-release.yml`
   - Trigger: automatic on successful `Desktop Auto Version And Tag` run for `main`
   - Action: creates or updates the GitHub Release for the tag created by version bumping
   - Reliability: uses the exact tag artifact exported by the versioning workflow to avoid tag-resolution race conditions

### Tip: Push Without Triggering Release Workflows

If you need to push changes to `main` without triggering CI/release workflows, include a skip token in your commit message:

```bash
git commit -m "docs: update README [skip ci]"
git push
```

`[skip ci]` (or `[ci skip]`) prevents push and pull-request workflows from running for that commit.
Note: if you push a version tag separately, tag-triggered release workflows can still run.

### Required Repository Setup

1. Ensure Actions permission allows write access to repository contents.
2. Ensure branch protection allows GitHub Actions to push version bump commits to `main`.
3. Add `Desktop Enforce Version Policy / prevent-manual-patch-bumps` as a required status check in branch protection for `main`.
4. No extra token is required for public-repo releases when using `${{ secrets.GITHUB_TOKEN }}`.
5. Optional (recommended for production): configure code-signing secrets and certs for trusted Windows installers.

### How to Choose Your Major/Minor

1. Before pushing to `main`, set `package.json` version to the major/minor line you want, using patch `0` (example: `2.4.0`).
2. Push to `main`.
3. The workflow creates `v2.4.0` for the first release in that series, then `v2.4.1`, `v2.4.2`, etc. on subsequent pushes.

### Automatic Release Creation Flow

1. Push to `main`.
2. `Desktop Auto Version And Tag` computes/creates the next tag (`vX.Y.Z`).
3. `Desktop Ensure GitHub Release` automatically creates or updates the GitHub Release for that tag.
4. `Desktop Build And Publish NSIS Installer` publishes installer assets for that tag.

### Web Deployment (Firebase Hosting)

The React renderer can also be deployed as a standalone web app using Firebase Hosting.

#### Prerequisites
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
- Firebase project (configured in `.firebaserc`)

#### Deploy to Firebase

1. Build the application:
   ```bash
   npm run build
   ```

2. Deploy to Firebase Hosting:
   ```bash
   firebase deploy
   ```

The built React app from `out/renderer/` will be deployed to your Firebase hosting URL.

### Minecraft Source Files

This project uses files extracted from the Minecraft `server.jar` file.

1. Download the latest version of the `server.jar` file from [here](https://www.minecraft.net/en-us/download/server)
2. Run `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`
3. The folder used is `/generated/reports/` stored in `/resources/minecraft/<mc_version>`

### License

GPLv3 (General Public License)
Any derived works must also be open-source and licensed under GPLv3.

Support the project by contributing!

---