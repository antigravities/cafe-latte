import { init as initSteam } from './steam.js';

document.addEventListener('DOMContentLoaded', async () => {
  const pageSections = ['page-login', 'page-connect', 'page-dashboard']
    .map(id => document.getElementById(id));

  /** Shows the target page div and hides all others. */
  function navigateTo(pageId) {
    pageSections.forEach(el => el.classList.toggle('d-none', el.id !== pageId));
  }

  await initSteam(navigateTo);
  // future: await initGdrive(navigateTo);
});
