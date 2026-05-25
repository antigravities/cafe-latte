import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import ElectronStore from 'electron-store';
import { registerHandlers as registerSteamHandlers } from './steam.js';
import { registerHandlers as registerGdriveHandlers } from './gdrive.js';

const store = new ElectronStore();

// workaround for __dirname in ES modules
const __dirname = path.dirname(new URL(import.meta.url).pathname).split("/").slice(1).join("/");

registerSteamHandlers(ipcMain, store);
registerGdriveHandlers(ipcMain, store);

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
