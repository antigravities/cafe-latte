# Café Latte

This is a project to asynchronously redeem Steam keys sourced from a Google sheet. The users of this project may have hundreds of backlogged keys at a particular time and want to redeem them as quickly as possible, but they don't want to have to babysit the process. This project will allow users to set-and-forget the redemption process, and it will automatically update the spreadsheet with the results of each redemption attempt.

We are building this project for personal use, but we will make the code public on GitHub when it's in a usable state. We are building this project in JavaScript using Electron for the desktop app and the Google Sheets API to interact with the spreadsheet. Do not use a complicated JavaScript framework like React or Vue, the app should be plain HTML/JS only. The UI can be based on Bootstrap or, at your suggestion, any other framework that makes it easy to build a simple and clean interface. We will also need to use the Steam API (both the Web and Storefront APIs and CM connections via node-steam-user) to check the user's library and redeem keys.

We are building this project step-by-step, starting with the basic flow and then adding features and improvements as we go. The basic flow is outlined below, but we may make changes to it as we build the project and encounter any issues or edge cases. Do not stray too far from the current task when working and try to keep diffs small and focused on the current step, to make it easier to review and merge changes. The outline of the project is being provided so you can keep future enhancements in mind as you propose and make changes, but ALWAYS focus on the task at hand.

The user is a near-expert at Node.js, Electron, and JavaScript, but please document methods and explain any complex code or logic in detail in comments, so that it's easy for us and future agents to understand the code and the reasoning behind it when we review the changes.

This is extremely important: as you implement more features, update this document's "what is implemented" / "what is not implemented" and include any relevant information about the implementation, such as new dependencies, changes to the file structure, or any other details that may be helpful for understanding the codebase and how to work with it.

## User Interface

The app itself should be a simple Electron app that has a few screens:

1. A screen to log in to Steam using the user's account name, password, and 2FA code (if applicable).
2. A screen to connect to Google Drive and select a spreadsheet that contains the Steam keys to redeem.
3. A screen to display the number of Steam keys that have been redeemed and the number still pending out of the Google sheet.

## Basic flow

1. The user logs in to Steam and connects to Google Drive.
2. The user selects a spreadsheet that contains the Steam keys to redeem.

Every 15 minutes, the app should automatically check the spreadsheet for any keys that have not been redeemed yet (i.e. any lines that have a blank activation status) and for every line in the spreadsheet:
1. Check if the line has a blank activation status. If it does not, skip it.
2. Check the game/DLC name(s).
    a. If the game is obviously in the user's library (you may need to search with the Storefront API or use GetAppList), the line in the spreadsheet should be marked as "Already in library" and skipped.
3. If the app cannot tell if the game or DLC is in the user's library, it should attempt to redeem the key.
    a. If the redemption is successful, the line in the spreadsheet should be marked as "Success [packageID, packageName]" (where packageID and packageName are the ID and name of the package that was redeemed). A GREEN highlight should be applied to the line to visually indicate that the redemption was successful.
    b. If the redemption fails, the line in the spreadsheet should be marked as "errorCode [packageID, packageName]" (where errorCode is the error message returned by Steam and packageID and packageName are only displayed where they can be obtained). Additionally, the app should pop a notification to the user with the error message and the game/DLC name, so that they can be aware of any issues that need to be resolved (e.g. if a key is invalid). A RED highlight should be applied to the line to visually indicate that the redemption failed.
4. If the user has activated too many keys and is rate-limited, the app should AUTOMATICALLY wait until the rate limit is lifted and then continue redeeming keys, without any user intervention needed. The app should also pop a notification to the user that it has hit the rate limit. You can run this process to check how many keys are in the sheet but do NOT redeem another key until one hour and 2 minutes have passed since the last redemption attempt, to be safe. You should save the timestamp of the last redemption attempt and check it before redeeming another key, to ensure that you don't accidentally redeem a key while still rate-limited and in case the app is closed and re-opened.

## Spreadsheet

The spreadsheet will look like this:

| Game name | Key | Activation status |
| --------- | --- | ----------------- |
| Arc Raiders | ABCDE-FGHIJ-KLMNO | DuplicateActivationCode [650214, Arc Raiders] |
| Hellblade: Senua's Sacrifice | PQRST-UVWXY-ZABCD | Success [197048, Hellblade: Senua's Sacrifice] |
| Hades | EFGHI-JKLMN-OPQRS |  |
| Lethal Company | TUVWX-YZABC-DEFGH |  |

- Any lines that have a *blank* activation status have not been activated yet and are eligible for redemption.
- Any lines that have a *non-blank* activation status have already been redeemed and should be skipped.
    - When you activate a key, always update the activation status with the name of the package (where available) and result of the activation attempt, both so that the user knows the game was activate and so it doesn't get redeemed again in the future.
    - Also highlight the line(s) red/green/etc. to visually indicate whether the activation was successful or not.

## Codebase Map

### File structure
```
src/
main.js          — Electron main process: BrowserWindow creation, wires store + modules
steam.js         — Steam auth module: state, helpers, IPC handler registration
gdrive.js        — Google Drive/Sheets OAuth module: loopback auth flow, token persistence
sheets.js        — Google Sheets API logic: enumerating sheets
preload.js       — contextBridge: exposes window.api to renderer
renderer/
    app.js         — Renderer entry point
    steam.js       — Steam UI logic and IPC calls
    gdrive.js      — Google Drive UI logic and IPC calls
public/
    index.html       — Single-page shell; three page divs toggled by JS
docs/
    gdrive.md        — Step-by-step guide: getting Google Cloud credentials and authorizing the app
electron-builder.yml — Builds to dist/ as Windows NSIS installer
```

### Key dependencies
| Package | Version | Purpose |
|---|---|---|
| `steam-user` | 5.3.0 | Steam CM connections, key activation, library queries |
| `googleapis` | 172.0.0 | Google Sheets/Drive API |
| `bootstrap` | 5.3.8 | UI — loaded directly from `node_modules/bootstrap/dist/` |
| `fuse.js` | 7.x | Fuzzy search for spreadsheet picker — imported as ESM from `node_modules/fuse.js/dist/fuse.mjs` |
| `electron-store` | 11.0.2 | Persistent config/state |
| `electron` | 42.2.0 | App runtime (devDep) |

### IPC surface

Handlers are registered via `registerHandlers(ipcMain, store)` in the respective module.

**Steam (`src/steam.js`)**

| IPC channel | `window.api` method | Description |
|---|---|---|
| `steam:login` | `steamLogin({ accountName, password, twoFactorCode?, authCode? })` | Fresh login; resets prior SteamUser instance |
| `steam:submit-steam-guard` | `steamSubmitSteamGuard(code)` | Submits SteamGuard code after a pending auth challenge |
| `steam:get-saved-account` | `getSavedAccount()` | Returns `{ accountName }` if a valid token is stored, else null |
| `steam:login-with-token` | `steamLoginWithToken()` | Logs in using the stored refresh token |
| `steam:clear-saved-account` | `steamClearSavedAccount()` | Clears the stored account and refresh token |

**Google Drive (`src/gdrive.js`)**

| IPC channel | `window.api` method | Description |
|---|---|---|
| `gdrive:set-credentials` | `gdriveSetCredentials({ clientId, clientSecret })` | Saves GCP OAuth client credentials to store (one-time setup) |
| `gdrive:start-auth` | `gdriveStartAuth()` | Opens system browser for OAuth consent; blocks until complete (5 min timeout) |
| `gdrive:get-saved-account` | `gdriveGetSavedAccount()` | Returns `{ connected: true }` if tokens exist, else null |
| `gdrive:logout` | `gdriveLogout()` | Clears stored OAuth tokens |

All handlers return `{ success: true }` or `{ success: false, reason, ... }`.

`src/gdrive.js` also exports `getAuthenticatedClient(store)` — returns a pre-credentialed `OAuth2Client` for use by future modules (e.g. sheets.js) that need to make API calls.

### UI pages (`public/index.html`)
Three `<div>` page containers toggled with Bootstrap's `d-none`:
- `#page-login` — Steam login form (visible by default)
- `#page-connect` — Google Drive connection + spreadsheet picker
- `#page-dashboard` — Redemption progress view

### What is implemented
- Steam login + SteamGuard two-step auth (`src/steam.js` + `src/preload.js`)
- Refresh token persistence and auto-login via `electron-store` (`src/steam.js`)
- BrowserWindow creation with contextIsolation + no nodeIntegration (`src/main.js`)
- Google Drive OAuth 2.0 loopback-redirect flow (`src/gdrive.js`): opens system browser, catches redirect on an ephemeral localhost server, exchanges code for tokens, persists to store
- `getAuthenticatedClient(store)` helper exported from `gdrive.js` for use by future sheets/API modules
- Spreadsheet selection backend (`src/sheets.js`): lists all Drive spreadsheets (paginated), persists selection to store
- Full renderer UI for all three pages (`src/renderer/steam.js`, `src/renderer/gdrive.js`, `src/renderer/app.js`)
  - Steam: saved-account banner, manual login form, SteamGuard challenge
  - Google Drive: credential entry, OAuth flow, spreadsheet picker with Fuse.js fuzzy search, pre-selects previously chosen sheet on return visits
- Dashboard UI with redemption stats (total/pending counts) with force refresh

### What is NOT yet implemented
- Spreadsheet reading (rows, keys, activation status)
- Key redemption logic (`steam-user` `activateKey` / `requestFreeLicense`)
- Library ownership check (Storefront API / GetAppList)
- Rate-limit detection, 62-minute cooldown, and last-redemption timestamp persistence
- 15-minute polling loop
- Desktop notifications for errors and rate-limit events
- Spreadsheet row coloring (green/red) on redemption result