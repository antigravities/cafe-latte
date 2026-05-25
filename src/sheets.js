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

const STATS_TTL_MS = 15 * 60 * 1000;
/** @type {{ spreadsheetId: string, totalRows: number, pendingRows: number, fetchedAt: number } | null} */
let statsCache = null;

/**
 * Reads the selected spreadsheet and returns row counts for the dashboard.
 * Skips fully blank rows and the header row (row 0).
 * @param {import('electron-store').default} store
 * @returns {Promise<{ totalRows: number, pendingRows: number }>}
 *   totalRows  — rows where at least one of columns A/B/C has content
 *   pendingRows — subset of totalRows where column C (activation status) is blank
 */
async function getSheetStats(store) {
  const spreadsheet = store.get('selectedSpreadsheet');
  if (!spreadsheet) throw new Error('NoSpreadsheetSelected');

  const auth = getAuthenticatedClient(store);
  if (!auth) throw new Error('NotConnected');

  const sheetsApi = google.sheets({ version: 'v4', auth });
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: spreadsheet.id,
    range: 'A:C',
  });

  // Drop header row, then keep only rows with at least one non-empty cell
  const rows = (res.data.values ?? []).slice(1);
  const dataRows = rows.filter(row => row.some(cell => cell?.trim() !== ''));

  const totalRows = dataRows.length;
  // Column C is index 2; missing or empty string means not yet redeemed
  const pendingRows = dataRows.filter(row => !row[2]?.trim()).length;

  return { totalRows, pendingRows };
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
    statsCache = null; // invalidate cached counts for the old sheet
    return { success: true };
  });

  /**
   * Returns the previously selected spreadsheet { id, name }, or null if none selected.
   */
  ipcMain.handle('sheets:get-selected-spreadsheet', () => {
    return store.get('selectedSpreadsheet') ?? null;
  });

  /**
   * Returns { success: true, totalRows, pendingRows } for the selected spreadsheet.
   * totalRows  — non-blank data rows (header excluded)
   * pendingRows — rows with a blank activation status (column C)
   */
  ipcMain.handle('sheets:get-stats', async () => {
    try {
      const spreadsheet = store.get('selectedSpreadsheet');
      if (!spreadsheet) throw new Error('NoSpreadsheetSelected');

      const cacheValid = statsCache &&
        statsCache.spreadsheetId === spreadsheet.id &&
        Date.now() - statsCache.fetchedAt < STATS_TTL_MS;

      if (cacheValid) {
        return { success: true, totalRows: statsCache.totalRows, pendingRows: statsCache.pendingRows };
      }

      const stats = await getSheetStats(store);
      statsCache = { spreadsheetId: spreadsheet.id, ...stats, fetchedAt: Date.now() };
      return { success: true, ...stats };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });
}
