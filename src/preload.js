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
});
