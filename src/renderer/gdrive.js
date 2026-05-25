/**
 * Google Drive connection page module.
 * Wires up all UI for the OAuth setup flow: credential entry, browser-based
 * consent, connected state, and disconnect. Calls navigateTo('page-dashboard')
 * on successful authentication.
 *
 * @param {function(string): void} navigateTo - shared page-switch utility from app.js
 */
export async function init(navigateTo) {
  // ── Element references ────────────────────────────────────────────────────
  const setupSection       = document.getElementById('gdrive-setup-section');
  const connectedSection   = document.getElementById('gdrive-connected-section');
  const inputClientId      = document.getElementById('input-client-id');
  const inputClientSecret  = document.getElementById('input-client-secret');
  const gdriveError        = document.getElementById('gdrive-error');
  const btnConnect         = document.getElementById('btn-gdrive-connect');
  const gdriveSpinner      = document.getElementById('gdrive-spinner');
  const btnGdriveLabel     = document.getElementById('btn-gdrive-label');
  const btnContinue        = document.getElementById('btn-gdrive-continue');
  const btnDisconnect      = document.getElementById('btn-gdrive-disconnect');
  const linkDocs           = document.getElementById('link-gdrive-docs');

  // ── Helpers ───────────────────────────────────────────────────────────────

  function showError(msg) {
    gdriveError.textContent = msg;
    gdriveError.classList.remove('d-none');
  }

  function clearError() {
    gdriveError.textContent = '';
    gdriveError.classList.add('d-none');
  }

  function setBusy(busy, label = 'Connect to Google Drive') {
    btnConnect.disabled = busy;
    gdriveSpinner.classList.toggle('d-none', !busy);
    btnGdriveLabel.textContent = busy ? label : 'Connect to Google Drive';
  }

  function showConnected() {
    setupSection.classList.add('d-none');
    connectedSection.classList.remove('d-none');
  }

  function showSetup() {
    connectedSection.classList.add('d-none');
    setupSection.classList.remove('d-none');
    inputClientId.value = '';
    inputClientSecret.value = '';
    clearError();
  }

  // ── Startup: check for existing tokens ───────────────────────────────────
  const saved = await window.api.gdriveGetSavedAccount();
  if (saved?.connected) {
    showConnected();
  }
  // If not connected, the setup section is already visible by default.

  // ── Docs link: open the gdrive setup guide ───────────────────────────────
  linkDocs.addEventListener('click', (e) => {
    e.preventDefault();
    // Shell-open the bundled docs file via Electron's default handler.
    // The preload doesn't expose shell.openExternal yet, so fall back to
    // opening the local markdown path in the default browser for now.
    window.open('https://github.com/'); // placeholder — will be replaced when shell IPC is added
  });

  // ── Connect button ────────────────────────────────────────────────────────
  btnConnect.addEventListener('click', async () => {
    clearError();

    const clientId     = inputClientId.value.trim();
    const clientSecret = inputClientSecret.value.trim();

    if (!clientId || !clientSecret) {
      showError('Please enter both Client ID and Client Secret.');
      return;
    }

    // Step 1: persist credentials
    setBusy(true, 'Saving credentials…');
    const credsResult = await window.api.gdriveSetCredentials({ clientId, clientSecret });
    if (!credsResult.success) {
      setBusy(false);
      showError(credsResult.reason ?? 'Failed to save credentials.');
      return;
    }

    // Step 2: open browser for OAuth consent (blocks up to 5 min)
    setBusy(true, 'Waiting for browser…');
    const authResult = await window.api.gdriveStartAuth();
    setBusy(false);

    if (authResult.success) {
      showConnected();
      navigateTo('page-dashboard');
    } else {
      showError(authResult.reason ?? 'Google Drive authorization failed.');
    }
  });

  // ── Continue button ───────────────────────────────────────────────────────
  btnContinue.addEventListener('click', () => navigateTo('page-dashboard'));

  // ── Disconnect button ─────────────────────────────────────────────────────
  btnDisconnect.addEventListener('click', async () => {
    await window.api.gdriveLogout();
    showSetup();
    navigateTo('page-connect');
  });
}
