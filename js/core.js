/**
 * core.js — pure logic, no DOM access.
 * Shared by popup.js, background.js and content.js.
 * Exposed on `self.PrayerCore` so it works in both window and service-worker contexts.
 */
(function (root) {
  "use strict";

  const ALADHAN_BASE = "https://api.aladhan.com/v1";

  // Aladhan calculation methods we expose in Settings.
  const METHODS = [
    { id: 1, label: "University of Islamic Sciences, Karachi" },
    { id: 2, label: "Islamic Society of North America (ISNA)" },
    { id: 3, label: "Muslim World League" },
    { id: 4, label: "Umm al-Qura, Makkah" },
    { id: 5, label: "Egyptian General Authority" },
    { id: 7, label: "Institute of Geophysics, Tehran" },
    { id: 8, label: "Gulf Region" },
    { id: 12, label: "Union Organization Islamic de France" },
    { id: 13, label: "Diyanet, Turkey" },
  ];

  const WAQTS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

  const WAQT_ICON = {
    Fajr: "\u{1F319}",     // crescent moon
    Dhuhr: "\u{2600}",     // sun
    Asr: "\u{26C5}",       // sun behind cloud
    Maghrib: "\u{1F54C}",  // mosque
    Isha: "\u{1F303}",     // night with stars
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function fmtDateForApi(date) {
    // Aladhan wants DD-MM-YYYY
    return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  // Aladhan times sometimes arrive as "05:12 (BDT)" — strip the suffix.
  function parseTimeOn(hhmm, baseDate) {
    const clean = String(hhmm).split(" ")[0];
    const [h, m] = clean.split(":").map(Number);
    const d = new Date(baseDate);
    d.setHours(h, m, 0, 0);
    return d;
  }

  async function fetchTimingsByCoords(lat, lng, method, date) {
    const url = `${ALADHAN_BASE}/timings/${fmtDateForApi(date)}?latitude=${lat}&longitude=${lng}&method=${method}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Aladhan API error ${res.status}`);
    const json = await res.json();
    if (json.code !== 200) throw new Error("Aladhan API returned non-200 code");
    return json.data;
  }

  async function fetchTimingsByCity(city, country, method, date) {
    const url = `${ALADHAN_BASE}/timingsByCity/${fmtDateForApi(date)}?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=${method}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Aladhan API error ${res.status}`);
    const json = await res.json();
    if (json.code !== 200) throw new Error("Aladhan API returned non-200 code");
    return json.data;
  }

  /**
   * Builds the 5 salat windows for "today" plus the parsed clock-times object.
   * Needs tomorrow's Fajr to correctly close the Isha window.
   */
  function buildDayModel(todayData, tomorrowFajrHHMM, baseDate) {
    const timings = todayData.timings;
    const t = {};
    for (const key of ["Fajr", "Sunrise", "Dhuhr", "Asr", "Sunset", "Maghrib", "Isha"]) {
      t[key] = parseTimeOn(timings[key], baseDate);
    }
    const tomorrowFajr = parseTimeOn(tomorrowFajrHHMM, addDays(baseDate, 1));
    // Yesterday's Isha, approximated by subtracting 24h (Isha drifts by seconds/day, negligible here).
    const prevIsha = new Date(t.Isha.getTime() - 24 * 60 * 60 * 1000);

    const windows = [
      { key: "Fajr", start: t.Fajr, end: t.Sunrise },
      { key: "Dhuhr", start: t.Dhuhr, end: t.Asr },
      { key: "Asr", start: t.Asr, end: t.Maghrib },
      { key: "Maghrib", start: t.Maghrib, end: t.Isha },
      { key: "Isha", start: t.Isha, end: tomorrowFajr },
    ];
    const prevWindow = { key: "Isha", start: prevIsha, end: t.Fajr };

    return {
      t,
      windows,
      prevWindow,
      hijri: todayData.date.hijri,
      gregorian: todayData.date.gregorian,
    };
  }

  /**
   * Determines which waqt is currently "live" (mode: ends) or, if we're in a
   * gap (e.g. Sunrise -> Dhuhr), which one is coming up next (mode: begins).
   */
  function computeActiveWaqt(model, now) {
    if (now < model.t.Fajr) {
      const w = model.prevWindow;
      return {
        mode: "ends",
        key: w.key,
        start: w.start,
        end: w.end,
        progress: clamp01((now - w.start) / (w.end - w.start)),
      };
    }
    for (const w of model.windows) {
      if (now >= w.start && now < w.end) {
        return {
          mode: "ends",
          key: w.key,
          start: w.start,
          end: w.end,
          progress: clamp01((now - w.start) / (w.end - w.start)),
        };
      }
    }
    // In a gap — find the next window that hasn't started yet.
    for (const w of model.windows) {
      if (w.start > now) {
        return {
          mode: "begins",
          key: w.key,
          start: w.start,
          end: w.start,
          progress: 0,
        };
      }
    }
    // Fallback (shouldn't happen): tomorrow's Fajr via Isha window end.
    const isha = model.windows[model.windows.length - 1];
    return { mode: "begins", key: "Fajr", start: isha.end, end: isha.end, progress: 0 };
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(m)}:${pad2(s)}`;
  }

  function formatClock12(date) {
    let h = date.getHours();
    const m = date.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${pad2(m)} ${ampm}`;
  }

  root.PrayerCore = {
    METHODS,
    WAQTS,
    WAQT_ICON,
    isoDate,
    addDays,
    fetchTimingsByCoords,
    fetchTimingsByCity,
    buildDayModel,
    computeActiveWaqt,
    formatCountdown,
    formatClock12,
    parseTimeOn,
  };
})(typeof self !== "undefined" ? self : this);
