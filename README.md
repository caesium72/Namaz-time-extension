# Namaz Timing Extension

<p align="center">
  <img src="assets/namaz-timing-extension-logo.png" alt="Namaz Timing Extension" width="220">
</p>

<p align="center">
  A pinned browser popup showing all 5 daily prayer times with a live countdown ring,
  sunrise/sunset, a mini calendar, and an optional floating on-page widget —
  wrapped in a dark liquid-glass UI.
</p>

---

## ✨ Features

- **Live waqt ring** — Pomodoro-style circular countdown for the currently active
  prayer window, with a rotating red → violet → blue → navy gradient stroke
- **Full salat list** — Fajr, Dhuhr, Asr, Maghrib, Isha, each with its time range
  and the active one highlighted
- **Sunrise / Sunset chips** in the header
- **Mini Hijri-aware calendar**, toggleable from the header icon
- **Floating widget** — a small draggable countdown ring pinned to every page
  (`<all_urls>`), transparent liquid-glass background, breathing/glow/bob
  animations, on by default
- **Notifications** — OS notification + toolbar badge when a prayer time begins
- **Settings overlay** — geolocation or manual city search, choice of
  calculation method (MWL, ISNA, Egyptian, Makkah, Karachi, Tehran, Jafari)
- Powered by the [Aladhan API](https://aladhan.com/prayer-times-api)

## 📦 Install (unpacked, Chrome)

1. Download/clone this folder.
2. Go to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `chrome/` folder.
5. Click the extension icon, allow location access (or set your city manually
   in settings), and pin it from the toolbar for quick access.

## 🗂️ Project structure

```
chrome/
├── manifest.json         # MV3 manifest — popup, background, content script
├── popup.html             # Popup UI markup
├── css/
│   ├── popup.css           # Popup styling — dark glass theme, ring, blobs
│   └── overlay.css         # Floating widget styling — transparent glass, animations
├── js/
│   ├── core.js              # Prayer-window math, Aladhan API calls, caching
│   ├── popup.js              # Popup logic — renders ring/list/calendar/settings
│   ├── background.js          # MV3 service worker — daily refresh alarm, notifications
│   └── content.js              # Injects the floating widget into every page
├── icons/                # Extension icons (16/32/48/128)
├── assets/                # README/banner images
└── README.md
```

## 🎨 Theme

Dark liquid-glass design. Every panel uses `backdrop-filter: blur()` over a
translucent dark-navy base, with three slow-drifting blurred color blobs behind
the cards. Accent palette is intentionally limited to:

| Color | Hex |
|---|---|
| Red | `#ef4444` |
| Violet | `#8b5cf6` |
| Blue | `#3b82f6` |
| Navy | `#1e2a6e` |

## 🔒 Permissions

| Permission | Why |
|---|---|
| `storage` | Cache prayer times, location, and settings locally |
| `alarms` | Schedule the daily midnight refresh |
| `notifications` | Alert when a prayer time begins |
| `geolocation` | Auto-detect location for prayer time calculation |
| `host_permissions: api.aladhan.com` | Fetch prayer timings |

No data leaves your device except the coordinates sent to the Aladhan API to
compute times — nothing is tracked or stored remotely.

## 🛠️ Notes for Firefox

This build targets Chrome (MV3, `service_worker`). A Firefox-compatible build
(MV3 with `background.scripts[]` + a `browser_specific_settings.gecko` block)
can be generated from the same `js/`, `css/`, and `popup.html` sources on
request.
