# Setup and maintenance

## One-time: add the signing key to GitHub

The APK is signed with a release key so each new version installs over the old one
and keeps everyone's progress. The key lives in GitHub as Actions secrets; it is never
committed to the repo.

1. On GitHub, open the repo → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**.
2. Add these secrets (values are in the `signing-key-secrets.txt` file from Claude):
   - `ANDROID_KEYSTORE_BASE64`: the long base64 text
   - `ANDROID_KEYSTORE_PASSWORD`: the password
   - `ANDROID_KEY_ALIAS`: `wrc`
3. Go to **Actions** → **Build APK** → **Run workflow**.

Keep a private backup of `release.jks` and the password (a password manager is ideal).
If the key is lost, future versions can't install over existing ones: everyone would have
to uninstall (losing progress unless they use the backup code first).

## Getting the app

Each build publishes a GitHub Release named "Warframe Relic Companion 1.0.N" with the APK
attached. Open **Releases** on the phone, download the `.apk` and open it. Android asks
once to allow installs from the browser.

## How data updates work

- `data/relics.json` is the dataset. Every app downloads it from
  `raw.githubusercontent.com` when it opens and keeps a copy for offline use.
- The **Update relic data** workflow rebuilds it every 6 hours with
  `scripts/build-data.mjs` from:
  - WFCD warframe-items: Prime items, parts, relic contents, stats, variants, unique mods
  - DE's official drop tables: which relics drop where ("By the Rates" farms) and
    which relics are vaulted (not in any mission table)
  - The WARFRAME Wiki: which weapons have an Incarnon Genesis
- It only commits when something changed, so no new APK is needed for data changes.
- Live info (Baro, Darvo, Teshin, Varzia, fissures) comes straight from
  `api.warframestat.us`, with DE's `worldState.php` as a fallback.

## Files you can edit by hand

Editing any of these on GitHub re-runs the data workflow, and the change reaches every
phone on its next launch.

- `data/community-farms.json`: the "Community-Driven" farm per relic tier, plus optional
  per-relic overrides.
- `data/vault-watch.json`: announced vaultings or upcoming Prime Resurgence lineups. Starred
  items that match get the pulsing red exclamation mark until the date passes. Varzia's
  current stock is detected automatically and doesn't need an entry.
- `data/overrides.json`: corrections, e.g. an Incarnon the wiki parse missed, or a note on
  one item.

## Repo layout

- `web/`: the app (HTML, CSS, JS). Open `web/index.html` in a desktop browser to try it;
  copy `data/relics.json` into `web/data/` first.
- `android/`: the minimal Android shell (one WebView activity).
- `scripts/build-data.mjs`: the data builder.
- `.github/workflows/`: `build-apk.yml` (APK + release), `update-data.yml` (data).
- `legacy/prime-checklist.html`: the original prototype the look comes from.
