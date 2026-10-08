// Card flow simulation for v2.7.4 exception-manager bug fixes — DOM-free.
// Regression-tests the v2.7.3 behaviour AND the v2.7.4 fixes:
//   F1  input/change wiring for the three form fields (note/until/date)
//   F2  delete via actionEl.dataset (icon-click safe)
//   F3  partial type switch seeds until_lesson default (4)
//   F4  save shows a visible error instead of silent return
//   F5  optimistic list add/remove
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

// ---- minimal DOM shim (v272 pattern) ----
function makeShadow(card) {
  const sh = {
    _innerHTML: "",
    set innerHTML(v) { this._innerHTML = v; this._els = []; },
    get innerHTML() { return this._innerHTML; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return sh;
}

const storage = { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };

const serviceCalls = [];
function makeHass() {
  return {
    states: {},
    locale: { language: "de" },
    callService(domain, service, data) { serviceCalls.push({ domain, service, data }); },
  };
}

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
  hass: makeHass(),
  console,
  setTimeout, clearTimeout,
};
sandbox.window.localStorage = storage;
const ctx = vm.createContext(sandbox);
vm.runInContext(src, ctx, { filename: "school-schedule-card.js" });
const SchoolScheduleCard = vm.runInContext("SchoolScheduleCard", ctx);

// ---- fixture: Michelle + full entity attributes (EN weekday keys, DE suffixes) ----
function iso(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
const todayIso = iso(0);
const tomorrowIso = iso(1);
const mondayIso = iso((8 - new Date().getDay()) % 7 || 7); // nächster Montag
// tomorrow must be a weekday for stable tests; pick next Tuesday otherwise
let tomorrowJs = new Date(); tomorrowJs.setDate(tomorrowJs.getDate() + 1);
let tomorrowOffset = 1;
if (tomorrowJs.getDay() === 0 || tomorrowJs.getDay() === 6) {
  // shift to Monday when tomorrow is a weekend day
  tomorrowOffset = ((8 - new Date().getDay()) % 7 || 7);
}
const excTomorrowIso = iso(tomorrowOffset);

const lessons = [
  { weekday: "monday", lesson_number: 1, subject: "Mathe", start_time: "08:00", end_time: "08:45", lesson_uid: "monday-1" },
  { weekday: "monday", lesson_number: 2, subject: "Deutsch", start_time: "08:50", end_time: "09:35", lesson_uid: "monday-2" },
];

function dayEntity(dateKey, lessonsList) {
  return {
    entity_id: "sensor.stundenplan_michelle_" + dateKey,
    state: String(lessonsList.length),
    attributes: {
      child_name: "Michelle", lessons: lessonsList, total_lessons: lessonsList.length,
      cancelled_count: 0, schedule_date: dateKey === "heute" ? todayIso : (dateKey === "morgen" ? excTomorrowIso : mondayIso),
    },
  };
}

sandbox.hass.states = {
  "sensor.stundenplan_michelle_heute": dayEntity("heute", lessons),
  "sensor.stundenplan_michelle_morgen": dayEntity("morgen", lessons),
  "sensor.stundenplan_michelle_montag": dayEntity("montag", lessons),
  "sensor.stundenplan_michelle_dienstag": dayEntity("dienstag", []),
  "sensor.stundenplan_michelle_mittwoch": dayEntity("mittwoch", []),
  "sensor.stundenplan_michelle_donnerstag": dayEntity("donnerstag", []),
  "sensor.stundenplan_michelle_freitag": dayEntity("freitag", []),
  "sensor.stundenplan_michelle_fehlzeiten": {
    entity_id: "sensor.stundenplan_michelle_fehlzeiten",
    state: "3",
    attributes: {
      child_name: "Michelle",
      sick_days_year: 3, sick_streak: 0,
      date_exceptions: [], sick_entries: [], upcoming_cancellations: [],
    },
  },
  "binary_sensor.stundenplan_michelle_schulfrei": {
    entity_id: "binary_sensor.stundenplan_michelle_schulfrei",
    state: "off",
    attributes: { child_name: "Michelle", exception_today: null, exception_tomorrow: null },
  },
};

function newCard() {
  const card = new SchoolScheduleCard();
  // HA-kanonische Reihenfolge: setConfig ZUERST (child_name!), dann hass.
  // Der hass-Setter feuert _updateData sofort — ohne config wären die
  // Entity-IDs falsch und _days bliebe leer.
  card.setConfig({ type: "custom:school-schedule-card", child_name: "Michelle" });
  card.hass = sandbox.hass;
  card._render();
  return card;
}

// ============ 1) v2.7.3 regression: label + modal basics ============
const card0 = newCard();
card0._openExcModal();
let html = card0._shadow.innerHTML;
check("1 modal opens (v273 regression)", card0._excModal === true && html.indexOf("Tages-Ausnahme") !== -1);
// cancel_btn 'Ausfall' lebt im Einzelstunden-Ausfall-Dialog (edit mode),
// nicht im Exc-Modal — dort heißt der Save-Button 'Ausnahme setzen'.
const card0b = newCard();
card0b._toggleEditMode();
card0b._openCancelDialog("monday", 1, "monday-1");
check("2 cancel button label is 'Ausfall' (v273 regression, lesson dialog)",
  card0b._shadow.innerHTML.indexOf(">Ausfall<") !== -1);

// ============ 2) F1: input wiring — note field ============
const card1 = newCard();
card1._openExcModal();
check("3 form state seeded on open", card1._excException && card1._excException.date_iso === todayIso);

// Simuliere exakt was der Browser macht: input-Event auf dem Notiz-Feld.
// Der Shadow-Shim liefert kein echtes DOM — wir testen die ROUTER-Logik:
// _handleInput muss data-action="exc-note-input" erkennen (closest-Fallback).
const noteField = { closest(sel) { return sel === "[data-action]" ? { dataset: { action: "exc-note-input" } } : null; }, value: "Klassenfahrt Berlin" };
card1._handleInput({ target: noteField });
check("4 F1 note input updates state via _handleInput", card1._excException.note === "Klassenfahrt Berlin");

const untilField = { closest(sel) { return sel === "[data-action]" ? { dataset: { action: "exc-until-change" } } : null; }, value: "6" };
card1._handleInput({ target: untilField });
check("5 F1 until input updates state via _handleInput", card1._excException.until_lesson === 6);

const dateField = { closest(sel) { return sel === "[data-action]" ? { dataset: { action: "exc-date-change" } } : null; }, value: "2026-10-20" };
card1._handleInput({ target: dateField });
check("6 F1 date input updates state via _handleInput", card1._excException.date_iso === "2026-10-20");

// Kein data-action-Target darf NICHT in die exc-Router fallen:
const plainField = { closest() { return null; }, value: "x", id: "ssc-icon" };
let iconPreviewBefore = card1._handleInput({ target: plainField });
check("7 F1 non-action targets pass through", card1._excException.note === "Klassenfahrt Berlin");

// ============ 3) F3: partial type switch seeds until default ============
const card2 = newCard();
card2._openExcModal();
check("8 F3 until starts null on free", card2._excException.until_lesson === null);
card2._setExcType("partial");
check("9 F3 type switch seeds until=4", card2._excException.until_lesson === 4);
card2._setExcType("free");
check("10 F3 free resets until to null", card2._excException.until_lesson === null);
card2._setExcType("partial");
card2._excException.until_lesson = 7;
card2._setExcType("partial");
check("11 F3 explicit until survives re-click", card2._excException.until_lesson === 7);

// ============ 4) F4: save with valid partial → service + optimistic ============
serviceCalls.length = 0;
const card3 = newCard();
card3._openExcModal();
card3._setExcType("partial");
const noteField3 = { closest(sel) { return sel === "[data-action]" ? { dataset: { action: "exc-note-input" } } : null; }, value: "Zeugnisse" };
card3._handleInput({ target: noteField3 });
card3._saveException();
check("12 F4 partial save calls mark_date_exception", serviceCalls.length === 1 && serviceCalls[0].service === "mark_date_exception" && serviceCalls[0].data.until_lesson === 4 && serviceCalls[0].data.note === "Zeugnisse");
check("13 F5 optimistic list add after save", card3._exceptions.some((e) => e.exception_type === "partial" && e.until_lesson === 4));
check("14 F4 form state cleared after save (no ghost)", card3._excException === null);

// ============ 5) F4: save invalid partial → visible error, NO service ============
serviceCalls.length = 0;
const card4 = newCard();
card4._openExcModal();
card4._setExcType("partial");
card4._excException.until_lesson = 99; // invalid
card4._saveException();
check("15 F4 invalid until: NO service call", serviceCalls.length === 0);
check("16 F4 invalid until: visible error set", card4._excError === "exc_err_until");
card4._excException.until_lesson = 2;
card4._saveException();
check("17 F4 error clears on successful save", card4._excError === null && serviceCalls.length === 1);

// ============ 6) F2: delete via actionEl (icon-click safe) ============
serviceCalls.length = 0;
const card5 = newCard();
card5._openExcModal();
card5._exceptions = [{ date: "2026-10-20", exception_type: "free", note: "", until_lesson: null }];
// Router-Logik: e.target = Icon (kein dataset), closest liefert den BUTTON.
const iconTarget = {
  dataset: {},
  closest(sel) { return sel === "[data-action]" ? this._btn : null; },
  _btn: { dataset: { action: "exc-delete", date: "2026-10-20" } },
};
card5._handleClick({ target: iconTarget });
check("18 F2 exc-delete sets pending date from actionEl", card5._excDelete === "2026-10-20");
const confirmTarget = {
  dataset: {},
  closest(sel) { return sel === "[data-action]" ? this._btn : null; },
  _btn: { dataset: { action: "exc-delete-confirm-yes", date: "2026-10-20" } },
};
card5._handleClick({ target: confirmTarget });
check("19 F2 confirm delete calls unmark via actionEl", serviceCalls.length === 1 && serviceCalls[0].service === "unmark_date_exception" && serviceCalls[0].data.date === "2026-10-20");
check("20 F5 optimistic list remove after delete", !card5._exceptions.some((e) => e.date === "2026-10-20"));

// ============ 7) F5: save idempotenz — no duplicate optimistic entries ============
serviceCalls.length = 0;
const card6 = newCard();
card6._openExcModal();
card6._saveException();
const count1 = card6._exceptions.filter((e) => e.date === todayIso).length;
card6._openExcModal();
card6._saveException();
const count2 = card6._exceptions.filter((e) => e.date === todayIso).length;
check("21 F5 no duplicate optimistic entries", count1 === 1 && count2 === 1);

// ============ 8) banner regression (v273) ============
const card7 = newCard();
card7._exceptions = [{ date: todayIso, exception_type: "free", note: "Schulfest", until_lesson: null }];
sandbox.hass.states["binary_sensor.stundenplan_michelle_schulfrei"].attributes.exception_today = { exception_type: "free", note: "Schulfest" };
card7._updateData();
card7._render();
check("22 banner free today renders (v273 regression)", card7._shadow.innerHTML.indexOf("Heute kein Unterricht") !== -1);

// ============ 9) close resets all state (v273 + v2.7.4 _excError) ============
const card8 = newCard();
card8._openExcModal();
card8._excError = "exc_err_until";
card8._closeExcModal();
check("23 close clears error flag", card8._excError === null && card8._excModal === false && card8._excException === null);

// ============ 10) free save (v273 core flow) still works ============
serviceCalls.length = 0;
const card9 = newCard();
card9._openExcModal();
const noteField9 = { closest(sel) { return sel === "[data-action]" ? { dataset: { action: "exc-note-input" } } : null; }, value: "Klassenfahrt" };
card9._handleInput({ target: noteField9 });
card9._saveException();
check("24 free save: service with note", serviceCalls.length === 1 && serviceCalls[0].data.exception_type === "free" && serviceCalls[0].data.note === "Klassenfahrt");

console.log("RESULT: " + pass + " checks passed" + (fail ? ", " + fail + " FAILED" : ""));
process.exit(fail ? 1 : 0);