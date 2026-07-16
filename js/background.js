// background.js — MV3 service worker (Chrome) / event page (Firefox MV3)
// Loaded together with core.js (declared in manifest "scripts" / imported below).

try {
  importScripts("core.js");
} catch (e) {
  // Firefox MV3 background scripts loaded via "scripts" array already include core.js;
  // importScripts is a no-op failure there, safe to ignore.
}

const C = self.PrayerCore;
const runtime = typeof browser !== "undefined" ? browser : chrome;
const storage = runtime.storage.local;

const DAILY_ALARM = "prayer-daily-refresh";
const MINUTE_ALARM = "prayer-minute-check";

runtime.runtime.onInstalled.addListener(() => {
  setupAlarms();
  refreshTimings();
});

runtime.runtime.onStartup?.addListener(() => {
  setupAlarms();
  refreshTimings();
});

runtime.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DAILY_ALARM) {
    refreshTimings();
  } else if (alarm.name === MINUTE_ALARM) {
    checkForPrayerStart();
    updateBadge();
  }
});

runtime.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "PRAYER_DATA_UPDATED") {
    updateBadge();
  }
});

function setupAlarms() {
  runtime.alarms.create(DAILY_ALARM, { periodInMinutes: 24 * 60 });
  runtime.alarms.create(MINUTE_ALARM, { periodInMinutes: 1 });
}

async function refreshTimings() {
  const saved = await storage.get(["location", "method"]);
  if (!saved.location) return;
  try {
    const today = new Date();
    const tomorrow = C.addDays(today, 1);
    const method = saved.method || 1;
    const { lat, lng, city, country } = saved.location;

    const [todayData, tomorrowData] = lat != null
      ? await Promise.all([
          C.fetchTimingsByCoords(lat, lng, method, today),
          C.fetchTimingsByCoords(lat, lng, method, tomorrow),
        ])
      : await Promise.all([
          C.fetchTimingsByCity(city, country, method, today),
          C.fetchTimingsByCity(city, country, method, tomorrow),
        ]);

    await storage.set({
      cache: {
        date: C.isoDate(today),
        todayData,
        tomorrowFajr: tomorrowData.timings.Fajr,
        location: saved.location,
        method,
        fetchedAt: Date.now(),
      },
    });
    updateBadge();
  } catch (err) {
    console.error("Prayer times refresh failed:", err);
  }
}

async function getModel() {
  const saved = await storage.get(["cache"]);
  if (!saved.cache || saved.cache.date !== C.isoDate(new Date())) return null;
  return C.buildDayModel(saved.cache.todayData, saved.cache.tomorrowFajr, new Date());
}

async function checkForPrayerStart() {
  const saved = await storage.get(["notificationsEnabled"]);
  if (!saved.notificationsEnabled) return;

  const model = await getModel();
  if (!model) return;

  const now = new Date();
  for (const w of model.windows) {
    const diffMs = now - w.start;
    // Fire once, within the first ~60s after the waqt begins.
    if (diffMs >= 0 && diffMs < 60000) {
      const notifiedKey = `notified-${C.isoDate(now)}-${w.key}`;
      const already = await storage.get([notifiedKey]);
      if (already[notifiedKey]) continue;
      await storage.set({ [notifiedKey]: true });

      runtime.notifications.create(`prayer-${w.key}-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `${w.key} time has begun`,
        message: `It's time for ${w.key} — ${C.formatClock12(w.start)}.`,
        priority: 1,
      });
    }
  }
}

async function updateBadge() {
  const model = await getModel();
  if (!model) return;
  const active = C.computeActiveWaqt(model, new Date());
  const remainingMin = Math.max(0, Math.round((active.end - new Date()) / 60000));
  const label = remainingMin >= 60 ? `${Math.round(remainingMin / 60)}h` : `${remainingMin}m`;
  try {
    runtime.action.setBadgeText({ text: label });
    runtime.action.setBadgeBackgroundColor({ color: "#2f8f6f" });
  } catch (e) {
    // MV2-style fallback (unused in this build, kept defensive).
  }
}
