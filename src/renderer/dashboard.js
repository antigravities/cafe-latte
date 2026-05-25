/**
 * Dashboard renderer — fetches spreadsheet stats via IPC and populates the
 * stat cards on #page-dashboard. Called from app.js with a navigateTo callback.
 */

const elSpinner    = () => document.getElementById('dashboard-spinner');
const elError      = () => document.getElementById('dashboard-error');
const elSheetName  = () => document.getElementById('dashboard-sheet-name');
const elTotal      = () => document.getElementById('stat-total');
const elRedeemed   = () => document.getElementById('stat-redeemed');
const elPending    = () => document.getElementById('stat-pending');

const KEYS_PER_HOUR    = 50;
const COOLDOWN_MS      = 62 * 60 * 1000;

/**
 * Formats a millisecond duration into a human-readable string like "2h 14m" or "45m".
 * Returns "< 1 minute" for very short durations.
 * @param {number} ms
 * @returns {string}
 */
function fmtDuration(ms) {
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin < 1) return '< 1 minute';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Updates the #stat-eta element with an estimated completion time.
 * Assumes all pending keys will succeed at KEYS_PER_HOUR.
 * Adds remaining rate-limit cooldown time when applicable.
 * @param {number} pending
 * @param {number|null} lastAttempt  — ms timestamp of last activation attempt, or null
 */
function updateEta(pending, lastAttempt) {
  const el = document.getElementById('stat-eta');
  if (!pending || pending === 0 || pending === '—') {
    el.textContent = '';
    return;
  }

  const cooldownRemaining = lastAttempt
    ? Math.max(0, lastAttempt + COOLDOWN_MS - Date.now())
    : 0;

  const activationMs = (pending / KEYS_PER_HOUR) * 3_600_000;
  const totalMs = cooldownRemaining + activationMs;

  if (cooldownRemaining > 0) {
    el.textContent = `~${fmtDuration(totalMs)} remaining at 50 keys/hour (rate-limited — cooldown ${fmtDuration(cooldownRemaining)})`;
  } else {
    el.textContent = `~${fmtDuration(totalMs)} remaining at 50 keys/hour`;
  }
}

// Cumulative session totals — reset only on app launch, not per pass.
// These accumulate across both manual passes and the future 15-min automatic passes.
const session = { checked: 0, activated: 0, owned: 0, failed: 0 };

function updateSessionCards() {
  const row = document.getElementById('session-stats-row');
  document.getElementById('stat-session-checked').textContent   = session.checked;
  document.getElementById('stat-session-activated').textContent = session.activated;
  document.getElementById('stat-session-owned').textContent     = session.owned;
  document.getElementById('stat-session-failed').textContent    = session.failed;
  // Only reveal the row once a pass has run
  if (session.checked > 0 || session.activated > 0 || session.owned > 0 || session.failed > 0) {
    row.classList.remove('d-none');
  }
}

/** Fetches stats and updates the DOM. Pass force=true to bypass the cache. */
async function loadStats(force = false) {
  const spinner = elSpinner();
  const errorEl = elError();

  spinner.classList.remove('d-none');
  errorEl.classList.add('d-none');
  setStats('—', '—', '—');

  // Populate the sheet name sub-heading
  const sheetRes = await window.api.getSelectedSpreadsheet();
  if (sheetRes?.name) {
    elSheetName().textContent = sheetRes.name;
  } else {
    elSheetName().textContent = '';
  }

  const res = await window.api.getSheetStats(force);
  spinner.classList.add('d-none');

  if (!res.success) {
    errorEl.textContent = res.reason === 'NoSpreadsheetSelected'
      ? 'No spreadsheet selected. Go back and choose one first.'
      : `Could not load stats: ${res.reason}`;
    errorEl.classList.remove('d-none');
    return;
  }

  const redeemed = res.totalRows - res.pendingRows;
  setStats(res.totalRows, redeemed, res.pendingRows);
  updateEta(res.pendingRows, res.lastRedemptionAttempt ?? null);

  // Keep session cards in sync on every refresh
  updateSessionCards();
}

function setStats(total, redeemed, pending) {
  elTotal().textContent    = total;
  elRedeemed().textContent = redeemed;
  elPending().textContent  = pending;
}

const AUTO_PASS_INTERVAL_MS = 15 * 60 * 1000;

export function init(navigateTo) {
  const btnRedeem     = document.getElementById('btn-redeem-now');
  const btnRefresh    = document.getElementById('btn-dashboard-refresh');
  const redeemSpinner = document.getElementById('btn-redeem-spinner');
  const redeemError   = document.getElementById('redemption-error');

  // UI-side guard: prevents the interval from firing a second IPC call while one is in flight.
  // The backend has its own isRunning guard as a belt-and-suspenders fallback.
  let isPassRunning    = false;
  let autoPassInterval = null;

  async function triggerPass() {
    if (isPassRunning) return;
    isPassRunning = true;

    // Start the 15-minute auto-pass on the first manual or automatic trigger
    if (!autoPassInterval) {
      autoPassInterval = setInterval(triggerPass, AUTO_PASS_INTERVAL_MS);
    }

    btnRedeem.disabled  = true;
    btnRefresh.disabled = true;
    redeemSpinner.classList.remove('d-none');
    redeemError.classList.add('d-none');

    try {
      const result = await window.api.runRedemptionPass();

      // already_running means the backend guard caught a race — silently ignore
      if (!result.success) {
        if (result.reason !== 'already_running') {
          redeemError.textContent = `Redemption pass failed: ${result.reason}`;
          redeemError.classList.remove('d-none');
        }
        return;
      }

      // Accumulate into session totals
      session.checked   += result.checked    ?? 0;
      session.activated += result.activated  ?? 0;
      session.owned     += result.markedOwned ?? 0;
      session.failed    += result.failed     ?? 0;

      updateSessionCards();

      // Refresh sheet stat cards so Redeemed / Pending numbers are up to date
      loadStats(true);
    } finally {
      isPassRunning       = false;
      btnRedeem.disabled  = false;
      btnRefresh.disabled = false;
      redeemSpinner.classList.add('d-none');
    }
  }

  btnRedeem.addEventListener('click', triggerPass);

  btnRefresh.addEventListener('click', () => loadStats(true));

  document.getElementById('btn-dashboard-back').addEventListener('click', () => {
    navigateTo('page-connect');
  });

  // Expose a hook so app.js can trigger a load whenever the page becomes visible
  return { loadStats };
}
