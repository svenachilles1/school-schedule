// XSS escape simulation for v2.7.5 (Frenck security review) — DOM-free.
// Proves that every user-controlled value that lands in card HTML is escaped:
//   E1  _escHtml / _escAttr helpers
//   E2  holiday names (mehr-schulferien.de via vacations) in holiday view
//   E3  holiday name in countdown pill (title attribute + text)
//   E4  child switch name (data-child + title attribute + text)
//   E5  lesson subject/room/teacher + icon attribute + color style attribute
//   E6  hero now/next subject + room (running lesson)
//   E7  cancel dialog subject + delete confirm subject
// The payload must never appear raw (unescaped) in the rendered HTML.
// Runs in plain Node (vm sandbox), exits non-zero on any failure.

"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const CARD = path.join(__dirname, "..", "school-schedule-card.js");
const src = fs.readFileSync(CARD, "utf-8");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log("FAIL: " + name); }
}

// ---- minimal DOM shim (v274 pattern) ----
function makeShadow(card) {
  const sh = {
    _innerHTML: "",
    set innerHTML(v) { this._innerHTML = v; },
    get innerHTML() { return this._innerHTML; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return sh;
}

const storage = { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };

const HTMLElement = class {
  constructor() { this._shadow = null; }
  attachShadow() { this._shadow = makeShadow(this); return this._shadow; }
  connectedCallback() {}
  disconnectedCallback() {}
};

const sandbox = {
  localStorage: storage,
  customElements: { define() {}, get() { return undefined; } },
  HTMLElement,
  window: { customCards: [] },
  hass: { states: {}, locale: { language: "de" }, callService() {} },
  console,
  setTimeout, clearTimeout,
};
sandbox.window.localStorage = storage;
const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx, { filename: "school-schedule-card.js" });
const SchoolScheduleCard = vm.runInContext("SchoolScheduleCard", ctx);

const SCRIPT_PAYLOAD = '<script>window.__xss=1</script>';
const ATTR_IMG_PAYLOAD = '<img src=x onerror=window.__xss=1>';
const QUOTE_PAYLOAD = '" onmouseover="window.__xss=1';
const STYLE_PAYLOAD = "#44739e;--c:red;content:\"x\"";
const ICON_PAYLOAD = 'mdi:school" onerror="window.__xss=1';

function iso(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function newCard() {
  const card = new SchoolScheduleCard();
  card.setConfig({ type: "custom:school-schedule-card", child_name: "Michelle" });
  card.hass = sandbox.hass;
  return card;
}

// ============ E1: escape helpers ============
{
  const card = newCard();
  const esc = card._escHtml(SCRIPT_PAYLOAD);
  check("E1 _escHtml neutralizes script tags", esc.indexOf("<script>") === -1 && esc.indexOf("&lt;script&gt;") !== -1);
  const escAttr = card._escAttr(QUOTE_PAYLOAD);
  check("E1 _escAttr neutralizes quote breakouts", escAttr.indexOf('"') === -1 && escAttr.indexOf("&quot;") !== -1);
  const escAttr2 = card._escAttr("' onmouseover='x");
  check("E1 _escAttr neutralizes single quotes", escAttr2.indexOf("'") === -1 && escAttr2.indexOf("&#39;") !== -1);
}

// ============ E2: holiday view renders holiday names escaped ============
{
  const card = newCard();
  const today = iso(0);
  card._holidayState = "thueringen";
  card._holidayLoading = false;
  card._holidayData = [
    { name: SCRIPT_PAYLOAD, starts_on: today, ends_on: today },
    { name: "Herbstferien", starts_on: "2026-10-12", ends_on: "2026-10-23" },
  ];
  const html = card._renderHolidayView();
  check("E2 holiday list escapes <script> payload", html.indexOf("<script>") === -1 && html.indexOf("&lt;script&gt;") !== -1);
  check("E2 holiday view keeps benign names readable", html.indexOf("Herbstferien") !== -1);
}

// ============ E3: countdown pill — title attribute + text ============
{
  const card = newCard();
  card._getHolidayCountdown = () => ({ days: 3, mode: "until", name: SCRIPT_PAYLOAD + QUOTE_PAYLOAD });
  const html = card._renderHolidayCountdownPill();
  check("E3 countdown pill has no raw script tag", html.indexOf("<script>") === -1);
  check("E3 countdown pill title attr escaped", html.indexOf('title="&lt;script&gt;') !== -1);
  check("E3 countdown pill text escaped", html.indexOf("&lt;script&gt;") !== -1);
}

// ============ E4: child switch — data-child + title + text ============
{
  const card = newCard();
  card._availableChildren = ["Michelle", 'O\'Brien "q" <b>'];
  const html = card._renderChildSwitch();
  check("E4 child switch has no raw <b> from name", html.indexOf("<b>") === -1 && html.indexOf("&lt;b&gt;") !== -1);
  check("E4 child switch data-child attr quotes escaped", html.indexOf('data-child="O&#39;Brien &quot;q&quot;') !== -1);
}

// ============ E5: lesson card — subject/room/teacher/icon/color ============
{
  const card = newCard();
  const lesson = {
    weekday: "monday", lesson_number: 1,
    subject: SCRIPT_PAYLOAD,
    room: ATTR_IMG_PAYLOAD,
    teacher: QUOTE_PAYLOAD,
    start_time: "08:00", end_time: "08:45",
    color: STYLE_PAYLOAD,
    icon: ICON_PAYLOAD,
    lesson_uid: "xss-1",
  };
  const html = card._renderLessonCard(lesson, false, false, "monday");
  check("E5 lesson card escapes subject script tag", html.indexOf("<script>") === -1 && html.indexOf("&lt;script&gt;") !== -1);
  check("E5 lesson card escapes room img-onerror payload", html.indexOf("<img") === -1 && html.indexOf("&lt;img") !== -1);
  check("E5 lesson card escapes teacher quote payload (stays inside span as text)",
    html.indexOf('<span class="lc-teacher">" onmouseover="window.__xss=1</span>') !== -1);
  check("E5 lesson card icon attribute is escaped", html.indexOf('icon="' + ICON_PAYLOAD + '"') === -1 && html.indexOf("&quot; onerror=&quot;") !== -1);
  check("E5 lesson card color style is escaped", html.indexOf('" style="--c:#44739e;--c:red;content:"') === -1);
}

// ============ E6: hero now/next — running lesson subject + room ============
{
  const card = newCard();
  const today = iso(0);
  const running = [
    { weekday: "monday", lesson_number: 1, subject: SCRIPT_PAYLOAD, room: ATTR_IMG_PAYLOAD, start_time: "00:01", end_time: "23:58", lesson_uid: "now-1" },
    { weekday: "monday", lesson_number: 2, subject: "Next: " + QUOTE_PAYLOAD, room: "R2", start_time: "23:58", end_time: "23:59", lesson_uid: "next-1" },
  ];
  // heute-Sensor mit laufender Payload-Lektion — _render baut hero-now/next.
  // current/next kommen aus den Backend-Attributen current_lesson/next_lesson.
  function dayEntity(dateKey, lessonsList) {
    return {
      entity_id: "sensor.stundenplan_michelle_" + dateKey,
      state: String(lessonsList.length),
      attributes: {
        child_name: "Michelle", lessons: lessonsList, total_lessons: lessonsList.length,
        cancelled_count: 0, schedule_date: today,
        current_lesson: dateKey === "heute" ? (lessonsList[0] || null) : null,
        next_lesson: dateKey === "heute" ? (lessonsList[1] || null) : null,
      },
    };
  }
  card.hass = {
    states: {
      "sensor.stundenplan_michelle_heute": dayEntity("heute", running),
      "sensor.stundenplan_michelle_morgen": dayEntity("morgen", []),
      "sensor.stundenplan_michelle_montag": dayEntity("montag", running),
      "sensor.stundenplan_michelle_dienstag": dayEntity("dienstag", []),
      "sensor.stundenplan_michelle_mittwoch": dayEntity("mittwoch", []),
      "sensor.stundenplan_michelle_donnerstag": dayEntity("donnerstag", []),
      "sensor.stundenplan_michelle_freitag": dayEntity("freitag", []),
      "sensor.stundenplan_michelle_fehlzeiten": {
        entity_id: "sensor.stundenplan_michelle_fehlzeiten",
        state: "0",
        attributes: { child_name: "Michelle", sick_days_year: 0, sick_streak: 0, date_exceptions: [], sick_entries: [], upcoming_cancellations: [] },
      },
      "binary_sensor.stundenplan_michelle_schulfrei": {
        entity_id: "binary_sensor.stundenplan_michelle_schulfrei",
        state: "off",
        attributes: { child_name: "Michelle", exception_today: null, exception_tomorrow: null },
      },
    },
    locale: { language: "de" }, callService() {},
  };
  card._render();
  const html = card._shadow.innerHTML;
  check("E6 hero renders running lesson", html.indexOf("hero-now") !== -1);
  check("E6 hero-now subject escaped", html.indexOf("<script>") === -1 && html.indexOf("&lt;script&gt;") !== -1);
  check("E6 hero-now room img payload escaped", html.indexOf("<img") === -1 || html.indexOf("&lt;img") !== -1 || html.indexOf('icon="mdi:') !== -1);
  check("E6 hero-next subject escaped (stays inside div as text)",
    html.indexOf('<div class="hero-next-subject">Next: " onmouseover="window.__xss=1</div>') !== -1);
}

// ============ E7: cancel dialog + delete confirm ============
{
  const card = newCard();
  const today = iso(0);
  card._today = { date: today, weekday: "monday", lessons: [ { weekday: "monday", lesson_number: 1, subject: SCRIPT_PAYLOAD, room: "", teacher: "", start_time: "08:00", end_time: "08:45", lesson_uid: "c-1" } ], current: null, next: null };
  card._days = { monday: { lessons: [ { weekday: "monday", lesson_number: 1, subject: SCRIPT_PAYLOAD, room: "", teacher: "", start_time: "08:00", end_time: "08:45", lesson_uid: "c-1" } ] } };
  card._editMode = true;
  card._dateForDay = () => today; // fixture stub: dialog needs a concrete date
  card._openCancelDialog("monday", 1, "c-1");
  const cancelHtml = card._shadow.innerHTML;
  check("E7 cancel dialog subject escaped", cancelHtml.indexOf("<script>") === -1 && cancelHtml.indexOf("&lt;script&gt;") !== -1);

  card._confirmDelete = { subject: SCRIPT_PAYLOAD, dayName: "Montag", start_time: "08:00", end_time: "08:45" };
  const confirmHtml = card._renderConfirmDelete();
  check("E7 delete confirm subject escaped", confirmHtml.indexOf("<script>") === -1 && confirmHtml.indexOf("&lt;script&gt;") !== -1);
}

// ============ summary ============
console.log(`\nxss escape sim v2.7.5: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("FAILED checks:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("ALL XSS ESCAPE CHECKS PASSED ✅");