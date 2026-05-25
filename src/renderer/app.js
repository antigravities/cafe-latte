document.addEventListener('DOMContentLoaded', async () => {
  // ── Element references ────────────────────────────────────────────────────
  const pageSections = ['page-login', 'page-connect', 'page-dashboard'].map(id => document.getElementById(id));

  const savedAccountSection = document.getElementById('saved-account-section');
  const savedAccountName    = document.getElementById('saved-account-name');
  const btnTokenLogin       = document.getElementById('btn-token-login');
  const tokenLoginSpinner   = document.getElementById('token-login-spinner');
  const linkDifferentAcct   = document.getElementById('link-different-account');

  const loginFormSection  = document.getElementById('login-form-section');
  const inputAccount      = document.getElementById('input-account');
  const inputPassword     = document.getElementById('input-password');
  const steamguardSection = document.getElementById('steamguard-section');
  const steamguardLabel   = document.getElementById('steamguard-label');
  const inputSteamguard   = document.getElementById('input-steamguard');
  const loginError        = document.getElementById('login-error');
  const btnLogin          = document.getElementById('btn-login');
  const loginSpinner      = document.getElementById('login-spinner');
  const btnLoginLabel     = document.getElementById('btn-login-label');

  // ── State ─────────────────────────────────────────────────────────────────
  // Tracks whether we're waiting for a SteamGuard code from the user.
  let awaitingSteamGuard = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Shows the target page div and hides all others. */
  function navigateTo(pageId) {
    pageSections.forEach(el => {
      el.classList.toggle('d-none', el.id !== pageId);
    });
  }

  /** Displays an error in the login error alert. */
  function showError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('d-none');
  }

  function clearError() {
    loginError.textContent = '';
    loginError.classList.add('d-none');
  }

  /** Enables or disables the login button and toggles the spinner. */
  function setLoginBusy(busy) {
    btnLogin.disabled = busy;
    loginSpinner.classList.toggle('d-none', !busy);
  }

  /** Enables or disables the token-login button and toggles its spinner. */
  function setTokenLoginBusy(busy) {
    btnTokenLogin.disabled = busy;
    tokenLoginSpinner.classList.toggle('d-none', !busy);
  }

  /**
   * Transitions from the saved-account banner to the manual login form.
   * Also clears the stored token so future launches go straight to the form.
   */
  async function switchToManualLogin() {
    await window.api.steamClearSavedAccount();
    savedAccountSection.classList.add('d-none');
    loginFormSection.classList.remove('d-none');
    inputAccount.focus();
  }

  /**
   * Shows the SteamGuard input and updates the label based on whether it's
   * an email code (with the partially-redacted address) or a TOTP code.
   * @param {boolean} isEmail
   * @param {string|null} domain - the email domain returned by steam-user, e.g. "gmail.com"
   */
  function showSteamGuard(isEmail, domain) {
    awaitingSteamGuard = true;
    if (isEmail) {
      steamguardLabel.textContent = domain
        ? `Email code (sent to an address ending in @${domain})`
        : 'Email code';
    } else {
      steamguardLabel.textContent = 'Authenticator code';
    }
    steamguardSection.classList.remove('d-none');
    btnLoginLabel.textContent = 'Submit code';
    inputSteamguard.value = '';
    inputSteamguard.focus();
  }

  // ── Startup: check for a saved token ─────────────────────────────────────
  const saved = await window.api.getSavedAccount();
  if (saved) {
    savedAccountName.textContent = saved.accountName;
    savedAccountSection.classList.remove('d-none');
    // loginFormSection stays hidden
  } else {
    loginFormSection.classList.remove('d-none');
    // savedAccountSection stays hidden
  }

  // ── Saved-account: token login button ────────────────────────────────────
  btnTokenLogin.addEventListener('click', async () => {
    clearError();
    setTokenLoginBusy(true);

    const result = await window.api.steamLoginWithToken();

    setTokenLoginBusy(false);
    if (result.success) {
      navigateTo('page-connect');
    } else {
      // Token expired or invalid — fall back to the manual form
      await switchToManualLogin();
      showError(`Auto-login failed: ${result.reason ?? 'unknown error'}. Please log in manually.`);
    }
  });

  // ── Saved-account: "use different account" link ──────────────────────────
  linkDifferentAcct.addEventListener('click', async (e) => {
    e.preventDefault();
    await switchToManualLogin();
  });

  // ── Main login / SteamGuard submit button ─────────────────────────────────
  btnLogin.addEventListener('click', async () => {
    clearError();

    if (awaitingSteamGuard) {
      // ── SteamGuard code submission ─────────────────────────────────────
      const code = inputSteamguard.value.trim();
      if (!code) {
        showError('Please enter your Steam Guard code.');
        return;
      }

      setLoginBusy(true);
      const result = await window.api.steamSubmitSteamGuard(code);
      setLoginBusy(false);

      if (result.success) {
        navigateTo('page-connect');
      } else if (result.reason === 'SteamGuard' && result.lastCodeWrong) {
        // Steam rejected the code; let the user try again
        inputSteamguard.value = '';
        inputSteamguard.focus();
        showError('Incorrect code — please try again.');
      } else {
        showError(result.reason ?? 'Steam Guard submission failed.');
      }
    } else {
      // ── Initial credentials submission ────────────────────────────────
      const accountName = inputAccount.value.trim();
      const password    = inputPassword.value;

      if (!accountName || !password) {
        showError('Please enter your account name and password.');
        return;
      }

      setLoginBusy(true);
      const result = await window.api.steamLogin({ accountName, password });
      setLoginBusy(false);

      if (result.success) {
        navigateTo('page-connect');
      } else if (result.reason === 'SteamGuard') {
        showSteamGuard(result.isEmail, result.domain);
      } else {
        showError(result.reason ?? 'Login failed.');
      }
    }
  });

  // Allow pressing Enter in any input to trigger the login button
  [inputAccount, inputPassword, inputSteamguard].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnLogin.click();
    });
  });
});
