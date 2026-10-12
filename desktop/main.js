import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiServer } from '../server/api-server.js';
import { loadLocalEnv } from '../server/env-loader.js';

await loadLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const instanceId = String(process.env.TTS_DESKTOP_INSTANCE_ID || 'main').trim() || 'main';
const inferenceBackend = String(process.env.TTS_INFERENCE_BACKEND || 'cpu').trim().toLowerCase() || 'cpu';
const localApiHost = process.env.TTS_LOCAL_HOST || '127.0.0.1';
const localApiPort = Number(process.env.TTS_LOCAL_PORT || 3030);
const localApiBase = `http://${localApiHost}:${localApiPort}`;

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
    localApi = await createApiServer({ host: localApiHost, port: localApiPort });
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
    title: instanceId === 'main'
      ? `Local TTS Studio (${inferenceBackend})`
      : `Local TTS Studio ${instanceId} (${inferenceBackend}, ${localApiPort})`,
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
    const url = new URL(devServerUrl);
    url.searchParams.set('ttsApiHost', localApiHost);
    url.searchParams.set('ttsApiPort', String(localApiPort));
    url.searchParams.set('ttsInferenceBackend', inferenceBackend);
    url.searchParams.set('ttsInstanceId', instanceId);
    await mainWindow.loadURL(url.toString());
  } else {
    await mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'), {
      query: {
        ttsApiHost: localApiHost,
        ttsApiPort: String(localApiPort),
        ttsInferenceBackend: inferenceBackend,
        ttsInstanceId: instanceId,
      },
    });
  }
}

if (instanceId !== 'main') {
  const defaultUserData = app.getPath('userData');
  app.setPath('userData', path.join(path.dirname(defaultUserData), `${path.basename(defaultUserData)}-${instanceId}`));
}

const gotLock = app.requestSingleInstanceLock({ instanceId, localApiPort });
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
