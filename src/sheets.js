import { google } from 'googleapis';
import { getAuthenticatedClient } from './gdrive.js';

/**
 * Lists all Google Sheets spreadsheets accessible to the authenticated user.
 * Pages through Drive API results to handle accounts with many files.
 * @param {import('electron-store').default} store
 * @returns {Promise<Array<{id: string, name: string}>>} sorted by name ascending
 */
async function listSpreadsheets(store) {
  const auth = getAuthenticatedClient(store);
  if (!auth) throw new Error('NotConnected');

  const drive = google.drive({ version: 'v3', auth });
  const files = [];
  let pageToken;

  do {
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'nextPageToken, files(id, name)',
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Registers all Sheets-related IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {import('electron-store').default} store
 */
export function registerHandlers(ipcMain, store) {
  /**
   * Returns all Google Sheets spreadsheets in the user's Drive, sorted by name.
   * Requires gdrive OAuth to be completed first.
   * Returns [{ id, name }, ...]
   */
  ipcMain.handle('sheets:list-spreadsheets', async () => {
    try {
      const sheets = await listSpreadsheets(store);
      return { success: true, sheets };
    } catch (err) {
      if (err.message === 'NotConnected') {
        return { success: false, reason: 'NotConnected — complete Google Drive auth first' };
      }
      return { success: false, reason: err.message };
    }
  });

  /**
   * Persists the user's chosen spreadsheet ({ id, name }) to the store.
   * Called when the user picks a spreadsheet in the UI.
   */
  ipcMain.handle('sheets:select-spreadsheet', (_event, { id, name }) => {
    if (!id || !name) {
      return { success: false, reason: 'Missing id or name' };
    }
    store.set('selectedSpreadsheet', { id, name });
    return { success: true };
  });

  /**
   * Returns the previously selected spreadsheet { id, name }, or null if none selected.
   */
  ipcMain.handle('sheets:get-selected-spreadsheet', () => {
    return store.get('selectedSpreadsheet') ?? null;
  });
}
