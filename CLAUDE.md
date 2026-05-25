# Café Latte

This is a project to asynchronously redeem Steam keys sourced from a Google sheet. The users of this project may have hundreds of backlogged keys at a particular time and want to redeem them as quickly as possible, but they don't want to have to babysit the process. This project will allow users to set-and-forget the redemption process, and it will automatically update the spreadsheet with the results of each redemption attempt.

We are building this project for personal use, but we will make the code public on GitHub when it's in a usable state. We are building this project in JavaScript using Electron for the desktop app and the Google Sheets API to interact with the spreadsheet. Do not use a complicated JavaScript framework like React or Vue, the app should be plain HTML/JS only. The UI can be based on Bootstrap or, at your suggestion, any other framework that makes it easy to build a simple and clean interface. We will also need to use the Steam API (both the Web and Storefront APIs and CM connections via node-steam-user) to check the user's library and redeem keys.

We are building this project step-by-step, starting with the basic flow and then adding features and improvements as we go. The basic flow is outlined below, but we may make changes to it as we build the project and encounter any issues or edge cases. Do not stray too far from the current task when working and try to keep diffs small and focused on the current step, to make it easier to review and merge changes. The outline of the project is being provided so you can keep future enhancements in mind as you propose and make changes, but ALWAYS focus on the task at hand.

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