(function () {
  "use strict";

  const C = self.PrayerCore;
  const storage = (typeof browser !== "undefined" ? browser : chrome).storage.local;
  const runtimeSend = (typeof browser !== "undefined" ? browser : chrome).runtime.sendMessage;

  const RING_CIRCUMFERENCE = 2 * Math.PI * 70; // r=70

  let state = {
    location: null,      // {lat,lng,city,country}
    method: 1,
    model: null,         // built day model
    tickTimer: null,
    calDate: new Date(),
    notificationsEnabled: false,
  };

  // ---------- DOM refs ----------
  const els = {
    locName: document.getElementById("locName"),
    hijriDate: document.getElementById("hijriDate"),
    sunriseTime: document.getElementById("sunriseTime"),
    sunsetTime: document.getElementById("sunsetTime"),
    ringProgress: document.getElementById("ringProgress"),
    ringIcon: document.getElementById("ringIcon"),
    ringName: document.getElementById("ringName"),
    ringCountdown: document.getElementById("ringCountdown"),
    ringMode: document.getElementById("ringMode"),
    salatList: document.getElementById("salatList"),
    statusLine: document.getElementById("statusLine"),
    calendarCard: document.getElementById("calendarCard"),
    calGrid: document.getElementById("calGrid"),
    calMonthLabel: document.getElementById("calMonthLabel"),
    calPrev: document.getElementById("calPrev"),
    calNext: document.getElementById("calNext"),
    calendarToggle: document.getElementById("calendarToggle"),
    bellToggle: document.getElementById("bellToggle"),
    locationBtn: document.getElementById("locationBtn"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    closeSettings: document.getElementById("closeSettings"),
    useGeoBtn: document.getElementById("useGeoBtn"),
    cityInput: document.getElementById("cityInput"),
    countryInput: document.getElementById("countryInput"),
    searchCityBtn: document.getElementById("searchCityBtn"),
    methodSelect: document.getElementById("methodSelect"),
    widgetToggle: document.getElementById("widgetToggle"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),
    settingsStatus: document.getElementById("settingsStatus"),
    alarmLink: document.getElementById("alarmLink"),
  };

  els.ringProgress.style.strokeDasharray = String(RING_CIRCUMFERENCE);

  // ---------- Boot ----------
  init();

  async function init() {
    populateMethodSelect();
    const saved = await storage.get(["location", "method", "notificationsEnabled", "cache", "widgetEnabled"]);
    state.location = saved.location || null;
    state.method = saved.method || 1;
    state.notificationsEnabled = !!saved.notificationsEnabled;
    els.widgetToggle.checked = saved.widgetEnabled !== false;
    updateBellIcon();

    if (saved.cache && saved.cache.date === C.isoDate(new Date()) && state.location) {
      buildModelFromCache(saved.cache);
      render();
      startTicking();
      refreshInBackgroundIfStale(saved.cache);
    } else if (state.location) {
      setStatus("Fetching prayer times…");
      await fetchAndCache();
    } else {
      setStatus("Set your location to begin.");
      els.locName.textContent = "No location set";
      openSettings();
    }

    bindEvents();
  }

  function populateMethodSelect() {
    els.methodSelect.innerHTML = "";
    for (const m of C.METHODS) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      els.methodSelect.appendChild(opt);
    }
  }

  // ---------- Data fetching ----------
  async function fetchAndCache() {
    if (!state.location) return;
    try {
      const today = new Date();
      const tomorrow = C.addDays(today, 1);
      const { lat, lng, city, country } = state.location;

      const [todayData, tomorrowData] = lat != null
        ? await Promise.all([
            C.fetchTimingsByCoords(lat, lng, state.method, today),
            C.fetchTimingsByCoords(lat, lng, state.method, tomorrow),
          ])
        : await Promise.all([
            C.fetchTimingsByCity(city, country, state.method, today),
            C.fetchTimingsByCity(city, country, state.method, tomorrow),
          ]);

      const cache = {
        date: C.isoDate(today),
        todayData,
        tomorrowFajr: tomorrowData.timings.Fajr,
        location: state.location,
        method: state.method,
        fetchedAt: Date.now(),
      };
      await storage.set({ cache });
      buildModelFromCache(cache);
      render();
      startTicking();
      setStatus("");
      try { runtimeSend({ type: "PRAYER_DATA_UPDATED" }); } catch (e) { /* background may be asleep */ }
    } catch (err) {
      console.error(err);
      setStatus("Couldn't reach the prayer-times service. Retrying soon.");
    }
  }

  function refreshInBackgroundIfStale(cache) {
    const ageMs = Date.now() - (cache.fetchedAt || 0);
    if (ageMs > 6 * 60 * 60 * 1000) {
      fetchAndCache();
    }
  }

  function buildModelFromCache(cache) {
    const baseDate = new Date();
    state.model = C.buildDayModel(cache.todayData, cache.tomorrowFajr, baseDate);
    const loc = cache.location || state.location;
    if (loc) {
      els.locName.textContent = loc.label || `${loc.city || "Current location"}${loc.country ? ", " + loc.country : ""}`;
    }
    const hijri = state.model.hijri;
    if (hijri) {
      els.hijriDate.textContent = `${hijri.day} ${hijri.month.en} ${hijri.year} AH`;
    }
    els.sunriseTime.textContent = C.formatClock12(state.model.t.Sunrise);
    els.sunsetTime.textContent = C.formatClock12(state.model.t.Sunset);
  }

  // ---------- Rendering ----------
  function render() {
    if (!state.model) return;
    renderList();
    tick();
  }

  function renderList() {
    els.salatList.innerHTML = "";
    for (const w of state.model.windows) {
      const li = document.createElement("li");
      li.className = "salat-row";
      li.dataset.key = w.key;
      li.innerHTML = `
        <div class="salat-icon">${C.WAQT_ICON[w.key]}</div>
        <div class="salat-name-col">
          <div class="salat-name">${w.key}</div>
          <div class="salat-sub">${C.formatClock12(w.start)} – ${C.formatClock12(w.end)}</div>
        </div>
        <div class="salat-range">${C.formatClock12(w.start)}</div>
      `;
      els.salatList.appendChild(li);
    }
  }

  function tick() {
    if (!state.model) return;
    const now = new Date();
    const active = C.computeActiveWaqt(state.model, now);

    els.ringIcon.textContent = C.WAQT_ICON[active.key];
    els.ringName.textContent = active.key;
    els.ringMode.textContent = active.mode === "ends" ? "ends in" : "begins in";
    const remainingMs = active.end - now;
    els.ringCountdown.textContent = C.formatCountdown(remainingMs);

    const progress = active.mode === "ends" ? active.progress : 0;
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    els.ringProgress.style.strokeDashoffset = String(offset);

    // Highlight active row (only meaningful in "ends" mode)
    document.querySelectorAll(".salat-row").forEach((row) => {
      row.classList.toggle("active", active.mode === "ends" && row.dataset.key === active.key);
    });
  }

  function startTicking() {
    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = setInterval(() => {
      // Re-check date rollover
      if (state.model && C.isoDate(new Date()) !== C.isoDate(state.model.t.Fajr)) {
        fetchAndCache();
        return;
      }
      tick();
    }, 1000);
  }

  function setStatus(msg) {
    els.statusLine.textContent = msg;
  }

  // ---------- Calendar ----------
  function renderCalendar() {
    const d = state.calDate;
    const year = d.getFullYear();
    const month = d.getMonth();
    els.calMonthLabel.textContent = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    els.calGrid.innerHTML = "";
    const dows = ["S", "M", "T", "W", "T", "F", "S"];
    for (const dow of dows) {
      const el = document.createElement("div");
      el.className = "dow";
      el.textContent = dow;
      els.calGrid.appendChild(el);
    }

    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    for (let i = 0; i < startOffset; i++) {
      const el = document.createElement("div");
      el.className = "day muted";
      els.calGrid.appendChild(el);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const el = document.createElement("div");
      el.className = "day";
      el.textContent = String(day);
      if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
        el.classList.add("today");
      }
      els.calGrid.appendChild(el);
    }
  }

  // ---------- Settings overlay ----------
  function openSettings() {
    els.methodSelect.value = String(state.method);
    if (state.location) {
      els.cityInput.value = state.location.city || "";
      els.countryInput.value = state.location.country || "";
    }
    els.settingsOverlay.classList.remove("hidden");
  }

  function closeSettingsOverlay() {
    els.settingsOverlay.classList.add("hidden");
    els.settingsStatus.textContent = "";
  }

  function useGeolocation() {
    els.settingsStatus.textContent = "Requesting location…";
    if (!navigator.geolocation) {
      els.settingsStatus.textContent = "Geolocation not available — use manual city instead.";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        state.location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "Current location",
        };
        await storage.set({ location: state.location });
        els.settingsStatus.textContent = "Location saved. Fetching…";
        await fetchAndCache();
        closeSettingsOverlay();
      },
      (err) => {
        console.error(err);
        els.settingsStatus.textContent = "Permission denied — try manual city search below.";
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  async function searchCity() {
    const city = els.cityInput.value.trim();
    const country = els.countryInput.value.trim();
    if (!city || !country) {
      els.settingsStatus.textContent = "Enter both city and country.";
      return;
    }
    state.location = { city, country, label: `${city}, ${country}` };
    await storage.set({ location: state.location });
    els.settingsStatus.textContent = "Location saved. Fetching…";
    await fetchAndCache();
    closeSettingsOverlay();
  }

  async function saveMethod() {
    state.method = Number(els.methodSelect.value);
    const widgetEnabled = els.widgetToggle.checked;
    await storage.set({ method: state.method, widgetEnabled });
    els.settingsStatus.textContent = "Saved. Refreshing…";
    await fetchAndCache();
    closeSettingsOverlay();
  }

  function updateBellIcon() {
    els.bellToggle.classList.toggle("active", state.notificationsEnabled);
  }

  async function toggleNotifications() {
    state.notificationsEnabled = !state.notificationsEnabled;
    updateBellIcon();
    await storage.set({ notificationsEnabled: state.notificationsEnabled });
    if (state.notificationsEnabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      // Popup context can't reliably request OS permission on some browsers;
      // background.js handles the actual chrome.notifications.create calls.
    }
  }

  // ---------- Events ----------
  function bindEvents() {
    els.calendarToggle.addEventListener("click", () => {
      const willShow = els.calendarCard.classList.contains("hidden");
      els.calendarCard.classList.toggle("hidden");
      els.calendarToggle.classList.toggle("active", willShow);
      if (willShow) renderCalendar();
    });

    els.bellToggle.addEventListener("click", toggleNotifications);
    els.locationBtn.addEventListener("click", openSettings);
    els.closeSettings.addEventListener("click", closeSettingsOverlay);
    els.settingsOverlay.addEventListener("click", (e) => {
      if (e.target === els.settingsOverlay) closeSettingsOverlay();
    });

    els.useGeoBtn.addEventListener("click", useGeolocation);
    els.searchCityBtn.addEventListener("click", searchCity);
    els.saveSettingsBtn.addEventListener("click", saveMethod);

    els.calPrev.addEventListener("click", () => {
      state.calDate = new Date(state.calDate.getFullYear(), state.calDate.getMonth() - 1, 1);
      renderCalendar();
    });
    els.calNext.addEventListener("click", () => {
      state.calDate = new Date(state.calDate.getFullYear(), state.calDate.getMonth() + 1, 1);
      renderCalendar();
    });

    els.alarmLink.addEventListener("click", () => {
      state.notificationsEnabled = true;
      updateBellIcon();
      storage.set({ notificationsEnabled: true });
      setStatus("Notifications enabled for all 5 waqts.");
    });
  }
})();
