# MCFunctionPlusPlus

MCFunction++ is a Minecraft datapack IDE + build system, split into desktop + web, with a shared core.

## Who is MCFunction++ For?
MCFunction++ is ideal for both new and experienced developers who want to get into Minecraft datapack programming.

---

## Key Features
- Work in progress

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) (comes with Node.js)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/touchportyl/MCFunctionPlusPlus.git
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

### Building

Compile TypeScript and build the React application:
```bash
npm run build
```

This will:
1. Compile TypeScript files from `src/main/` to `out/main/`
2. Bundle the React application from `src/renderer/` to `out/renderer/`

### Running

Launch the Electron application:
```bash
npm start
```

Or build and run in one command:
```bash
npm run electron
```

### Building Distributable

Create a distributable executable for Windows:
```bash
npm run dist:win
```

This will create an installer and portable executable in the `release/` folder.

**Other platforms:**
- macOS: `npm run dist:mac` (DMG and ZIP)
- Linux: `npm run dist:linux` (AppImage and DEB)
- All platforms: `npm run dist`

---

## Web Deployment (Firebase Hosting)

The React renderer can also be deployed as a standalone web app using Firebase Hosting.

### Prerequisites
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
- Firebase project (configured in `.firebaserc`)

### Deploy to Firebase

1. Build the application:
   ```bash
   npm run build
   ```

2. Deploy to Firebase Hosting:
   ```bash
   firebase deploy
   ```

The built React app from `out/renderer/` will be deployed to your Firebase hosting URL.

---

## License
GPLv3 (General Public License)
Any derived works must also be open-source and licensed under GPLv3.

Support the project by contributing!

---