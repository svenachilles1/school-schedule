/**
 * School Schedule Card — Ultra Premium v2.4.5
 * 3D Glassmorphism, animated aurora background
 * Features: Tagesansicht-Toggle, Inline-Verwaltung (Add/Edit/Delete), Pausen (is_break),
 *           Ferienkalender mit Zurueck-Button, Icon-Anzeige pro Stunde, Sprache DE/EN,
 *           Kinder-Umschalter (Multi-Child), Ferien-Countdown in der Hero-Sektion
 */

const HOLIDAY_STATES = [
  {slug:"baden-wuerttemberg", name_de:"Baden-W\u00fcrttemberg", name_en:"Baden-W\u00fcrttemberg"},
  {slug:"bayern", name_de:"Bayern", name_en:"Bavaria"},
  {slug:"berlin", name_de:"Berlin", name_en:"Berlin"},
  {slug:"brandenburg", name_de:"Brandenburg", name_en:"Brandenburg"},
  {slug:"bremen", name_de:"Bremen", name_en:"Bremen"},
  {slug:"hamburg", name_de:"Hamburg", name_en:"Hamburg"},
  {slug:"hessen", name_de:"Hessen", name_en:"Hesse"},
  {slug:"mecklenburg-vorpommern", name_de:"Mecklenburg-Vorpommern", name_en:"Mecklenburg-Western Pomerania"},
  {slug:"niedersachsen", name_de:"Niedersachsen", name_en:"Lower Saxony"},
  {slug:"nordrhein-westfalen", name_de:"Nordrhein-Westfalen", name_en:"North Rhine-Westphalia"},
  {slug:"rheinland-pfalz", name_de:"Rheinland-Pfalz", name_en:"Rhineland-Palatinate"},
  {slug:"saarland", name_de:"Saarland", name_en:"Saarland"},
  {slug:"sachsen", name_de:"Sachsen", name_en:"Saxony"},
  {slug:"sachsen-anhalt", name_de:"Sachsen-Anhalt", name_en:"Saxony-Anhalt"},
  {slug:"schleswig-holstein", name_de:"Schleswig-Holstein", name_en:"Schleswig-Holstein"},
  {slug:"thueringen", name_de:"Th\u00fcringen", name_en:"Thuringia"},
];

class SchoolScheduleCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._childName = "";
    this._days = {};
    this._today = null;
    this._todayKey = "";
    this._viewMode = "week";
    this._editMode = false;
    this._showForm = false;
    this._formData = null;
    this._confirmDelete = null;
    this._holidayMode = false;
    this._holidayData = null;
    this._holidayLoading = false;
    this._holidayState = localStorage.getItem("ssc_holiday_state") || "";
    this._holidayAutoFetched = false;
    this._availableChildren = [];
    this._cardLanguage = "";
    this._lang = "de";
    this._shadow = this.attachShadow({ mode: "open" });
    this._shadow.addEventListener("click", (e) => this._handleClick(e));
    this._shadow.addEventListener("input", (e) => this._handleInput(e));
  }

  static get STRINGS() {
    return {
      de: {
        title: "Stundenplan",
        no_data: "Keine Daten",
        today: "Heute",
        lessons_today: "Stunden heute",
        now_label: "Jetzt",
        now_upper: "JETZT",
        next_label: "Als N\u00e4chstes",
        next_upper: "ALS N\u00c4CHSTES",
        day_view: "Tagesansicht",
        week_view: "Wochenansicht",
        done: "Fertig",
        edit: "Bearbeiten",
        delete: "L\u00f6schen",
        loading_holidays: "Ferien werden geladen...",
        no_holiday_data: "Keine Feriendaten verf\u00fcgbar",
        choose_state: "Bundesland w\u00e4hlen",
        back: "Zur\u00fcck",
        to: "bis",
        days_until_holiday: "TAGE BIS FERIEN",
        holiday_days_left: "FERIENTAGE NOCH",
        edit_lesson: "Stunde bearbeiten",
        add_lesson: "Stunde hinzuf\u00fcgen",
        weekday: "Wochentag",
        subject: "Fach",
        lesson_short: "Stunde",
        start_time: "Startzeit",
        end_time: "Endzeit",
        room: "Raum",
        teacher: "Lehrer",
        color: "Farbe",
        icon: "Icon",
        mark_break: "Als Pause markieren",
        apply_all: "Auf alle Tage anwenden",
        cancel: "Abbrechen",
        save: "Speichern",
        add: "Hinzuf\u00fcgen",
        delete_lesson_q: "Stunde l\u00f6schen?",
        unnamed: "Unbenannt",
        weekend: "Wochenende",
        ph_subject: "z.B. Mathematik",
        ph_room: "z.B. R204",
        ph_teacher: "z.B. M\u00fcller",
        day_full_saturday: "Samstag",
        day_full_sunday: "Sonntag",
        day_full: {monday:"Montag",tuesday:"Dienstag",wednesday:"Mittwoch",thursday:"Donnerstag",friday:"Freitag"},
        day_short: {monday:"Mo",tuesday:"Di",wednesday:"Mi",thursday:"Do",friday:"Fr"},
      },
      en: {
        title: "Schedule",
        no_data: "No data",
        today: "Today",
        lessons_today: "Lessons today",
        now_label: "Now",
        now_upper: "NOW",
        next_label: "Next",
        next_upper: "NEXT",
        day_view: "Day view",
        week_view: "Week view",
        done: "Done",
        edit: "Edit",
        delete: "Delete",
        loading_holidays: "Loading holidays...",
        no_holiday_data: "No holiday data available",
        choose_state: "Choose a federal state",
        back: "Back",
        to: "to",
        days_until_holiday: "DAYS UNTIL HOLIDAYS",
        holiday_days_left: "HOLIDAYS LEFT",
        edit_lesson: "Edit lesson",
        add_lesson: "Add lesson",
        weekday: "Weekday",
        subject: "Subject",
        lesson_short: "Lesson",
        start_time: "Start time",
        end_time: "End time",
        room: "Room",
        teacher: "Teacher",
        color: "Color",
        icon: "Icon",
        mark_break: "Mark as break",
        apply_all: "Apply to all days",
        cancel: "Cancel",
        save: "Save",
        add: "Add",
        delete_lesson_q: "Delete lesson?",
        unnamed: "Unnamed",
        weekend: "Weekend",
        ph_subject: "e.g. Math",
        ph_room: "e.g. R204",
        ph_teacher: "e.g. Miller",
        day_full_saturday: "Saturday",
        day_full_sunday: "Sunday",
        day_full: {monday:"Monday",tuesday:"Tuesday",wednesday:"Wednesday",thursday:"Thursday",friday:"Friday"},
        day_short: {monday:"Mo",tuesday:"Tu",wednesday:"We",thursday:"Th",friday:"Fr"},
      },
    };
  }

  _t(key) {
    const table = SchoolScheduleCard.STRINGS[this._lang] || SchoolScheduleCard.STRINGS.de;
    const val = table[key];
    if (val !== undefined) return val;
    const fallback = SchoolScheduleCard.STRINGS.de[key];
    return fallback !== undefined ? fallback : key;
  }

  _resolveLanguage() {
    // Priority: config.language (manual override) > hass.locale.language (auto) > "de"
    let lang = this._cardLanguage;
    if (lang !== "de" && lang !== "en") {
      if (this._hass && this._hass.locale && this._hass.locale.language) {
        const loc = String(this._hass.locale.language).toLowerCase();
        if (loc.startsWith("de")) lang = "de";
        else if (loc.startsWith("en")) lang = "en";
        else lang = "de";
      } else {
        lang = "de";
      }
    }
    this._lang = lang;
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
    this._childName = config.child_name || "";
    this._cardHeight = config.height || "";
    this._cardWidth = config.width || "";
    this._cardLanguage = config.language || "";
    this._resolveLanguage();
    const savedView = localStorage.getItem("ssc_view_" + this._childName.toLowerCase());
    if (savedView === "week" || savedView === "day") {
      this._viewMode = savedView;
    }
  }

  set hass(hass) {
    this._hass = hass;
    this._resolveLanguage();
    this._updateData();
  }

  getCardSize() { return 5; }

  _findEntity(suffix) {
    const childName = (this._childName || "").toLowerCase();
    const allStates = Object.values(this._hass.states);
    for (const state of allStates) {
      const attrs = state.attributes || {};
      if (attrs.child_name && attrs.child_name.toLowerCase() === childName) {
        if (state.entity_id.endsWith("_" + suffix)) return state;
      }
    }
    return null;
  }

  _updateData() {
    if (!this._hass || !this._config) return;
    const childName = this._childName || this._config.child_name || "";
    if (!childName) return;
    // Collect all configured children (for the child switcher)
    const childSet = new Set();
    for (const st of Object.values(this._hass.states)) {
      const at = st.attributes || {};
      if (at.child_name && Array.isArray(at.lessons)) childSet.add(at.child_name);
    }
    this._availableChildren = [...childSet].sort((a, b) => a.localeCompare(b, "de"));
    // Auto-load holiday data for the countdown (cache first, fetch once)
    if (this._holidayState && !this._holidayData && !this._holidayAutoFetched) {
      this._holidayAutoFetched = true;
      if (!this._loadHolidayCache(this._holidayState)) this._fetchHolidays(this._holidayState);
    }
    const shortNames = this._t("day_short");
    const fullNames = this._t("day_full");
    const dayMap = {
      monday: { sensor: "montag", label: shortNames.monday, full: fullNames.monday },
      tuesday: { sensor: "dienstag", label: shortNames.tuesday, full: fullNames.tuesday },
      wednesday: { sensor: "mittwoch", label: shortNames.wednesday, full: fullNames.wednesday },
      thursday: { sensor: "donnerstag", label: shortNames.thursday, full: fullNames.thursday },
      friday: { sensor: "freitag", label: shortNames.friday, full: fullNames.friday },
    };
    this._days = {};
    for (const [day, info] of Object.entries(dayMap)) {
      const state = this._findEntity(info.sensor);
      this._days[day] = {
        label: info.label,
        full: info.full,
        lessons: state ? (state.attributes.lessons || []) : [],
        state: state ? state.state : 0,
      };
    }
    const todayEntity = this._findEntity("heute");
    this._today = todayEntity ? {
      lessons: todayEntity.attributes.lessons || [],
      current: todayEntity.attributes.current_lesson || null,
      next: todayEntity.attributes.next_lesson || null,
    } : null;
    const todayJs = new Date().getDay();
    this._todayKey = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][todayJs];
    if (!this._showForm && !this._confirmDelete) {
      this._render();
    }
  }

  _getColor(l) { return l.color || "#7c4dff"; }
  _getIcon(l) { return l.icon || "mdi:school"; }

  _hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return { r, g, b };
  }

  _rgba(hex, a) {
    if (!hex.startsWith("#")) return "rgba(124,77,255," + a + ")";
    const c = this._hexToRgb(hex);
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }

  _luminance(hex) {
    if (!hex.startsWith("#")) return 0.3;
    const c = this._hexToRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  }

  // === Event Handlers ===

  _handleClick(e) {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    switch (action) {
      case "toggle-view": this._toggleViewMode(); break;
      case "switch-child": this._switchChild(actionEl.dataset.child); break;
      case "toggle-edit": this._toggleEditMode(); break;
      case "toggle-holiday": this._toggleHolidayMode(); break;
      case "select-holiday-state": this._selectHolidayState(actionEl.dataset.state); break;
      case "back-holiday-state": this._backToHolidayPicker(); break;
      case "add-lesson": this._openAddForm(actionEl.dataset.weekday); break;
      case "edit-lesson": this._openEditForm(actionEl.dataset.weekday, actionEl.dataset.number); break;
      case "delete-lesson": this._requestDelete(actionEl.dataset.weekday, actionEl.dataset.number); break;
      case "confirm-delete": this._confirmDeleteAction(); break;
      case "cancel-delete": this._cancelDelete(); break;
      case "cancel-delete-bg":
        if (!e.target.closest(".ssc-confirm-card")) this._cancelDelete();
        break;
      case "save-form": this._saveForm(); break;
      case "cancel-form": this._closeForm(); break;
      case "cancel-form-bg":
        if (!e.target.closest(".ssc-form-card")) this._closeForm();
        break;
    }
  }

  _handleInput(e) {
    if (e.target.id === "ssc-icon") {
      const preview = this._shadow.querySelector("#ssc-icon-preview");
      if (preview) preview.icon = e.target.value || "mdi:school";
    }
    if (e.target.id === "ssc-color") {
      const hexDisplay = this._shadow.querySelector("#ssc-color-hex");
      if (hexDisplay) hexDisplay.textContent = e.target.value;
      const iconPreview = this._shadow.querySelector("#ssc-icon-preview");
      if (iconPreview) iconPreview.style.color = e.target.value;
    }
    if (e.target.id === "ssc-is-break") {
      const isBreak = e.target.checked;
      const subjectLabel = this._shadow.querySelector('.ssc-field-row .ssc-field-label');
      const roomInput = this._shadow.querySelector("#ssc-room");
      const teacherInput = this._shadow.querySelector("#ssc-teacher");
      const subjectInput = this._shadow.querySelector("#ssc-subject");
      if (isBreak) {
        if (subjectLabel) subjectLabel.textContent = this._t("subject");
        if (roomInput) { roomInput.value = ""; roomInput.disabled = true; }
        if (teacherInput) { teacherInput.value = ""; teacherInput.disabled = true; }
        if (subjectInput && !subjectInput.value) { subjectInput.value = "Pause"; subjectInput.style.opacity = "0.6"; }
      } else {
        if (subjectLabel) subjectLabel.textContent = this._t("subject") + " *";
        if (roomInput) roomInput.disabled = false;
        if (teacherInput) teacherInput.disabled = false;
        if (subjectInput && subjectInput.value === "Pause") { subjectInput.value = ""; subjectInput.style.opacity = "1"; }
      }
    }
  }

  // === View / Edit Toggles ===

  _toggleViewMode() {
    this._viewMode = this._viewMode === "week" ? "day" : "week";
    localStorage.setItem("ssc_view_" + this._childName.toLowerCase(), this._viewMode);
    this._render();
  }

  _switchChild(name) {
    if (!name || name === this._childName) return;
    this._childName = name;
    this._showForm = false;
    this._formData = null;
    this._confirmDelete = null;
    const savedView = localStorage.getItem("ssc_view_" + name.toLowerCase());
    if (savedView === "week" || savedView === "day") this._viewMode = savedView;
    this._updateData();
  }

  _toggleHolidayMode() {
    this._holidayMode = !this._holidayMode;
    if (this._holidayMode && !this._holidayData && this._holidayState) {
      if (!this._loadHolidayCache(this._holidayState)) this._fetchHolidays(this._holidayState);
    }
    this._render();
  }

  _selectHolidayState(stateSlug) {
    this._holidayState = stateSlug;
    localStorage.setItem("ssc_holiday_state", stateSlug);
    this._fetchHolidays(stateSlug);
  }

  _backToHolidayPicker() {
    this._holidayState = "";
    this._holidayData = null;
    localStorage.removeItem("ssc_holiday_state");
    this._render();
  }

  _dedupePeriods(periods) {
    const seen = new Set();
    const out = [];
    for (const p of (periods || [])) {
      if (!p || !p.is_school_vacation) continue;
      const key = String(p.starts_on) + "|" + String(p.ends_on) + "|" + String(p.name);
      if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
    return out;
  }

  _loadHolidayCache(stateSlug) {
    try {
      const raw = localStorage.getItem("ssc_holiday_cache_" + stateSlug);
      if (!raw) return false;
      const cache = JSON.parse(raw);
      if (!cache || cache.state !== stateSlug) return false;
      if (cache.date !== new Date().toISOString().slice(0, 10)) return false;
      if (!Array.isArray(cache.data)) return false;
      // Dedupe auch beim Cache-Load (v2.4.2 konnte Duplikate in den Cache geschrieben haben)
      this._holidayData = this._dedupePeriods(cache.data);
      return true;
    } catch(e) { return false; }
  }

  async _fetchHolidays(stateSlug) {
    this._holidayLoading = true;
    this._render();
    const periods = [];
    const fetchYear = async (y) => {
      try {
        const resp = await fetch("https://www.mehr-schulferien.de/api/v2.1/federal-states/" + stateSlug + "/periods?year=" + y);
        if (!resp.ok) return;
        const json = await resp.json();
        for (const p of (json.data || [])) {
          if (p && p.is_school_vacation) periods.push(p);
        }
      } catch(e) { /* ignore single-year failures */ }
    };
    const year = new Date().getFullYear();
    await fetchYear(year);
    await fetchYear(year + 1);
    periods.sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on)));
    this._holidayData = this._dedupePeriods(periods);
    this._holidayLoading = false;
    try {
      localStorage.setItem("ssc_holiday_cache_" + stateSlug, JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        state: stateSlug,
        data: periods,
      }));
    } catch(e) { /* storage full — ignore */ }
    this._render();
  }

  _isInHoliday(dateStr) {
    if (!this._holidayData) return false;
    const today = dateStr || new Date().toISOString().slice(0, 10);
    for (const h of this._holidayData) {
      if (today >= h.starts_on && today <= h.ends_on) return h;
    }
    return false;
  }

  _getHolidayCountdown() {
    if (!this._holidayData || this._holidayData.length === 0) return null;
    const todayStr = new Date().toISOString().slice(0, 10);
    const today = new Date(todayStr + "T00:00:00");
    const current = this._isInHoliday(todayStr);
    if (current) {
      const end = new Date(current.ends_on + "T00:00:00");
      return { mode: "current", days: Math.max(0, Math.round((end - today) / 86400000)), name: current.name, ends_on: current.ends_on };
    }
    const upcoming = this._holidayData
      .filter(h => String(h.starts_on) > todayStr)
      .sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on)))[0];
    if (!upcoming) return null;
    const start = new Date(upcoming.starts_on + "T00:00:00");
    return { mode: "upcoming", days: Math.max(0, Math.round((start - today) / 86400000)), name: upcoming.name, starts_on: upcoming.starts_on };
  }

  _formatDate(dateStr) {
    const parts = dateStr.split("-");
    if (parts.length === 3) return parts[2] + "." + parts[1] + "." + parts[0];
    return dateStr;
  }

  _getStateName(slug) {
    for (const s of HOLIDAY_STATES) {
      if (s.slug === slug) return this._lang === "en" ? s.name_en : s.name_de;
    }
    return slug;
  }

  _renderHolidayView() {
    if (!this._holidayState) {
      return this._renderHolidayPicker();
    }
    const stateName = this._getStateName(this._holidayState);
    let html = '<div class="holiday-header">' +
      '<button class="holiday-back-btn" data-action="back-holiday-state" title="' + this._t("back") + '">' +
        '<ha-icon icon="mdi:arrow-left" style="--mdc-icon-size:15px"></ha-icon>' +
        '<span>' + this._t("back") + '</span>' +
      '</button>' +
      '<div class="holiday-state-name">' + stateName + '</div>' +
    '</div>';
    if (this._holidayLoading) {
      return html + '<div class="holiday-loading"><div>' + this._t("loading_holidays") + '</div></div>';
    }
    if (!this._holidayData || this._holidayData.length === 0) {
      return html + '<div class="holiday-empty"><div>' + this._t("no_holiday_data") + '</div></div>';
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const currentHoliday = this._isInHoliday(todayStr);
    if (currentHoliday) {
      html += '<div class="holiday-current"><div class="holiday-item-icon"><ha-icon icon="mdi:beach" style="--mdc-icon-size:28px;color:#ff9800"></ha-icon></div><div class="holiday-current-text"><div class="holiday-current-name">' + currentHoliday.name + '</div><div class="holiday-current-dates">' + this._formatDate(currentHoliday.starts_on) + " " + this._t("to") + " " + this._formatDate(currentHoliday.ends_on) + '</div></div></div>';
    }
    html += '<div class="holiday-list">';
    for (const h of this._holidayData) {
      html += '<div class="holiday-item"><div class="holiday-item-icon"><ha-icon icon="mdi:beach" style="--mdc-icon-size:18px;color:#ff9800;opacity:0.7"></ha-icon></div><div class="holiday-item-info"><div class="holiday-item-name">' + h.name + '</div><div class="holiday-item-dates">' + this._formatDate(h.starts_on) + " \u2013 " + this._formatDate(h.ends_on) + '</div></div></div>';
    }
    html += '</div>';
    return html;
  }

  _renderHolidayPicker() {
    let html = '<div class="holiday-picker"><div class="holiday-picker-title">' + this._t("choose_state") + '</div><div class="holiday-picker-grid">';
    for (const s of HOLIDAY_STATES) {
      const name = this._lang === "en" ? s.name_en : s.name_de;
      html += '<button class="holiday-state-btn" data-action="select-holiday-state" data-state="' + s.slug + '">' + name + '</button>';
    }
    return html + '</div></div>';
  }

  _toggleEditMode() {
    this._editMode = !this._editMode;
    if (!this._editMode) {
      this._showForm = false;
      this._formData = null;
      this._confirmDelete = null;
    }
    this._render();
  }

  // === Form Logic ===

  _openAddForm(weekday) {
    if (!weekday || weekday === "saturday" || weekday === "sunday") {
      weekday = "monday";
    }
    this._formData = { mode: "add", weekday: weekday, lesson: null };
    this._showForm = true;
    this._render();
  }

  _openEditForm(weekday, lessonNumber) {
    const lesson = this._findLesson(weekday, lessonNumber);
    if (!lesson) return;
    this._formData = { mode: "edit", weekday: weekday, lesson: lesson };
    this._showForm = true;
    this._render();
  }

  _closeForm() {
    this._showForm = false;
    this._formData = null;
    this._render();
  }

  _saveForm() {
    const isBreakEl = this._shadow.querySelector("#ssc-is-break");
    const isBreak = isBreakEl ? isBreakEl.checked : false;

    const subjectEl = this._shadow.querySelector("#ssc-subject");
    const subject = subjectEl ? subjectEl.value.trim() : "";
    if (!subject && !isBreak) {
      if (subjectEl) {
        subjectEl.style.borderColor = "#f44336";
        subjectEl.focus();
      }
      return;
    }

    const fd = this._formData;
    const isEdit = fd.mode === "edit";

    const applyAllEl = this._shadow.querySelector("#ssc-apply-all");
    const applyToAll = applyAllEl ? applyAllEl.checked : false;

    let weekday;
    if (isEdit) {
      weekday = fd.weekday;
    } else {
      const weekdaySelect = this._shadow.querySelector("#ssc-weekday");
      weekday = weekdaySelect ? weekdaySelect.value : fd.weekday;
    }

    const numberEl = this._shadow.querySelector("#ssc-number");
    const number = parseInt(numberEl ? numberEl.value : "1", 10) || 1;
    const room = (this._shadow.querySelector("#ssc-room") || {}).value || "";
    const teacher = (this._shadow.querySelector("#ssc-teacher") || {}).value || "";
    const startEl = this._shadow.querySelector("#ssc-start");
    const endEl = this._shadow.querySelector("#ssc-end");
    const start_time = startEl ? startEl.value : "08:00";
    const end_time = endEl ? endEl.value : "08:45";
    const colorEl = this._shadow.querySelector("#ssc-color");
    const color = colorEl ? colorEl.value : "#44739e";
    const iconEl = this._shadow.querySelector("#ssc-icon");
    const icon = iconEl ? iconEl.value.trim() : "mdi:school";

    const serviceData = {
      child_name: this._childName,
      weekday: weekday,
      lesson_number: number,
      subject: subject || (isBreak ? "Pause" : ""),
      room: isBreak ? "" : room,
      teacher: isBreak ? "" : teacher,
      start_time: start_time,
      end_time: end_time,
      color: isBreak ? (color !== "#44739e" ? color : "#7a8a99") : color,
      icon: isBreak ? (icon !== "mdi:school" ? icon : "mdi:coffee") : icon,
      is_break: isBreak,
    };
    if (!isEdit) {
      serviceData.apply_to_all_days = applyToAll;
    }

    if (isEdit) {
      this._hass.callService("school_schedule", "update_lesson", serviceData);
    } else {
      this._hass.callService("school_schedule", "add_lesson", serviceData);
    }

    this._showForm = false;
    this._formData = null;
    this._render();
  }

  // === Delete Logic ===

  _requestDelete(weekday, lessonNumber) {
    const lesson = this._findLesson(weekday, lessonNumber);
    if (!lesson) return;
    const dayFullNames = this._t("day_full");
    this._confirmDelete = {
      weekday: weekday,
      lesson_number: parseInt(lessonNumber),
      subject: lesson.subject,
      dayName: dayFullNames[weekday] || weekday,
      start_time: (lesson.start_time || "").slice(0, 5),
      end_time: (lesson.end_time || "").slice(0, 5),
    };
    this._render();
  }

  _confirmDeleteAction() {
    const cd = this._confirmDelete;
    if (!cd) return;
    this._hass.callService("school_schedule", "remove_lesson", {
      child_name: this._childName,
      weekday: cd.weekday,
      lesson_number: cd.lesson_number,
    });
    this._confirmDelete = null;
    this._render();
  }

  _cancelDelete() {
    this._confirmDelete = null;
    this._render();
  }

  // === Helpers ===

  _findLesson(weekday, lessonNumber) {
    const dayData = this._days[weekday];
    if (dayData && dayData.lessons) {
      for (const l of dayData.lessons) {
        if (parseInt(l.lesson_number) === parseInt(lessonNumber)) return l;
      }
    }
    if (this._today && this._todayKey === weekday && this._today.lessons) {
      for (const l of this._today.lessons) {
        if (parseInt(l.lesson_number) === parseInt(lessonNumber)) return l;
      }
    }
    return null;
  }

  _getNextLessonNumber(weekday) {
    const dayData = this._days[weekday];
    if (!dayData || !dayData.lessons || dayData.lessons.length === 0) return 1;
    const max = Math.max(...dayData.lessons.map(l => parseInt(l.lesson_number) || 0));
    return max + 1;
  }

  // === Render ===

  _renderChildSwitch() {
    if (!this._availableChildren || this._availableChildren.length < 2) return "";
    let html = '<div class="ssc-child-switch">';
    for (const name of this._availableChildren) {
      html += '<button class="ssc-child-pill' + (name === this._childName ? " ssc-child-active" : "") +
        '" data-action="switch-child" data-child="' + name + '" title="' + name + '">' + name + '</button>';
    }
    return html + '</div>';
  }

  _renderHolidayCountdownPill() {
    const cd = this._getHolidayCountdown();
    const grad = "background:linear-gradient(135deg,#ffb74d,#ff9800);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text";
    if (cd) {
      return '<div class="hero-stat hero-holiday" data-action="toggle-holiday">' +
        '<div class="hero-stat-num" style="' + grad + '">' + cd.days + '</div>' +
        '<div class="hero-stat-label">' + this._t(cd.mode === "current" ? "holiday_days_left" : "days_until_holiday") + '</div>' +
        '<div class="hero-holiday-name" title="' + cd.name + '">' + cd.name + '</div>' +
      '</div>';
    }
    return '<div class="hero-stat hero-holiday" data-action="toggle-holiday" title="' + this._t("choose_state") + '">' +
      '<div class="hero-stat-num" style="color:var(--disabled-text-color,rgba(255,255,255,0.15))">-</div>' +
      '<div class="hero-stat-label">' + this._t("days_until_holiday") + '</div>' +
      '<div class="hero-holiday-name">' + this._t("choose_state") + '</div>' +
    '</div>';
  }

  _render() {
    if (!this._days || Object.keys(this._days).length === 0) {
      const switchHtml = this._renderChildSwitch();
      this._shadow.innerHTML =
        '<ha-card style="padding:16px;color:var(--secondary-text-color)">' +
          (switchHtml ? '<div style="padding:0 0 12px">' + switchHtml + '</div>' : "") +
          this._t("no_data") +
        '</ha-card>';
      return;
    }

    const childName = this._childName || "";
    const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    const childSwitchHtml = this._renderChildSwitch();
    let todayLessons = 0, currentLesson = null, nextLesson = null;
    if (this._today) {
      todayLessons = this._today.lessons.length;
      currentLesson = this._today.current;
      nextLesson = this._today.next;
    }

    // --- Hero summary ---
    let heroHtml = "";
    if (this._today) {
      let heroPills = "";
      const totalToday = todayLessons;
      const heroGrad = currentLesson
        ? this._getColor(currentLesson)
        : "var(--primary-color, #7c4dff)";

      heroPills += '<div class="hero-stat">' +
        '<div class="hero-stat-num" style="background:linear-gradient(135deg,' + heroGrad + ',' + this._rgba(heroGrad.startsWith("#") ? heroGrad : "#7c4dff", 0.5) + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">' + totalToday + '</div>' +
        '<div class="hero-stat-label">' + this._t("lessons_today") + '</div>' +
      '</div>';

      if (currentLesson) {
        const c = this._getColor(currentLesson);
        heroPills += '<div class="hero-now" style="--now-c:' + c + ';--now-c20:' + this._rgba(c, 0.2) + ';--now-c10:' + this._rgba(c, 0.1) + '">' +
          '<div class="hero-now-pulse"></div>' +
          '<div class="hero-now-info">' +
            '<div class="hero-now-label">' + this._t("now_upper") + '</div>' +
            '<div class="hero-now-subject">' + currentLesson.subject + '</div>' +
            '<div class="hero-now-time">' + (currentLesson.start_time || "").slice(0,5) + " - " + (currentLesson.end_time || "").slice(0,5) + '</div>' +
            '<div class="hero-now-room">' + (currentLesson.room || "") + '</div>' +
          '</div>' +
        '</div>';
      } else {
        heroPills += '<div class="hero-stat">' +
          '<div class="hero-stat-num" style="color:var(--disabled-text-color,rgba(255,255,255,0.15))">-</div>' +
          '<div class="hero-stat-label">' + this._t("now_label") + '</div>' +
        '</div>';
      }

      if (nextLesson) {
        const c = this._getColor(nextLesson);
        heroPills += '<div class="hero-next" style="--next-c:' + c + ';--next-c15:' + this._rgba(c, 0.15) + '">' +
          '<div class="hero-next-label">' + this._t("next_upper") + '</div>' +
          '<div class="hero-next-subject">' + nextLesson.subject + '</div>' +
          '<div class="hero-next-time">' + (nextLesson.start_time || "").slice(0,5) + " - " + (nextLesson.end_time || "").slice(0,5) + '</div>' +
        '</div>';
      } else {
        heroPills += '<div class="hero-stat">' +
          '<div class="hero-stat-num" style="color:var(--disabled-text-color,rgba(255,255,255,0.15))">-</div>' +
          '<div class="hero-stat-label">' + this._t("next_label") + '</div>' +
        '</div>';
      }

      heroPills += this._renderHolidayCountdownPill();

      heroHtml = '<div class="hero">' + heroPills + '</div>';
    }

    // --- Action buttons ---
    const viewBtnText = this._viewMode === "week" ? this._t("day_view") : this._t("week_view");
    const viewBtnIcon = this._viewMode === "week" ? "mdi:calendar-day" : "mdi:calendar-week";
    const editBtnText = this._editMode ? this._t("done") : this._t("edit");
    const editBtnIcon = this._editMode ? "mdi:check" : "mdi:pencil";

    const actionsHtml = '<div class="ssc-actions">' +
      '<button class="ssc-btn' + (this._holidayMode ? " ssc-btn-active" : "") + '" data-action="toggle-holiday" title="' + this._t("loading_holidays").replace("...", "") + '">' +
        '<ha-icon icon="mdi:beach" style="--mdc-icon-size:16px"></ha-icon>' +
      '</button>' +
      '<button class="ssc-btn" data-action="toggle-view">' +
        '<ha-icon icon="' + viewBtnIcon + '" style="--mdc-icon-size:16px"></ha-icon>' +
        '<span>' + viewBtnText + '</span>' +
      '</button>' +
      '<button class="ssc-btn' + (this._editMode ? " ssc-btn-active" : "") + '" data-action="toggle-edit">' +
        '<ha-icon icon="' + editBtnIcon + '" style="--mdc-icon-size:16px"></ha-icon>' +
        '<span>' + editBtnText + '</span>' +
      '</button>' +
    '</div>';

    // --- Main content ---
    let contentHtml = "";
    if (this._holidayMode) {
      contentHtml = this._renderHolidayView();
    } else if (this._viewMode === "day") {
      contentHtml = this._renderDayView(currentLesson);
    } else {
      contentHtml = this._renderWeekView(dayOrder, currentLesson);
    }

    // --- Form / Confirm overlays ---
    const formHtml = this._renderForm();
    const confirmHtml = this._renderConfirmDelete();

    const cardClass = "ssc" + (this._editMode ? " ssc-editing" : "");
    const heightStyle = this._cardHeight ? ' style="height:' + this._cardHeight + '"' : "";
    const widthStyle = this._cardWidth ? ' style="max-width:' + this._cardWidth + ';margin:0 auto"' : "";

    this._shadow.innerHTML =
      '<style>' + this._styles() + '</style>' +
      '<ha-card class="' + cardClass + '"' + heightStyle + '>' +
        '<div class="aurora"></div>' +
        '<div class="aurora aurora2"></div>' +
        '<div class="content"' + widthStyle + '>' +
          '<div class="title-row">' +
            '<div class="title-icon">' +
              '<ha-icon icon="mdi:school" style="color:#fff;--mdc-icon-size:22px"></ha-icon>' +
            '</div>' +
            '<div class="title-text">' +
              '<div class="title-main">' + this._t("title") + '</div>' +
              '<div class="title-sub">' + childName + '</div>' +
            '</div>' +
            actionsHtml +
          '</div>' +
          childSwitchHtml +
          heroHtml +
          '<div class="content-scroll">' + contentHtml + '</div>' +
        '</div>' +
        formHtml +
        confirmHtml +
      '</ha-card>';
  }

  _renderLessonCard(lesson, isCurrent, isToday, day) {
    const isBreak = lesson.is_break === true;
    const color = isBreak ? (lesson.color || "#7a8a99") : this._getColor(lesson);
    const isDark = this._luminance(color) < 0.5;
    const textColor = isDark ? "#fff" : "#1a1a2e";
    const c10 = this._rgba(color, 0.1);
    const c20 = this._rgba(color, 0.2);
    const c30 = this._rgba(color, 0.3);
    const c05 = this._rgba(color, 0.05);
    const lessonNum = parseInt(lesson.lesson_number) || lesson.lesson_number;
    const lessonIcon = this._getIcon(lesson);
    const hasCustomIcon = !isBreak && lessonIcon && lessonIcon !== "mdi:school";

    let cls = "lc";
    if (isCurrent) cls += " lc-now";
    if (isBreak) cls += " lc-break";

    let details = "";
    if (!isBreak) {
    if (lesson.room) details += '<span class="lc-room">' + lesson.room + '</span>';
    if (lesson.teacher) details += '<span class="lc-teacher">' + lesson.teacher + '</span>';
    }

    let numHtml;
    if (isBreak) {
      numHtml = '<ha-icon icon="mdi:coffee-off" style="--mdc-icon-size:16px"></ha-icon>';
    } else if (hasCustomIcon) {
      numHtml = '<ha-icon icon="' + lessonIcon + '" style="--mdc-icon-size:15px"></ha-icon>';
    } else {
      numHtml = lessonNum;
    }

    let editBtns = "";
    if (this._editMode) {
      editBtns = '<div class="lc-edit">' +
        '<button class="lc-edit-btn" data-action="edit-lesson" data-weekday="' + day + '" data-number="' + lessonNum + '" title="' + this._t("edit") + '">' +
          '<ha-icon icon="mdi:pencil"></ha-icon>' +
        '</button>' +
        '<button class="lc-edit-btn" data-action="delete-lesson" data-weekday="' + day + '" data-number="' + lessonNum + '" title="' + this._t("delete") + '">' +
          '<ha-icon icon="mdi:trash-can"></ha-icon>' +
        '</button>' +
      '</div>';
    }

    return '<div class="' + cls + '" style="--c:' + color + ';--c05:' + c05 + ';--c10:' + c10 + ';--c20:' + c20 + ';--c30:' + c30 + ';--ctext:' + textColor + '">' +
      '<div class="lc-rail"></div>' +
      '<div class="lc-content">' +
        '<div class="lc-num">' + numHtml + '</div>' +
        '<div class="lc-info">' +
          '<div class="lc-subject">' + lesson.subject + '</div>' +
          '<div class="lc-time">' + (lesson.start_time || "").slice(0,5) + " - " + (lesson.end_time || "").slice(0,5) + '</div>' +
          (details ? '<div class="lc-details">' + details + '</div>' : "") +
        '</div>' +
      '</div>' +
      editBtns +
    '</div>';
  }

  _renderAddButton(day) {
    if (!this._editMode) return "";
    return '<button class="lc-add" data-action="add-lesson" data-weekday="' + day + '">' +
      '<ha-icon icon="mdi:plus"></ha-icon>' +
    '</button>';
  }

  _renderWeekView(dayOrder, currentLesson) {
    let gridHtml = '<div class="grid">';
    for (const day of dayOrder) {
      const dd = this._days[day] || { lessons: [], label: day.slice(0,2), full: day };
      const isToday = day === this._todayKey;
      const count = dd.lessons.length;

      let dayClass = "day";
      if (isToday) dayClass += " day-active";
      if (count === 0) dayClass += " day-empty";

      let headerHtml = '<div class="day-header' + (isToday ? " dh-active" : "") + '">' +
        '<span class="day-label">' + dd.label + '</span>' +
        '<span class="day-badge' + (count === 0 ? " badge-zero" : "") + '">' + count + '</span>' +
      '</div>';

      let bodyHtml = '<div class="day-body">';
      if (dd.lessons.length === 0) {
        bodyHtml += '<div class="no-lesson"><span class="no-lesson-line"></span></div>';
      } else {
        for (const lesson of dd.lessons) {
          const isCurrent = currentLesson && currentLesson.lesson_number === lesson.lesson_number && isToday;
          bodyHtml += this._renderLessonCard(lesson, isCurrent, isToday, day);
        }
      }
      bodyHtml += this._renderAddButton(day);
      bodyHtml += '</div>';

      gridHtml += '<div class="' + dayClass + '">' + headerHtml + bodyHtml + '</div>';
    }
    gridHtml += '</div>';
    return gridHtml;
  }

  _renderDayView(currentLesson) {
    const dayFullNames = Object.assign({}, this._t("day_full"), {
      saturday: this._t("day_full_saturday"),
      sunday: this._t("day_full_sunday"),
    });
    const schoolDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    const isSchoolDay = schoolDays.includes(this._todayKey);
    const todayFull = dayFullNames[this._todayKey] || this._t("today");

    const lessons = this._today ? this._today.lessons : [];
    const count = lessons.length;
    const day = this._todayKey;

    let headerHtml = '<div class="day-header dh-active">' +
      '<span class="day-label">' + todayFull + '</span>' +
      '<span class="day-badge' + (count === 0 ? " badge-zero" : "") + '">' + count + '</span>' +
    '</div>';

    let bodyHtml = '<div class="day-body">';
    if (!isSchoolDay) {
      bodyHtml += '<div class="no-lesson"><span class="weekend-text">' + this._t("weekend") + '</span></div>';
    } else if (lessons.length === 0) {
      bodyHtml += '<div class="no-lesson"><span class="no-lesson-line"></span></div>';
    } else {
      for (const lesson of lessons) {
        const isCurrent = currentLesson && parseInt(currentLesson.lesson_number) === parseInt(lesson.lesson_number);
        bodyHtml += this._renderLessonCard(lesson, isCurrent, true, day);
      }
    }
    if (isSchoolDay) {
      bodyHtml += this._renderAddButton(day);
    }
    bodyHtml += '</div>';

    return '<div class="grid day-view"><div class="day day-active">' + headerHtml + bodyHtml + '</div></div>';
  }

  _renderForm() {
    if (!this._showForm || !this._formData) return "";
    const fd = this._formData;
    const isEdit = fd.mode === "edit";
    const lesson = fd.lesson || {};
    const dayFullNames = this._t("day_full");
    const weekday = fd.weekday;
    const dayName = dayFullNames[weekday] || weekday;
    const nextNum = isEdit ? (parseInt(lesson.lesson_number) || 1) : this._getNextLessonNumber(weekday);

    let weekdayField;
    if (isEdit) {
      weekdayField = '<div class="ssc-field">' +
        '<span class="ssc-field-label">' + this._t("weekday") + '</span>' +
        '<input class="ssc-input" type="text" value="' + dayName + '" disabled />' +
      '</div>';
    } else {
      weekdayField = '<div class="ssc-field">' +
        '<span class="ssc-field-label">' + this._t("weekday") + '</span>' +
        '<select class="ssc-input" id="ssc-weekday">' +
          '<option value="monday"' + (weekday === "monday" ? " selected" : "") + '>' + dayFullNames.monday + '</option>' +
          '<option value="tuesday"' + (weekday === "tuesday" ? " selected" : "") + '>' + dayFullNames.tuesday + '</option>' +
          '<option value="wednesday"' + (weekday === "wednesday" ? " selected" : "") + '>' + dayFullNames.wednesday + '</option>' +
          '<option value="thursday"' + (weekday === "thursday" ? " selected" : "") + '>' + dayFullNames.thursday + '</option>' +
          '<option value="friday"' + (weekday === "friday" ? " selected" : "") + '>' + dayFullNames.friday + '</option>' +
        '</select>' +
      '</div>';
    }

    const subj = lesson.subject || "";
    const room = lesson.room || "";
    const teacher = lesson.teacher || "";
    const startT = (lesson.start_time || "08:00").slice(0,5);
    const endT = (lesson.end_time || "08:45").slice(0,5);
    const colorV = lesson.color || "#44739e";
    const iconV = lesson.icon || "mdi:school";
    const isBreakV = lesson.is_break === true;
    const applyAllV = false;

    return '<div class="ssc-modal-overlay" data-action="cancel-form-bg">' +
      '<div class="ssc-form-card">' +
        '<div class="ssc-form-title">' + (isEdit ? this._t("edit_lesson") : this._t("add_lesson")) + '</div>' +
        '<div class="ssc-form-day">' + dayName + '</div>' +
        '<div class="ssc-form-fields">' +
          '<div class="ssc-field-row">' +
            '<div class="ssc-field" style="flex:2">' +
              '<span class="ssc-field-label">' + this._t("subject") + (isBreakV ? '' : ' *') + '</span>' +
              '<input class="ssc-input" type="text" id="ssc-subject" value="' + subj + '" placeholder="' + this._t("ph_subject") + '" />' +
            '</div>' +
            '<div class="ssc-field" style="flex:0 0 80px;max-width:80px">' +
              '<span class="ssc-field-label">' + this._t("lesson_short") + '</span>' +
              '<input class="ssc-input" type="number" id="ssc-number" min="1" max="12" value="' + nextNum + '"' + (isEdit ? " disabled" : "") + ' />' +
            '</div>' +
          '</div>' +
          '<div class="ssc-field-row">' +
            '<div class="ssc-field">' +
              '<span class="ssc-field-label">' + this._t("start_time") + '</span>' +
              '<input class="ssc-input" type="time" id="ssc-start" value="' + startT + '" />' +
            '</div>' +
            '<div class="ssc-field">' +
              '<span class="ssc-field-label">' + this._t("end_time") + '</span>' +
              '<input class="ssc-input" type="time" id="ssc-end" value="' + endT + '" />' +
            '</div>' +
          '</div>' +
          '<div class="ssc-field-row">' +
            '<div class="ssc-field">' +
              '<span class="ssc-field-label">' + this._t("room") + '</span>' +
              '<input class="ssc-input" type="text" id="ssc-room" value="' + room + '" placeholder="' + this._t("ph_room") + '" />' +
            '</div>' +
            '<div class="ssc-field">' +
              '<span class="ssc-field-label">' + this._t("teacher") + '</span>' +
              '<input class="ssc-input" type="text" id="ssc-teacher" value="' + teacher + '" placeholder="' + this._t("ph_teacher") + '" />' +
            '</div>' +
          '</div>' +
          '<div class="ssc-field-row">' +
            '<div class="ssc-field">' +
              '<span class="ssc-field-label">' + this._t("color") + '</span>' +
              '<div class="ssc-color-row">' +
                '<input class="ssc-color-input" type="color" id="ssc-color" value="' + colorV + '" />' +
                '<span class="ssc-color-hex" id="ssc-color-hex">' + colorV + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="ssc-field">' +
              '<span class="ssc-field-label">' + this._t("icon") + '</span>' +
              '<div class="ssc-icon-row">' +
                '<input class="ssc-input" type="text" id="ssc-icon" value="' + iconV + '" placeholder="mdi:school" />' +
                '<ha-icon id="ssc-icon-preview" icon="' + iconV + '" style="--mdc-icon-size:22px;color:' + colorV + '"></ha-icon>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="ssc-field-row ssc-break-row">' +
            '<label class="ssc-checkbox-label">' +
              '<input type="checkbox" id="ssc-is-break"' + (isBreakV ? ' checked' : '') + ' />' +
              '<span class="ssc-checkbox-text">' + this._t("mark_break") + '</span>' +
            '</label>' +
            (isEdit ? '' : '<label class="ssc-checkbox-label">' +
              '<input type="checkbox" id="ssc-apply-all"' + (applyAllV ? ' checked' : '') + ' />' +
              '<span class="ssc-checkbox-text">' + this._t("apply_all") + '</span>' +
            '</label>') +
          '</div>' +
        '</div>' +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="cancel-form">' + this._t("cancel") + '</button>' +
          '<button class="ssc-btn ssc-btn-save" data-action="save-form">' + (isEdit ? this._t("save") : this._t("add")) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  _renderConfirmDelete() {
    if (!this._confirmDelete) return "";
    const cd = this._confirmDelete;
    return '<div class="ssc-modal-overlay" data-action="cancel-delete-bg">' +
      '<div class="ssc-confirm-card">' +
        '<div class="ssc-confirm-icon">' +
          '<ha-icon icon="mdi:trash-can" style="--mdc-icon-size:36px;color:#f44336"></ha-icon>' +
        '</div>' +
        '<div class="ssc-confirm-text">' + this._t("delete_lesson_q") + '</div>' +
        '<div class="ssc-confirm-subject">' + (cd.subject || this._t("unnamed")) + '</div>' +
        '<div class="ssc-confirm-sub">' + (cd.dayName || "") + ", " + cd.start_time + " - " + cd.end_time + '</div>' +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="cancel-delete">' + this._t("cancel") + '</button>' +
          '<button class="ssc-btn ssc-btn-danger" data-action="confirm-delete">' + this._t("delete") + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  static getConfigElement() {
    return document.createElement("school-schedule-card-editor");
  }

  static getStubConfig() {
    return { type: "custom:school-schedule-card", child_name: "Michelle", height: "", width: "", language: "" };
  }

  // === Styles ===

  _styles() {
    return `
      :host { display: block; box-sizing: border-box; color-scheme: dark; }
      *, *::before, *::after { box-sizing: border-box; }
      .ssc {
        position: relative; width: 100%; max-width: 100%; height: auto;
        border-radius: 24px;
        overflow: hidden;
        background: var(--card-background-color, #111118);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 12%, transparent);
        box-shadow: 0 12px 48px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.15);
      }

      /* === Edit mode glow === */
      .ssc-editing {
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 30%, transparent);
        box-shadow: 0 12px 48px rgba(0,0,0,0.35), 0 0 30px color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent);
      }

      /* === Animated aurora background === */
      .aurora {
        position: absolute; inset: 0; overflow: hidden; border-radius: 24px;
        background: radial-gradient(ellipse 80% 60% at 20% 0%, color-mix(in srgb, var(--primary-color, #7c4dff) 25%, transparent), transparent),
                    radial-gradient(ellipse 60% 50% at 80% 100%, color-mix(in srgb, #00e5ff 15%, transparent), transparent);
        opacity: 0.6;
        animation: aurora-drift 20s ease-in-out infinite alternate;
        pointer-events: none;
      }
      .aurora2 {
        background: radial-gradient(ellipse 50% 40% at 90% 20%, color-mix(in srgb, #ff4081 12%, transparent), transparent),
                    radial-gradient(ellipse 70% 50% at 10% 80%, color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent), transparent);
        animation: aurora-drift2 25s ease-in-out infinite alternate;
        opacity: 0.4;
      }
      @keyframes aurora-drift {
        0% { transform: translate(0, 0) scale(1); }
        100% { transform: translate(-30px, 20px) scale(1.1); }
      }
      @keyframes aurora-drift2 {
        0% { transform: translate(0, 0) scale(1.1); }
        100% { transform: translate(40px, -20px) scale(0.9); }
      }

      .content {
        position: relative; z-index: 1; width: 100%; max-width: 100%;
        padding: 16px 12px 14px;
        display: flex; flex-direction: column;
      }

      .content-scroll {
        flex: 1; overflow-y: auto; overflow-x: hidden;
        min-height: 0;
      }
      .content-scroll::-webkit-scrollbar { width: 6px; }
      .content-scroll::-webkit-scrollbar-track { background: transparent; }
      .content-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--primary-color, #7c4dff) 20%, transparent); border-radius: 3px; }

      .holiday-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 16px; color: var(--secondary-text-color, rgba(255,255,255,0.4)); }
      .holiday-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 16px; color: var(--secondary-text-color, rgba(255,255,255,0.4)); }
      .holiday-picker { padding: 12px 4px; }
      .holiday-picker-title { font-size: 0.9em; font-weight: 700; color: var(--primary-text-color, #fff); margin-bottom: 12px; }
      .holiday-picker-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
      .holiday-state-btn { padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--card-background-color, #111118) 60%, transparent); border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 15%, transparent); color: var(--primary-text-color, #fff); font-size: 0.75em; font-weight: 600; cursor: pointer; text-align: left; transition: border-color 0.2s, background 0.2s; }
      .holiday-state-btn:hover { border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 35%, transparent); }
      .holiday-header {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 14px; margin-bottom: 14px;
        border-radius: 14px;
        background: color-mix(in srgb, var(--card-background-color, #111118) 60%, transparent);
        backdrop-filter: blur(12px);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 15%, transparent);
      }
      .holiday-back-btn {
        display: flex; align-items: center; gap: 6px;
        padding: 7px 14px; border-radius: 10px;
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 30%, transparent);
        color: var(--primary-text-color, #fff);
        font-size: 0.72em; font-weight: 700;
        cursor: pointer; white-space: nowrap;
        transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
      }
      .holiday-back-btn:hover {
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 50%, transparent);
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 18%, transparent);
        box-shadow: 0 4px 16px color-mix(in srgb, var(--primary-color, #7c4dff) 12%, transparent);
      }
      .holiday-state-name {
        font-size: 0.85em; font-weight: 800;
        color: var(--primary-text-color, #fff);
        margin-left: auto;
        letter-spacing: 0.02em;
      }
      .holiday-view { padding: 4px 0; }
      .holiday-current { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 16px; margin-bottom: 16px; background: color-mix(in srgb, #ff9800 12%, transparent); border: 1px solid color-mix(in srgb, #ff9800 30%, transparent); }
      .holiday-current-text { display: flex; flex-direction: column; }
      .holiday-current-name { font-size: 1em; font-weight: 800; color: #ff9800; }
      .holiday-current-dates { font-size: 0.72em; font-weight: 600; color: var(--secondary-text-color, rgba(255,255,255,0.4)); }
      .holiday-list { display: flex; flex-direction: column; gap: 8px; }
      .holiday-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--card-background-color, #111118) 40%, transparent); border: 1px solid color-mix(in srgb, var(--divider-color, rgba(255,255,255,0.06)) 60%, transparent); transition: border-color 0.2s; }
      .holiday-item:hover { border-color: color-mix(in srgb, #ff9800 25%, transparent); }
      .holiday-item-icon { color: #ff9800; opacity: 0.7; display: flex; align-items: center; }
      .holiday-item-info { display: flex; flex-direction: column; }
      .holiday-item-name { font-size: 0.82em; font-weight: 700; color: var(--primary-text-color, #fff); }
      .holiday-item-dates { font-size: 0.65em; font-weight: 500; color: var(--secondary-text-color, rgba(255,255,255,0.4)); }

      /* === Title === */
      .title-row {
        display: flex; align-items: center; gap: 14px;
        margin-bottom: 16px;
      }
      .title-icon {
        width: 44px; height: 44px; border-radius: 14px;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, var(--primary-color, #7c4dff), color-mix(in srgb, var(--primary-color, #7c4dff) 50%, #00e5ff));
        box-shadow: 0 6px 20px color-mix(in srgb, var(--primary-color, #7c4dff) 35%, transparent),
                    inset 0 1px 0 rgba(255,255,255,0.2);
        flex-shrink: 0;
      }
      .title-main {
        font-size: 1.3em; font-weight: 800;
        color: var(--primary-text-color, #fff);
        letter-spacing: -0.01em;
      }
      .title-sub {
        font-size: 0.82em; font-weight: 600;
        color: var(--secondary-text-color, rgba(255,255,255,0.45));
        margin-top: 2px;
      }

      /* === Action buttons === */
      .ssc-actions {
        display: flex; gap: 8px; margin-left: auto; flex-shrink: 0;
      }
      .ssc-btn {
        display: flex; align-items: center; gap: 6px;
        padding: 7px 14px; border-radius: 12px;
        background: color-mix(in srgb, var(--card-background-color, #111118) 60%, transparent);
        backdrop-filter: blur(12px);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 15%, transparent);
        color: var(--primary-text-color, #fff);
        font-size: 0.72em; font-weight: 700;
        cursor: pointer; white-space: nowrap;
        transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
      }
      .ssc-btn:hover {
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 35%, transparent);
        box-shadow: 0 4px 16px color-mix(in srgb, var(--primary-color, #7c4dff) 12%, transparent);
      }
      .ssc-btn-active {
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 15%, transparent);
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 40%, transparent);
      }
      .ssc-btn-save {
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 20%, transparent);
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 40%, transparent);
      }
      .ssc-btn-danger {
        background: color-mix(in srgb, #f44336 20%, transparent);
        border-color: color-mix(in srgb, #f44336 40%, transparent);
        color: #f44336;
      }
      .ssc-btn-danger:hover {
        box-shadow: 0 6px 20px color-mix(in srgb, #f44336 15%, transparent);
      }

      /* === Child switcher === */
      .ssc-child-switch {
        display: flex; gap: 6px; flex-wrap: wrap; width: fit-content;
        padding: 4px; margin-bottom: 14px;
        border-radius: 14px;
        background: color-mix(in srgb, var(--card-background-color, #111118) 60%, transparent);
        backdrop-filter: blur(12px);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent);
      }
      .ssc-child-pill {
        padding: 6px 16px; border-radius: 10px;
        background: transparent; border: 1px solid transparent;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
        font-size: 0.72em; font-weight: 700; cursor: pointer; white-space: nowrap;
        transition: border-color 0.2s, background 0.2s, color 0.2s;
      }
      .ssc-child-pill:hover {
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 30%, transparent);
        color: var(--primary-text-color, #fff);
      }
      .ssc-child-active {
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 18%, transparent);
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 40%, transparent);
        color: var(--primary-text-color, #fff);
      }

      /* === Holiday countdown pill === */
      .hero-holiday {
        cursor: pointer;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .hero-holiday:hover {
        border-color: color-mix(in srgb, #ff9800 40%, transparent);
        box-shadow: 0 4px 16px color-mix(in srgb, #ff9800 12%, transparent);
      }
      .hero-holiday-name {
        font-size: 0.6em; font-weight: 700; margin-top: 2px;
        color: #ffb74d;
        max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      /* === Hero summary === */
      .hero {
        display: flex; gap: 10px; margin-bottom: 16px;
        flex-wrap: wrap; width: 100%;
      }
      .hero-stat {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 10px 18px; border-radius: 16px;
        background: color-mix(in srgb, var(--card-background-color, #111118) 60%, transparent);
        backdrop-filter: blur(12px);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent);
        min-width: 80px;
      }
      .hero-stat-num {
        font-size: 2em; font-weight: 900; line-height: 1;
      }
      .hero-stat-label {
        font-size: 0.65em; font-weight: 600; margin-top: 3px;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
        text-transform: uppercase; letter-spacing: 0.08em;
      }

      .hero-now {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 16px; border-radius: 16px;
        background: var(--now-c10, transparent);
        backdrop-filter: blur(12px);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent);
        box-shadow: 0 0 24px var(--now-c10, transparent);
        flex: 1; min-width: 140px;
      }
      .hero-now-pulse {
        width: 10px; height: 10px; border-radius: 50%;
        background: var(--now-c, #7c4dff);
        flex-shrink: 0;
        animation: now-pulse 1.5s ease-in-out infinite;
      }
      @keyframes now-pulse {
        0%, 100% { box-shadow: 0 0 0 0 var(--now-c, #7c4dff); transform: scale(1); }
        50% { box-shadow: 0 0 0 8px transparent; transform: scale(1.3); }
      }
      .hero-now-info { display: flex; flex-direction: column; }
      .hero-now-label {
        font-size: 0.58em; font-weight: 800;
        color: var(--now-c, #7c4dff);
        letter-spacing: 0.12em;
      }
      .hero-now-subject {
        font-size: 0.9em; font-weight: 700;
        color: var(--primary-text-color, #fff);
      }
      .hero-now-time {
        font-size: 0.68em; font-weight: 600;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
        margin-top: 1px;
      }
      .hero-now-room {
        font-size: 0.68em; font-weight: 500;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
      }

      .hero-next {
        display: flex; flex-direction: column; justify-content: center;
        padding: 10px 16px; border-radius: 16px;
        background: var(--next-c15, transparent);
        backdrop-filter: blur(12px);
        border: 1px solid var(--next-c15, transparent);
        min-width: 100px;
      }
      .hero-next-label {
        font-size: 0.58em; font-weight: 800;
        color: var(--next-c, #7c4dff);
        letter-spacing: 0.12em;
      }
      .hero-next-subject {
        font-size: 0.85em; font-weight: 700;
        color: var(--primary-text-color, #fff);
        margin-top: 1px;
      }
      .hero-next-time {
        font-size: 0.68em; font-weight: 500;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
      }

      /* === Day grid === */
      .grid {
        display: grid; width: 100%;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 7px;
      }
      .day {
        min-width: 0; display: flex; flex-direction: column;
        border-radius: 14px; padding: 6px 4px 8px;
        background: color-mix(in srgb, var(--card-background-color, #111118) 40%, transparent);
        backdrop-filter: blur(8px);
        border: 1px solid color-mix(in srgb, var(--divider-color, rgba(255,255,255,0.06)) 60%, transparent);
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .day:hover {
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 20%, transparent);
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      }
      .day-active {
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 6%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 25%, transparent);
        box-shadow: 0 0 28px color-mix(in srgb, var(--primary-color, #7c4dff) 8%, transparent),
                    inset 0 1px 0 color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent);
      }

      .day-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 2px 4px 8px;
        border-bottom: 2px solid var(--divider-color, rgba(255,255,255,0.06));
        margin-bottom: 6px;
      }
      .dh-active {
        border-bottom-color: var(--primary-color, #7c4dff);
      }
      .day-label {
        font-size: 0.78em; font-weight: 800;
        color: var(--secondary-text-color, rgba(255,255,255,0.45));
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .dh-active .day-label {
        color: var(--primary-color, #7c4dff);
      }
      .day-badge {
        font-size: 0.6em; font-weight: 800;
        padding: 2px 7px; border-radius: 100px;
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 18%, transparent);
        color: var(--primary-color, #7c4dff);
      }
      .badge-zero {
        background: transparent;
        color: var(--disabled-text-color, rgba(255,255,255,0.15));
      }

      .day-body {
        display: flex; flex-direction: column; gap: 5px;
      }

      /* === Empty day === */
      .no-lesson {
        display: flex; align-items: center; justify-content: center;
        padding: 16px 4px;
      }
      .no-lesson-line {
        width: 24px; height: 2px; border-radius: 2px;
        background: var(--disabled-text-color, rgba(255,255,255,0.12));
      }
      .weekend-text {
        font-size: 0.7em; font-weight: 600;
        color: var(--disabled-text-color, rgba(255,255,255,0.2));
        text-transform: uppercase; letter-spacing: 0.1em;
      }

      /* === Lesson card === */
      .lc {
        display: flex; position: relative;
        border-radius: 12px; overflow: visible;
        background: var(--c05, transparent);
        border: 1px solid color-mix(in srgb, var(--divider-color, rgba(255,255,255,0.05)) 50%, transparent);
        transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        cursor: default;
      }
      .lc:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 0 8px var(--c20, transparent);
        border-color: var(--c30, transparent);
        background: var(--c10, transparent);
      }

      .lc-now {
        border: 2px solid var(--c, #7c4dff);
        box-shadow: 0 0 20px var(--c20, transparent);
        animation: lc-glow 2s ease-in-out infinite;
      }
      .lc-break {
        border-style: dashed !important;
        opacity: 0.85;
      }
      .lc-break .lc-subject {
        font-style: italic;
        opacity: 0.8;
      }
      .lc-break .lc-num {
        opacity: 0.6;
      }
      .lc-break .lc-rail {
        opacity: 0.4;
      }
      @keyframes lc-glow {
        0%, 100% { box-shadow: 0 0 14px var(--c20, transparent); }
        50% { box-shadow: 0 0 28px var(--c30, transparent), 0 0 8px var(--c, transparent); }
      }
      .ssc-break-row {
        justify-content: flex-start !important;
        gap: 20px !important;
        padding-top: 8px;
        border-top: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent);
        margin-top: 4px;
      }
      .ssc-checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
      }
      .ssc-checkbox-label input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: var(--primary-color, #7c4dff);
      }
      .ssc-checkbox-text {
        font-size: 13px;
        color: var(--primary-text-color, #e0e0e0);
      }

      .lc-rail {
        width: 5px; flex-shrink: 0;
        background: linear-gradient(180deg, var(--c, #7c4dff) 0%, var(--c, #7c4dff) 30%, var(--c20, transparent) 100%);
        box-shadow: 0 0 8px var(--c20, transparent);
      }
      .lc-content {
        flex: 1; padding: 8px 10px;
        display: flex; align-items: flex-start; gap: 8px;
      }
      .lc-num {
        font-size: 0.6em; font-weight: 900;
        color: var(--c, #7c4dff);
        opacity: 0.5;
        padding-top: 2px;
        min-width: 10px;
      }
      .lc-num ha-icon {
        color: var(--c, #7c4dff);
        opacity: 0.95;
        display: flex;
        align-items: center;
        margin-top: -2px;
      }
      .lc-info {
        flex: 1; min-width: 0;
        display: flex; flex-direction: column; gap: 1px;
      }
      .lc-subject {
        font-size: 0.72em; font-weight: 700;
        color: var(--primary-text-color, #fff);
        white-space: normal;
        word-wrap: break-word;
        overflow-wrap: break-word;
        line-height: 1.2;
      }
      .lc-time {
        font-size: 0.62em; font-weight: 600;
        color: var(--secondary-text-color, rgba(255,255,255,0.4)); white-space: normal;
      }
      .lc-details {
        display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 2px;
      }
      .lc-room, .lc-teacher {
        font-size: 0.58em; font-weight: 600;
        color: var(--secondary-text-color, rgba(255,255,255,0.3));
      }

      /* === Edit overlay buttons === */
      .lc-edit {
        display: flex; gap: 4px;
        position: absolute; top: 4px; right: 4px;
        z-index: 5;
      }
      .lc-edit-btn {
        width: 22px; height: 22px; border-radius: 7px;
        display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--card-background-color, #111118) 85%, transparent);
        border: 1px solid color-mix(in srgb, var(--c, #7c4dff) 20%, transparent);
        cursor: pointer; padding: 0;
        transition: border-color 0.2s, background 0.2s;
      }
      .lc-edit-btn:hover {
        border-color: var(--c, #7c4dff);
        background: color-mix(in srgb, var(--c, #7c4dff) 10%, transparent);
      }
      .lc-edit-btn ha-icon {
        --mdc-icon-size: 13px;
        color: var(--secondary-text-color, rgba(255,255,255,0.5));
      }
      .lc-edit-btn:hover ha-icon {
        color: var(--c, #7c4dff);
      }

      /* === Add button === */
      .lc-add {
        display: flex; align-items: center; justify-content: center;
        padding: 6px; border-radius: 12px; min-height: 32px;
        border: 1px dashed color-mix(in srgb, var(--primary-color, #7c4dff) 25%, transparent);
        background: transparent;
        cursor: pointer; width: 100%;
        transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
      }
      .lc-add:hover {
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 8%, transparent);
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 40%, transparent);
      }
      .lc-add ha-icon {
        --mdc-icon-size: 16px;
        color: color-mix(in srgb, var(--primary-color, #7c4dff) 50%, transparent);
      }
      .lc-add:hover ha-icon {
        color: var(--primary-color, #7c4dff);
      }

      /* === Day view === */
      .grid.day-view {
        grid-template-columns: 1fr;
      }
      .grid.day-view .day {
        max-width: 500px; margin: 0 auto; width: 100%;
      }
      .grid.day-view .lc-content { padding: 10px 14px; }
      .grid.day-view .lc-subject { font-size: 0.85em; }
      .grid.day-view .lc-time { font-size: 0.7em; }
      .grid.day-view .lc-room, .grid.day-view .lc-teacher { font-size: 0.63em; }
      .grid.day-view .lc-num { font-size: 0.7em; }
      .grid.day-view .day-label { font-size: 0.9em; }

      /* === Modal overlay === */
      .ssc-modal-overlay {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        z-index: 100;
        display: flex; align-items: flex-start; justify-content: center;
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(10px);
        border-radius: 24px;
        overflow-y: auto;
        padding: 20px 16px;
        animation: ssc-fade-in 0.2s ease-out;
      }
      @keyframes ssc-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .ssc-form-card, .ssc-confirm-card {
        width: 100%; max-width: 360px;
        max-height: 100%; overflow-y: auto;
        padding: 20px;
        border-radius: 20px;
        background: var(--card-background-color, #111118);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 20%, transparent);
        box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        animation: ssc-scale-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes ssc-scale-in {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }

      .ssc-form-title {
        font-size: 1.1em; font-weight: 800;
        color: var(--primary-text-color, #fff);
        margin-bottom: 4px;
      }
      .ssc-form-day {
        font-size: 0.75em; font-weight: 600;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
        margin-bottom: 16px;
        text-transform: uppercase; letter-spacing: 0.08em;
      }

      .ssc-form-fields {
        display: flex; flex-direction: column; gap: 12px;
        margin-bottom: 16px;
      }
      .ssc-field {
        display: flex; flex-direction: column; gap: 4px;
      }
      .ssc-field-row {
        display: flex; gap: 10px;
      }
      .ssc-field-row .ssc-field { flex: 1; min-width: 0; }
      .ssc-field-label {
        font-size: 0.65em; font-weight: 700;
        color: var(--secondary-text-color, rgba(255,255,255,0.5));
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .ssc-input {
        padding: 8px 12px; border-radius: 10px;
        background: color-mix(in srgb, var(--card-background-color, #111118) 80%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 15%, transparent);
        color: var(--primary-text-color, #fff);
        font-size: 0.85em; font-weight: 500;
        outline: none; width: 100%;
        transition: border-color 0.2s;
        color-scheme: dark;
      }
      .ssc-input:focus {
        border-color: color-mix(in srgb, var(--primary-color, #7c4dff) 40%, transparent);
      }
      .ssc-input:disabled {
        opacity: 0.5; cursor: not-allowed;
      }
      .ssc-color-row {
        display: flex; align-items: center; gap: 10px;
      }
      .ssc-color-input {
        -webkit-appearance: none; appearance: none;
        width: 44px; height: 36px; border: none; border-radius: 10px;
        background: transparent; cursor: pointer; padding: 0;
      }
      .ssc-color-input::-webkit-color-swatch-wrapper { padding: 2px; }
      .ssc-color-input::-webkit-color-swatch { border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 15%, transparent); border-radius: 8px; }
      .ssc-color-input::-moz-color-swatch { border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 15%, transparent); border-radius: 8px; }
      .ssc-color-hex {
        font-size: 0.75em; font-weight: 600;
        color: var(--secondary-text-color, rgba(255,255,255,0.5));
        font-family: monospace;
      }
      .ssc-icon-row {
        display: flex; align-items: center; gap: 8px;
      }
      .ssc-icon-row .ssc-input { flex: 1; }

      .ssc-form-buttons {
        display: flex; gap: 10px; justify-content: flex-end;
      }

      /* === Confirm dialog === */
      .ssc-confirm-card {
        max-width: 300px; text-align: center;
      }
      .ssc-confirm-icon {
        margin-bottom: 12px;
      }
      .ssc-confirm-text {
        font-size: 1em; font-weight: 800;
        color: var(--primary-text-color, #fff);
        margin-bottom: 4px;
      }
      .ssc-confirm-subject {
        font-size: 0.9em; font-weight: 700;
        color: var(--primary-color, #7c4dff);
        margin-bottom: 2px;
      }
      .ssc-confirm-sub {
        font-size: 0.72em; font-weight: 500;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
        margin-bottom: 16px;
      }

      @media (max-width: 600px) {
        .grid { gap: 3px; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
        .day { padding: 6px 3px 8px; }
        .lc-content { padding: 6px 6px; }
        .lc-subject { font-size: 0.68em; }
        .lc-time { font-size: 0.56em; }
        .lc-room, .lc-teacher { font-size: 0.52em; }
        .lc-content { padding: 6px 8px; }
        .ssc-actions { gap: 4px; }
        .ssc-btn { padding: 6px 10px; font-size: 0.6em; }
        .ssc-child-pill { padding: 5px 12px; font-size: 0.62em; }
        .hero-holiday-name { max-width: 90px; font-size: 0.55em; }
        .grid.day-view .lc-content { padding: 8px 10px; }
        .grid.day-view .lc-subject { font-size: 0.78em; }
      }
    `;
  }
}

if (!customElements.get("school-schedule-card")) {
  customElements.define("school-schedule-card", SchoolScheduleCard);
}

class SchoolScheduleCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._hass = null;
    if (this._shadow) { this._syncLanguage(); return; }
    this._lang = "de";
    this._shadow = this.attachShadow({ mode: "open" });
    this._shadow.innerHTML = `<style>
      .ssc-editor{display:flex;flex-direction:column;gap:16px;padding:8px 0}
      .ssc-editor-label{font-size:14px;font-weight:500;margin-bottom:4px;color:var(--primary-text-color)}
      .ssc-editor-input{width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--divider-color,rgba(0,0,0,0.1));background:var(--card-background-color,#fff);color:var(--primary-text-color,#000);font-size:14px;outline:none}
      .ssc-editor-input:focus{border-color:var(--primary-color)}
      .ssc-editor-hint{font-size:12px;color:var(--secondary-text-color);margin-top:2px}
      </style>
      <div class="ssc-editor">
        <div>
          <div class="ssc-editor-label" data-i18n="ed_child">Name des Kindes</div>
          <input class="ssc-editor-input" id="ssc-edit-child" type="text" value="${this._config.child_name || ""}" placeholder="z.B. Michelle" />
          <div class="ssc-editor-hint" data-i18n="ed_child_hint">Muss mit dem Namen in der Integration übereinstimmen</div>
        </div>
        <div>
          <div class="ssc-editor-label" data-i18n="ed_height">Höhe der Karte</div>
          <input class="ssc-editor-input" id="ssc-edit-height" type="text" value="${this._config.height || ""}" placeholder="z.B. 500px (leer = automatisch)" />
          <div class="ssc-editor-hint" data-i18n="ed_height_hint">Feste Höhe mit Scrollbar, z.B. 500px. Leer = wächst mit Inhalt</div>
        </div>
        <div>
          <div class="ssc-editor-label" data-i18n="ed_width">Maximale Breite</div>
          <input class="ssc-editor-input" id="ssc-edit-width" type="text" value="${this._config.width || ""}" placeholder="z.B. 600px (leer = volle Breite)" />
          <div class="ssc-editor-hint" data-i18n="ed_width_hint">Begrenzt die Kartenbreite, z.B. 600px. Leer = volle Breite</div>
        </div>
        <div>
          <div class="ssc-editor-label" data-i18n="ed_language">Sprache</div>
          <select class="ssc-editor-input" id="ssc-edit-language">
            <option value="" data-i18n="ed_auto">Automatisch</option>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
          <div class="ssc-editor-hint" data-i18n="ed_lang_hint">Sprache der Kartenoberfläche. Automatisch = folgt der Home Assistant Sprache</div>
        </div>
      </div>`;
    const languageSelect = this._shadow.querySelector("#ssc-edit-language");
    if (languageSelect) languageSelect.value = this._config.language || "";
    const inputs = this._shadow.querySelectorAll(".ssc-editor-input");
    inputs.forEach(input => {
      input.addEventListener("input", () => {
        this._config = {
          type: "custom:school-schedule-card",
          child_name: this._shadow.querySelector("#ssc-edit-child").value,
          height: this._shadow.querySelector("#ssc-edit-height").value,
          width: this._shadow.querySelector("#ssc-edit-width").value,
          language: this._shadow.querySelector("#ssc-edit-language").value,
        };
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      input.addEventListener("change", () => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    this._syncLanguage();
  }
  set hass(hass) { this._hass = hass; this._syncLanguage(); }

  _syncLanguage() {
    if (!this._shadow) return;
    const cfgLang = (this._config && this._config.language) || "";
    let lang = cfgLang;
    if (lang !== "de" && lang !== "en") {
      if (this._hass && this._hass.locale && this._hass.locale.language) {
        const loc = String(this._hass.locale.language).toLowerCase();
        if (loc.startsWith("de")) lang = "de";
        else if (loc.startsWith("en")) lang = "en";
        else lang = "de";
      } else {
        lang = "de";
      }
    }
    this._lang = lang;
    const table = SchoolScheduleCard.STRINGS[lang] || SchoolScheduleCard.STRINGS.de;
    const editorStrings = {
      de: {
        ed_child: "Name des Kindes",
        ed_child_hint: "Muss mit dem Namen in der Integration übereinstimmen",
        ed_height: "Höhe der Karte",
        ed_height_hint: "Feste Höhe mit Scrollbar, z.B. 500px. Leer = wächst mit Inhalt",
        ed_width: "Maximale Breite",
        ed_width_hint: "Begrenzt die Kartenbreite, z.B. 600px. Leer = volle Breite",
        ed_language: "Sprache",
        ed_auto: "Automatisch",
        ed_lang_hint: "Sprache der Kartenoberfläche. Automatisch = folgt der Home Assistant Sprache",
      },
      en: {
        ed_child: "Child's name",
        ed_child_hint: "Must match the name in the integration",
        ed_height: "Card height",
        ed_height_hint: "Fixed height with scrollbar, e.g. 500px. Empty = grows with content",
        ed_width: "Max width",
        ed_width_hint: "Limits the card width, e.g. 600px. Empty = full width",
        ed_language: "Language",
        ed_auto: "Automatic",
        ed_lang_hint: "Card interface language. Automatic = follows the Home Assistant language",
      },
    };
    const strings = editorStrings[lang] || editorStrings.de;
    this._shadow.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      if (strings[key] !== undefined) el.textContent = strings[key];
    });
  }
}

if (!customElements.get("school-schedule-card-editor")) {
  customElements.define("school-schedule-card-editor", SchoolScheduleCardEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "school-schedule-card",
  name: "School Schedule Card",
  description: "Stundenplan-Karte Ultra Premium v2.4.5",
  preview: false,
});