# Macro Log

A personal calorie and macro tracker (calories, protein, carbs, fat and sodium). It's a static site: no server and no paywall.

- **Barcode scanning.** Uses the phone camera and looks products up in [Open Food Facts](https://world.openfoodfacts.org) (free). Anything it can't find, you add once and it's remembered.
- **Food library.** Includes ~45 built-in basics (rice, chicken, eggs…), plus anything you've scanned or typed in, sorted by most recent.
- **Photo / AI.** Snap a plate, optionally say "180g cooked rice, 2 chicken thighs…", and Claude splits it into items with grams and macros that you can edit before adding. It can also read a nutrition-label photo straight into a new food.
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

### 3. AI photo estimates (optional)
Get an API key at [platform.claude.com](https://platform.claude.com) (pay-as-you-go; one photo costs a few cents) and paste it in **⚙ Settings**. It's stored only on that device.

### 4. On iPhone
Open the site in Safari → Share → **Add to Home Screen**. It then opens full-screen like an app.
This also stops Safari from clearing the site's storage after a week of not using it. Sync protects you either way.

## Tips
- The coloured dot in the top bar shows sync status: green = synced, yellow = syncing, red = problem (tap ⚙ to see why).
- Tap any logged item to change grams, meal or date, or to delete it.
- Drinks: enter ml as grams (close enough for most drinks).
- AI estimates are marked "est.". Weights you give it are used exactly; portions it guesses from the photo are usually within ±20–30%.
