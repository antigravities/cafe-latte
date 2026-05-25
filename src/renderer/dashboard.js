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

// Set to true after the first redemption pass runs; gates the ETA and auto-notice.
let autoPassStarted = false;

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
 *
 * Keys activate back-to-back in seconds; the rate limit fires only after a
 * full batch of KEYS_PER_HOUR activations. So we count cooldown windows, not
 * a steady per-key rate:
 *
 *   batches = ceil(pending / KEYS_PER_HOUR)
 *   cooldowns needed = batches - 1  (no wait after the final batch)
 *   if currently rate-limited: add the remaining cooldown as the first wait
 *
 * @param {number} pending
 * @param {number|null} lastAttempt  — ms timestamp of last activation attempt, or null
 */
function updateEta(pending, lastAttempt) {
  const el = document.getElementById('stat-eta');
  const notice = document.getElementById('stat-auto-notice');

  if (autoPassStarted) {
    notice.classList.remove('d-none');
  } else {
    notice.classList.add('d-none');
  }

  if (!autoPassStarted || !pending || pending === 0 || pending === '—') {
    el.textContent = '';
    return;
  }

  const cooldownRemaining = lastAttempt
    ? Math.max(0, lastAttempt + COOLDOWN_MS - Date.now())
    : 0;

  const batches = Math.ceil(pending / KEYS_PER_HOUR);
  // Each inter-batch cooldown is 62 min; if rate-limited now, that counts as the first one.
  const fullCooldowns = batches - 1;
  const totalMs = cooldownRemaining + fullCooldowns * COOLDOWN_MS;

  if (totalMs === 0) {
    // All keys fit in one batch with no active cooldown — done in seconds.
    el.textContent = `~a few minutes (${pending} key${pending === 1 ? '' : 's'} in one batch)`;
  } else if (cooldownRemaining > 0) {
    el.textContent = `~${fmtDuration(totalMs)} (rate-limited — ${fmtDuration(cooldownRemaining)} remaining, then ${batches - 1} more batch${batches - 1 === 1 ? '' : 'es'})`;
  } else {
    el.textContent = `~${fmtDuration(totalMs)} (${batches} batches, 62m cooldown between each)`;
  }
}

/**
 * Updates the session stat cards from a stats object returned by the backend.
 * @param {{ checked: number, activated: number, owned: number, failed: number }} stats
 */
function updateSessionCards(stats) {
  document.getElementById('stat-session-checked').textContent   = stats.checked;
  document.getElementById('stat-session-activated').textContent = stats.activated;
  document.getElementById('stat-session-owned').textContent     = stats.owned;
  document.getElementById('stat-session-failed').textContent    = stats.failed;
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

  // Session stats live in the main process; just display whatever the backend reports
  if (res.sessionStats) updateSessionCards(res.sessionStats);
}

function setStats(total, redeemed, pending) {
  elTotal().textContent    = total;
  elRedeemed().textContent = redeemed;
  elPending().textContent  = pending;
}

const AUTO_PASS_INTERVAL_MS = 5 * 60 * 1000;

export function init(navigateTo) {
  const btnRedeem     = document.getElementById('btn-redeem-now');
  const btnRefresh    = document.getElementById('btn-dashboard-refresh');
  const redeemSpinner = document.getElementById('btn-redeem-spinner');
  const redeemError   = document.getElementById('redemption-error');

  // UI-side guard: prevents the interval from firing a second IPC call while one is in flight.
  // The backend has its own isRunning guard as a belt-and-suspenders fallback.
  let isPassRunning      = false;
  let autoPassInterval   = null;
  let statsRefreshInterval = null;

  async function triggerPass() {
    if (isPassRunning) return;
    isPassRunning = true;
    document.getElementById('session-stats-row').classList.remove('d-none');

    // Start the 15-minute auto-pass on the first manual or automatic trigger
    if (!autoPassInterval) {
      autoPassInterval = setInterval(triggerPass, AUTO_PASS_INTERVAL_MS);
      autoPassStarted  = true;
    }

    btnRedeem.disabled  = true;
    btnRefresh.disabled = true;
    redeemSpinner.classList.remove('d-none');
    btnRedeem.textContent = "Continue Redeeming";
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

      // Refresh sheet stat cards (and session stats) — backend has the cumulative totals
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

  function startRefresh() {
    if (!statsRefreshInterval) {
      statsRefreshInterval = setInterval(() => loadStats(false), 60_000);
    }
  }

  function stopRefresh() {
    clearInterval(statsRefreshInterval);
    statsRefreshInterval = null;
  }

  // Expose hooks so app.js can trigger loads and manage the refresh interval
  return { loadStats, startRefresh, stopRefresh };
}
