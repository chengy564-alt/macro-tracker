# Macro Log

A personal calorie and macro tracker (calories, protein, carbs, fat and sodium). It's a static site: no server and no paywall.

- **Barcode scanning.** Uses the phone camera and looks products up in [Open Food Facts](https://world.openfoodfacts.org) (free). Anything it can't find, you add once and it's remembered.
- **Food library.** Includes ~45 built-in basics (rice, chicken, eggs…), plus anything you've scanned or typed in, sorted by most recent.
- **Photo → Claude (free, no API key).** Tap *Copy prompt* and add a note like "180g cooked rice, 2 chicken thighs…". In the Claude app, attach the photo and paste the prompt. Then paste Claude's reply back into the tracker. It becomes an editable list of items with grams and macros. The same flow turns a nutrition-label photo into a new food. This uses your normal Claude plan.
- **Game layer** to keep you consistent:
  - **XP & levels.** You earn XP for logging meals, hitting protein, landing your calories and staying junk-free. Junk, overeating and skipped days *cost* XP, and you can drop a level.
  - **Streak.** Counts days with 2+ main meals logged. Each day in a row adds +5% XP, up to +70%. A junk or over-target day gets no bonus.
  - **Daily quests, junk alerts** (with an undo), and **badges**.
  - **Weigh-ins & cut coach.** The coach tracks your 7-day average weight, kg/week and weeks to goal, and tells you when to adjust.
  - Everything is computed from your log, so it's the same on every device and fixes itself if you edit a past day.
- **Sync** between iPhone and computer. Your log is stored as `data.json` in a private GitHub repo.

## Setup

### 1. Turn on the website (GitHub Pages)
On the repo that holds these files: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
After a minute the site is at `https://<your-username>.github.io/<repo-name>/`.

### 2. Sync between phone and computer (optional, recommended)
1. Create a **new private repo**, e.g. `macro-data`. Leave it empty.
2. Create a token at **GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token**:
   - Repository access: **Only select repositories → `macro-data`**
   - Permissions → Repository permissions → **Contents: Read and write**
   - Pick an expiration you're happy with. When it expires, sync stops (the dot turns red) until you paste a new one.
3. In the app, open **⚙ Settings** and enter your username, `macro-data` and the token. Do this on each device.

The token is stored only in that browser. It's never written to the data file.

### 3. On iPhone
Open the site in Safari → Share → **Add to Home Screen**. It then opens full-screen like an app.
This also stops Safari from clearing the site's storage after a week of not using it. Sync protects you either way.

## Tips
- The coloured dot in the top bar shows sync status: green = synced, yellow = syncing, red = problem (tap ⚙ to see why).
- Tap any logged item to change grams, meal or date, or to delete it.
- Drinks: enter ml as grams (close enough for most drinks).
- Items Claude estimated are marked "est.". Weights you give it are used exactly; portions it guesses from the photo are usually within ±20–30%.
