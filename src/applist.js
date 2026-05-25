import Fuse from 'fuse.js';

const APP_LIST_URL = 'https://api.steampowered.com/IStoreService/GetAppList/v1/';

/** @type {Map<string, number> | null} */
let appListCache = null;

/**
 * Maps a normalized name to { appid, name } for punctuation-tolerant exact matching.
 * If two apps normalize to the same string, the entry is set to null (ambiguous — skip).
 * @type {Map<string, { appid: number, name: string } | null> | null}
 */
let normalizedMapCache = null;

/** @type {Fuse | null} */
let fuseCache = null;

/**
 * Strips punctuation that commonly differs between spreadsheet entries and canonical
 * Steam names: colons, dashes, smart quotes, TM/R/C symbols. Collapses resulting
 * whitespace so "Hellblade: Senua's Sacrifice" and "Hellblade Senuas Sacrifice"
 * both normalize to "hellblade senuas sacrifice".
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeAppName(name) {
  return name
    .toLowerCase()
    .replace(/[:–—-]/g, ' ')             // colon, en-dash, em-dash, hyphen → space
    .replace(/['‘’ʼ"™®©]/g, '') // quotes + TM/R/C → remove
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Downloads the full Steam app catalog via the IStoreService/GetAppList/v1 API,
 * paginating until all apps are fetched. Returns a Map of lowercase app name to appid.
 *
 * The endpoint returns up to 50,000 results per page. With ~200,000+ apps in the catalog,
 * we typically need 4-5 pages. Pagination is driven by the `last_appid` cursor and the
 * `have_more_results` flag in each response.
 *
 * @param {string} accessToken - Steam access token from the logged-in SteamUser session
 * @returns {Promise<Map<string, number>>}
 */
async function buildAppList(accessToken) {
  const map = new Map();
  let lastAppId = undefined;

  do {
    const params = new URLSearchParams({
      access_token: accessToken,
      include_games: '1',
      include_dlc: '1',
      max_results: '50000',
    });
    if (lastAppId !== undefined) params.set('last_appid', String(lastAppId));

    const res = await fetch(`${APP_LIST_URL}?${params}`);
    if (!res.ok) throw new Error(`AppList fetch failed: HTTP ${res.status}`);

    const data = await res.json();
    const response = data?.response ?? {};
    const apps = response.apps ?? [];

    for (const app of apps) {
      if (app.name) map.set(app.name.toLowerCase().trim(), app.appid);
    }

    lastAppId = response.have_more_results ? response.last_appid : undefined;
  } while (lastAppId !== undefined);

  return map;
}

/**
 * Returns the Steam app catalog as a name→appid Map, downloading it if not yet cached.
 * Also builds the normalized map and Fuse index used by findAppId.
 * The cache lives for the duration of the app session (cleared on restart).
 *
 * @param {string} accessToken
 * @returns {Promise<Map<string, number>>}
 */
export async function getAppList(accessToken) {
  if (appListCache) return appListCache;
  appListCache = await buildAppList(accessToken);

  // Build normalized map and Fuse index in a single pass over the catalog.
  const normalizedMap = new Map();
  const fuseEntries = [];

  for (const [lcName, appid] of appListCache) {
    // Recover the canonical mixed-case name isn't stored — lcName is already lowercase.
    // We use lcName as the canonical name here since appListCache only stores lowercase.
    const normalizedName = normalizeAppName(lcName);

    if (normalizedMap.has(normalizedName)) {
      // Two apps normalize to the same string — mark ambiguous so we skip this in lookup.
      normalizedMap.set(normalizedName, null);
    } else {
      normalizedMap.set(normalizedName, { appid, name: lcName });
    }

    fuseEntries.push({ name: lcName, normalizedName, appid });
  }

  normalizedMapCache = normalizedMap;

  // Fuse index is built on normalized names so punctuation differences don't skew scores.
  fuseCache = new Fuse(fuseEntries, {
    keys: ['normalizedName'],
    threshold: 0.2,       // 0 = perfect match, 1 = no match — only very close names accepted
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 3,
  });

  return appListCache;
}

/**
 * Looks up a game name in the Steam app catalog using a three-tier strategy:
 *
 *   1. Exact case-insensitive match (fastest, most reliable)
 *   2. Normalized exact match — strips punctuation like colons, hyphens, smart quotes
 *      before comparing, so "Hellblade Senua's Sacrifice" matches the canonical
 *      "Hellblade: Senua's Sacrifice" without ambiguity
 *   3. Fuse.js fuzzy match on normalized names (threshold ≤ 0.2) — catches genuinely
 *      different spellings like "Hades 2" vs "Hades II"
 *
 * Tiers 1 and 2 set `exact: true`; tier 3 sets `exact: false`. The `matchedName` is
 * always the canonical Steam name so callers can log what was actually matched.
 *
 * Always returns null on error rather than throwing — a failed pre-check must never
 * prevent a redemption attempt.
 *
 * @param {string} accessToken
 * @param {string} gameName
 * @returns {Promise<{ appid: number, matchedName: string, exact: boolean } | null>}
 */
export async function findAppId(accessToken, gameName) {
  try {
    const map = await getAppList(accessToken); // also populates normalizedMapCache + fuseCache
    const lc = gameName.toLowerCase().trim();

    // Tier 1: exact
    const exactId = map.get(lc);
    if (exactId != null) return { appid: exactId, matchedName: lc, exact: true };

    // Tier 2: normalized exact — deterministic, no scoring ambiguity
    const normalizedQuery = normalizeAppName(gameName);
    const normalizedEntry = normalizedMapCache.get(normalizedQuery);
    if (normalizedEntry != null) {
      return { appid: normalizedEntry.appid, matchedName: normalizedEntry.name, exact: true };
    }

    // Tier 3: Fuse fuzzy on normalized names — for genuinely different spellings
    const results = fuseCache.search(normalizedQuery);
    if (results.length > 0 && results[0].score <= 0.2) {
      return { appid: results[0].item.appid, matchedName: results[0].item.name, exact: false };
    }

    return null;
  } catch {
    return null;
  }
}
