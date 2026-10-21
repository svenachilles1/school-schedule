// XSS escape simulation for v2.7.7 (Frenck security review, round 2) — DOM-free.
// Proves the 13 places from review #2 plus the form time values are escaped:
//   F8  edit form: subject/room/teacher/color/icon/time in value attributes
//   F9  card title: child name from card config
//   F10 card config height/width inside style attributes
//   F11 visual editor: child_name/height/width in value attributes
//   F12 paused (school-free) days render empty without errors
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

// ---- minimal DOM shim (v275 pattern) ----
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
const SchoolScheduleCardEditor = vm.runInContext("SchoolScheduleCardEditor", ctx);

const SCRIPT_PAYLOAD = '<script>window.__xss=1</script>';
const ATTR_IMG_PAYLOAD = '<img src=x onerror=window.__xss=1>';
const QUOTE_PAYLOAD = '" onmouseover="window.__xss=1';
const STYLE_PAYLOAD = '#44739e;--c:red;content:"x"';
const ICON_PAYLOAD = 'mdi:school" onerror="window.__xss=1';
const TIME_QUOTE_PAYLOAD = 'x" onerror="window.__xss=1';

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

// Full hass factory for _render()-based checks (v275 E6 pattern)
function fullHass(lessonsByDay) {
  function dayEntity(dateKey, lessonsList) {
    return {
      entity_id: "sensor.stundenplan_michelle_" + dateKey,
      state: String(lessonsList.length),
      attributes: {
        child_name: "Michelle", lessons: lessonsList, total_lessons: lessonsList.length,
        cancelled_count: 0, schedule_date: iso(0),
        current_lesson: dateKey === "heute" ? (lessonsList[0] || null) : null,
        next_lesson: dateKey === "heute" ? (lessonsList[1] || null) : null,
      },
    };
  }
  return {
    states: {
      "sensor.stundenplan_michelle_heute": dayEntity("heute", lessonsByDay.heute || []),
      "sensor.stundenplan_michelle_morgen": dayEntity("morgen", lessonsByDay.morgen || []),
      "sensor.stundenplan_michelle_montag": dayEntity("montag", lessonsByDay.montag || []),
      "sensor.stundenplan_michelle_dienstag": dayEntity("dienstag", lessonsByDay.dienstag || []),
      "sensor.stundenplan_michelle_mittwoch": dayEntity("mittwoch", lessonsByDay.mittwoch || []),
      "sensor.stundenplan_michelle_donnerstag": dayEntity("donnerstag", lessonsByDay.donnerstag || []),
      "sensor.stundenplan_michelle_freitag": dayEntity("freitag", lessonsByDay.freitag || []),
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
}

// ============ F8: edit form values (review #2: lines 2275/2295/2299/2306-2314) ============
{
  const card = newCard();
  card._showForm = true;
  card._formData = {
    mode: "edit",
    weekday: "monday",
    lesson: {
      weekday: "monday", lesson_number: 1,
      subject: QUOTE_PAYLOAD,
      room: ATTR_IMG_PAYLOAD,
      teacher: SCRIPT_PAYLOAD,
      color: STYLE_PAYLOAD,
      icon: ICON_PAYLOAD,
      start_time: TIME_QUOTE_PAYLOAD,
      end_time: TIME_QUOTE_PAYLOAD,
      lesson_uid: "xss-edit-1",
    },
  };
  const html = card._renderForm();
  check("F8 form renders", typeof html === "string" && html.length > 0);
  check("F8 subject value escaped (no raw quote breakout)",
    html.indexOf('value="' + QUOTE_PAYLOAD) === -1 && html.indexOf('value="&quot; onmouseover=&quot;') !== -1);
  check("F8 room value escaped (img payload neutralized)",
    html.indexOf('value="' + ATTR_IMG_PAYLOAD) === -1 && html.indexOf("&lt;img") !== -1);
  check("F8 teacher value escaped (script neutralized)",
    html.indexOf('value="' + SCRIPT_PAYLOAD) === -1 && html.indexOf("&lt;script&gt;") !== -1);
  check("F8 color value escaped", html.indexOf('value="#44739e;--c:red;content:&quot;x&quot;"') !== -1);
  check("F8 color value has no raw quote", html.indexOf('value="#44739e;--c:red;content:"x"') === -1);
  // color hex span: TEXT context via _escHtml (quotes are safe in text;
  // element breakouts must be neutralized)
  {
    const card2 = newCard();
    card2._showForm = true;
    card2._formData = { mode: "edit", weekday: "monday", lesson: { weekday: "monday", lesson_number: 1, subject: "x", room: "", teacher: "", color: ATTR_IMG_PAYLOAD, icon: "mdi:school", start_time: "08:00", end_time: "08:45", lesson_uid: "xss-edit-2" } };
    const html2 = card2._renderForm();
    check("F8 color hex text neutralizes element breakout", html2.indexOf('ssc-color-hex">&lt;img') !== -1);
    check("F8 color hex text has no raw img element", html2.indexOf('ssc-color-hex"><img') === -1);
  }
  check("F8 icon value escaped", html.indexOf('value="' + ICON_PAYLOAD) === -1 && html.indexOf('mdi:school&quot; onerror=&quot;') !== -1);
  check("F8 icon preview attribute escaped", html.indexOf('icon="' + ICON_PAYLOAD) === -1);
  check("F8 start time value escaped (5-char slice still escaped)",
    html.indexOf('value="x&quot; on"') !== -1 && html.indexOf('value="x" on') === -1);
  check("F8 end time value escaped",
    html.indexOf('value="x&quot; on') !== -1 && html.indexOf('value="x" on') === -1);
  check("F8 form has no raw script tag anywhere", html.indexOf("<script>") === -1);
}

// ============ F9: card title child name (review #2: line 1807) ============
{
  const card = new SchoolScheduleCard();
  card.setConfig({ type: "custom:school-schedule-card", child_name: SCRIPT_PAYLOAD });
  card.hass = fullHass({ heute: [], morgen: [], montag: [], dienstag: [], mittwoch: [], donnerstag: [], freitag: [] });
  card._render();
  const html = card._shadow.innerHTML;
  check("F9 title-sub has no raw script payload",
    html.indexOf('<div class="title-sub">' + SCRIPT_PAYLOAD + '</div>') === -1);
  check("F9 title-sub escapes script payload as text",
    html.indexOf('&lt;script&gt;window.__xss=1&lt;/script&gt;') !== -1);
}

// ============ F10: card config height/width in style attribute (review #2: lines 1792-1793) ============
{
  const card = new SchoolScheduleCard();
  card.setConfig({
    type: "custom:school-schedule-card", child_name: "Michelle",
    height: QUOTE_PAYLOAD,
    width: '600px" onload="window.__xss=1',
  });
  card.hass = fullHass({});
  card._render();
  const html = card._shadow.innerHTML;
  check("F10 height style escaped (no raw quote breakout)",
    html.indexOf('height:" onmouseover="') === -1 && html.indexOf('height:&quot; onmouseover=&quot;') !== -1);
  check("F10 width style escaped (no raw onload injection)",
    html.indexOf('600px" onload="') === -1 && html.indexOf('600px&quot; onload=&quot;') !== -1);
}

// ============ F11: visual editor values (review #2: lines 3529/3534/3539) ============
{
  const ed = new SchoolScheduleCardEditor();
  ed.setConfig({
    child_name: QUOTE_PAYLOAD,
    height: SCRIPT_PAYLOAD,
    width: '600px" onload="window.__xss=1',
  });
  const html = ed._shadow.innerHTML;
  check("F11 editor renders", typeof html === "string" && html.length > 0);
  check("F11 editor child_name value escaped",
    html.indexOf('value="' + QUOTE_PAYLOAD) === -1 && html.indexOf('value="&quot; onmouseover=&quot;') !== -1);
  check("F11 editor height value escaped",
    html.indexOf('value="' + SCRIPT_PAYLOAD) === -1 && html.indexOf("&lt;script&gt;") !== -1);
  check("F11 editor width value escaped",
    html.indexOf('600px" onload="') === -1 && html.indexOf('600px&quot; onload=&quot;') !== -1);
  check("F11 editor has its own escape helpers",
    typeof ed._escHtml === "function" && typeof ed._escAttr === "function");
}

// ============ F12: paused (school-free) days render empty without errors ============
{
  const card = newCard();
  card.hass = fullHass({ heute: [], morgen: [], montag: [], dienstag: [], mittwoch: [], donnerstag: [], freitag: [] });
  let threw = false;
  try { card._render(); } catch (e) { threw = true; console.log("F12 render threw:", e && e.message); }
  const html = card._shadow.innerHTML;
  check("F12 renders fully paused week without throwing", threw === false && typeof html === "string" && html.length > 0);
  check("F12 hero still shows a number (0 lessons)", /hero-stat-num/.test(html));
}

// ============ summary ============
console.log(`\nxss escape sim v2.7.7: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("FAILED checks:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("ALL v2.7.7 XSS ESCAPE CHECKS PASSED ✅");