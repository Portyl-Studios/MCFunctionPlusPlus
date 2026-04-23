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

### App Requirement: Java

MCFunction++ now requires Java at runtime for automatic Minecraft data preparation.

- Java must be installed and available in your system `PATH`.
- If Java is missing or too old, Minecraft version preparation will fail in-app.
- Installing a modern Java runtime (recommended: Java 25+) is strongly suggested.

### How to Use It

1. Install Java and ensure `java` is available in `PATH`.
2. Install the Windows desktop app from the latest GitHub release, or run it from source.
3. Open or create a datapack workspace.
4. Author datapack files, use validation feedback, and package for release.
5. Receive update checks once per app launch when using packaged desktop builds.

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

The `.github/workflows/desktop-release-pipeline.yml` workflow automates version bumping and release publishing on pushes to `main`:

- **Trigger**: Pushes to `main` by a non-bot actor
- **Version**: Reads `major.minor` from `package.json`; auto-computes patch from existing tags (`vMAJOR.MINOR.*`), ignoring user-provided patch
- **Bump**: Commits version bump to `package.json` if version changes, with `[skip ci]` to prevent re-triggering
- **Tag & Release**: Creates tag `vX.Y.Z` and GitHub Release
- **Assets**: Builds and publishes NSIS artifacts (`.exe`, `.exe.blockmap`, `latest.yml`) if any are missing
- **Safeguard**: Skips publish if all required assets exist for the target tag

### Tip: Push Without Triggering Release Workflows

Add `[skip ci]` to your commit message to prevent the workflow from running:
```bash
git commit -m "docs: update README [skip ci]"
git push
```

### How to Choose Your Major/Minor

Before pushing to `main`, set `package.json` version to the major/minor line you want, using patch `0` (example: `2.4.0`). The pipeline creates `v2.4.0` for the first release in that series, then `v2.4.1`, `v2.4.2`, etc. on subsequent pushes.

### Web Deployment (Firebase Hosting)

Web deployment is on the roadmap. It will only be implemented once the main application is fully featured.

### Minecraft Source Files

Minecraft command/schema data is now prepared automatically by the desktop app.

- On startup (and when the selected datapack Minecraft version changes), MCFunction++ checks a local cache first.
- If the requested version is missing, the app downloads the official `server.jar` metadata source, runs report generation, and builds the required cache files automatically.
- Cached data is stored under the app user data directory in `Minecraft Data Cache/<mc_version>`.
- Progress and errors are surfaced in-app during bootstrap/refresh.

### Minecraft Source Files (Legacy Manual Process)

Use this only for manual verification, debugging, or if you want to inspect raw Mojang report output yourself.

1. Download the target `server.jar` from [Minecraft Server Downloads](https://www.minecraft.net/en-us/download/server).
2. Run `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`.
3. Inspect output in `generated/reports/`.

Note: MCFunction++ no longer requires you to manually place generated reports into `resources/minecraft/<mc_version>` for normal usage.

### License

GPLv3 (General Public License)
Any derived works must also be open-source and licensed under GPLv3.

Support the project by contributing!

---