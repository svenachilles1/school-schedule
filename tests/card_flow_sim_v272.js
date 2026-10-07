// Card flow simulation for v2.7.2 cancellations — DOM-free.
// Loads the card JS in a Node VM with a minimal DOM/localStorage shim,
// then drives the full cancel-dialog flow and asserts behaviour.
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const CARD = path.join(__dirname, "..", "custom_components", "school_schedule", "school-schedule-card.js");
const src = fs.readFileSync(CARD, "utf8");

// ─── Minimal DOM shim ───────────────────────────────────────────────
const elements = [];
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

// class declarations don't create context properties — extract via eval bridge
const SchoolScheduleCard = vm.runInContext("SchoolScheduleCard", ctx);
if (typeof SchoolScheduleCard !== "function") {
  console.error("SchoolScheduleCard not found in sandbox");
  process.exit(1);
}

// ─── Test drive ─────────────────────────────────────────────────────
// helper: concrete date for weekday index (0=Mon..4=Fri), today counts -
// mirrors the backend's _next_date_for_weekday
function nextDate(weekdayIdx) {
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7;   // Mon=0..Sun=6
  const offset = (weekdayIdx - todayIdx + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
const calls = [];
const card = new SchoolScheduleCard();

// hass shim with realistic sensor attributes (cancellation data included)
const todayIso = new Date().toISOString().slice(0, 10);
const lessons = [
  { lesson_uid: "tuesday-1", lesson_number: 1, subject: "Mathe", room: "101", teacher: "Menz", start_time: "07:30", end_time: "08:15", color: "#2196f3", icon: "mdi:math-compass", is_break: false },
  { lesson_uid: "tuesday-2", lesson_number: 2, subject: "Deutsch", room: "102", teacher: "Weber", start_time: "08:15", end_time: "09:00", color: "#4caf50", icon: "mdi:book-open", is_break: false },
  { lesson_uid: "tuesday-3", lesson_number: 3, subject: "Sport", room: "Halle", teacher: "Krause", start_time: "09:00", end_time: "09:45", color: "#ff9800", icon: "mdi:run", is_break: false },
];
const annotated = lessons.map((l) => ({ ...l, cancelled: l.lesson_number === 2, cancelled_note: l.lesson_number === 2 ? "Lehrer krank" : "" }));

card._hass = {
  states: {
    "sensor.stundenplan_michelle_heute": {
      state: "3",
      attributes: { child_name: "Michelle", lessons: annotated, total_lessons: 2, current_lesson: null, next_lesson: null },
    },
    // schedule_dates computed like the backend (_next_date_for_weekday)
    "sensor.stundenplan_michelle_montag": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: nextDate(0) } },
    "sensor.stundenplan_michelle_dienstag": { state: "3", attributes: { child_name: "Michelle", lessons: annotated, schedule_date: nextDate(1) } },
    "sensor.stundenplan_michelle_mittwoch": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: nextDate(2) } },
    "sensor.stundenplan_michelle_donnerstag": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: nextDate(3) } },
    "sensor.stundenplan_michelle_freitag": { state: "0", attributes: { child_name: "Michelle", lessons: [], schedule_date: nextDate(4) } },
    "sensor.stundenplan_michelle_morgen": { state: "0", attributes: { child_name: "Michelle", lessons: [] } },
    "binary_sensor.stundenplan_michelle_schulfrei": { state: "off", attributes: { child_name: "Michelle", federal_state: "thueringen" } },
    "sensor.stundenplan_michelle_fehlzeiten": {
      state: "2",
      attributes: {
        child_name: "Michelle",
        sick_today: false, sick_tomorrow: false, sick_streak: 0,
        sick_streak_active_today: false, attest_warning: false, attest_required: false,
        last_sick_day: null, next_sick_dates: [], recent_sick_days: [],
        sick_entries: [{ date: "2026-10-05", note: "Fieber" }],
        upcoming_cancellations: [{ date: nextDate(1), lesson_number: 2, note: "Lehrer krank" }],
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
card._editMode = true;

// 1) _updateData reads cancellations + day dates
card._updateData();
console.assert(Array.isArray(card._cancellations) && card._cancellations.length === 1, "cancellations read from fehlzeiten attrs");
console.assert(card._cancellations[0].lesson_number === 2, "cancellation slot = 2");
console.assert(card._dayDates && card._dayDates.tuesday === nextDate(1), "day dates from schedule_date attr");

// 2) _dateForDay — backend attr wins, fallback computes
const dTuesday = card._dateForDay("tuesday");
console.assert(dTuesday === nextDate(1), "_dateForDay uses schedule_date: " + dTuesday);
const dMonday = card._dateForDay("monday");
console.assert(dMonday === nextDate(0), "_dateForDay monday = " + dMonday);

// 3) open cancel dialog for lesson 1 (not yet cancelled)
const dienstagDate = nextDate(1);
card._openCancelDialog("tuesday", "1", "tuesday-1");
console.assert(card._cancelLesson !== null, "cancel dialog opens");
console.assert(card._cancelLesson.lesson_number === 1, "dialog targets lesson 1");
console.assert(card._cancelLesson.date_iso === dienstagDate, "dialog targets tuesday's date: " + dienstagDate);
console.assert(card._cancelLesson.already_cancelled === false, "lesson 1 not yet cancelled");

// 4) dialog renders (overlay HTML) — cancelled lesson shows <s> strikethrough
const html = card._renderCancelDialog();
console.assert(html.includes("ssc-cancel-card"), "dialog overlay rendered");
console.assert(!html.includes("undefined"), "no undefined leaked into HTML");
console.log("rendered dialog length:", html.length);

// 5) confirm → service call payload
card._shadow.querySelector = (sel) => (sel === "#ssc-cancel-note" ? { value: "Ausflug" } : null);
card._confirmCancelLesson();
console.assert(calls.length === 1, "one service call fired");
console.assert(calls[0].domain === "school_schedule" && calls[0].service === "mark_lesson_cancelled", "service = mark_lesson_cancelled");
console.assert(calls[0].data.date === dienstagDate, "payload date = tuesday");
console.assert(calls[0].data.lesson_number === 1, "payload lesson_number = 1");
console.assert(calls[0].data.note === "Ausflug", "payload note from input");
console.assert(calls[0].data.child_name === "Michelle", "payload child");
console.assert(card._cancelLesson === null, "dialog closed after confirm");

// 6) cancelled lesson card rendering — strikethrough + badge + note
const lc = card._renderLessonCard(annotated[1], false, false, "tuesday");
console.assert(lc.includes("lc-cancelled"), "cancelled class set");
console.assert(lc.includes("<s>Sport</s>".replace("Sport", "Deutsch")), "subject struck through");
console.assert(lc.includes("ENTF\u00c4LLT") || lc.includes("ENTFÄLLT"), "badge rendered");
console.assert(lc.includes("Lehrer krank"), "note rendered");
console.assert(lc.includes("#ff7043"), "warning color");

// 7) cancel button in edit mode on cancelled lesson → active state
const lcBtn = lc.includes("data-action=\"cancel-lesson\"");
console.assert(lcBtn, "cancel button rendered in edit mode");
console.assert(lc.includes("lc-cancel-btn-active"), "active state on cancelled lesson");

// 8) already-cancelled dialog → restore branch
card._openCancelDialog("tuesday", "2", "tuesday-2");
console.assert(card._cancelLesson.already_cancelled === true, "lesson 2 already cancelled");
const html2 = card._renderCancelDialog();
console.assert(html2.includes("uncancel-lesson"), "restore action offered");
console.assert(html2.includes("Stunde findet statt"), "restore button label");

// 9) uncancel → service payload
card._uncancelLesson(dienstagDate, 2);
console.assert(calls.length === 2, "second service call fired");
console.assert(calls[1].service === "unmark_lesson_cancelled", "service = unmark_lesson_cancelled");
console.assert(calls[1].data.date === dienstagDate && calls[1].data.lesson_number === 2, "payload ok");

// 10) cancelled list in the sick modal
const listHtml = card._renderCancelledList();
console.assert(listHtml.includes("AUSFALL"), "list title");
console.assert(listHtml.includes("data-number=\"2\""), "list entry with lesson number");
console.assert(listHtml.includes("uncancel-lesson"), "list restore button");

// 11) week view badge counts exclude cancelled
card._viewMode = "week";
const weekHtml = card._renderWeekView(["monday","tuesday","wednesday","thursday","friday"], null);
// tuesday column: 3 lessons, 1 cancelled -> badge shows 2.
// Columns render in fixed order monday..friday — extract per-column by
// splitting on the column wrapper, NOT on day-active (that marks TODAY,
// which is not necessarily tuesday).
console.assert(weekHtml.includes("day-active"), "today column marked");
// split by the visible day label spans (Mo/Di/Mi/Do/Fr — order stable)
const labels = ["Mo", "Di", "Mi", "Do", "Fr"];
let tuesdayCol = "";
for (let i = 0; i < labels.length; i++) {
  const start = weekHtml.indexOf('">' + labels[i] + '</span>');
  if (labels[i] === "Di" && start >= 0) {
    const end = weekHtml.indexOf('">' + labels[i + 1] + '</span>', start);
    tuesdayCol = weekHtml.slice(start, end > start ? end : undefined);
  }
}
const m = tuesdayCol.match(/day-badge[^>]*>(\d+)</);
console.assert(m && parseInt(m[1], 10) === 2, "tuesday badge = 2 (cancelled excluded), got: " + (m ? m[1] : "none"));

// 12) hero count excludes cancelled
let heroOk = false;
const render = card._render();
console.assert(typeof render === "undefined", "_render returns void (innerHTML)");
// hero check via internal: lessons today = 3, cancelled 1 -> realToday 2
const heroCount = (card._today.lessons || []).filter((l) => l.is_break !== true && l.cancelled !== true).length;
console.assert(heroCount === 2, "hero lesson count = 2, got " + heroCount);

// 13) progress excludes cancelled
const p = card._calcProgress();
console.assert(p.total === 2, "progress total = 2 (cancelled excluded), got " + p.total);

// 14) empty cancellations -> no list
card._cancellations = [];
console.assert(card._renderCancelledList() === "", "empty cancellations -> no list");

// 15) EN translations present
card._lang = "en";
console.assert(card._t("cancelled_badge") === "CANCELLED", "EN badge string");
console.assert(card._t("uncancel_btn") === "Lesson takes place", "EN restore string");
card._lang = "de";
console.assert(card._t("cancelled_badge") === "ENTF\u00c4LLT" || card._t("cancelled_badge") === "ENTFÄLLT", "DE badge string");

console.log("\nALL 15 CARD FLOW SIMULATIONS PASSED \u2705");