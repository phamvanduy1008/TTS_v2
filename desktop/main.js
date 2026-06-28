import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiServer } from '../server/api-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const localApiBase = 'http://127.0.0.1:3030';

let mainWindow = null;
let localApi = null;
let usesExternalApi = false;

async function healthCheck() {
  try {
    const response = await fetch(`${localApiBase}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startLocalApi() {
  if (await healthCheck()) {
    usesExternalApi = true;
    return;
  }

  try {
    localApi = await createApiServer({ host: '127.0.0.1', port: 3030 });
    await localApi.start();
  } catch (error) {
    if (error?.code === 'EADDRINUSE' && await healthCheck()) {
      localApi = null;
      usesExternalApi = true;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'Cannot start local TTS server',
      `Desktop app needs ${localApiBase}, but the server could not start.\n\n${message}`,
    );
    app.quit();
  }
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#f8f5ef',
    height: 900,
    minHeight: 720,
    minWidth: 1100,
    show: false,
    title: 'Local TTS Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: 1280,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await startLocalApi();
    await createMainWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on('before-quit', async (event) => {
  if (!localApi || usesExternalApi) {
    return;
  }

  event.preventDefault();
  const api = localApi;
  localApi = null;

  try {
    await api.stop();
  } finally {
    app.exit(0);
  }
});
