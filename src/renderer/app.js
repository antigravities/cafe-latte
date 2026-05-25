import { init as initSteam } from './steam.js';
import { init as initGdrive } from './gdrive.js';
import { init as initDashboard } from './dashboard.js';

document.addEventListener('DOMContentLoaded', async () => {
  const pageSections = ['page-login', 'page-connect', 'page-dashboard']
    .map(id => document.getElementById(id));

  /** Shows the target page div and hides all others. */
  function navigateTo(pageId) {
    pageSections.forEach(el => el.classList.toggle('d-none', el.id !== pageId));
  }

  const dashboard = initDashboard(navigateTo);

  // Wrap navigateTo so navigating to the dashboard triggers a stats load and
  // starts the 1-minute refresh interval; leaving stops it to avoid ghost calls.
  const _navigateTo = navigateTo;
  function navigateToWithHooks(pageId) {
    _navigateTo(pageId);
    if (pageId === 'page-dashboard') {
      dashboard.loadStats();
      dashboard.startRefresh();
    } else {
      dashboard.stopRefresh();
    }
  }

  await initSteam(navigateToWithHooks);
  await initGdrive(navigateToWithHooks);
});
