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
}

function setStats(total, redeemed, pending) {
  elTotal().textContent    = total;
  elRedeemed().textContent = redeemed;
  elPending().textContent  = pending;
}

export function init(navigateTo) {
  document.getElementById('btn-dashboard-refresh').addEventListener('click', () => loadStats(true));

  document.getElementById('btn-dashboard-back').addEventListener('click', () => {
    navigateTo('page-connect');
  });

  // Expose a hook so app.js can trigger a load whenever the page becomes visible
  return { loadStats };
}
