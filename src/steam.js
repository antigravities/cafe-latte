import SteamUser from 'steam-user';

let client = new SteamUser();
let pendingSteamGuardCallback = null;
let pendingAccountName = null;

/**
 * Decodes a JWT refresh token (without verification) and returns the payload.
 * Steam refresh tokens are JWTs; we only need the exp claim to check expiry.
 * @param {string} token
 * @returns {object|null}
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // JWT segments use base64url encoding; Node's Buffer handles it via 'base64'
    // after replacing URL-safe chars
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Returns the stored Steam account if a valid (non-expired) refresh token exists.
 * Clears the store entry and returns null if the token is expired or unreadable.
 * @param {import('electron-store').default} store
 * @returns {{ accountName: string, refreshToken: string } | null}
 */
function getValidSavedAccount(store) {
  const saved = store.get('steamAccount');
  if (!saved) return null;

  const payload = decodeJwtPayload(saved.refreshToken);
  if (!payload || !payload.exp || Date.now() / 1000 > payload.exp) {
    store.delete('steamAccount');
    return null;
  }

  return saved;
}

// Resets the authentication state in the event a user enters a new
// account name and password
function resetSteamAuth() {
  pendingSteamGuardCallback = null;
  pendingAccountName = null;
  client.removeAllListeners('loggedOn');
  client.removeAllListeners('error');
  client.removeAllListeners('steamGuard');
  client.removeAllListeners('refreshToken');
  client.logOff();
  client = new SteamUser();
}

/**
 * Waits for the next login attempt to succeed, fail, or require SteamGuard.
 * The refreshToken listener is attached by the caller (steam:login / steam:login-with-token)
 * so it is only registered once per login attempt — not again when SteamGuard re-enters this function.
 * @returns {Promise<{ success: boolean, [key: string]: any }>}
 */
function waitForLogin() {
  return new Promise((resolve) => {
    client.once('loggedOn', () => {
      resolve({ success: true });
    });

    client.once('error', (err) => {
      pendingSteamGuardCallback = null;
      resolve({ success: false, reason: err.eresult != null ? SteamUser.EResult[err.eresult] ?? String(err.eresult) : err.message });
    });

    client.once('steamGuard', (domain, callback, lastCodeWrong) => {
      pendingSteamGuardCallback = callback;
      resolve({
        success: false,
        reason: 'SteamGuard',
        isEmail: domain !== null,
        domain: domain ?? null,
        lastCodeWrong: lastCodeWrong ?? false,
      });
    });
  });
}

/**
 * Registers all Steam IPC handlers on the provided ipcMain instance.
 * @param {import('electron').IpcMain} ipcMain
 * @param {import('electron-store').default} store
 */
export function registerHandlers(ipcMain, store) {
  // Log in to Steam. Idempotent - can be called with different credentials to log in to a different account
  ipcMain.handle('steam:login', async (_event, { accountName, password, twoFactorCode, authCode }) => {
    resetSteamAuth();
    pendingAccountName = accountName;

    const logOnOptions = { accountName, password };
    if (twoFactorCode) logOnOptions.twoFactorCode = twoFactorCode;
    if (authCode) logOnOptions.authCode = authCode;

    client.logOn(logOnOptions);
    // Attach exactly once per login attempt so SteamGuard's second waitForLogin() call doesn't add a duplicate
    client.once('refreshToken', (token) => {
      store.set('steamAccount', { accountName, refreshToken: token, savedAt: Date.now() });
    });
    return waitForLogin();
  });

  // Submit a SteamGuard code in response to a login attempt that requires it
  ipcMain.handle('steam:submit-steam-guard', async (_event, { code }) => {
    if (!pendingSteamGuardCallback) {
      return { success: false, reason: 'NoPendingSteamGuard' };
    }

    const callback = pendingSteamGuardCallback;
    pendingSteamGuardCallback = null;

    callback(code);
    // pendingAccountName was set by steam:login; the refreshToken listener is already attached
    return waitForLogin();
  });

  // Returns { accountName } if a valid (non-expired) refresh token is stored, otherwise null
  ipcMain.handle('steam:get-saved-account', () => {
    const saved = getValidSavedAccount(store);
    return saved ? { accountName: saved.accountName } : null;
  });

  // Logs in using the stored refresh token instead of a password
  ipcMain.handle('steam:login-with-token', async () => {
    const saved = getValidSavedAccount(store);
    if (!saved) return { success: false, reason: 'NoSavedToken' };

    resetSteamAuth();
    pendingAccountName = saved.accountName;
    client.logOn({ accountName: saved.accountName, refreshToken: saved.refreshToken });
    client.once('refreshToken', (token) => {
      store.set('steamAccount', { accountName: saved.accountName, refreshToken: token, savedAt: Date.now() });
    });
    return waitForLogin();
  });

  // Clears the stored account and refresh token (e.g. for logout or switching accounts)
  ipcMain.handle('steam:clear-saved-account', () => {
    store.delete('steamAccount');
    return { success: true };
  });
}
