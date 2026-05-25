import Fuse from '../../node_modules/fuse.js/dist/fuse.mjs';

/**
 * Google Drive connection page module.
 * Wires up all UI for the OAuth setup flow: credential entry, browser-based
 * consent, connected state, and spreadsheet picker. Calls navigateTo('page-dashboard')
 * once the user has selected a spreadsheet.
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

  const sheetSelectSection  = document.getElementById('sheet-select-section');
  const inputSheetSearch    = document.getElementById('input-sheet-search');
  const sheetList           = document.getElementById('sheet-list');
  const sheetSelectError    = document.getElementById('sheet-select-error');
  const btnSheetConfirm     = document.getElementById('btn-sheet-confirm');
  const sheetConfirmSpinner = document.getElementById('sheet-confirm-spinner');
  const btnSheetConfirmLabel = document.getElementById('btn-sheet-confirm-label');
  const linkSheetBack       = document.getElementById('link-sheet-back');

  // ── Helpers: GDrive setup ─────────────────────────────────────────────────

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
    sheetSelectSection.classList.add('d-none');
    connectedSection.classList.remove('d-none');
  }

  function showSetup() {
    connectedSection.classList.add('d-none');
    sheetSelectSection.classList.add('d-none');
    setupSection.classList.remove('d-none');
    inputClientId.value = '';
    inputClientSecret.value = '';
    clearError();
  }

  // ── Sheet picker ──────────────────────────────────────────────────────────

  /** Currently highlighted/selected sheet { id, name }, or null. */
  let selectedSheet = null;

  /** All sheets returned from the API, used to reset after clearing search. */
  let allSheets = [];

  /** Fuse instance for fuzzy searching sheet names. */
  let fuse = null;

  function showSheetError(msg) {
    sheetSelectError.textContent = msg;
    sheetSelectError.classList.remove('d-none');
  }

  function clearSheetError() {
    sheetSelectError.textContent = '';
    sheetSelectError.classList.add('d-none');
  }

  /**
   * Renders a list of sheet objects into #sheet-list as Bootstrap list-group items.
   * Highlights the item whose id matches selectedSheet (if any).
   * @param {Array<{id: string, name: string}>} sheets
   */
  function renderSheetList(sheets) {
    sheetList.innerHTML = '';

    if (sheets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-muted small text-center py-3';
      empty.textContent = inputSheetSearch.value.trim()
        ? 'No spreadsheets match your search.'
        : 'No spreadsheets found in your Google Drive.';
      sheetList.appendChild(empty);
      return;
    }

    for (const sheet of sheets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-group-item list-group-item-action';
      btn.textContent = sheet.name;
      if (selectedSheet?.id === sheet.id) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => selectSheet(sheet));
      sheetList.appendChild(btn);
    }
  }

  /**
   * Marks a sheet as selected, updates the confirm button label, and re-renders
   * the list so the active highlight moves to the clicked item.
   * @param {{id: string, name: string}} sheet
   */
  function selectSheet(sheet) {
    selectedSheet = sheet;
    const query = inputSheetSearch.value.trim();
    const visible = query && fuse
      ? fuse.search(query).map(r => r.item)
      : allSheets;
    renderSheetList(visible);
    btnSheetConfirmLabel.textContent = `Continue with "${sheet.name}"`;
    btnSheetConfirm.classList.remove('d-none');
    clearSheetError();
  }

  /**
   * Loads all spreadsheets from the API, initialises Fuse, renders the list,
   * and pre-selects the previously chosen sheet (if any).
   */
  async function showSheetPicker() {
    setupSection.classList.add('d-none');
    connectedSection.classList.add('d-none');
    sheetSelectSection.classList.remove('d-none');

    // Reset UI state
    inputSheetSearch.value = '';
    btnSheetConfirm.classList.add('d-none');
    clearSheetError();
    selectedSheet = null;
    allSheets = [];
    fuse = null;

    // Show a loading placeholder while fetching
    sheetList.innerHTML = '<div class="text-muted small text-center py-3">Loading spreadsheets…</div>';

    const [listResult, savedSheet] = await Promise.all([
      window.api.listSpreadsheets(),
      window.api.getSelectedSpreadsheet(),
    ]);

    if (!listResult.success) {
      sheetList.innerHTML = '';
      showSheetError(listResult.reason ?? 'Failed to load spreadsheets.');
      return;
    }

    allSheets = listResult.sheets;
    fuse = new Fuse(allSheets, {
      keys: ['name'],
      threshold: 0.4,   // 0 = exact match only, 1 = match anything; 0.4 is comfortably fuzzy
      minMatchCharLength: 1,
    });

    renderSheetList(allSheets);

    // Pre-select the previously chosen sheet if it's still in the list
    if (savedSheet) {
      const match = allSheets.find(s => s.id === savedSheet.id);
      if (match) selectSheet(match);
    }

    inputSheetSearch.focus();
  }

  // ── Sheet search input ────────────────────────────────────────────────────
  inputSheetSearch.addEventListener('input', () => {
    const query = inputSheetSearch.value.trim();
    const results = query && fuse ? fuse.search(query).map(r => r.item) : allSheets;
    renderSheetList(results);
  });

  // ── Sheet confirm button ──────────────────────────────────────────────────
  btnSheetConfirm.addEventListener('click', async () => {
    if (!selectedSheet) return;

    sheetConfirmSpinner.classList.remove('d-none');
    btnSheetConfirm.disabled = true;

    const result = await window.api.selectSpreadsheet(selectedSheet);

    sheetConfirmSpinner.classList.add('d-none');
    btnSheetConfirm.disabled = false;

    if (result.success) {
      navigateTo('page-dashboard');
    } else {
      showSheetError(result.reason ?? 'Failed to save spreadsheet selection.');
    }
  });

  // ── Sheet back link ───────────────────────────────────────────────────────
  linkSheetBack.addEventListener('click', (e) => {
    e.preventDefault();
    showConnected();
  });

  // ── Startup: check for existing tokens ───────────────────────────────────
  const saved = await window.api.gdriveGetSavedAccount();
  if (saved?.connected) {
    showConnected();
  }
  // If not connected, the setup section is already visible by default.

  // ── Docs link: open the gdrive setup guide ───────────────────────────────
  linkDocs.addEventListener('click', (e) => {
    e.preventDefault();
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
      await showSheetPicker();
    } else {
      showError(authResult.reason ?? 'Google Drive authorization failed.');
    }
  });

  // ── Continue button ───────────────────────────────────────────────────────
  btnContinue.addEventListener('click', () => showSheetPicker());

  // ── Disconnect button ─────────────────────────────────────────────────────
  btnDisconnect.addEventListener('click', async () => {
    await window.api.gdriveLogout();
    showSetup();
    navigateTo('page-connect');
  });
}
