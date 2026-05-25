import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import ElectronStore from 'electron-store';
import { registerHandlers as registerSteamHandlers, getAccessToken } from './steam.js';
import { registerHandlers as registerGdriveHandlers } from './gdrive.js';
import { registerHandlers as registerSheetsHandlers } from './sheets.js';
import { registerHandlers as registerRedeemHandlers } from './redeem.js';
import { findAppId } from './applist.js';

const store = new ElectronStore();

// workaround for __dirname in ES modules
const __dirname = path.dirname(new URL(import.meta.url).pathname).split("/").slice(1).join("/");

registerSteamHandlers(ipcMain, store);
registerGdriveHandlers(ipcMain, store);
registerSheetsHandlers(ipcMain, store);
registerRedeemHandlers(ipcMain, store);

// TODO: remove after verifying app list lookup works
ipcMain.handle('debug:applist', async (_e, name) => {
  const token = getAccessToken();
  if (!token) return { error: 'not logged in' };
  const result = await findAppId(token, name);
  return result
    ? { name, appid: result.appid, matchedName: result.matchedName, exact: result.exact }
    : { name, appid: null };
});

// Remove Electron's default menu bar (File, Edit, View, etc.)
Menu.setApplicationMenu(null);

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

  // Hide to tray on close instead of quitting; app.isQuitting is set by the tray Quit action
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'icon.ico'));
  const tray = new Tray(icon);
  tray.setToolTip('Café Latte');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  // Double-click the tray icon to restore the window
  tray.on('double-click', () => { win.show(); win.focus(); });

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    // On macOS, re-show the window rather than creating a new one
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) existing.show();
    else createWindow();
  });
});

// Prevent the app from quitting when the last window is closed (tray keeps it alive)
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit();
});
