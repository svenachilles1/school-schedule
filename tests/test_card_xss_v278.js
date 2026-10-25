// XSS escape simulation for v2.7.8 (Frenck security review, round 3) — DOM-free.
// Proves the holiday starts_on/ends_on values are escaped after _formatDate:
//   G1  current-holiday line: _formatDate output wrapped in _escHtml
//   G2  holiday list items: _formatDate output wrapped in _escHtml
//   G3  source-level: all 4 _formatDate render calls are wrapped, none raw
//   G4  regression: real dates still render as dd.mm.yyyy
// The crafted dates come from mehr-schulferien.de via _fetchHolidays or the
// localStorage cache — both sources end up in _holidayData, and both render
// paths (current + list) go through the same wrapping.
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

// ---- minimal DOM shim (v275/v277 pattern) ----
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
const IMG_PAYLOAD = '"><img src=x onerror=window.__xss=1>';

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

// G1: current-holiday line (line ~909) — crafted period wins as "current"
{
  const card = newCard();
  card._holidayState = "thueringen";
  card._holidayPickerOpen = false;
  card._holidayLoading = false;
  card._holidayDataState = "thueringen";
  card._holidayData = [{ name: "Herbstferien", starts_on: "2026-10-01", ends_on: "2026-10-10" }];
  card._isInHoliday = () => ({ name: "Angriff", starts_on: IMG_PAYLOAD, ends_on: IMG_PAYLOAD });
  const html = card._renderHolidayView();
  check("G1a current dates: no raw <img", html.indexOf("<img") === -1);
  check("G1b current dates: no raw <script", html.indexOf("<script") === -1);
  check("G1c current dates: escaped form present", html.indexOf("&lt;img") !== -1);
  check("G1d current dates: current block rendered", html.indexOf("holiday-current-dates") !== -1);
}

// G2: holiday list items (line ~913) — crafted dates in the list entries
{
  const card = newCard();
  card._holidayState = "thueringen";
  card._holidayPickerOpen = false;
  card._holidayLoading = false;
  card._holidayDataState = "thueringen";
  card._isInHoliday = () => null;
  card._holidayData = [
    { name: "Weihnachten", starts_on: SCRIPT_PAYLOAD, ends_on: IMG_PAYLOAD },
    { name: "Herbst", starts_on: "2026-10-05", ends_on: "2026-10-17" },
  ];
  const html = card._renderHolidayView();
  check("G2a list dates: no raw <script", html.indexOf("<script") === -1);
  check("G2b list dates: no raw <img", html.indexOf("<img") === -1);
  check("G2c list dates: escaped form present", html.indexOf("&lt;script") !== -1 && html.indexOf("&lt;img") !== -1);
  check("G2d list dates: healthy entry still renders dd.mm.yyyy", html.indexOf("05.10.2026") !== -1 && html.indexOf("17.10.2026") !== -1);
}

// G3: source-level — every _formatDate call that feeds HTML is wrapped
{
  const wrapped = (src.match(/_escHtml\(this\._formatDate\(/g) || []).length;
  const total = (src.match(/this\._formatDate\(/g) || []).length;
  check("G3a all 4 _formatDate render calls wrapped", wrapped === 4 && total === 4);
  check("G3b no unwrapped concat into HTML", src.indexOf("+ this._formatDate(") === -1);
}

// G4: regression — real dates must still render as dd.mm.yyyy in both paths
{
  const card = newCard();
  card._holidayState = "thueringen";
  card._holidayPickerOpen = false;
  card._holidayLoading = false;
  card._holidayDataState = "thueringen";
  const today = iso(0), soon = iso(3);
  card._isInHoliday = () => ({ name: "Winter", starts_on: today, ends_on: soon });
  card._holidayData = [{ name: "Weihnachten", starts_on: "2026-12-23", ends_on: "2027-01-02" }];
  const html = card._renderHolidayView();
  const fmt = (d) => { const p = d.split("-"); return p[2] + "." + p[1] + "." + p[0]; };
  check("G4a current real dates formatted", html.indexOf(fmt(today)) !== -1 && html.indexOf(fmt(soon)) !== -1);
  check("G4b list real dates formatted", html.indexOf("23.12.2026") !== -1 && html.indexOf("02.01.2027") !== -1);
}

console.log("RESULT v278: " + pass + " passed, " + fail + " failed");
if (fail > 0) { console.log("FAILURES: " + failures.join(", ")); process.exit(1); }
console.log("ALL v2.7.8 HOLIDAY-DATE XSS CHECKS PASSED \u2705");
