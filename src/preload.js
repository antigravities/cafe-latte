const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  version: '0.0.1',

  // Steam authentication

  // Log in to Steam. Idempotent - can be called with different credentials to log in to a different account
  // window.api.steamLogin({ accountName, password, twoFactorCode, authCode })
  steamLogin: (credentials) => ipcRenderer.invoke('steam:login', credentials),
  
  // Submit a SteamGuard code in response to a login attempt that requires it
  // window.api.steamSubmitSteamGuard(code)
  steamSubmitSteamGuard: (code) => ipcRenderer.invoke('steam:submit-steam-guard', { code }),

  // Returns { accountName } if a valid saved refresh token exists, otherwise null
  // window.api.getSavedAccount()
  getSavedAccount: () => ipcRenderer.invoke('steam:get-saved-account'),

  // Logs in using the stored refresh token (no password needed)
  // window.api.steamLoginWithToken()
  steamLoginWithToken: () => ipcRenderer.invoke('steam:login-with-token'),

  // Clears the stored refresh token (logout / switch account)
  // window.api.steamClearSavedAccount()
  steamClearSavedAccount: () => ipcRenderer.invoke('steam:clear-saved-account'),

  // Google Drive / Sheets authentication

  // Saves OAuth 2.0 client credentials (one-time setup).
  // window.api.gdriveSetCredentials({ clientId, clientSecret })
  gdriveSetCredentials: (creds) => ipcRenderer.invoke('gdrive:set-credentials', creds),

  // Opens the system browser for Google OAuth consent and waits for completion (up to 5 min).
  // window.api.gdriveStartAuth()
  gdriveStartAuth: () => ipcRenderer.invoke('gdrive:start-auth'),

  // Returns { connected: true } if valid tokens are stored, otherwise null.
  // window.api.gdriveGetSavedAccount()
  gdriveGetSavedAccount: () => ipcRenderer.invoke('gdrive:get-saved-account'),

  // Clears stored Google OAuth tokens (disconnect).
  // window.api.gdriveLogout()
  gdriveLogout: () => ipcRenderer.invoke('gdrive:logout'),

  // Spreadsheet selection

  // Returns { success: true, sheets: [{ id, name }, ...] } sorted by name, or { success: false, reason }
  // window.api.listSpreadsheets()
  listSpreadsheets: () => ipcRenderer.invoke('sheets:list-spreadsheets'),

  // Persists the selected spreadsheet. window.api.selectSpreadsheet({ id, name })
  selectSpreadsheet: (sheet) => ipcRenderer.invoke('sheets:select-spreadsheet', sheet),

  // Returns { id, name } of the previously selected spreadsheet, or null.
  // window.api.getSelectedSpreadsheet()
  getSelectedSpreadsheet: () => ipcRenderer.invoke('sheets:get-selected-spreadsheet'),

  // Returns { success: true, totalRows, pendingRows } or { success: false, reason }.
  // Pass force=true to bypass the 15-minute cache and hit the Sheets API directly.
  // window.api.getSheetStats(force?)
  getSheetStats: (force = false) => ipcRenderer.invoke('sheets:get-stats', { force }),

  // TODO: remove after verifying app list lookup - returns { name, appid } or { error }
  // window.api.debugAppList('Hades')
  debugAppList: (name) => ipcRenderer.invoke('debug:applist', name),

  // Runs a full redemption pass over the selected spreadsheet.
  // Checks each pending row for library ownership, then attempts key activation for unowned rows.
  // Returns { success: true, checked, markedOwned, activated, failed } or { success: false, reason }.
  // window.api.runRedemptionPass()
  runRedemptionPass: () => ipcRenderer.invoke('redemption:run'),
});
