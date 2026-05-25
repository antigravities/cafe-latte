import { google } from 'googleapis';
import { shell } from 'electron';
import http from 'http';

const SCOPES = [
  // Read and write spreadsheet data (for updating activation status)
  'https://www.googleapis.com/auth/spreadsheets',
  // List the user's Drive files so they can pick a spreadsheet
  'https://www.googleapis.com/auth/drive.readonly',
];

// How long (ms) to wait for the user to complete the browser OAuth flow
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Builds a new OAuth2 client using stored credentials.
 * Returns null if no credentials have been saved yet.
 * @param {import('electron-store').default} store
 * @param {number} [port] - redirect port; omit when just refreshing tokens
 * @returns {import('googleapis').Auth.OAuth2Client | null}
 */
function buildOAuth2Client(store, port) {
  const creds = store.get('gdriveCredentials');
  if (!creds?.clientId || !creds?.clientSecret) return null;

  const redirectUri = port != null ? `http://localhost:${port}` : undefined;
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
}

/**
 * Returns true if the stored tokens include a refresh token and are either
 * not yet expired or refreshable. We don't auto-refresh here — that happens
 * lazily when the googleapis client is used for API calls.
 * @param {import('electron-store').default} store
 * @returns {boolean}
 */
function hasSavedTokens(store) {
  const tokens = store.get('gdriveTokens');
  if (!tokens?.refresh_token) return false;
  // If there's an expiry date set and it's in the past, the access token is
  // stale — but since we have a refresh token, the googleapis client can
  // silently obtain a new one, so we still consider it "connected".
  return true;
}

/**
 * Registers all Google Drive / OAuth IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {import('electron-store').default} store
 */
export function registerHandlers(ipcMain, store) {
  /**
   * Saves the user's Google Cloud OAuth 2.0 client credentials.
   * Must be called once before gdrive:start-auth will work.
   * The UI settings screen will call this; for dev use the DevTools console.
   */
  ipcMain.handle('gdrive:set-credentials', (_event, { clientId, clientSecret }) => {
    if (!clientId || !clientSecret) {
      return { success: false, reason: 'Missing clientId or clientSecret' };
    }
    store.set('gdriveCredentials', { clientId, clientSecret });
    return { success: true };
  });

  /**
   * Runs the full OAuth 2.0 loopback-redirect flow:
   *   1. Spin up a temporary local HTTP server on a free port.
   *   2. Build an auth URL pointing at that port.
   *   3. Open the URL in the user's default browser via shell.openExternal.
   *   4. Wait for Google to redirect back with the auth code.
   *   5. Exchange the code for access + refresh tokens.
   *   6. Persist the tokens in electron-store.
   *
   * This handler blocks until the flow completes or times out (5 min).
   */
  ipcMain.handle('gdrive:start-auth', async () => {
    // We need a free port before building the OAuth client so the redirect URI matches
    let code, port;
    try {
      // Start the server first so we know the port before generating the URL
      const result = await new Promise((resolve, reject) => {
        // Hoisted so both the listen callback (setter) and the request handler (reader) share it
        let assignedPort;
        const server = http.createServer((req, res) => {
          const url = new URL(req.url, `http://localhost`);
          const authCode = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html><html><head><title>Café Latte</title></head><body style="font-family:sans-serif;padding:2rem">
            <h2>${error ? 'Authorization denied.' : 'Authorization successful!'}</h2>
            <p>You can close this tab and return to the app.</p>
          </body></html>`);

          clearTimeout(timer);
          server.close();

          if (error) reject(new Error(error));
          else if (authCode) resolve({ code: authCode, port: assignedPort });
          else reject(new Error('No code in OAuth redirect'));
        });

        server.listen(0, '127.0.0.1', () => {
          assignedPort = server.address().port;

          // Build the OAuth client now that we know the port
          const oauth2Client = buildOAuth2Client(store, assignedPort);
          if (!oauth2Client) {
            clearTimeout(timer);
            server.close();
            reject(new Error('NoCredentials'));
            return;
          }

          const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            // prompt: 'consent' ensures Google always returns a refresh token.
            // Without this, subsequent logins won't return one if the app is already authorized.
            prompt: 'consent',
          });

          shell.openExternal(authUrl);
        });

        server.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        const timer = setTimeout(() => {
          server.close();
          reject(new Error('OAuth flow timed out after 5 minutes'));
        }, AUTH_TIMEOUT_MS);
      });

      code = result.code;
      port = result.port;
    } catch (err) {
      if (err.message === 'NoCredentials') {
        return { success: false, reason: 'NoCredentials — call gdrive:set-credentials first' };
      }
      return { success: false, reason: err.message };
    }

    // Exchange the authorization code for access + refresh tokens
    try {
      const oauth2Client = buildOAuth2Client(store, port);
      const { tokens } = await oauth2Client.getToken(code);
      store.set('gdriveTokens', tokens);
      return { success: true };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });

  /**
   * Returns { connected: true } if valid OAuth tokens are stored, otherwise null.
   * "Valid" here means a refresh token exists — the access token may be expired
   * but googleapis will refresh it automatically on first API use.
   */
  ipcMain.handle('gdrive:get-saved-account', () => {
    return hasSavedTokens(store) ? { connected: true } : null;
  });

  /**
   * Removes stored OAuth tokens, effectively disconnecting Google Drive.
   * Does not revoke the token on Google's servers (the user can do that from
   * their Google account security settings if needed).
   */
  ipcMain.handle('gdrive:logout', () => {
    store.delete('gdriveTokens');
    return { success: true };
  });
}

/**
 * Builds an authenticated googleapis OAuth2 client with the stored tokens.
 * Returns null if credentials or tokens are missing.
 * Used by other modules (e.g. sheets.js) that need an authenticated client.
 * @param {import('electron-store').default} store
 * @returns {import('googleapis').Auth.OAuth2Client | null}
 */
export function getAuthenticatedClient(store) {
  const tokens = store.get('gdriveTokens');
  if (!tokens) return null;

  const oauth2Client = buildOAuth2Client(store);
  if (!oauth2Client) return null;

  oauth2Client.setCredentials(tokens);

  // Persist any refreshed tokens back to the store so they survive app restarts
  oauth2Client.on('tokens', (newTokens) => {
    const existing = store.get('gdriveTokens') ?? {};
    store.set('gdriveTokens', { ...existing, ...newTokens });
  });

  return oauth2Client;
}
