// Card flow simulation for v2.7.3 date exceptions — DOM-free.
// Loads the card JS in a Node VM with a minimal DOM/localStorage shim,
// then drives the exception-manager flows and asserts behaviour
// (same pattern as card_flow_sim_v272.js).
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const CARD = path.join(__dirname, "..", "custom_components", "school_schedule", "school-schedule-card.js");
const src = fs.readFileSync(CARD, "utf8");

// ─── Minimal DOM shim (identical to v272 sim) ──────────────────────
function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    attributes: {},
    dataset: {},
    style: {},
    _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : (this.dataset[k] !== undefined ? this.dataset[k] : null); },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    attachShadow() {
      const sh = {
        _listeners: {},
        innerHTML: "",
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
      };
      this.shadowRoot = sh;
      return sh;
    },
  };
  return el;
}

const localStorageShim = {
  _s: {},
  getItem(k) { return k in this._s ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};

const sandbox = {
  window: {},
  document: {
    createElement: (t) => makeEl(t),
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
  },
  localStorage: localStorageShim,
  customElements: { define() {}, get() { return undefined; } },
  HTMLElement: class HTMLElement {
    constructor() { this._shadow = null; }
    attachShadow() {
      const self = this;
      const sh = {
        _listeners: {},
        set innerHTML(v) { self._shadowInnerHTML = v; },
        get innerHTML() { return self._shadowInnerHTML || ""; },
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
      };
      this._shadow = sh;
      this.shadowRoot = sh;
      return sh;
    }
  },
  haIconButton: undefined,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  parseInt,
  parseFloat,
  isNaN,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx, { filename: "school-schedule-card.js" });

const SchoolScheduleCard = vm.runInContext("SchoolScheduleCard", ctx);
if (typeof SchoolScheduleCard !== "function") {
  console.error("SchoolScheduleCard not found in sandbox");
  process.exit(1);
}

// ─── Test drive ─────────────────────────────────────────────────────
const calls = [];
const card = new SchoolScheduleCard();

const todayIso = (() => {
  const n = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate());
})();

// Exception data as the backend ships it on the fehlzeiten sensor
const excToday = { date: todayIso, exception_type: "partial", note: "Zeugnisse", until_lesson: 2 };

card._hass = {
  states: {
    "sensor.stundenplan_michelle_heute": {
      state: "3",
      attributes: { child_name: "Michelle", lessons: [], total_lessons: 3, current_lesson: null, next_lesson: null },
    },
    "sensor.stundenplan_michelle_montag": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: "2026-10-12" } },
    "sensor.stundenplan_michelle_dienstag": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: "2026-10-13" } },
    "sensor.stundenplan_michelle_mittwoch": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: "2026-10-14" } },
    "sensor.stundenplan_michelle_donnerstag": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: "2026-10-15" } },
    "sensor.stundenplan_michelle_freitag": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: "2026-10-16" } },
    "sensor.stundenplan_michelle_morgen": { state: "0", attributes: { child_name: "Michelle", lessons: [] } },
    "binary_sensor.stundenplan_michelle_schulfrei": {
      state: "off",
      attributes: {
        child_name: "Michelle", federal_state: "thueringen",
        exception_today: excToday, exception_tomorrow: null,
      },
    },
    "sensor.stundenplan_michelle_fehlzeiten": {
      state: "2",
      attributes: {
        child_name: "Michelle",
        sick_today: false, sick_tomorrow: false, sick_streak: 0,
        sick_streak_active_today: false, attest_warning: false, attest_required: false,
        last_sick_day: null, next_sick_dates: [], recent_sick_days: [],
        sick_entries: [], upcoming_cancellations: [],
        date_exceptions: [excToday],
      },
    },
  },
  callService(domain, service, data) { calls.push({ domain, service, data }); },
};

for (const [eid, st] of Object.entries(card._hass.states)) { st.entity_id = eid; }
card._config = { child_name: "Michelle" };
card._childName = "Michelle";
card._cardLanguage = "de";
card._lang = "de";

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log("  ✅ " + name); }
  else { console.log("  ❌ " + name + (detail ? " — " + detail : "")); process.exitCode = 1; }
}

console.log("=== 1) cancel button label: 'Entfällt lassen' -> 'Ausfall' ===");
card._lang = "de";
ok("DE cancel_btn = 'Ausfall'", card._t("cancel_btn") === "Ausfall", card._t("cancel_btn"));
card._lang = "en";
ok("EN cancel_btn = 'Cancel lesson'", card._t("cancel_btn") === "Cancel lesson", card._t("cancel_btn"));
card._lang = "de";

console.log("=== 2) _updateData reads date_exceptions from fehlzeiten attrs ===");
card._updateData();
ok("exceptions array read", Array.isArray(card._exceptions) && card._exceptions.length === 1);
ok("exception entry intact", card._exceptions[0].exception_type === "partial" && card._exceptions[0].until_lesson === 2);

console.log("=== 3) exception banner renders (partial today) ===");
const banner = card._renderExcBanner();
ok("partial banner shown", banner.includes("exc-banner") || banner.includes("sick-banner-exc-partial"));
ok("banner shows Halbtag", banner.includes("Halbtag"), banner.slice(0, 200));
ok("banner shows until lesson", banner.includes("2"));
ok("banner shows note", banner.includes("Zeugnisse"));
ok("banner opens modal on click", banner.includes("open-exc-modal"));

console.log("=== 4) free-exception banner (tomorrow) ===");
card._hass.states["binary_sensor.stundenplan_michelle_schulfrei"].attributes.exception_today = null;
card._hass.states["binary_sensor.stundenplan_michelle_schulfrei"].attributes.exception_tomorrow = { date: "2026-10-13", exception_type: "free", note: "Klassenfahrt", until_lesson: null };
const banner2 = card._renderExcBanner();
ok("tomorrow free banner", banner2.includes("Morgen kein Unterricht"), banner2.slice(0, 200));
ok("banner note", banner2.includes("Klassenfahrt"));
// reset
card._hass.states["binary_sensor.stundenplan_michelle_schulfrei"].attributes.exception_tomorrow = null;

console.log("=== 5) exception modal opens with defaults ===");
card._openExcModal();
ok("modal state open", card._excModal === true);
const modalHtml = card._renderExcModal();
ok("modal renders overlay", modalHtml.includes("ssc-modal-overlay"));
ok("modal shows title", modalHtml.includes("Tages-Ausnahme"));
ok("free type selected by default", modalHtml.includes("sick-btn-active") && modalHtml.includes("exc-type-free"));
ok("date field prefilled today", modalHtml.includes(todayIso));
ok("no undefined leaked", !modalHtml.includes("undefined"));

console.log("=== 6) type switch free -> partial shows until field ===");
card._setExcType("partial");
ok("state switched to partial", card._excException.exception_type === "partial");
const modalHtml2 = card._renderExcModal();
ok("until field rendered", modalHtml2.includes("exc-until-change"));
ok("until default 4", modalHtml2.includes('value="4"'));

console.log("=== 7) save exception -> service payload ===");
card._excException.note = "Klassenfahrt nach Erfurt";
card._excException.until_lesson = 3;
card._saveException();
ok("mark_date_exception fired", calls.length >= 1 && calls[calls.length - 1].service === "mark_date_exception");
const payload = calls[calls.length - 1].data;
ok("payload date today", payload.date === todayIso);
ok("payload type partial", payload.exception_type === "partial");
ok("payload until 3", payload.until_lesson === 3);
ok("payload note", payload.note === "Klassenfahrt nach Erfurt");
ok("payload child", payload.child_name === "Michelle");
ok("form closed after save", card._excException === null);

console.log("=== 8) guard: partial without until_lesson is refused ===");
card._excException = { date_iso: todayIso, exception_type: "partial", note: "", until_lesson: null };
const callsBefore = calls.length;
card._saveException();
ok("no service call on invalid partial", calls.length === callsBefore);

console.log("=== 9) free exception: until_lesson never sent ===");
card._excException = { date_iso: todayIso, exception_type: "free", note: "Schulfest", until_lesson: 5 };
card._saveException();
const freePayload = calls[calls.length - 1].data;
ok("free fired", calls[calls.length - 1].service === "mark_date_exception");
ok("free has no until_lesson", !("until_lesson" in freePayload));

console.log("=== 10) range form -> mark_date_exception_range ===");
card._excModal = true;
card._excException = null;
card._excRange = true;
// range form reads inputs from shadow — shim them
const rangeVals = { "#ssc-exc-range-from": { value: "2026-10-12" }, "#ssc-exc-range-to": { value: "2026-10-15" }, "#ssc-exc-range-note": { value: "Klassenfahrt" }, "#ssc-exc-range-type": { value: "free" } };
card._shadow.querySelector = (sel) => rangeVals[sel] || null;
card._saveExceptionRange();
ok("range service fired", calls[calls.length - 1].service === "mark_date_exception_range");
const rangePayload = calls[calls.length - 1].data;
ok("range start", rangePayload.start_date === "2026-10-12");
ok("range end", rangePayload.end_date === "2026-10-15");
ok("range type free", rangePayload.exception_type === "free");
ok("range note", rangePayload.note === "Klassenfahrt");
ok("range form closed", card._excRange === false);

console.log("=== 11) editable list renders + 2-click delete ===");
card._exceptions = [
  { date: todayIso, exception_type: "free", note: "Schulfest", until_lesson: null },
  { date: "2026-10-20", exception_type: "partial", note: "", until_lesson: 4 },
];
const listHtml = card._renderExcModal();
ok("list title AUSNAHMEN", listHtml.includes("AUSNAHMEN"));
ok("list shows free type label", listHtml.includes("Ganzer Tag frei"));
ok("list shows partial type label", listHtml.includes("Halbtag bis Stunde 4"));
ok("list delete buttons", listHtml.includes("exc-delete"));
ok("today badge on entry", listHtml.includes("exc_today_badge") || listHtml.includes("heute"));

console.log("=== 12) delete exception -> unmark_date_exception ===");
card._deleteException("2026-10-20");
ok("unmark fired", calls[calls.length - 1].service === "unmark_date_exception");
ok("delete payload date", calls[calls.length - 1].data.date === "2026-10-20");

console.log("=== 13) modal close resets state ===");
card._openExcModal();
card._setExcType("partial");
card._closeExcModal();
ok("modal closed", card._excModal === false);
ok("form state cleared", card._excException === null);
ok("range cleared", card._excRange === false);

console.log("=== 14) exception modal mounted in main render ===");
card._excModal = true;
card._editMode = false;
const full = card._render();
ok("exc modal in main HTML", (card._shadowInnerHTML || "").includes("ssc-exc-card"));

console.log("=== 15) EN exception strings ===");
card._lang = "en";
ok("EN modal title", card._t("exc_modal_title") === "Day exception");
ok("EN banner free", card._t("exc_banner_free") === "No school today");
ok("EN type free", card._t("exc_type_free") === "Whole day off");
card._lang = "de";

console.log("\nRESULT: " + passed + " checks passed" + (process.exitCode ? ", FAILED" : ""));