import { Notification } from 'electron';
import { google } from 'googleapis';
import SteamUser from 'steam-user';
import { getAuthenticatedClient } from './gdrive.js';
import { getAccessToken, getSteamId, activateKey } from './steam.js';
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
    skip_unvetted_apps: '0',
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
const COLOR_SUCCESS        = { red: 0.714, green: 0.843, blue: 0.659 }; // soft green
const COLOR_FAILURE        = { red: 0.918, green: 0.600, blue: 0.600 }; // soft red

// How long to wait after hitting a Steam rate limit before attempting another activation.
// Steam's actual window is ~1 hour; we add 2 minutes of buffer to be safe.
const RATE_LIMIT_COOLDOWN_MS = 62 * 60 * 1000;

/**
 * Runs one pass over the selected spreadsheet. For every row with a blank activation
 * status (column C), it:
 *
 *   1. Resolves the game name (column A) to a Steam appID via the app catalog.
 *   2. Checks whether that appID is in the user's owned-games list (fetched once and
 *      cached for the duration of this pass).
 *   3. If owned: writes "Already in library [appid, name]" with a light-blue highlight.
 *   4. If not owned (or app not found in catalog) and not in rate-limit cooldown:
 *      attempts to activate the key (column B).
 *      - Success → green row, "Success [pkgId, pkgName]"
 *      - RateLimitExceeded → desktop notification, loop stops (timestamp saved, next
 *        pass will skip activation until 62 minutes have elapsed)
 *      - Any other Steam error → red row, "ErrorName [pkgId, pkgName]", desktop notification
 *
 * Progress is written to the sheet immediately so a crash or interruption preserves work.
 *
 * @param {import('electron-store').default} store
 * @returns {Promise<{ checked: number, markedOwned: number, activated: number, failed: number }>}
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

  // Check once at the start of the pass so ownership checks still run during cooldown
  const lastAttempt = store.get('lastRedemptionAttempt', 0);
  let inCooldown = Date.now() - lastAttempt < RATE_LIMIT_COOLDOWN_MS;

  let checked = 0;
  let markedOwned = 0;
  let activated = 0;
  let failed = 0;

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

    // Skip activation if in rate-limit cooldown but still count ownership checks above
    const key = row[1]?.trim();
    if (!key || inCooldown) continue;

    const { eresult, eresultName, packageList } = await activateKey(key);
    const [pkgId, pkgName] = Object.entries(packageList)[0] ?? [null, null];

    if (eresult === SteamUser.EResult.OK) {
      const statusText = pkgId ? `Success [${pkgId}, ${pkgName}]` : 'Success';
      await writeRowResult(sheetsApi, spreadsheet.id, sheetId, rowIndex, statusText, COLOR_SUCCESS);
      activated++;
    } else if (eresultName === 'RateLimited') {
      // Save timestamp and flip inCooldown so remaining rows still get ownership-checked
      // but no further activation is attempted in this pass
      store.set('lastRedemptionAttempt', Date.now());
      new Notification({
        title: 'Café Latte — Rate Limited',
        body: `Steam rate limit hit on "${gameName}". Resuming in ~62 minutes.`,
      }).show();
      inCooldown = true;
      continue;
    } else {
      const statusText = pkgId ? `${eresultName} [${pkgId}, ${pkgName}]` : eresultName;
      await writeRowResult(sheetsApi, spreadsheet.id, sheetId, rowIndex, statusText, COLOR_FAILURE);
      new Notification({
        title: `Café Latte — ${eresultName}`,
        body: `Could not redeem "${gameName}": ${eresultName}`,
      }).show();
      failed++;
    }
  }

  return { checked, markedOwned, activated, failed };
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
