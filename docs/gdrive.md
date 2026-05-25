# Google Drive / Sheets Setup

Café Latte uses your own Google Cloud OAuth 2.0 credentials to access Google Drive and Sheets. This means you create a free "app" in Google Cloud Console and authorize only your own account — no third-party service sees your data.

---

## Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Click the project selector at the top → **New Project**.
3. Give it a name (e.g. `cafe-latte`) and click **Create**.
4. Make sure the new project is selected in the dropdown before continuing.

---

## Step 2 — Enable the required APIs

You need two APIs enabled:

1. In the left sidebar go to **APIs & Services → Library**.
2. Search for **Google Sheets API** → click it → click **Enable**.
3. Go back to the Library, search for **Google Drive API** → click it → click **Enable**.

---

## Step 3 — Configure the OAuth consent screen

Google requires a consent screen before it will issue tokens.

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** and click **Create**.
3. Fill in the required fields:
   - **App name**: anything (e.g. `Café Latte`)
   - **User support email**: your email
   - **Developer contact email**: your email
4. Click **Save and Continue** through the Scopes screen (you don't need to add scopes here — the app requests them at runtime).
5. On the **Test users** screen, click **Add users** and add your Google account email. This is required while the app is in *Testing* status; only listed test users can authorize it.
6. Click **Save and Continue**, then **Back to Dashboard**.

> **Note**: You do not need to go through Google's verification process. Keeping the app in *Testing* mode is fine for personal use — tokens just expire after 7 days instead of never. If you want longer-lived tokens, you can publish the app (no review needed for apps with only drive/sheets scopes used by yourself).

---

## Step 4 — Create OAuth 2.0 credentials

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Set **Application type** to **Desktop app**.
4. Give it a name (e.g. `Café Latte Desktop`) and click **Create**.
5. Copy the **Client ID** and **Client Secret** from the dialog (or download the JSON and open it).

> **Redirect URIs**: You do **not** need to add any redirect URIs manually. Google allows any `http://localhost` port for Desktop app credentials, which is how the app catches the OAuth callback.

---

## Step 5 — Enter your credentials into the app

The app stores your credentials locally in its data directory (via `electron-store`) — they are never sent anywhere other than Google's servers.

Until the settings UI is built, enter them via the DevTools console (press `Ctrl+Shift+I` inside the app):

```js
await window.api.gdriveSetCredentials({
  clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
  clientSecret: 'YOUR_CLIENT_SECRET',
});
```

---

## Step 6 — Authorize the app

Call `gdriveStartAuth()` from the DevTools console (or click the Connect button once the UI is ready):

```js
await window.api.gdriveStartAuth();
```

This will:
1. Open your default browser to Google's consent screen.
2. Ask you to sign in (if needed) and grant access to Drive and Sheets.
3. Redirect back to a local page that says "Authorization successful!" — you can close that tab.
4. Return `{ success: true }` in the console.

Your tokens are now saved. You will not need to repeat this until you explicitly log out or the app's testing-mode token expires (7 days), at which point just call `gdriveStartAuth()` again.

---

## Verifying the connection

```js
// Should return { connected: true }
await window.api.gdriveGetSavedAccount();
```

## Disconnecting

```js
await window.api.gdriveLogout();
```

This clears the local tokens. It does **not** revoke the authorization on Google's side — you can do that from [myaccount.google.com/permissions](https://myaccount.google.com/permissions) if needed.
