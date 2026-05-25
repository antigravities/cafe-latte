# Cafè Latte

A small program that manages batch Steam activations from Google Drive sheets.
This is heavily tuned to my use but I'm releasing it in case it's useful to others.

Note that you will need to set up your own Google API credentials and have a spreadsheet format that looks like this to use the tool:

| Game Name | Key | Status |
|---|---|---|
| Example Game | ABCDE-FGHIJ-KLMNO | (blank) |
| Another Game | PQRST-UVWXY-Z1234 | (blank) |
| ... | ... | ... |

Before activating anything, the script will check if you own the game as described in the Game Name column, so it's worth trying to keep that as accurate as possible to avoid wasting activation attempts. Then, if the game isn't already owned, the script will attempt to redeem each key via the Steam API. The status is then written back to the "Status" column and the column is highlighted in green for success, red for failed, or light blue for skipped. It also handles rate limits by pausing and resuming after a cooldown period.

## License

Where applicable, this project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE.md) for details.

```
Copyright (C) 2026 Alexandra Frock

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```