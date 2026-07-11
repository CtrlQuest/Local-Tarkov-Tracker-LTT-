# Local Tarkov Tracker (LTT)

Local Tarkov Tracker is an unofficial, local-first Escape from Tarkov tracking tool created by **CtrlQuest**.

Repo / updates: https://github.com/CtrlQuest/Local-Tarkov-Tracker-LTT-

Current build naming: **v0.3.9**. Older internal test builds used names like v33/v34; public releases now use semantic-style version numbers.

## v0.3.9 - Bottom bar cleanup

- Removed the UTC clock from the bottom status bar.
- Kept the rest of the UI and storage behaviour unchanged.


The app is designed to run in your browser from your own PC. Personal progress is saved locally in your browser. Synced reference data is cached locally using IndexedDB where supported.

## Features

- Needed item tracker
- Raid Bag flow: found items only count after you mark a safe extract
- Hideout upgrade tracker with current-level progress
- Mission/task tracker with objectives and item/key notes
- Story chapter tracker
- Key lookup and Key Locker for owned/needed/missing keys
- All Items Lookup with paged search results
- Local/offline map viewer with zoom, pan, fullscreen and personal markers
- Flea Prices page with value-per-slot search for raid looting decisions
- Gear Locker for armour, rigs, bags, helmets, clothing and containers
- Weapon Rack for guns/builds you own
- Med Cabinet for meds, stims and healing supplies
- Export/import save file for backups


## Stash Scanner accuracy note

The Stash Scanner image OCR is experimental. Tarkov stash screenshots often include small labels, grid lines, FIR icons, durability text and stack numbers, so browser OCR can miss items or choose the wrong match.

For best results, use an external AI/OCR tool to read the screenshot first and ask it to produce a text file with **one item per line**, including quantities where possible, then upload that text file in the Stash Scanner page.

Recommended text-file format:

```text
Razor x1
TANGO6T x1
PM II 1-8 x1
Powerban x1
BGV-QDIT x1
STM 15" x1
MPX GEN1 x1
SAG MK1 x1
Magnum x30
Zvezda 5/5 x1
```

The scanner will still show a review table before importing anything into Stash.

## Quick start

1. Download or clone the project.
2. If you have offline map images, place them in:

```text
assets/maps/
```

3. Open a terminal in the project folder.
4. Run a local web server:

```bat
py -m http.server 5173
```

If `py` does not work, try:

```bat
python -m http.server 5173
```

5. Open your browser:

```text
http://localhost:5173
```

6. Press **Ctrl + F5** after updating files.

## Flea market / price data

LTT uses `tarkov.dev` as the default flea/price source because it has a free community GraphQL API and does not require a key.

The Flea Prices page can also hold optional support for Tarkov Market if you provide your own API key. Tarkov Guru is linked for manual checking, but this build does not include a stable public Tarkov Guru API integration.

Price data is reference data and can change often. Use it as a raid-looting guide, not as a guaranteed live market quote.

## Personal stash tabs

The Gear Locker, Weapon Rack and Med Cabinet tabs are manual local lists. They are not synced from your Tarkov account. They are useful for tracking gear, guns, bags, armour and meds you want to keep.

## Running without maps

The core app works without local map images. Maps will show local variants only when files exist in `assets/maps/`. Live interactive map/wiki links can still be used where available.

## Saving progress

LTT stores your personal tracker progress in your browser storage. Do not clear browser site data unless you have exported a backup first.

Use **Export** to save a JSON backup. Use **Import** to restore it later.

## Updating

To update the core app, replace these files with the newer release files:

```text
app.js
data.js
index.html
styles.css
favicon.svg
README.md
LICENSE
```

Keep your existing `assets/maps/` folder unless you are intentionally replacing your offline maps.

## Offline map credits

Offline map images are optional and are not required for the core app. If you choose to use the community map packs, the packs used during local testing were sourced from the community map collection shared on Reddit:

https://www.reddit.com/r/EscapefromTarkov/comments/sh4o0r/escape_from_tarkov_map_collection/

Credit goes to the original community map creators/authors named in those map images/posts. The app code is MIT licensed, but third-party map images are **not** automatically covered by this app's MIT license unless their original authors licensed them that way. For the clean GitHub repo, it is safest to ship the app code and let users add their own maps into `assets/maps/`.

## Data credits

This project can sync public Tarkov reference data from community sources such as tarkov.dev and can link to Escape from Tarkov Wiki/Fandom pages for live details. Third-party data remains subject to those projects' own terms and licenses.

## License

The app code in this repository is released under the MIT License. See `LICENSE`.

Escape from Tarkov and related names/assets belong to Battlestate Games. This is an unofficial fan tool and is not affiliated with Battlestate Games, TarkovTracker, tarkov.dev, Fandom, or Reddit.


## v26 changes

- Flea Prices is now the second sidebar tab.
- The duplicate Keys tab was removed; key ownership, needed/missing status, lock locations and wiki sync now live under **Keys / Locker**.
- Gear Locker, Weapon Rack and Med Cabinet can search the synced tarkov.dev item catalogue and add real items with icons/photos.
- Weapon Rack supports saved gun builds, including suppressor/muzzle, optic, grip, magazine, stock, tactical device and extra mod notes.
- The real item catalogue is pulled from tarkov.dev GraphQL data and cached locally in IndexedDB.


### v27 note

The duplicate old **Keys** tab was removed from normal navigation in v26. In v27, the wiki key sync controls have been moved into the kept **Keys / Locker** page:

- Sync Category:Keys list
- Sync all wiki key lock locations
- Enrich visible keys from wiki
- Clear wiki key cache



### Stash Scanner image URLs

The Stash Scanner can scan either a local image file or a direct screenshot/image URL, such as a ShareX/Kappa link. Paste the URL into **Stash Scanner → Upload screenshot → Paste image URL**, then press **Load URL preview** or **Scan URL**.

Browser security/CORS still applies. Some image hosts allow the tracker to read the image directly; others block local web apps from fetching image data. If a URL fails, open the image in your browser, save it, then use the normal file upload button.


## Stash Scanner text-file fallback

The Stash Scanner can scan an image, a URL, pasted text, or a `.txt` / `.csv` file from another OCR/AI tool. One item per line works best:

```text
Zvezda 5/5
sag mk1
stm 15"
Duct tape x3
```

The scanner matches those labels against the synced Tarkov item catalogue using short names and full names, then shows a review table before anything is imported into Stash. Durability-style values such as `5/5` are treated as item condition, not quantity. Quantity formats such as `x3`, `3x`, or `Duct tape x3` are parsed where possible.


## v0.3.9 scanner changes

The Stash Scanner now uses a multi-pass OCR mode by default. It scans the raw image and a contrast-enhanced image, then merges the label matches. This should catch more Tarkov labels such as `TANGO6T`, `PM II 1-8`, `STM 15"`, `MPX GEN1`, `SAG MK1`, and `Razor`.

The scanner also tries to detect stack counts near item labels. For example, two `Magnum` stacks showing `20` and `10` should be reviewed as `Magnum x30`. Quantities are still estimates, so always check the review table before pressing **Import selected to Stash**.

If OCR still misses labels, use the text-file/manual fallback with one item per line, for example:

```text
Razor
TANGO6T
PM II 1-8
Zvezda 5/5
Magnum x20
Magnum x10
```


## v0.3.9 - FIR vs buyable requirements

Needed Items now shows whether remaining uses require **Found in Raid** or can be **bought/found normally**. The item-use lookup is progress-aware, so built hideout levels and completed mission objectives are ignored.

Use **Sync Data** after updating so the app can refresh task data and hideout requirement flags where the public API provides them.


## v0.3.9 - FIR / buyable hideout requirement fix

- Hideout upgrade items now default to **Can buy / no FIR** unless the synced requirement explicitly says Found in Raid.
- Needed Items now shows clearer requirement badges for **FIR required** versus **can buy / normal**.
- Hideout cards now show the requirement mode on each item line, plus have/left counts.
- Item lookup now explains that built hideout levels and completed task objectives are ignored.
- Example: Xenomorph sealing foam for Lavatory level 3 should show as a normal/buyable hideout requirement, not FIR, unless the data explicitly marks it as FIR.


## v0.3.9 - Visible FIR / buyable labels

- Needed Items cards now clearly show requirement type badges:
  - **FIR required**
  - **Can buy / no FIR**
- Hideout requirement rows now label every item as **Can buy / no FIR** unless the requirement explicitly says Found in Raid.
- Item use lookup now has separate stat boxes for FIR required and Can buy / no FIR.
- Hideout imports now add `Can buy / no FIR` into the tracker note so the status is visible even before searching.

After updating, press **Ctrl + F5** and run **Sync Data** once if requirement data looks old.


## v0.3.9 - FIR display correction

- Fixed the Needed Items display so it no longer looks like every requirement is simply **Can buy / no FIR**.
- Hideout materials still show **Can buy / no FIR** by default, which is correct unless the requirement explicitly says Found in Raid.
- Task/mission requirements now show a separate **Task FIR** count when the synced objective says the item must be found in raid.
- Item lookup now separates **Task FIR**, **Normal / buyable**, **Hideout left**, and **Tasks left** more clearly.
- Tracking an item from lookup now stores the FIR/normal split in the tracked note.
