(function () {
  "use strict";
  if (window.__namazWidgetInjected) return;
  window.__namazWidgetInjected = true;

  const runtime = typeof browser !== "undefined" ? browser : chrome;
  const storage = runtime.storage.local;
  const C = self.PrayerCore;

  let widgetEl = null;
  let tickTimer = null;
  let model = null;

  init();

  async function init() {
    const saved = await storage.get(["widgetEnabled", "cache", "widgetPos"]);
    const enabled = saved.widgetEnabled !== false; // default ON
    if (!enabled) return;
    if (!saved.cache || saved.cache.date !== C.isoDate(new Date())) return;
    model = C.buildDayModel(saved.cache.todayData, saved.cache.tomorrowFajr, new Date());
    mountWidget(saved.widgetPos);
  }

  runtime.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.widgetEnabled) {
      if (changes.widgetEnabled.newValue) {
        init();
      } else {
        unmountWidget();
      }
    }
    if (changes.cache && widgetEl) {
      const c = changes.cache.newValue;
      if (c) model = C.buildDayModel(c.todayData, c.tomorrowFajr, new Date());
    }
  });

  function mountWidget(pos) {
    if (widgetEl) return;
    injectStyles();

    widgetEl = document.createElement("div");
    widgetEl.id = "namaz-floating-widget";
    widgetEl.innerHTML = `
      <div class="nfw-drag-handle">
        <svg class="nfw-ring" viewBox="0 0 92 92">
          <defs>
            <linearGradient id="nfwGradient" x1="0%" y1="0%" x2="100%" y2="100%" gradientUnits="objectBoundingBox">
              <animateTransform attributeName="gradientTransform" type="rotate"
                from="0 0.5 0.5" to="360 0.5 0.5" dur="14s" repeatCount="indefinite" />
              <stop offset="0%" stop-color="#ef4444" />
              <stop offset="33%" stop-color="#8b5cf6" />
              <stop offset="66%" stop-color="#3b82f6" />
              <stop offset="100%" stop-color="#1e2a6e" />
            </linearGradient>
          </defs>
          <circle class="nfw-track" cx="46" cy="46" r="40"></circle>
          <circle class="nfw-progress" cx="46" cy="46" r="40"></circle>
        </svg>
        <div class="nfw-center">
          <span class="nfw-icon"></span>
          <span class="nfw-time"></span>
          <span class="nfw-label"></span>
        </div>
      </div>
    `;
    widgetEl.classList.add("nfw-enter");
    document.documentElement.appendChild(widgetEl);
    widgetEl.addEventListener("animationend", () => widgetEl.classList.remove("nfw-enter"), { once: true });

    if (pos && typeof pos.top === "number") {
      widgetEl.style.top = pos.top + "px";
      widgetEl.style.left = pos.left + "px";
      widgetEl.style.right = "auto";
    }

    makeDraggable(widgetEl);
    startTicking();
  }

  function unmountWidget() {
    if (tickTimer) clearInterval(tickTimer);
    if (widgetEl) {
      widgetEl.remove();
      widgetEl = null;
    }
  }

  function startTicking() {
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  function tick() {
    if (!widgetEl || !model) return;
    const now = new Date();
    const active = C.computeActiveWaqt(model, now);
    const circumference = 2 * Math.PI * 40;
    const progress = active.mode === "ends" ? active.progress : 0;
    const offset = circumference * (1 - progress);

    const progressCircle = widgetEl.querySelector(".nfw-progress");
    progressCircle.style.strokeDasharray = circumference;
    progressCircle.style.strokeDashoffset = offset;

    widgetEl.querySelector(".nfw-icon").textContent = C.WAQT_ICON[active.key];
    widgetEl.querySelector(".nfw-time").textContent = C.formatCountdown(active.end - now);
    widgetEl.querySelector(".nfw-label").textContent = active.key;
    widgetEl.title = `${active.key} ${active.mode === "ends" ? "ends" : "begins"} in ${C.formatCountdown(active.end - now)}`;
  }

  function makeDraggable(el) {
    let dragging = false;
    let startX, startY, startTop, startLeft;

    el.addEventListener("mousedown", (e) => {
      dragging = true;
      el.classList.add("nfw-dragging");
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startTop = rect.top;
      startLeft = rect.left;
      el.style.right = "auto";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.top = Math.max(0, startTop + dy) + "px";
      el.style.left = Math.max(0, startLeft + dx) + "px";
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("nfw-dragging");
      const rect = el.getBoundingClientRect();
      storage.set({ widgetPos: { top: rect.top, left: rect.left } });
    });
  }

  function injectStyles() {
    if (document.getElementById("namaz-widget-styles")) return;
    const link = document.createElement("link");
    link.id = "namaz-widget-styles";
    link.rel = "stylesheet";
    link.href = runtime.runtime.getURL("css/overlay.css");
    document.documentElement.appendChild(link);
  }
})();
