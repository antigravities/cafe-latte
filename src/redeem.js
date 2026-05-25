import { google } from 'googleapis';
import { getAuthenticatedClient } from './gdrive.js';
import { getAccessToken, getSteamId } from './steam.js';
import { findAppId } from './applist.js';

const OWNED_GAMES_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/';

/**
 * Fetches all app IDs currently owned by the logged-in Steam account.
 * Includes free-to-play games so that F2P titles with DLC keys aren't re-activated.
 *
 * @param {string} accessToken - Steam Web API access token
 * @param {string} steamId - 64-bit SteamID string
 * @returns {Promise<Set<number>>}
 */
async function getOwnedAppIds(accessToken, steamId) {
  const params = new URLSearchParams({
    access_token: accessToken,
    steamid: steamId,
    include_appinfo: '0',
    include_played_free_games: '1',
  });

  const res = await fetch(`${OWNED_GAMES_URL}?${params}`);
  if (!res.ok) throw new Error(`GetOwnedGames failed: HTTP ${res.status}`);

  const data = await res.json();
  const games = data?.response?.games ?? [];
  return new Set(games.map(g => g.appid));
}

/**
 * Fetches the Google Sheets internal sheetId for the first tab of a spreadsheet.
 * The sheetId is needed for cell formatting requests and is NOT the same as the
 * spreadsheet's Drive file ID. It defaults to 0 for the first tab of a new sheet,
 * but can differ if tabs have been reordered or deleted.
 *
 * @param {import('googleapis').sheets_v4.Sheets} sheetsApi
 * @param {string} spreadsheetId
 * @returns {Promise<number>}
 */
async function getFirstSheetId(sheetsApi, spreadsheetId) {
  const res = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,index)',
  });

  const sheets = res.data.sheets ?? [];
  // Sort by index to be safe and return the first tab's sheetId
  sheets.sort((a, b) => a.properties.index - b.properties.index);
  return sheets[0]?.properties?.sheetId ?? 0;
}

/**
 * Writes the activation status text to a single row's column C, then applies a
 * background color to the entire row. Two separate API calls are used so that any
 * partial failure leaves the status text written (the more important update).
 *
 * @param {import('googleapis').sheets_v4.Sheets} sheetsApi
 * @param {string} spreadsheetId
 * @param {number} sheetId - internal Google Sheets tab ID
 * @param {number} rowIndex - 0-based row index (0 = header, 1 = first data row)
 * @param {string} statusText - value to write into column C
 * @param {{ red: number, green: number, blue: number }} color - RGB floats 0–1
 */
async function writeRowResult(sheetsApi, spreadsheetId, sheetId, rowIndex, statusText, color) {
  // Write status text to column C (1-indexed row number for A1 notation)
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `C${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[statusText]] },
  });

  // Apply background color to the full row
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: color,
            },
          },
          fields: 'userEnteredFormat.backgroundColor',
        },
      }],
    },
  });
}

// Light blue: visually distinct from green (redemption success) and red (failure)
const COLOR_ALREADY_OWNED = { red: 0.678, green: 0.847, blue: 0.902 };

/**
 * Runs one pass over the selected spreadsheet. For every row with a blank activation
 * status (column C), it:
 *
 *   1. Resolves the game name (column A) to a Steam appID via the app catalog.
 *   2. Checks whether that appID is in the user's owned-games list (fetched once and
 *      cached for the duration of this pass).
 *   3. If owned: writes "Already in library [appid, name]" and applies a light-blue
 *      highlight immediately — progress is preserved if the pass is interrupted.
 *   4. If not owned or app not found: no-op for now (key activation will be added here).
 *
 * @param {import('electron-store').default} store
 * @returns {Promise<{ checked: number, markedOwned: number }>}
 */
async function runRedemptionPass(store) {
  const spreadsheet = store.get('selectedSpreadsheet');
  if (!spreadsheet) throw new Error('NoSpreadsheetSelected');

  const auth = getAuthenticatedClient(store);
  if (!auth) throw new Error('NotConnected');

  const accessToken = getAccessToken();
  const steamId = getSteamId();
  if (!accessToken || !steamId) throw new Error('NotLoggedIn');

  const sheetsApi = google.sheets({ version: 'v4', auth });

  // Fetch sheet metadata and row data in parallel
  const [sheetId, rowsRes] = await Promise.all([
    getFirstSheetId(sheetsApi, spreadsheet.id),
    sheetsApi.spreadsheets.values.get({ spreadsheetId: spreadsheet.id, range: 'A:C' }),
  ]);

  const allRows = rowsRes.data.values ?? [];
  // Row 0 is the header; data rows start at index 1 (matching their 1-based sheet row numbers)
  const dataRows = allRows.slice(1);

  const ownedAppIds = await getOwnedAppIds(accessToken, steamId.toString());

  let checked = 0;
  let markedOwned = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const gameName = row[0]?.trim();
    const status = row[2]?.trim();

    if (!gameName || status) continue; // no game name, or already processed
    checked++;

    const rowIndex = i + 1; // offset by 1 to skip the header row

    const match = await findAppId(accessToken, gameName);

    if (match && ownedAppIds.has(match.appid)) {
      const statusText = `Already in library [${match.appid}, ${match.matchedName}]`;
      await writeRowResult(sheetsApi, spreadsheet.id, sheetId, rowIndex, statusText, COLOR_ALREADY_OWNED);
      markedOwned++;
      continue;
    }

    // TODO: attempt key activation for unowned games
  }

  return { checked, markedOwned };
}

/**
 * Registers the redemption IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {import('electron-store').default} store
 */
export function registerHandlers(ipcMain, store) {
  /**
   * Runs a full redemption pass over the selected spreadsheet.
   * Returns { success: true, checked, markedOwned } or { success: false, reason }.
   */
  ipcMain.handle('redemption:run', async () => {
    try {
      const result = await runRedemptionPass(store);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });
}
