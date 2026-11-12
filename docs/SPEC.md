# Warframe Relic Companion: build spec

This is the agreed plan for the Android app. Everything here was settled with the owner (LowBudgetAtheon) in a chat on 2026-11-12. Build to this spec. If something isn't covered, ask the owner before guessing.

## Starting point

- `legacy/prime-checklist.html` is the working prototype. **Keep its look exactly**: colors, fonts (Rajdhani + Inter), card layout, checkboxes, progress bars, chips and overall organization. That becomes the "Orokin Dark" theme.
- The prototype's data (weapon parts, relic sources, frame list) is a seed only. Rebuild the full dataset from the sources below.
- The owner's inventory ticks in the prototype are **not** carried over. Every install starts blank.

## Delivery

- Android APK, built by GitHub Actions in this repo, published as a GitHub Release so friends can download it.
- Build approach: the app is a web app (HTML/CSS/JS) wrapped in a native Android shell (Capacitor or a minimal WebView wrapper). The Android SDK isn't available in Claude's workspace, so all compiling happens in GitHub Actions.
- Sign the APK with a release key stored as a GitHub Actions secret, so updates install over older versions.
- App name: **Warframe Relic Companion**.
- On launch: a short, polished intro animation, then straight into the app.

## Data and updates

- Relic and item data lives in a JSON file in this repo (for example `data/relics.json`). The app downloads it from `raw.githubusercontent.com` each time it opens, so updating the file updates every user's app without a reinstall.
- **Offline mode:** the app caches the last downloaded data and still works without a connection. Show a small "updated X ago" line.
- Live data comes from `api.warframestat.us` (PC/crossplay worldstate): voidTrader (Baro), dailyDeals (Darvo), steelPath (Teshin), fissures, and the Varzia / Prime Resurgence stock if the API covers it. Fall back to `content.warframe.com/dynamic/worldState.php` if needed.
- Data sources to build from:
  - WARFRAME Wiki (`wiki.warframe.com`): relic contents, vault status, Incarnons, variants, unique mods.
  - DE's official drop tables (`warframe.com/droptables`, which forwards to `warframe-web-assets.nyc3.cdn.digitaloceanspaces.com`): drop rates and mission rewards for the "By the Rates" farm.
  - WFCD community data on `raw.githubusercontent.com` (warframe-items, warframe-drop-data) for cross-checking.

## User data

- All ticks, stars, mastered flags, settings and dismissed alerts are saved on the device. Closing the app keeps them, and each person's phone has its own progress.
- **Backup code:** copy a short code out and paste it back in to restore progress on a new phone. It lives at the bottom of the side menu.

## Navigation: four swipeable pages, left to right

1. **Rotating** (furthest left): every vendor with rotating stock, with their current items.
   - Baro Ki'Teer: countdown to his next arrival (or his departure while he's here), which relay he's at, and his current inventory. Write his name as "Baro Ki'Teer", not an icon.
   - Darvo's daily deal, Teshin's weekly Steel Path item, and Varzia's Prime Resurgence stock if available.
2. **Relic Runs:** an at-a-glance page to check while you're in a relic mission.
   - Top: the **High value** panel, a live list of relics that contain parts for **two or more different starred items**. It has a minimize button that collapses it into a slim header you can tap to expand again.
   - Then: the live Void Fissures running now, highlighting tiers that match relics you need. Always shown.
   - Then: the full list of relics for every part you're missing, across all items.
3. **Favorites:** every starred item.
   - At the very bottom: the **trade chat helper**, covered below.
4. **Main** (furthest right): every Prime set.
   - The page header is a dropdown that switches between the Prime categories: All, Weapons, Warframes, Archwing, Arch-gun, Arch-melee, Companions, and Other (a catch-all).
   - The Weapons view is split into Primary, Secondary, Melee and so on.
   - A search bar at the top.
   - Every item has a tappable **star** that adds it to Favorites.
   - A **Mastered toggle** on each item. Marking an item mastered hides it from Main, so the list shrinks as you go.

## Items

- List every Prime item. Base, non-Prime versions are left out (for example Bronco Prime is listed, but plain Bronco isn't).
- Each item shows a checkbox for each part, the same way the prototype does.
- **Weapons made from other weapons** (Akvasto Prime, Akmagnus Prime and the like): show checkboxes for the item's own Blueprint and Link, plus one dropdown per required weapon (for example "Vasto Prime #1" and "Vasto Prime #2"), each with its own part checkboxes that you tick separately.
- **Tapping an item expands it** (on Favorites and Main alike) to show:
  - The relics that contain each part, with a rarity badge for each one. Rarity badges always show.
  - The best farm for each relic, shown according to the side-menu toggle.
  - If **every relic for a part is vaulted**, they go in a dropdown with each relic marked "Vaulted". Any **Prime Resurgence** relics that contain the part are listed at the top of that dropdown, along with the Warframe they come back alongside.
  - Whether the item has an **Incarnon**. Always shown.
  - Whether it has **variants** (Kuva, Tenet, Prisma, Coda and so on). Has an on/off switch.
  - Its **unique mods** and where to get them, if it has any. Has an on/off switch.
  - If an item has **both an Incarnon and a variant**, both are inside one dropdown that also lists the differences between the Incarnon Prime and the variant. Inside that dropdown, variant info always shows, even if the variant switch is off.
- **Vault Watch:** a starred item whose relics are about to be vaulted, or that's coming back through Prime Resurgence, gets a small red exclamation mark with a soft red gradient circle that pulses.
  - It pulses until tapped. After that it stays, without pulsing, until the vaulting actually happens.
  - Tapping it opens a short card explaining what's happening, for example "Relics may be vaulted soon".
  - Items with nothing coming up show no icon at all.

## Trade chat helper (bottom of Favorites)

- Builds "want to buy" messages for the parts you're missing on **starred items only**.
- Format: `WTB [Kronen Prime Blade] [Tekko Prime Gauntlet] PMO`. "WTB" and "PMO" are always in capitals, and each part is wrapped in square brackets the way in-game item links appear.
- Trade chat allows 180 characters per message. Players report getting cut off just under that, so keep each message at **about 170 characters**. That includes the WTB and PMO.
- When the parts don't fit in one message, split them into a numbered list of messages. Each one starts with WTB and ends with PMO and has its own copy button.
- The owner and their friends play on Xbox.

## Side menu

- Opens from the very left edge of the screen, or from a small menu button in a corner. A normal swipe moves between pages instead.
- Covers about half the screen, with everything behind it dimmed.
- Contents, top to bottom:
  1. **Settings**
     - Themes (seven):
       - **Orokin Dark** (default): the prototype's black and gold.
       - **Orokin Light:** ivory and gold.
       - **Grineer:** rusty reds and gunmetal.
       - **Corpus:** clean blues and white.
       - **Infested:** sickly, gangrenous greens and fleshy pinks.
       - **Void:** near-black with a pale cyan-green highlight, like the Void glow around the Zariman Ten Zero.
       - **Sentient:** metallic bone and skin tones with dull bronze accents.
     - Info switches: unique mods, drop chances, vaulted relic lists, Prime Resurgence notes, and variant info (variant info has the Incarnon-dropdown exception above).
     - Always shown, with no switch: current fissures, relic rarity badges, Incarnon info.
  2. **Farm source toggle**, a three-position switch:
     - Left, "By the Rates": the best farm for each relic worked out from DE's drop tables.
     - Right, "Community-Driven": the farm players recommend.
     - Middle: both, with By the Rates on top and Community-Driven just below it. If the two agree, show it once.
  3. Empty space for future additions.
  4. At the very bottom: **Backup / restore code**.

## Ideas the owner turned down (don't add these)

Ready-to-build badge, ducat tags, push notifications, relic inventory counter, squad share code, undo of recent ticks, mastery XP tracker, build-order suggestions, refinement hints, home-screen widget.
