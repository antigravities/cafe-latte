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
});
