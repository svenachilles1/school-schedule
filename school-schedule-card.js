/**
 * School Schedule Card — Ultra Premium v2.7.4
 * 3D Glassmorphism, animated aurora background
 * Features: Tagesansicht-Toggle, Inline-Verwaltung (Add/Edit/Delete), Pausen (is_break),
 *           Ferienkalender mit Zurueck-Button (Backend-Sync: Bundesland + Feriendaten aus der
 *           Integration statt localStorage/Client-Fetch — ueberleben Updates/Cache-Clear),
 *           Icon-Anzeige pro Stunde, Sprache DE/EN,
 *           Kinder-Umschalter (Multi-Child), Ferien-Countdown in der Hero-Sektion,
 *           Tages-Fortschrittsbalken mit Sternen-Gamification + Konfetti bei Schulschluss,
 *           eindeutige lesson_uid-Adressierung (Bugfix: falsches Fach im Bearbeiten-Formular),
 *           Fehltage-Tracking (v2.6.0): Krank-Pill im Hero, Krank-Modal mit Heute/Morgen-Button,
 *           Attest-Warnbanner (ab 3. Kranktagen Attestpflicht), Notizen + Historie,
 *           Einzelstunden-Ausfall (v2.7.2): entfallene Stunden durchgestrichen in Warnfarbe,
 *           EINFÄLLT-Badge + Grund, Ausfall-Dialog im Bearbeiten-Modus, Cancel-Liste im Modal
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
    // v2.7.1: the backend is the single source of truth for the federal
    // state. localStorage is only a boot hint until the first backend push
    // arrives (set hass -> _updateData) and a fallback while the backend
    // has no state configured at all.
    this._holidayState = "";
    this._holidayPickerOpen = false;  // user pressed "back" — keep picker open
    // v2.7.1: while a set_federal_state service call is in flight the
    // backend still pushes the OLD state — blindly syncing would flip
    // the UI right back (race). Pending tracks the in-flight choice.
    this._holidayPendingState = null;
    this._holidayPendingAt = 0;
    this._holidayPendingChild = "";
    // v2.7.1: which federal state this._holidayData belongs to — stale
    // data from a previous state is dropped on switch (see _updateData).
    this._holidayDataState = "";
    // v2.7.1: one-time legacy migration flag per child (localStorage-only
    // installs push their stored choice into the backend on first contact)
    this._holidayMigrateFired = {};
    this._holidayAutoFetched = false;
    this._availableChildren = [];
    this._cardLanguage = "";
    this._lang = "de";
    this._shadow = this.attachShadow({ mode: "open" });
    this._shadow.addEventListener("click", (e) => this._handleClick(e));
    this._shadow.addEventListener("input", (e) => this._handleInput(e));
    // v2.7.4: date/number fields fire change (not input) on some browsers —
    // route it through the same input handler (idempotent state sets).
    this._shadow.addEventListener("change", (e) => this._handleInput(e));
    this._progress = null;
    this._confettiFired = false;
    this._progressDay = "";
    this._starsPrev = 0;
    this._sick = null;
    this._sickModal = false;
    // v2.7.0: editable sick-day manager state
    this._sickEdit = null;         // ISO date of the entry being edited
    this._sickDelete = null;      // ISO date pending delete confirmation
    this._sickRange = false;      // range form visible
    // v2.7.2: lesson cancellation dialog state (edit mode)
    this._cancelLesson = null;   // {weekday, lesson_number, lesson_uid, subject, date_iso}
    this._cancellations = [];    // upcoming cancellations from the absence sensor
    // v2.7.3: date exception manager state
    this._exceptions = [];       // full exception list from the absence sensor
    this._excModal = false;      // exception modal open?
    this._excException = null;   // exception dialog form state {date_iso, exception_type, note, until_lesson}
    this._excRange = false;      // range form (Von-Bis) open?
    this._excDelete = null;      // date with pending 2-click delete confirm
    this._excError = null;       // v2.7.4: visible validation error key
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
        progress_label: "TAGESFORTSCHRITT",
        day_done: "TAG GESCHAFFT!",
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
        sick_days_label: "FEHLTAGE (JAHR)",
        sick_streak_label: "KRANK HEUTE",
        sick_modal_title: "Krankmeldung",
        sick_modal_sub: "Tag als Kranktag markieren oder Markierung entfernen.",
        sick_today_btn: "Heute krank",
        sick_tomorrow_btn: "Morgen krank",
        sick_note: "Notiz (optional)",
        sick_history: "Letzte Kranktage",
        sick_no_history: "Keine Kranktage erfasst",
      sick_list_title: "KRANKTAGE",
      sick_list_count: "Tage",
      sick_edit_btn: "Bearbeiten",
      sick_delete_btn: "Löschen",
      sick_delete_confirm: "Wirklich löschen?",
      sick_edit_mode: "Bearbeiten",
      sick_edit_save: "Speichern",
      sick_edit_note: "Notiz",
      sick_edit_note_ph: "Notiz ändern...",
      sick_range_title: "KRANKMELDUNG (VON–BIS)",
      sick_range_from: "Von",
      sick_range_to: "Bis",
      sick_range_note: "Notiz (für alle Tage)",
      sick_range_btn: "Krank von–bis markieren",
      sick_today_badge: "heute",
      sick_planned_badge: "geplant",
        cancelled_badge: "ENTF\u00c4LLT",
        cancelled_lesson: "Stunde entf\u00e4llt",
        cancel_lesson_q: "Stunde ausfallen lassen?",
        cancel_lesson_sub: "Die Stunde wird f\u00fcr dieses Datum als Ausfall markiert \u2014 der Wochenplan bleibt unver\u00e4ndert.",
        cancel_btn: "Ausfall",
        uncancel_btn: "Stunde findet statt",
        cancelled_list_title: "AUSFALL",
        cancelled_list_empty: "Kein Stunden-Ausfall erfasst",
        cancel_note: "Grund (optional)",
        cancel_note_ph: "z.B. Lehrer krank",
        exc_modal_title: "Tages-Ausnahme",
        exc_modal_sub: "Konkreten Tag als Ausnahme markieren (Klassenfahrt, Schulfest, Halbtag) \u2014 der Wochenplan bleibt unver\u00e4ndert.",
        exc_type_free: "Ganzer Tag frei",
        exc_type_partial: "Halbtag bis Stunde",
        exc_note: "Grund (optional)",
        exc_note_ph: "z.B. Klassenfahrt",
        exc_date: "Datum",
        exc_range_title: "AUSNAHME (VON\u2013BIS)",
        exc_range_from: "Von",
        exc_range_to: "Bis",
        exc_range_btn: "Ausnahme von\u2013bis markieren",
        exc_list_title: "AUSNAHMEN",
        exc_list_empty: "Keine Tages-Ausnahmen erfasst",
        exc_today_badge: "heute",
        exc_planned_badge: "geplant",
        exc_delete_confirm: "Wirklich l\u00f6schen?",
        exc_save: "Ausnahme setzen",
        exc_banner_free: "Heute kein Unterricht",
        exc_banner_partial: "Heute Halbtag",
        exc_banner_tomorrow_free: "Morgen kein Unterricht",
        exc_banner_tomorrow_partial: "Morgen Halbtag",
        exc_range_type: "Ausnahmetyp",
        exc_err_date: "Bitte ein Datum w\u00e4hlen",
        exc_err_until: "Bitte \u201ebis Stunde\u201c angeben (1\u201312)",
        exc_err_range: "Bitte Von- und Bis-Datum angeben",
        attest_warning_text: "Ab dem 3. Kranktag ist ein \u00e4rztliches Attest n\u00f6tig \u2014 bei weiterer Krankheit morgen mitbringen!",
        attest_required_text: "Attestpflicht: Ab dem 3. Kranktag in Folge wird ein \u00e4rztliches Attest ben\u00f6tigt!",
        sick_day: "Tag",
        sick_days: "Tage",
        sick_streak_short: "Tag(e) krank in Folge",
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
        progress_label: "DAILY PROGRESS",
        day_done: "DAY DONE!",
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
        sick_days_label: "SICK DAYS (YEAR)",
        sick_streak_label: "SICK TODAY",
        sick_modal_title: "Sick note",
        sick_modal_sub: "Mark a day as sick or remove the mark.",
        sick_today_btn: "Sick today",
        sick_tomorrow_btn: "Sick tomorrow",
        sick_note: "Note (optional)",
        sick_history: "Recent sick days",
        sick_no_history: "No sick days recorded",
      sick_list_title: "SICK DAYS",
      sick_list_count: "days",
      sick_edit_btn: "Edit",
      sick_delete_btn: "Delete",
      sick_delete_confirm: "Really delete?",
      sick_edit_mode: "Edit",
      sick_edit_save: "Save",
      sick_edit_note: "Note",
      sick_edit_note_ph: "Change note...",
      sick_range_title: "SICK NOTE (FROM–TO)",
      sick_range_from: "From",
      sick_range_to: "To",
      sick_range_note: "Note (for all days)",
      sick_range_btn: "Mark sick from–to",
      sick_today_badge: "today",
      sick_planned_badge: "planned",
        cancelled_badge: "CANCELLED",
        cancelled_lesson: "Lesson cancelled",
        cancel_lesson_q: "Cancel this lesson?",
        cancel_lesson_sub: "Marks this lesson as cancelled for this date only \u2014 the weekly schedule stays unchanged.",
        cancel_btn: "Cancel lesson",
        uncancel_btn: "Lesson takes place",
        cancelled_list_title: "CANCELLATIONS",
        cancelled_list_empty: "No cancelled lessons recorded",
        cancel_note: "Reason (optional)",
        cancel_note_ph: "e.g. teacher sick",
        exc_modal_title: "Day exception",
        exc_modal_sub: "Mark a concrete day as an exception (school trip, school fest, half day) \u2014 the weekly schedule stays unchanged.",
        exc_type_free: "Whole day off",
        exc_type_partial: "Half day until lesson",
        exc_note: "Reason (optional)",
        exc_note_ph: "e.g. school trip",
        exc_date: "Date",
        exc_range_title: "EXCEPTION (FROM\u2013TO)",
        exc_range_from: "From",
        exc_range_to: "To",
        exc_range_btn: "Mark exception from\u2013to",
        exc_list_title: "EXCEPTIONS",
        exc_list_empty: "No day exceptions recorded",
        exc_today_badge: "today",
        exc_planned_badge: "planned",
        exc_delete_confirm: "Really delete?",
        exc_save: "Set exception",
        exc_banner_free: "No school today",
        exc_banner_partial: "Half day today",
        exc_banner_tomorrow_free: "No school tomorrow",
        exc_banner_tomorrow_partial: "Half day tomorrow",
        exc_range_type: "Exception type",
        exc_err_date: "Please pick a date",
        exc_err_until: "Please provide \u201cuntil lesson\u201d (1\u201312)",
        exc_err_range: "Please provide from and to dates",
        attest_warning_text: "From the 3rd sick day a doctor's note is required — bring one tomorrow if still sick!",
        attest_required_text: "Doctor's note required: from the 3rd consecutive sick day a medical certificate is needed!",
        sick_day: "day",
        sick_days: "days",
        sick_streak_short: "day(s) sick in a row",
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
    // v2.7.1: on the very first hass push, seed the holiday state from
    // localStorage (boot hint) so the countdown can render before the
    // first backend attribute arrives — but only while the backend has
    // not delivered its state yet.
    if (!this._hassSeeded) {
      this._hassSeeded = true;
      try {
        const boot = localStorage.getItem("ssc_holiday_state");
        if (boot && !this._holidayState) this._holidayState = boot;
      } catch(e) { /* storage unavailable — backend state wins */ }
    }
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
    // v2.7.1: the backend binary_sensor carries federal_state AND the
    // vacations list — the single source of truth. It heals any lost
    // localStorage (browser cache clear, app reinstall, new device) and
    // overrides the boot hint from set hass. localStorage is only written
    // as a boot hint for the next page load, never read as authority.
    const schulfreiEntity = this._findEntity("schulfrei");
    const schulfreiAttr = schulfreiEntity ? (schulfreiEntity.attributes || {}) : {};
    const backendState = schulfreiAttr.federal_state || "";
    // v2.7.1: capture the legacy choice (boot hint from localStorage) BEFORE
    // the backend sync below overwrites this._holidayState — the migration
    // check later needs the original value, not the freshly synced one.
    const legacyChoice = this._holidayState;
    // v2.7.1 race guard: while a picker choice is in flight (service call
    // sent, backend not yet updated) the backend still pushes the OLD
    // state — syncing now would flip the UI back. The pending choice wins
    // until the backend confirms it (state == pending) or the guard times
    // out (backend never confirms -> fall back to backend truth).
    const pending = this._holidayPendingState;
    // Child switch cleared the pending phase — an in-flight choice for
    // another child must never block this child's backend sync (the
    // service addresses children by name; the pending flag is per-card).
    const pendingStaleChild = pending && this._holidayPendingChild && this._holidayPendingChild !== childName;
    const pendingTimedOut = pending && (Date.now() - this._holidayPendingAt > 15000);
    if (pending && !pendingTimedOut && !pendingStaleChild && backendState && backendState !== pending) {
      // in flight — do NOT overwrite the user's fresh choice
    } else {
      if (pending && (pendingTimedOut || pendingStaleChild || backendState === pending)) {
        // confirmed, timed out or stale — either way the pending phase is over
        this._holidayPendingState = null;
      }
      if (backendState && schulfreiAttr.federal_state_configured !== false) {
        // v2.7.1: only sync a CONFIGURED backend state. configured === false
        // means the attribute carries the default nobody ever chose —
        // syncing it would silently show wrong holidays; the picker stays
        // (or the legacy migration below pushes the stored choice).
        if (this._holidayState !== backendState) {
          this._holidayState = backendState;
          this._holidayData = null;          // state changed -> invalidate cache
          this._holidayAutoFetched = false;  // allow re-fetch for the new state
        }
        try { localStorage.setItem("ssc_holiday_state", backendState); } catch(e) {}
      } else if (this._holidayState) {
        // Legacy backend (pre-v2.7.1): keep whatever we have (boot hint or a
        // state picked in this session) so the countdown keeps working.
        try { localStorage.setItem("ssc_holiday_state", this._holidayState); } catch(e) {}
      }
    }
    // v2.7.1 legacy migration: an installation that only ever used the old
    // card-side picker (localStorage, backend never configured — the
    // federal_state_configured attribute is missing/False) pushes its
    // stored choice into the backend ONCE. Never fires when the backend
    // was configured via options flow or service. ``legacyChoice`` holds
    // the localStorage hint captured BEFORE the backend sync overwrote
    // this._holidayState.
    if (
      backendState &&
      schulfreiAttr.federal_state_configured === false &&
      !this._holidayMigrateFired[this._childName] &&
      legacyChoice
    ) {
      // Fires even when legacyChoice === the default: the user explicitly
      // picked it in the old card era — persisting that intent is what
      // makes the setting device-independent (the core of this fix).
      this._holidayMigrateFired[this._childName] = true;
      try {
        this._hass.callService("school_schedule", "set_federal_state", {
          child_name: this._childName,
          federal_state: legacyChoice,
        });
      } catch(e) { /* migration is best-effort */ }
    }
    // v2.7.1: prefer the backend vacations attribute over the client-side
    // API fetch — one data path, offline-safe, always in sync with the
    // school-free logic. Fall back to the fetch only on legacy backends.
    // ``_holidayDataState`` tracks WHICH state the cached data belongs
    // to — after a state change the stale data is dropped even when the
    // new backend push arrives with an empty list (fresh state, API
    // fetch still in flight) so the countdown can never show the wrong
    // state's vacations.
    if (this._holidayDataState !== this._holidayState) {
      this._holidayData = null;
      this._holidayDataState = this._holidayState;
      this._holidayAutoFetched = false;
    }
    // Gate: the vacations attribute belongs to ``backendState`` — only
    // load it while we actually DISPLAY that state. On an unconfigured
    // backend (default state nobody chose) with no local choice this
    // stays empty -> hero shows "-" + picker instead of a default-state
    // countdown the user never asked for.
    if (Array.isArray(schulfreiAttr.vacations) && backendState === this._holidayState) {
      const backendVacations = this._dedupePeriods(schulfreiAttr.vacations);
      if (backendVacations.length > 0) {
        this._holidayData = backendVacations;
        this._holidayDataState = this._holidayState;
        this._holidayLoading = false;
      }
    }
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
    // v2.6.0: sick-day data from the absence sensor (fehlzeiten)
    const sickEntity = this._findEntity("fehlzeiten");
    const sAttr = sickEntity ? (sickEntity.attributes || {}) : {};
    this._sick = {
      yearCount: sickEntity ? parseInt(sickEntity.state, 10) || 0 : 0,
      today: sAttr.sick_today === true,
      tomorrow: sAttr.sick_tomorrow === true,
      streak: sAttr.sick_streak || 0,
      streakActiveToday: sAttr.sick_streak_active_today === true,
      attestWarning: sAttr.attest_warning === true,
      attestRequired: sAttr.attest_required === true,
      lastSickDay: sAttr.last_sick_day || null,
      recent: Array.isArray(sAttr.recent_sick_days) ? sAttr.recent_sick_days : [],
      // v2.7.0: full editable list + today ISO (badges "heute"/"geplant")
      entries: Array.isArray(sAttr.sick_entries) ? sAttr.sick_entries : [],
      isoToday: this._isoDate("today"),
    };
    // v2.7.2: lesson cancellations (Einzelstunden-Ausfall) from the
    // absence sensor attributes — backend single source of truth.
    this._cancellations = Array.isArray(sAttr.upcoming_cancellations)
      ? sAttr.upcoming_cancellations : [];
    // v2.7.3: date exceptions (Tages-Ausnahmen) from the absence sensor
    // attributes — backend single source of truth, editable list.
    this._exceptions = Array.isArray(sAttr.date_exceptions)
      ? sAttr.date_exceptions : [];
    // Per-day concrete dates: the backend annotates each weekday sensor's
    // lessons with the cancellations for EXACTLY the date that sensor
    // stands for (next occurrence, today counts). We read the date from
    // each day entity's schedule_date attribute so cancel service calls
    // always address the same date the user sees.
    for (const [day, info] of Object.entries(dayMap)) {
      const st = this._findEntity(info.sensor);
      if (st && st.attributes && st.attributes.schedule_date) {
        this._dayDates = this._dayDates || {};
        this._dayDates[day] = st.attributes.schedule_date;
      }
    }
    const todayJs = new Date().getDay();
    this._todayKey = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][todayJs];
    if (!this._showForm && !this._confirmDelete && !this._sickModal && !this._cancelLesson && !this._excModal && !this._excException) {
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
      case "edit-lesson": this._openEditForm(actionEl.dataset.weekday, actionEl.dataset.number, actionEl.dataset.uid); break;
      case "delete-lesson": this._requestDelete(actionEl.dataset.weekday, actionEl.dataset.number, actionEl.dataset.uid); break;
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
      case "open-sick-modal": this._openSickModal(); break;
      case "cancel-sick": this._closeSickModal(); break;
      case "cancel-sick-bg":
        if (!e.target.closest(".ssc-sick-card")) this._closeSickModal();
        break;
      case "sick-today": this._sickAction("today"); break;
      case "sick-tomorrow": this._sickAction("tomorrow"); break;
      // v2.7.0: editable list + range
      case "sick-edit": this._sickEdit = e.target.closest("[data-date]").getAttribute("data-date") || null; this._sickDelete = null; this._render(); break;
      case "sick-cancel-edit": this._sickEdit = null; this._render(); break;
      case "sick-save-edit": this._sickSaveEdit(e.target.closest("[data-date]").getAttribute("data-date")); break;
      case "sick-delete": this._sickDelete = e.target.closest("[data-date]").getAttribute("data-date") || null; this._sickEdit = null; this._render(); break;
      case "sick-delete-confirm-yes": this._sickDeleteEntry(e.target.closest("[data-date]").getAttribute("data-date")); break;
      case "sick-delete-confirm-no": this._sickDelete = null; this._render(); break;
      case "sick-range-toggle": this._sickRange = !this._sickRange; this._render(); break;
      case "sick-range-cancel": this._sickRange = false; this._render(); break;
      case "sick-range-save": this._sickSaveRange(); break;
      // v2.7.2: lesson cancellation dialog (edit mode)
      case "cancel-lesson": this._openCancelDialog(actionEl.dataset.weekday, actionEl.dataset.number, actionEl.dataset.uid); break;
      case "cancel-lesson-confirm": this._confirmCancelLesson(); break;
      case "cancel-lesson-cancel": this._cancelLesson = null; this._render(); break;
      case "cancel-lesson-bg":
        if (!e.target.closest(".ssc-cancel-card")) { this._cancelLesson = null; this._render(); }
        break;
      // v2.7.3: date exception manager
      case "open-exc-modal": this._openExcModal(); break;
      case "exc-close": this._closeExcModal(); break;
      case "exc-bg":
        if (!e.target.closest(".ssc-exc-card")) { this._closeExcModal(); }
        break;
      case "exc-type-free": this._setExcType("free"); break;
      case "exc-type-partial": this._setExcType("partial"); break;
      // v2.7.4: the exception form inputs (exc-date-change, exc-until-change,
      // exc-note-input) are routed via the input/change listener
      // (_handleInput) — typing in a field never fires a click.
      case "exc-save": this._saveException(); break;
      case "exc-range-toggle": this._excRange = !this._excRange; this._render(); break;
      case "exc-range-cancel": this._excRange = false; this._render(); break;
      case "exc-range-save": this._saveExceptionRange(); break;
      case "exc-delete": this._excDelete = actionEl.dataset.date || null; this._render(); break;
      case "exc-delete-confirm-yes": this._deleteException(actionEl.dataset.date); break;
      case "exc-delete-confirm-no": this._excDelete = null; this._render(); break;
      case "exc-delete-list": this._excDelete = null; this._render(); break;
      case "uncancel-lesson": this._uncancelLesson(e.target.closest("[data-date]").getAttribute("data-date"), parseInt(e.target.closest("[data-number]").getAttribute("data-number"), 10)); break;
    }
  }

  _handleInput(e) {
    // v2.7.4: exception form inputs carry data-action but fire input/change,
    // not click — route them here first.
    const excInputEl = (e.target && e.target.closest) ? e.target.closest("[data-action]") : null;
    if (excInputEl) {
      const excInputAction = excInputEl.dataset.action || "";
      if (excInputAction === "exc-note-input") { this._excNoteInput(e); return; }
      if (excInputAction === "exc-until-change") { this._excUntilChange(e); return; }
      if (excInputAction === "exc-date-change") { this._excDateChange(e); return; }
    }
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
    // v2.7.1: persist the choice to the BACKEND (single source of truth)
    // via the set_federal_state service — survives HA updates, HACS
    // updates, browser cache clears, app reinstalls and device changes.
    // localStorage is only a boot hint for the next page load.
    this._holidayState = stateSlug;
    this._holidayPickerOpen = false;
    try { localStorage.setItem("ssc_holiday_state", stateSlug); } catch(e) {}
    if (this._hass && this._childName) {
      // Mark the choice in-flight so _updateData's backend sync does not
      // flip the UI back to the old state before the service completes.
      this._holidayPendingState = stateSlug;
      this._holidayPendingAt = Date.now();
      this._holidayPendingChild = this._childName;
      try {
        this._hass.callService("school_schedule", "set_federal_state", {
          child_name: this._childName,
          federal_state: stateSlug,
        });
      } catch(e) { /* service errors are non-fatal for the card UI */ }
      this._holidayData = null;          // backend will push fresh data
      this._holidayLoading = true;      // show spinner until it arrives
      this._render();
      return;
    }
    this._fetchHolidays(stateSlug);     // no hass (editor preview) — old path
  }

  _backToHolidayPicker() {
    // v2.7.1: "back" now only OPENS the picker — it must not wipe the
    // configured state anymore (old behaviour: removeItem -> every
    // reload showed the picker again = "settings lost after update").
    // The backend keeps the state; _updateData re-syncs on the next push.
    this._holidayPickerOpen = true;
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
      this._holidayDataState = stateSlug;  // cache belongs to this state
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
    this._holidayDataState = stateSlug;    // fetched data belongs to this state
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
    // v2.7.1: the picker shows when NO backend state is configured OR the
    // user explicitly pressed "back" to open it (_holidayPickerOpen).
    // The state itself is never cleared anymore — the backend owns it.
    if (!this._holidayState || this._holidayPickerOpen) {
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

  // === Sick days (v2.6.0) ===

  _openSickModal() {
    this._sickModal = true;
    this._render();
  }

  _closeSickModal() {
    this._sickModal = false;
    this._sickEdit = null;
    this._sickDelete = null;
    this._sickRange = false;
    // v2.7.0: re-sync from live hass states — optimistic updates inside
    // the modal are healed here with server truth (the render guard
    // suppresses state pushes while the modal is open).
    this._updateData();
  }

  _sickAction(target) {
    // target: "today" | "tomorrow" — toggles the mark for that day.
    // v2.7.0: the modal STAYS OPEN so the updated list is visible
    // immediately (state push re-renders with fresh entries).
    const iso = this._isoDate(target);
    if (!iso) return;
    const marked = target === "today"
      ? !!(this._sick && this._sick.today)
      : !!(this._sick && this._sick.tomorrow);
    const noteEl = this._shadow.querySelector("#ssc-sick-note");
    const note = noteEl ? noteEl.value.trim() : "";
    if (marked) {
      this._hass.callService("school_schedule", "unmark_sick_day", {
        child_name: this._childName,
        date: iso,
      });
      this._sickOptimisticRemove(iso);
    } else {
      this._hass.callService("school_schedule", "mark_sick_day", {
        child_name: this._childName,
        date: iso,
        note: note,
      });
      this._sickOptimisticAdd(iso, note);
    }
  }

  // v2.7.0: optimistic local state updates — instant feedback while the
  // state push is suppressed by the modal render guard. Healed on close.
  _sickOptimisticAdd(iso, note) {
    if (!this._sick) this._sick = { entries: [] };
    if (!Array.isArray(this._sick.entries)) this._sick.entries = [];
    if (!this._sick.entries.some(function(e) { return e.date === iso; })) {
      this._sick.entries.push({ date: iso, note: note || "" });
      this._sick.entries.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
      this._sick.yearCount = (this._sick.yearCount || 0) + 1;
    }
    if (iso === this._sick.isoToday) this._sick.today = true;
    if (iso === this._isoDate("tomorrow")) this._sick.tomorrow = true;
    this._render();
  }

  _sickOptimisticRemove(iso) {
    if (!this._sick) return;
    if (Array.isArray(this._sick.entries)) {
      const before = this._sick.entries.length;
      this._sick.entries = this._sick.entries.filter(function(e) { return e.date !== iso; });
      if (this._sick.entries.length < before) {
        this._sick.yearCount = Math.max(0, (this._sick.yearCount || 0) - 1);
      }
    }
    if (iso === this._sick.isoToday) this._sick.today = false;
    if (iso === this._isoDate("tomorrow")) this._sick.tomorrow = false;
    this._render();
  }

  _isoDate(target) {
    const d = new Date();
    if (target === "tomorrow") d.setDate(d.getDate() + 1);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  // ── v2.7.0: sick-day list actions ────────────────────────────────────

  _sickSaveEdit(iso) {
    if (!iso) return;
    const noteEl = this._shadow.querySelector("#ssc-sick-edit-note");
    const note = noteEl ? noteEl.value.trim() : "";
    this._hass.callService("school_schedule", "update_sick_day", {
      child_name: this._childName,
      date: iso,
      note: note,
    });
    // optimistic: update the note in the local list
    if (this._sick && Array.isArray(this._sick.entries)) {
      this._sick.entries = this._sick.entries.map(function(e) {
        return e.date === iso ? { date: e.date, note: note } : e;
      });
    }
    this._sickEdit = null;
    this._render();
  }

  _sickDeleteEntry(iso) {
    if (!iso) return;
    this._hass.callService("school_schedule", "unmark_sick_day", {
      child_name: this._childName,
      date: iso,
    });
    this._sickDelete = null;
    this._sickOptimisticRemove(iso);
  }

  _sickSaveRange() {
    const fromEl = this._shadow.querySelector("#ssc-sick-range-from");
    const toEl = this._shadow.querySelector("#ssc-sick-range-to");
    const noteEl = this._shadow.querySelector("#ssc-sick-range-note");
    const from = fromEl ? fromEl.value : "";
    const to = toEl ? toEl.value : "";
    const note = noteEl ? noteEl.value.trim() : "";
    if (!from || !to) return;
    this._hass.callService("school_schedule", "mark_sick_range", {
      child_name: this._childName,
      start_date: from,
      end_date: to,
      note: note,
    });
    // optimistic: add every missing day in the range to the local list
    if (this._sick && from <= to) {
      if (!Array.isArray(this._sick.entries)) this._sick.entries = [];
      const fd = new Date(from + "T00:00:00");
      const td = new Date(to + "T00:00:00");
      let added = 0;
      while (fd <= td) {
        const iso = fd.getFullYear() + "-" + String(fd.getMonth() + 1).padStart(2, "0") + "-" + String(fd.getDate()).padStart(2, "0");
        if (!this._sick.entries.some(function(e) { return e.date === iso; })) {
          this._sick.entries.push({ date: iso, note: note || "" });
          added++;
        }
        fd.setDate(fd.getDate() + 1);
      }
      if (added > 0) {
        this._sick.entries.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
        this._sick.yearCount = (this._sick.yearCount || 0) + added;
      }
      this._sick.today = this._sick.entries.some(function(e) { return e.date === this._sick.isoToday; }.bind(this));
      this._sick.tomorrow = this._sick.entries.some(function(e) { return e.date === this._isoDate("tomorrow"); }.bind(this));
    }
    this._sickRange = false;
    this._render();
  }

  // === Form Logic ===

  // === v2.7.2: lesson cancellation (Einzelstunden-Ausfall) ===

  _dateForDay(day) {
    // The concrete date a weekday column currently stands for.
    // Priority: backend schedule_date attribute (always exact) > local
    // fallback computation (identical formula to the backend's
    // _next_date_for_weekday) > empty (dialog refuses without date).
    if (this._dayDates && this._dayDates[day]) return this._dayDates[day];
    if (!this._todayKey) return "";
    const idx = ["monday","tuesday","wednesday","thursday","friday"].indexOf(day);
    if (idx < 0) return "";
    const today = new Date();
    const todayIdx = (today.getDay() + 6) % 7;  // Mon=0..Sun=6
    const offset = (idx - todayIdx + 7) % 7;
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  _openCancelDialog(weekday, lessonNumber, lessonUid) {
    const lesson = this._findLesson(weekday, lessonNumber, lessonUid);
    if (!lesson) return;
    const dateIso = this._dateForDay(weekday);
    if (!dateIso) return;
    const isCancelled = lesson.cancelled === true;
    this._cancelLesson = {
      weekday: weekday,
      lesson_number: parseInt(lessonNumber, 10),
      lesson_uid: lessonUid || "",
      subject: lesson.subject || "",
      start_time: (lesson.start_time || "").slice(0, 5),
      end_time: (lesson.end_time || "").slice(0, 5),
      date_iso: dateIso,
      already_cancelled: isCancelled,
      note: lesson.cancelled_note || "",
    };
    this._showForm = false;
    this._confirmDelete = null;
    this._render();
  }

  _confirmCancelLesson() {
    const cd = this._cancelLesson;
    if (!cd) return;
    const noteInput = this._shadow.querySelector("#ssc-cancel-note");
    const note = noteInput ? String(noteInput.value || "").trim() : "";
    this._hass.callService("school_schedule", "mark_lesson_cancelled", {
      child_name: this._childName,
      date: cd.date_iso,
      lesson_number: cd.lesson_number,
      note: note,
    });
    this._cancelLesson = null;
    this._render();
  }

  _uncancelLesson(dateIso, lessonNumber) {
    if (!dateIso || !lessonNumber) return;
    this._hass.callService("school_schedule", "unmark_lesson_cancelled", {
      child_name: this._childName,
      date: dateIso,
      lesson_number: lessonNumber,
    });
    this._cancelLesson = null;
    this._render();
  }

  // === v2.7.3: date exception manager (Tages-Ausnahmen) ===

  _openExcModal() {
    this._excModal = true;
    this._excRange = false;
    this._excDelete = null;
    this._excError = null;
    // Default form state — set HERE (opening), never in the renderer:
    // _renderExcModal must stay pure so saving (which nulls the form and
    // re-renders) cannot resurrect a ghost dialog state.
    this._excException = {
      date_iso: this._isoDate("today"),
      exception_type: "free",
      note: "",
      until_lesson: null,
    };
    this._render();
  }

  _closeExcModal() {
    this._excModal = false;
    this._excException = null;
    this._excRange = false;
    this._excDelete = null;
    this._excError = null;
    this._render();
  }

  _excDateChange(e) {
    if (!this._excException) return;
    this._excException.date_iso = e.target.value || "";
    // v2.7.4: no re-render here — re-rendering on every input steals the
    // focus from the field. The state is what counts at save time; the
    // field itself already shows the picked value.
    this._clearExcError();
  }

  _setExcType(type) {
    if (!this._excException) return;
    this._excException.exception_type = type;
    // v2.7.4: seed the until default when switching to partial so the form
    // state matches the visible field value (4) — saving without touching
    // the field must never hit the until guard.
    if (type === "partial" && (this._excException.until_lesson === null
        || this._excException.until_lesson === undefined
        || isNaN(parseInt(this._excException.until_lesson, 10)))) {
      this._excException.until_lesson = 4;
    }
    if (type !== "partial") this._excException.until_lesson = null;
    this._render();
  }

  _excUntilChange(e) {
    if (!this._excException) return;
    const v = parseInt(e.target.value, 10);
    this._excException.until_lesson = isNaN(v) ? null : v;
    this._clearExcError();
  }

  _excNoteInput(e) {
    if (!this._excException) return;
    this._excException.note = e.target.value || "";
    this._clearExcError();
  }

  _clearExcError() {
    // v2.7.4: dismiss the visible save error without a full re-render
    // (keeps field focus) — flag reset + direct DOM node removal.
    if (this._excError) {
      this._excError = null;
      const errEl = this._shadow.querySelector(".ssc-exc-error");
      if (errEl) errEl.remove();
    }
  }

  _saveException() {
    const ex = this._excException;
    if (!ex || !ex.date_iso) return;
    const data = {
      child_name: this._childName,
      date: ex.date_iso,
      exception_type: ex.exception_type,
      note: ex.note || "",
    };
    if (!ex.date_iso) { this._showExcError("exc_err_date"); return; }
    if (ex.exception_type === "partial") {
      const until = parseInt(ex.until_lesson, 10);
      if (isNaN(until) || until < 1 || until > 12) {
        // v2.7.4: silent returns hide the guard — surface it in the modal
        this._showExcError("exc_err_until");
        return;
      }
      data.until_lesson = until;
    }
    this._hass.callService("school_schedule", "mark_date_exception", data);
    this._excException = null;
    this._excRange = false;
    this._excError = null;
    // v2.7.4: optimistic list add (sick-day pattern) — the entry appears
    // immediately; the backend attribute replaces it on the next hass push.
    this._optimisticAddException(data);
    this._render();
  }

  _showExcError(key) {
    // v2.7.4: visible validation feedback — inserted directly into the DOM
    // (NO full re-render) so field focus and values stay stable; symmetric
    // to _clearExcError which removes the node the same way. The renderer
    // fallback (_renderExcModal) still honors this._excError on later renders.
    this._excError = key;
    if (!this._shadow) return;
    let errEl = this._shadow.querySelector(".ssc-exc-error");
    if (!errEl) {
      const cardEl = this._shadow.querySelector(".ssc-exc-card");
      if (!cardEl) return;
      const btnRow = cardEl.querySelector(".ssc-form-buttons");
      if (!btnRow) return;
      errEl = document.createElement("div");
      errEl.className = "ssc-exc-error";
      if (btnRow.nextSibling) cardEl.insertBefore(errEl, btnRow.nextSibling);
      else cardEl.appendChild(errEl);
    }
    errEl.innerHTML = '<ha-icon icon="mdi:alert-circle" style="--mdc-icon-size:16px"></ha-icon>' + this._t(key);
  }

  _optimisticAddException(data) {
    if (!data || !data.date) return;
    if (!Array.isArray(this._exceptions)) this._exceptions = [];
    if (!this._exceptions.some(function(x) { return x.date === data.date; })) {
      this._exceptions.push({
        date: data.date,
        exception_type: data.exception_type,
        note: data.note || "",
        until_lesson: data.until_lesson || null,
      });
      this._exceptions.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
    }
  }

  _saveExceptionRange() {
    const fromEl = this._shadow.querySelector("#ssc-exc-range-from");
    const toEl = this._shadow.querySelector("#ssc-exc-range-to");
    const noteEl = this._shadow.querySelector("#ssc-exc-range-note");
    if (!fromEl || !toEl) return;
    const typeSel = this._shadow.querySelector("#ssc-exc-range-type");
    const exType = typeSel ? typeSel.value : "free";
    const data = {
      child_name: this._childName,
      start_date: fromEl.value,
      end_date: toEl.value,
      exception_type: exType,
      note: noteEl ? (noteEl.value || "") : "",
    };
    if (exType === "partial") {
      const untilEl = this._shadow.querySelector("#ssc-exc-range-until");
      const until = untilEl ? parseInt(untilEl.value, 10) : NaN;
      if (isNaN(until) || until < 1 || until > 12) { this._showExcError("exc_err_until"); return; }
      data.until_lesson = until;
    }
    if (!data.start_date || !data.end_date) { this._showExcError("exc_err_range"); return; }
    this._hass.callService("school_schedule", "mark_date_exception_range", data);
    this._excRange = false;
    this._excError = null;
    this._render();
  }

  _deleteException(dateIso) {
    if (!dateIso) return;
    this._hass.callService("school_schedule", "unmark_date_exception", {
      child_name: this._childName,
      date: dateIso,
    });
    this._excDelete = null;
    // v2.7.4: optimistic remove (sick-day pattern) — the list shows the
    // deletion immediately; the backend attribute replaces it on the next
    // hass push (identical content).
    this._exceptions = (Array.isArray(this._exceptions) ? this._exceptions : [])
      .filter(function(x) { return x.date !== dateIso; });
    this._render();
  }

  _openAddForm(weekday) {
    if (!weekday || weekday === "saturday" || weekday === "sunday") {
      weekday = "monday";
    }
    this._formData = { mode: "add", weekday: weekday, lesson: null };
    this._showForm = true;
    this._render();
  }

  _openEditForm(weekday, lessonNumber, lessonUid) {
    const lesson = this._findLesson(weekday, lessonNumber, lessonUid);
    if (!lesson) return;
    this._formData = { mode: "edit", weekday: weekday, lesson: lesson, lesson_uid: lessonUid || "" };
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
      if (fd.lesson_uid) serviceData.lesson_uid = fd.lesson_uid;
      this._hass.callService("school_schedule", "update_lesson", serviceData);
    } else {
      this._hass.callService("school_schedule", "add_lesson", serviceData);
    }

    this._showForm = false;
    this._formData = null;
    this._render();
  }

  // === Delete Logic ===

  _requestDelete(weekday, lessonNumber, lessonUid) {
    const lesson = this._findLesson(weekday, lessonNumber, lessonUid);
    if (!lesson) return;
    const dayFullNames = this._t("day_full");
    this._confirmDelete = {
      weekday: weekday,
      lesson_number: parseInt(lessonNumber),
      lesson_uid: lessonUid || "",
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
      lesson_uid: cd.lesson_uid || undefined,
    });
    this._confirmDelete = null;
    this._render();
  }

  _cancelDelete() {
    this._confirmDelete = null;
    this._render();
  }

  // === Helpers ===

  _findLesson(weekday, lessonNumber, lessonUid) {
    // v2.5.7: prefer the unique lesson_uid — (weekday, number) alone
    // is ambiguous when a legacy slot holds two entries (the "wrong
    // subject in the edit form" bug). Old data without uid falls
    // back to the first slot match, exactly like before.
    const candidates = [];
    const dayData = this._days[weekday];
    if (dayData && dayData.lessons) {
      for (const l of dayData.lessons) {
        if (parseInt(l.lesson_number) === parseInt(lessonNumber)) candidates.push(l);
      }
    }
    if (this._today && this._todayKey === weekday && this._today.lessons) {
      for (const l of this._today.lessons) {
        if (parseInt(l.lesson_number) === parseInt(lessonNumber)) {
          if (!candidates.some(c => c === l)) candidates.push(l);
        }
      }
    }
    if (candidates.length === 0) return null;
    if (lessonUid) {
      const byUid = candidates.find(l => String(l.lesson_uid || "") === String(lessonUid));
      if (byUid) return byUid;
    }
    return candidates[0];
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

  _renderSickPill() {
    // v2.6.0: sick-day hero pill — click opens the sick-day modal
    const s = this._sick || {};
    const active = s.today === true;
    const sickGrad = "background:linear-gradient(135deg,#ef5350,#e53935);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text";
    const numColor = active ? sickGrad : "color:var(--disabled-text-color,rgba(255,255,255,0.15))";
    const label = active
      ? (s.streak > 1 ? this._t("sick_days_label") : this._t("sick_streak_label"))
      : this._t("sick_days_label");
    const numHtml = active
      ? '<div class="hero-stat-num" style="' + sickGrad + '">' + (s.streak || 1) + '</div>'
      : '<div class="hero-stat-num" style="' + numColor + '">' + (s.yearCount || 0) + '</div>';
    let sub = "";
    if (active) {
      sub = '<div class="hero-holiday-name" style="color:#ef9a9a">' + (s.streak || 1) + " " + this._t(s.streak > 1 ? "sick_days" : "sick_day") + " \u2192 " + this._t("sick_streak_short") + '</div>';
    } else if (s.tomorrow === true) {
      sub = '<div class="hero-holiday-name" style="color:#ffcc80">' + this._t("sick_tomorrow_btn") + '</div>';
    }
    return '<div class="hero-stat hero-sick" data-action="open-sick-modal">' +
      numHtml +
      '<div class="hero-stat-label">' + label + '</div>' +
      sub +
    '</div>';
  }

  _renderSickBanner() {
    // v2.6.0: attest banner below the hero when thresholds are reached
    const s = this._sick || {};
    if (s.attestRequired === true) {
      return '<div class="sick-banner sick-banner-required" data-action="open-sick-modal">' +
        '<ha-icon icon="mdi:certificate" style="--mdc-icon-size:18px"></ha-icon>' +
        '<span>' + this._t("attest_required_text") + '</span>' +
      '</div>';
    }
    if (s.attestWarning === true) {
      return '<div class="sick-banner sick-banner-warning" data-action="open-sick-modal">' +
        '<ha-icon icon="mdi:alert" style="--mdc-icon-size:18px"></ha-icon>' +
        '<span>' + this._t("attest_warning_text") + '</span>' +
      '</div>';
    }
    return "";
  }


  _calcProgress() {
    const lessons = (this._today && Array.isArray(this._today.lessons)) ? this._today.lessons : [];
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const toMins = (t) => {
      if (!t) return null;
      const p = String(t).split(":").map(Number);
      if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) return null;
      return p[0] * 60 + p[1] + (p.length > 2 && !isNaN(p[2]) ? p[2] / 60 : 0);
    };
    // v2.7.2: cancelled lessons are excluded from the progress entirely —
    // they neither count as done nor inflate the total (the child is not
    // sitting in them, so they are not part of the day's work)
    const real = lessons.filter((l) => l.is_break !== true && l.cancelled !== true);
    const total = real.length;
    let done = 0;
    for (const l of real) {
      const e = toMins(l.end_time);
      if (e !== null && e <= nowMins) done++;
    }
    const current = this._today ? this._today.current : null;
    let frac = 0;
    if (current && current.is_break !== true) {
      const s = toMins(current.start_time), e = toMins(current.end_time);
      // frac nur wenn die laufende Stunde wirklich noch nicht beendet ist (e > now) --
      // sonst waere sie in done schon gezaehlt (keine Doppel-Zaehlung bei Stale-Daten)
      if (s !== null && e !== null && e > s && e > nowMins) {
        frac = Math.min(1, Math.max(0, (nowMins - s) / (e - s)));
      }
    }
    const pct = total > 0 ? Math.min(1, (done + frac) / total) : 0;
    const isDone = total > 0 && done >= total;
    const dayKey = now.toDateString();
    if (dayKey !== this._progressDay) {
      this._progressDay = dayKey;
      this._confettiFired = false;
      this._starsPrev = 0;
    }
    return { total, done, frac, pct, isDone };
  }

  _renderProgressSection() {
    const p = this._calcProgress();
    this._progress = p;
    const grad = p.isDone
      ? "linear-gradient(90deg,#ffb74d,#ffd740)"
      : "linear-gradient(90deg,var(--primary-color,#7c4dff),color-mix(in srgb,var(--primary-color,#7c4dff) 45%,transparent))";
    const label = p.isDone ? this._t("day_done") : this._t("progress_label");
    let starsHtml = "";
    for (let i = 0; i < p.total; i++) {
      const earned = i < p.done;
      const isNew = earned && i >= this._starsPrev;
      starsHtml += '<span class="hp-star' + (earned ? " earned" : "") + (isNew ? " pop" : "") + '">\u2605</span>';
    }
    if (p.total === 0) starsHtml = '<span class="hp-star">\u2605</span>';
    const pct = Math.round(p.pct * 100);
    const doneGlow = p.isDone ? "box-shadow:0 0 18px rgba(255,193,7,0.35);" : "";
    return '<div class="hero-progress"' + (p.isDone ? ' data-done="1"' : "") + '>' +
      '<div class="hp-row">' +
        '<div class="hp-label">' + label + '</div>' +
        '<div class="hp-count">' + p.done + '/' + p.total + '</div>' +
      '</div>' +
      '<div class="hp-bar">' +
        '<div class="hp-fill" style="width:' + pct + '%;background:' + grad + ';' + doneGlow + '"></div>' +
      '</div>' +
      '<div class="hp-stars">' + starsHtml + '</div>' +
    '</div>';
  }

  _fireConfetti() {
    const host = this._shadow.querySelector(".ssc");
    if (!host) return;
    const colors = ["#ffd740", "#00e5ff", "#ff4081", "#7c4dff", "#69f0ae"];
    const parts = [];
    for (let i = 0; i < 28; i++) {
      const c = colors[i % colors.length];
      const left = 4 + (i * 93) % 92;
      const dur = 1.8 + ((i * 37) % 90) / 100;
      const delay = ((i * 53) % 60) / 100;
      const size = 5 + ((i * 29) % 5);
      const variant = i % 3 === 1 ? " confetti-fall2" : (i % 3 === 2 ? " confetti-fall3" : "");
      const round = i % 4 === 0 ? "50%" : "2px";
      parts.push('<i class="confetti' + variant + '" style="left:' + left + '%;background:' + c + ';width:' + size + 'px;height:' + (i % 3 === 0 ? size * 0.5 : size) + 'px;border-radius:' + round + ';animation-duration:' + dur + 's;animation-delay:' + delay + 's"></i>');
    }
    const wrap = document.createElement("div");
    wrap.className = "confetti-layer";
    wrap.innerHTML = parts.join("");
    host.appendChild(wrap);
    setTimeout(() => { wrap.remove(); }, 4200);
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
      const realToday = (this._today.lessons || []).filter((l) => l.is_break !== true && l.cancelled !== true).length;
      const totalToday = realToday;
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
      heroPills += this._renderSickPill();

      heroHtml = '<div class="hero">' + heroPills + '</div>';
    }

    const sickBannerHtml = (this._today && this._sick) ? this._renderSickBanner() : "";
    // v2.7.3: date exception banner (free/partial today or tomorrow)
    const excBannerHtml = this._renderExcBanner();

    const progressHtml = this._today ? this._renderProgressSection() : "";

    // --- Action buttons ---
    const viewBtnText = this._viewMode === "week" ? this._t("day_view") : this._t("week_view");
    const viewBtnIcon = this._viewMode === "week" ? "mdi:calendar-day" : "mdi:calendar-week";
    const editBtnText = this._editMode ? this._t("done") : this._t("edit");
    const editBtnIcon = this._editMode ? "mdi:check" : "mdi:pencil";

    const actionsHtml = '<div class="ssc-actions">' +
      '<button class="ssc-btn' + (this._holidayMode ? " ssc-btn-active" : "") + '" data-action="toggle-holiday" title="' + this._t("loading_holidays").replace("...", "") + '">' +
        '<ha-icon icon="mdi:beach" style="--mdc-icon-size:16px"></ha-icon>' +
      '</button>' +
      // v2.7.3: date exception manager (Klassenfahrt, Schulfest, Halbtag)
      '<button class="ssc-btn' + (this._excModal ? " ssc-btn-active" : "") + '" data-action="open-exc-modal" title="' + this._t("exc_modal_title") + '">' +
        '<ha-icon icon="mdi:calendar-remove" style="--mdc-icon-size:16px"></ha-icon>' +
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
    const sickModalHtml = this._renderSickModal();
    const cancelDialogHtml = this._renderCancelDialog();
    // v2.7.3: date exception manager modal
    const excModalHtml = this._renderExcModal();

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
          sickBannerHtml +
          excBannerHtml +
          progressHtml +
          '<div class="content-scroll">' + contentHtml + '</div>' +
        '</div>' +
        formHtml +
        confirmHtml +
        sickModalHtml +
        cancelDialogHtml +
        excModalHtml +
      '</ha-card>';

    if (this._today && this._progress) {
      if (this._progress.isDone && !this._confettiFired) {
        this._confettiFired = true;
        this._fireConfetti();
      }
      this._starsPrev = this._progress.done;
    }
  }

  _renderLessonCard(lesson, isCurrent, isToday, day) {
    const isBreak = lesson.is_break === true;
    // v2.7.2: cancelled lessons render in warning red, struck through —
    // same premium design language, unmistakably "entfällt".
    const isCancelled = lesson.cancelled === true;
    const color = isCancelled ? "#ff7043" : (isBreak ? (lesson.color || "#7a8a99") : this._getColor(lesson));
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
    if (isCancelled) cls += " lc-cancelled";

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
      const lessonUid = lesson.lesson_uid || "";
      // v2.7.2: cancel toggle button — calendar-close icon; filled when
      // the lesson is already cancelled for this date
      const cancelIcon = isCancelled ? "mdi:calendar-remove" : "mdi:calendar-remove-outline";
      const cancelBtn = '<button class="lc-edit-btn' + (isCancelled ? " lc-cancel-btn-active" : "") + '" data-action="cancel-lesson" data-weekday="' + day + '" data-number="' + lessonNum + '" data-uid="' + lessonUid + '" title="' + this._t(isCancelled ? "uncancel_btn" : "cancel_btn") + '">' +
          '<ha-icon icon="' + cancelIcon + '"></ha-icon>' +
        '</button>';
      editBtns = '<div class="lc-edit">' +
        cancelBtn +
        '<button class="lc-edit-btn" data-action="edit-lesson" data-weekday="' + day + '" data-number="' + lessonNum + '" data-uid="' + lessonUid + '" title="' + this._t("edit") + '">' +
          '<ha-icon icon="mdi:pencil"></ha-icon>' +
        '</button>' +
        '<button class="lc-edit-btn" data-action="delete-lesson" data-weekday="' + day + '" data-number="' + lessonNum + '" data-uid="' + lessonUid + '" title="' + this._t("delete") + '">' +
          '<ha-icon icon="mdi:trash-can"></ha-icon>' +
        '</button>' +
      '</div>';
    }

    const cancelledBadgeHtml = isCancelled
      ? '<span class="lc-cancelled-badge">' + this._t("cancelled_badge") + '</span>' : "";
    const cancelledNoteHtml = (isCancelled && lesson.cancelled_note)
      ? '<div class="lc-cancelled-note">' + this._escHtml(lesson.cancelled_note) + '</div>' : "";

    return '<div class="' + cls + '" style="--c:' + color + ';--c05:' + c05 + ';--c10:' + c10 + ';--c20:' + c20 + ';--c30:' + c30 + ';--ctext:' + textColor + '">' +
      '<div class="lc-rail"></div>' +
      '<div class="lc-content">' +
        '<div class="lc-num">' + numHtml + '</div>' +
        '<div class="lc-info">' +
          '<div class="lc-subject">' + (isCancelled ? "<s>" + lesson.subject + "</s>" : lesson.subject) + '</div>' +
          '<div class="lc-time">' + (lesson.start_time || "").slice(0,5) + " - " + (lesson.end_time || "").slice(0,5) + '</div>' +
          (details ? '<div class="lc-details">' + details + '</div>' : "") +
          (cancelledBadgeHtml ? '<div class="lc-cancelled-row">' + cancelledBadgeHtml + '</div>' : "") +
          cancelledNoteHtml +
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
      const count = (dd.lessons || []).filter((l) => l.is_break !== true && l.cancelled !== true).length;

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
    const count = lessons.filter((l) => l.is_break !== true && l.cancelled !== true).length;
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

  // v2.7.3: date exception banner — premium warning design like the sick
  // banners; free exceptions win over partial (the more severe state).
  _renderExcBanner() {
    const sEntity = this._findEntity("schulfrei");
    const attrs = sEntity ? (sEntity.attributes || {}) : {};
    const today = attrs.exception_today || null;
    const tomorrow = attrs.exception_tomorrow || null;
    if (today && today.exception_type === "free") {
      return '<div class="sick-banner sick-banner-exc-free" data-action="open-exc-modal">' +
        '<ha-icon icon="mdi:bus-school" style="--mdc-icon-size:18px"></ha-icon>' +
        '<span>' + this._t("exc_banner_free") + (today.note ? " \u00b7 " + this._escHtml(today.note) : "") + '</span>' +
      '</div>';
    }
    if (today && today.exception_type === "partial") {
      return '<div class="sick-banner sick-banner-exc-partial" data-action="open-exc-modal">' +
        '<ha-icon icon="mdi:weather-sunset" style="--mdc-icon-size:18px"></ha-icon>' +
        '<span>' + this._t("exc_banner_partial") + " \u2014 " + this._t("lesson_short") + " " + (today.until_lesson || "?") + (today.note ? " \u00b7 " + this._escHtml(today.note) : "") + '</span>' +
      '</div>';
    }
    if (tomorrow && tomorrow.exception_type === "free") {
      return '<div class="sick-banner sick-banner-exc-free" data-action="open-exc-modal">' +
        '<ha-icon icon="mdi:bus-school" style="--mdc-icon-size:18px"></ha-icon>' +
        '<span>' + this._t("exc_banner_tomorrow_free") + (tomorrow.note ? " \u00b7 " + this._escHtml(tomorrow.note) : "") + '</span>' +
      '</div>';
    }
    if (tomorrow && tomorrow.exception_type === "partial") {
      return '<div class="sick-banner sick-banner-exc-partial" data-action="open-exc-modal">' +
        '<ha-icon icon="mdi:weather-sunset" style="--mdc-icon-size:18px"></ha-icon>' +
        '<span>' + this._t("exc_banner_tomorrow_partial") + " \u2014 " + this._t("lesson_short") + " " + (tomorrow.until_lesson || "?") + (tomorrow.note ? " \u00b7 " + this._escHtml(tomorrow.note) : "") + '</span>' +
      '</div>';
    }
    return "";
  }

  // v2.7.3: date exception manager modal (Kranken-Modal-Pattern: quick
  // buttons + range form + editable list with 2-click delete)
  _renderExcModal() {
    if (!this._excModal) return "";
    const todayIso = this._isoDate("today");
    const tomorrowIso = this._isoDate("tomorrow");
    // Pure render: never mutate state here — a missing form state falls
    // back to a LOCAL default object (see the v273 sim test 7 regression).
    const ex = this._excException || {
      date_iso: todayIso,
      exception_type: "free",
      note: "",
      until_lesson: null,
    };
    const isFree = ex.exception_type !== "partial";

    // Range form (Von-Bis)
    let rangeHtml = "";
    if (this._excRange) {
      rangeHtml = '<div class="sick-range-form">' +
        '<div class="sick-history-title">' + this._t("exc_range_title") + '</div>' +
        '<div class="ssc-field-row">' +
          '<div class="ssc-field">' +
            '<span class="ssc-field-label">' + this._t("exc_range_from") + '</span>' +
            '<input class="ssc-input" type="date" id="ssc-exc-range-from" value="' + todayIso + '" />' +
          '</div>' +
          '<div class="ssc-field">' +
            '<span class="ssc-field-label">' + this._t("exc_range_to") + '</span>' +
            '<input class="ssc-input" type="date" id="ssc-exc-range-to" value="' + todayIso + '" />' +
          '</div>' +
        '</div>' +
        '<div class="ssc-field">' +
          '<span class="ssc-field-label">' + this._t("exc_range_type") + '</span>' +
          '<select class="ssc-input" id="ssc-exc-range-type">' +
            '<option value="free"' + (isFree ? " selected" : "") + '>' + this._t("exc_type_free") + '</option>' +
            '<option value="partial"' + (!isFree ? " selected" : "") + '>' + this._t("exc_type_partial") + '</option>' +
          '</select>' +
        '</div>' +
        '<div class="ssc-field" id="ssc-exc-range-until-field"' + (isFree ? ' style="display:none"' : "") + '>' +
          '<span class="ssc-field-label">' + this._t("exc_type_partial") + ' (1-12)</span>' +
          '<input class="ssc-input" type="number" min="1" max="12" id="ssc-exc-range-until" value="4" />' +
        '</div>' +
        '<div class="ssc-field">' +
          '<span class="ssc-field-label">' + this._t("exc_note") + '</span>' +
          '<input class="ssc-input" type="text" id="ssc-exc-range-note" placeholder="' + this._escAttr(this._t("exc_note_ph")) + '" />' +
        '</div>' +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="exc-range-cancel">' + this._t("cancel") + '</button>' +
          '<button class="ssc-btn ssc-btn-save" data-action="exc-range-save">' + this._t("exc_range_btn") + '</button>' +
        '</div>' +
      '</div>';
    }

    // Editable list
    const entries = Array.isArray(this._exceptions) ? this._exceptions.slice() : [];
    let listHtml = "";
    if (entries.length > 0) {
      const itemsHtml = entries.map(function(entry) {
        const d = entry.date || "";
        const note = entry.note || "";
        const isPartial = entry.exception_type === "partial";
        const typeLabel = isPartial
          ? this._t("exc_type_partial") + " " + (entry.until_lesson || "?")
          : this._t("exc_type_free");
        const badge = d === todayIso
          ? '<span class="sick-entry-badge sick-entry-badge-today">' + this._t("exc_today_badge") + '</span>'
          : (d === tomorrowIso
            ? '<span class="sick-entry-badge sick-entry-badge-planned">' + this._t("sick_planned_badge") + '</span>'
            : (d > todayIso
              ? '<span class="sick-entry-badge sick-entry-badge-planned">' + this._t("exc_planned_badge") + '</span>'
              : ""));
        const isDeleting = this._excDelete === d;
        let rowActionHtml = "";
        if (isDeleting) {
          rowActionHtml =
            '<div class="sick-entry-edit-row">' +
              '<span class="sick-delete-confirm-text">' + this._t("exc_delete_confirm") + '</span>' +
              '<button class="sick-icon-btn sick-icon-btn-danger" data-action="exc-delete-confirm-yes" data-date="' + d + '"><ha-icon icon="mdi:check" style="--mdc-icon-size:16px"></ha-icon></button>' +
              '<button class="sick-icon-btn" data-action="exc-delete-confirm-no" title="' + this._t("cancel") + '"><ha-icon icon="mdi:close" style="--mdc-icon-size:16px"></ha-icon></button>' +
            '</div>';
        } else {
          rowActionHtml =
            '<div class="sick-entry-actions">' +
              '<button class="sick-icon-btn sick-icon-btn-danger" data-action="exc-delete" data-date="' + d + '" title="' + this._t("sick_delete_btn") + '"><ha-icon icon="mdi:delete" style="--mdc-icon-size:14px"></ha-icon></button>' +
            '</div>';
        }
        return '<div class="sick-entry' + (isDeleting ? " sick-entry-active" : "") + '">' +
          '<div class="sick-entry-main">' +
            '<span class="sick-entry-date">' + d + '</span>' +
            '<span class="ssc-exc-type">' + typeLabel + '</span>' +
            badge +
            (note ? '<span class="sick-entry-note">' + this._escHtml(note) + '</span>' : "") +
          '</div>' +
          rowActionHtml +
        '</div>';
      }.bind(this)).join("");
      listHtml = '<div class="sick-history-title">' + this._t("exc_list_title") + ' <span class="sick-list-count">(' + entries.length + ')</span></div>' +
        '<div class="sick-entry-list">' + itemsHtml + '</div>';
    } else {
      listHtml = '<div class="sick-history-title">' + this._t("exc_list_title") + '</div>' +
        '<div class="sick-history-empty">' + this._t("exc_list_empty") + '</div>';
    }

    // Type buttons + date/note/until form
    const formHtml = '<div class="sick-action-row">' +
        '<button class="sick-btn' + (isFree ? " sick-btn-active" : "") + '" data-action="exc-type-free">' +
          '<ha-icon icon="mdi:bus-school" style="--mdc-icon-size:18px"></ha-icon>' +
          '<span>' + this._t("exc_type_free") + '</span>' +
        '</button>' +
        '<button class="sick-btn' + (!isFree ? " sick-btn-active" : "") + '" data-action="exc-type-partial">' +
          '<ha-icon icon="mdi:weather-sunset" style="--mdc-icon-size:18px"></ha-icon>' +
          '<span>' + this._t("exc_type_partial") + '</span>' +
        '</button>' +
      '</div>' +
      '<div class="ssc-field-row">' +
        '<div class="ssc-field">' +
          '<span class="ssc-field-label">' + this._t("exc_date") + '</span>' +
          '<input class="ssc-input" type="date" data-action="exc-date-change" value="' + (ex.date_iso || todayIso) + '" />' +
        '</div>' +
        (!isFree
          ? '<div class="ssc-field">' +
              '<span class="ssc-field-label">' + this._t("exc_type_partial") + ' (1-12)</span>' +
              '<input class="ssc-input" type="number" min="1" max="12" data-action="exc-until-change" value="' + (ex.until_lesson || 4) + '" />' +
            '</div>'
          : "") +
      '</div>' +
      '<div class="ssc-field">' +
        '<span class="ssc-field-label">' + this._t("exc_note") + '</span>' +
        '<input class="ssc-input" type="text" data-action="exc-note-input" placeholder="' + this._escAttr(this._t("exc_note_ph")) + '" value="' + this._escAttr(ex.note || "") + '" />' +
      '</div>';

    return '<div class="ssc-modal-overlay" data-action="exc-bg">' +
      '<div class="ssc-form-card ssc-exc-card">' +
        '<div class="ssc-form-title">' + this._t("exc_modal_title") + '</div>' +
        '<div class="ssc-form-day">' + this._t("exc_modal_sub") + '</div>' +
        formHtml +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn ssc-btn-save" data-action="exc-save">' + this._t("exc_save") + '</button>' +
        '</div>' +
        (this._excError
          ? '<div class="ssc-exc-error"><ha-icon icon="mdi:alert-circle" style="--mdc-icon-size:16px"></ha-icon>' + this._t(this._excError) + '</div>'
          : "") +
        '<button class="sick-btn sick-btn-range" data-action="exc-range-toggle">' +
          '<ha-icon icon="mdi:calendar-range" style="--mdc-icon-size:18px"></ha-icon>' +
          '<span>' + this._t("exc_range_title") + '</span>' +
        '</button>' +
        rangeHtml +
        listHtml +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="exc-close">' + this._t("cancel") + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // v2.7.2: lesson cancellation dialog (edit mode)
  _renderCancelDialog() {
    if (!this._cancelLesson || !this._editMode) return "";
    const cd = this._cancelLesson;
    const already = cd.already_cancelled === true;
    const dayFullNames = this._t("day_full");
    const dayName = dayFullNames[cd.weekday] || cd.weekday;

    let bodyHtml = "";
    if (already) {
      // already cancelled for this date -> offer the restore action
      bodyHtml = '<div class="ssc-cancel-note">' +
          this._t("cancelled_lesson") + " \u2014 " + dayName + ", " + cd.date_iso +
        '</div>' +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="cancel-lesson-cancel">' + this._t("cancel") + '</button>' +
          '<button class="ssc-btn ssc-btn-restore" data-action="uncancel-lesson" data-date="' + cd.date_iso + '" data-number="' + cd.lesson_number + '">' +
            '<ha-icon icon="mdi:calendar-check" style="--mdc-icon-size:16px"></ha-icon>' +
            '<span>' + this._t("uncancel_btn") + '</span>' +
          '</button>' +
        '</div>';
    } else {
      bodyHtml = '<div class="ssc-cancel-note">' +
          this._t("cancel_lesson_sub") +
        '</div>' +
        '<div class="ssc-field">' +
          '<span class="ssc-field-label">' + this._t("cancel_note") + '</span>' +
          '<input class="ssc-input" type="text" id="ssc-cancel-note" placeholder="' + this._escAttr(this._t("cancel_note_ph")) + '" value="' + this._escAttr(cd.note || "") + '" />' +
        '</div>' +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="cancel-lesson-cancel">' + this._t("cancel") + '</button>' +
          '<button class="ssc-btn ssc-btn-danger" data-action="cancel-lesson-confirm">' +
            '<ha-icon icon="mdi:calendar-remove" style="--mdc-icon-size:16px"></ha-icon>' +
            '<span>' + this._t("cancel_btn") + '</span>' +
          '</button>' +
        '</div>';
    }

    return '<div class="ssc-modal-overlay" data-action="cancel-lesson-bg">' +
      '<div class="ssc-form-card ssc-cancel-card">' +
        '<div class="ssc-form-title">' + this._t("cancel_lesson_q") + '</div>' +
        '<div class="ssc-form-day">' +
          (cd.subject ? cd.subject + " \u00b7 " : "") + dayName + ", " + cd.date_iso + " \u00b7 " +
          this._t("lesson_short") + " " + cd.lesson_number + " \u00b7 " + cd.start_time + "-" + cd.end_time +
        '</div>' +
        bodyHtml +
      '</div>' +
    '</div>';
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

  _renderSickModal() {
    if (!this._sickModal) return "";
    const s = this._sick || {};
    const entries = (s.entries || []).slice();
    const todayMarked = s.today === true;
    const tomorrowMarked = s.tomorrow === true;
    const todayIso = s.isoToday || "";
    const tomorrowIso = this._isoDate("tomorrow");

    const attestHtml = s.attestRequired === true
      ? '<div class="sick-modal-attest sick-modal-attest-required"><ha-icon icon="mdi:certificate" style="--mdc-icon-size:16px"></ha-icon>' + this._t("attest_required_text") + '</div>'
      : (s.attestWarning === true
        ? '<div class="sick-modal-attest sick-modal-attest-warning"><ha-icon icon="mdi:alert" style="--mdc-icon-size:16px"></ha-icon>' + this._t("attest_warning_text") + '</div>'
        : "");

    // v2.7.0: editable sick-day list
    let listHtml = "";
    if (entries.length > 0) {
      const itemsHtml = entries.map(function(entry) {
        const d = entry.date || "";
        const note = entry.note || "";
        const isToday = d === todayIso;
        const isFuture = d > todayIso;
        let badge = "";
        if (isToday) {
          badge = '<span class="sick-entry-badge sick-entry-badge-today">' + this._t("sick_today_badge") + '</span>';
        } else if (isFuture) {
          badge = '<span class="sick-entry-badge sick-entry-badge-planned">' + this._t("sick_planned_badge") + '</span>';
        }
        const isEditing = this._sickEdit === d;
        const isDeleting = this._sickDelete === d;
        let rowActionHtml = "";
        if (isEditing) {
          rowActionHtml =
            '<div class="sick-entry-edit-row">' +
              '<input class="ssc-input sick-entry-note-input" id="ssc-sick-edit-note" type="text" value="' + this._escAttr(note) + '" placeholder="..." />' +
              '<button class="sick-icon-btn" data-action="sick-save-edit" data-date="' + d + '" title="' + this._t("sick_edit_save") + '"><ha-icon icon="mdi:check" style="--mdc-icon-size:16px"></ha-icon></button>' +
              '<button class="sick-icon-btn" data-action="sick-cancel-edit" title="' + this._t("cancel") + '"><ha-icon icon="mdi:close" style="--mdc-icon-size:16px"></ha-icon></button>' +
            '</div>';
        } else if (isDeleting) {
          rowActionHtml =
            '<div class="sick-entry-edit-row">' +
              '<span class="sick-delete-confirm-text">' + this._t("sick_delete_confirm") + '</span>' +
              '<button class="sick-icon-btn sick-icon-btn-danger" data-action="sick-delete-confirm-yes" data-date="' + d + '"><ha-icon icon="mdi:check" style="--mdc-icon-size:16px"></ha-icon></button>' +
              '<button class="sick-icon-btn" data-action="sick-delete-confirm-no" title="' + this._t("cancel") + '"><ha-icon icon="mdi:close" style="--mdc-icon-size:16px"></ha-icon></button>' +
            '</div>';
        } else {
          rowActionHtml =
            '<div class="sick-entry-actions">' +
              '<button class="sick-icon-btn" data-action="sick-edit" data-date="' + d + '" title="' + this._t("sick_edit_btn") + '"><ha-icon icon="mdi:pencil" style="--mdc-icon-size:14px"></ha-icon></button>' +
              '<button class="sick-icon-btn sick-icon-btn-danger" data-action="sick-delete" data-date="' + d + '" title="' + this._t("sick_delete_btn") + '"><ha-icon icon="mdi:delete" style="--mdc-icon-size:14px"></ha-icon></button>' +
            '</div>';
        }
        return '<div class="sick-entry' + (isEditing || isDeleting ? " sick-entry-active" : "") + '">' +
          '<div class="sick-entry-main">' +
            '<span class="sick-entry-date">' + d + '</span>' +
            badge +
            (note && !isEditing ? '<span class="sick-entry-note">' + this._escHtml(note) + '</span>' : "") +
          '</div>' +
          rowActionHtml +
        '</div>';
      }.bind(this)).join("");
      listHtml = '<div class="sick-history-title">' + this._t("sick_list_title") + ' <span class="sick-list-count">(' + entries.length + ' ' + this._t("sick_list_count") + ')</span></div>' +
        '<div class="sick-entry-list">' + itemsHtml + '</div>';
    } else {
      listHtml = '<div class="sick-history-title">' + this._t("sick_list_title") + '</div>' +
        '<div class="sick-history-empty">' + this._t("sick_no_history") + '</div>';
    }

    // v2.7.0: range form (Von–Bis)
    let rangeHtml = "";
    if (this._sickRange) {
      rangeHtml = '<div class="sick-range-form">' +
        '<div class="sick-history-title">' + this._t("sick_range_title") + '</div>' +
        '<div class="ssc-field-row">' +
          '<div class="ssc-field">' +
            '<span class="ssc-field-label">' + this._t("sick_range_from") + '</span>' +
            '<input class="ssc-input" type="date" id="ssc-sick-range-from" value="' + todayIso + '" />' +
          '</div>' +
          '<div class="ssc-field">' +
            '<span class="ssc-field-label">' + this._t("sick_range_to") + '</span>' +
            '<input class="ssc-input" type="date" id="ssc-sick-range-to" value="' + todayIso + '" />' +
          '</div>' +
        '</div>' +
        '<div class="ssc-field">' +
          '<span class="ssc-field-label">' + this._t("sick_range_note") + '</span>' +
          '<input class="ssc-input" type="text" id="ssc-sick-range-note" placeholder="..." />' +
        '</div>' +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="sick-range-cancel">' + this._t("cancel") + '</button>' +
          '<button class="ssc-btn ssc-btn-save" data-action="sick-range-save">' + this._t("sick_range_btn") + '</button>' +
        '</div>' +
      '</div>';
    }

    return '<div class="ssc-modal-overlay" data-action="cancel-sick-bg">' +
      '<div class="ssc-form-card ssc-sick-card">' +
        '<div class="ssc-form-title">' + this._t("sick_modal_title") + '</div>' +
        '<div class="ssc-form-day">' + this._t("sick_modal_sub") + '</div>' +
        attestHtml +
        '<div class="sick-action-row">' +
          '<button class="sick-btn' + (todayMarked ? " sick-btn-active" : "") + '" data-action="sick-today">' +
            '<ha-icon icon="' + (todayMarked ? "mdi:check-circle" : "mdi:thermometer") + '" style="--mdc-icon-size:18px"></ha-icon>' +
            '<span>' + this._t("sick_today_btn") + (todayMarked ? " ✓" : "") + '</span>' +
          '</button>' +
          '<button class="sick-btn' + (tomorrowMarked ? " sick-btn-active" : "") + '" data-action="sick-tomorrow">' +
            '<ha-icon icon="' + (tomorrowMarked ? "mdi:check-circle" : "mdi:thermometer") + '" style="--mdc-icon-size:18px"></ha-icon>' +
            '<span>' + this._t("sick_tomorrow_btn") + (tomorrowMarked ? " ✓" : "") + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="ssc-field">' +
          '<span class="ssc-field-label">' + this._t("sick_note") + '</span>' +
          '<input class="ssc-input" type="text" id="ssc-sick-note" placeholder="..." />' +
        '</div>' +
        '<button class="sick-btn sick-btn-range" data-action="sick-range-toggle">' +
          '<ha-icon icon="mdi:calendar-range" style="--mdc-icon-size:18px"></ha-icon>' +
          '<span>' + this._t("sick_range_title") + '</span>' +
        '</button>' +
        rangeHtml +
        listHtml +
        this._renderCancelledList() +
        '<div class="ssc-form-buttons">' +
          '<button class="ssc-btn" data-action="cancel-sick">' + this._t("cancel") + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // v2.7.2: upcoming lesson cancellations list (shown in the sick modal)
  _renderCancelledList() {
    const cancels = Array.isArray(this._cancellations) ? this._cancellations : [];
    const todayIso = this._sick ? this._sick.isoToday : "";
    if (cancels.length === 0) return "";
    const itemsHtml = cancels.map(function(entry) {
      const d = entry.date || "";
      const num = parseInt(entry.lesson_number, 10);
      const note = entry.note || "";
      const badge = d === todayIso
        ? '<span class="sick-entry-badge sick-entry-badge-today">' + this._t("sick_today_badge") + '</span>'
        : (d > todayIso
          ? '<span class="sick-entry-badge sick-entry-badge-planned">' + this._t("sick_planned_badge") + '</span>'
          : "");
      return '<div class="sick-entry ssc-cancel-entry" data-date="' + d + '" data-number="' + num + '">' +
        '<div class="sick-entry-main">' +
          '<span class="sick-entry-date">' + d + '</span>' +
          '<span class="ssc-cancel-num">' + this._t("lesson_short") + " " + num + '</span>' +
          badge +
          (note ? '<span class="sick-entry-note">' + this._escHtml(note) + '</span>' : "") +
        '</div>' +
        '<div class="sick-entry-actions">' +
          '<button class="sick-icon-btn sick-icon-btn-danger" data-action="uncancel-lesson" data-date="' + d + '" data-number="' + num + '" title="' + this._t("uncancel_btn") + '">' +
            '<ha-icon icon="mdi:calendar-check" style="--mdc-icon-size:14px"></ha-icon>' +
          '</button>' +
        '</div>' +
      '</div>';
    }.bind(this)).join("");
    return '<div class="sick-history-title">' + this._t("cancelled_list_title") + '</div>' +
      '<div class="sick-entry-list">' + itemsHtml + '</div>';
  }

  // v2.7.0: escape helpers for user notes in HTML attributes / text
  _escHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  _escAttr(text) {
    return this._escHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

_getSickHistory() {
    // v2.6.0: recent sick days (last 5) with notes from the absence
    // sensor attributes — the coordinator keeps the full list.
    const s = this._sick || {};
    return (s.recent || []).slice(-5);
  }

  static getConfigElement() {
    return document.createElement("school-schedule-card-editor");
  }

  static getStubConfig() {
    return { type: "custom:school-schedule-card", child_name: "", height: "", width: "", language: "" };
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

      /* === Sick-day pill + attest banner (v2.6.0) === */
      .hero-sick { cursor: pointer; transition: border-color .18s ease, box-shadow .18s ease; }
      .hero-sick:hover { border-color: rgba(239,83,80,0.45); box-shadow: 0 4px 18px rgba(239,83,80,0.18); }
      .sick-banner {
        display: flex; align-items: center; gap: 8px;
        margin: 10px 0 0; padding: 8px 12px;
        border-radius: 12px; font-size: 0.78em; font-weight: 600;
        cursor: pointer; line-height: 1.35;
      }
      .sick-banner-warning {
        background: color-mix(in srgb, #ffb74d 14%, transparent);
        border: 1px solid color-mix(in srgb, #ffb74d 35%, transparent);
        color: #ffcc80;
      }
      .sick-banner-required {
        background: color-mix(in srgb, #ef5350 16%, transparent);
        border: 1px solid color-mix(in srgb, #ef5350 40%, transparent);
        color: #ef9a9a;
        animation: sick-pulse 2.4s ease-in-out infinite;
      }
      @keyframes sick-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,83,80,0.0); }
        50% { box-shadow: 0 0 16px 2px rgba(239,83,80,0.25); }
      }
      .sick-action-row { display: flex; gap: 10px; margin: 14px 0 10px; }
      .sick-btn {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
        padding: 11px 10px; border-radius: 12px; cursor: pointer;
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 25%, transparent);
        color: var(--primary-text-color, #fff);
        font-size: 0.85em; font-weight: 600; font-family: inherit;
        transition: border-color .18s ease, background .18s ease;
      }
      .sick-btn:hover { border-color: color-mix(in srgb, #ef5350 55%, transparent); background: color-mix(in srgb, #ef5350 10%, transparent); }
      .sick-btn-active {
        background: color-mix(in srgb, #ef5350 18%, transparent);
        border-color: color-mix(in srgb, #ef5350 55%, transparent);
        color: #ef9a9a;
      }
      .sick-modal-attest {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px; margin-top: 10px; border-radius: 10px;
        font-size: 0.76em; font-weight: 600; line-height: 1.35;
      }
      .sick-modal-attest-warning { background: color-mix(in srgb, #ffb74d 14%, transparent); border: 1px solid color-mix(in srgb, #ffb74d 35%, transparent); color: #ffcc80; }
      .sick-modal-attest-required { background: color-mix(in srgb, #ef5350 16%, transparent); border: 1px solid color-mix(in srgb, #ef5350 40%, transparent); color: #ef9a9a; }
      .sick-history-title { font-size: 0.72em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.65; margin: 14px 0 6px; }
      .sick-history-list { display: flex; flex-direction: column; gap: 4px; max-height: 130px; overflow-y: auto; }
      .sick-history-item {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 10px; border-radius: 8px;
        background: rgba(255,255,255,0.04);
        font-size: 0.78em;
      }
      .sick-history-date { font-weight: 700; color: #ef9a9a; }
      .sick-history-note { opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sick-history-empty { font-size: 0.78em; opacity: 0.55; padding: 8px 2px; }
      /* v2.7.0: editable sick-day list */
      .sick-list-count { text-transform: none; letter-spacing: 0; opacity: 0.7; }
      .sick-entry-list { display: flex; flex-direction: column; gap: 5px; max-height: 220px; overflow-y: auto; margin-bottom: 6px; }
      .sick-entry {
        display: flex; flex-direction: column; gap: 4px;
        padding: 7px 10px; border-radius: 10px;
        background: rgba(255,255,255,0.04);
        border: 1px solid transparent;
        transition: border-color 0.15s ease;
      }
      .sick-entry:hover { border-color: rgba(239,83,80,0.25); }
      .sick-entry-active { border-color: rgba(239,83,80,0.45); background: color-mix(in srgb, #ef5350 8%, transparent); }
      .sick-entry-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sick-entry-date { font-size: 0.8em; font-weight: 700; color: #ef9a9a; font-family: monospace; }
      .sick-entry-badge {
        font-size: 0.58em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
        padding: 2px 8px; border-radius: 100px; white-space: nowrap;
      }
      .sick-entry-badge-today {
        background: color-mix(in srgb, #ef5350 25%, transparent);
        border: 1px solid color-mix(in srgb, #ef5350 50%, transparent);
        color: #ffcdd2;
      }
      .sick-entry-badge-planned {
        background: color-mix(in srgb, #ffb74d 18%, transparent);
        border: 1px solid color-mix(in srgb, #ffb74d 40%, transparent);
        color: #ffcc80;
      }
      .sick-entry-note { font-size: 0.72em; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
      .sick-entry-actions { display: flex; gap: 6px; }
      .sick-entry-actions { margin-left: auto; }
      .sick-icon-btn {
        width: 26px; height: 26px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--primary-color, #7c4dff) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 25%, transparent);
        cursor: pointer; padding: 0; flex-shrink: 0;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .sick-icon-btn:hover { border-color: color-mix(in srgb, #ef5350 55%, transparent); background: color-mix(in srgb, #ef5350 10%, transparent); }
      .sick-icon-btn-danger { border-color: color-mix(in srgb, #f44336 30%, transparent); }
      .sick-icon-btn-danger:hover { border-color: #f44336; background: color-mix(in srgb, #f44336 15%, transparent); }
      .sick-entry-edit-row { display: flex; align-items: center; gap: 6px; }
      .sick-entry-edit-row .ssc-input { flex: 1; min-width: 0; }
      .sick-delete-confirm-text { font-size: 0.72em; font-weight: 700; color: #ef9a9a; }
      .sick-range-form {
        margin-top: 10px; padding: 12px;
        border-radius: 12px;
        background: color-mix(in srgb, #ef5350 6%, transparent);
        border: 1px dashed color-mix(in srgb, #ef5350 30%, transparent);
      }
      .sick-btn-range { margin-top: 4px; justify-content: flex-start; }
      .sick-btn-range:hover { border-color: color-mix(in srgb, #ef5350 55%, transparent); background: color-mix(in srgb, #ef5350 8%, transparent); }

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

      /* === Daily progress + gamification (v2.5.6) === */
      .ssc { position: relative; }
      .hero-progress {
        display: flex; flex-direction: column; gap: 7px;
        padding: 12px 16px; margin-bottom: 16px;
        border-radius: 16px; width: 100%; box-sizing: border-box;
        background: color-mix(in srgb, var(--card-background-color, #111118) 60%, transparent);
        backdrop-filter: blur(12px);
        border: 1px solid color-mix(in srgb, var(--primary-color, #7c4dff) 10%, transparent);
      }
      .hero-progress[data-done] {
        border-color: color-mix(in srgb, #ffca28 35%, transparent);
        box-shadow: 0 0 24px rgba(255,193,7,0.12);
      }
      .hp-row { display: flex; justify-content: space-between; align-items: baseline; }
      .hp-label {
        font-size: 0.6em; font-weight: 800; letter-spacing: 0.1em;
        color: var(--secondary-text-color, rgba(255,255,255,0.4));
        text-transform: uppercase;
      }
      .hero-progress[data-done] .hp-label {
        background: linear-gradient(135deg,#ffb74d,#ffd740);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
      }
      .hp-count {
        font-size: 0.78em; font-weight: 900;
        color: var(--primary-text-color, #fff);
      }
      .hp-bar {
        position: relative; height: 10px; border-radius: 6px; overflow: hidden;
        background: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent);
      }
      .hp-fill {
        position: absolute; top: 0; bottom: 0; left: 0; height: 100%;
        border-radius: 6px; overflow: hidden;
        transition: width 0.8s cubic-bezier(0.22,1,0.36,1);
      }
      .hp-fill::after {
        content: ""; position: absolute; top: 0; bottom: 0; left: 0; right: 0;
        background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.35) 50%, transparent 65%);
        transform: translateX(-100%);
        animation: hp-shimmer 2.6s ease-in-out infinite;
      }
      .hero-progress[data-done] .hp-fill::after { animation: none; opacity: 0; }
      @keyframes hp-shimmer {
        0% { transform: translateX(-100%); }
        55%, 100% { transform: translateX(100%); }
      }
      .hp-stars { display: flex; flex-wrap: wrap; gap: 5px; min-height: 18px; }
      .hp-star {
        font-size: 14px; line-height: 1; font-style: normal;
        color: color-mix(in srgb, var(--primary-text-color, #fff) 14%, transparent);
        transition: color 0.4s;
      }
      .hp-star.earned {
        color: #ffd740;
        text-shadow: 0 0 10px rgba(255,215,64,0.55);
      }
      .hp-star.pop { animation: star-pop 0.6s cubic-bezier(0.34,1.56,0.64,1); }
      @keyframes star-pop {
        0% { transform: scale(0); opacity: 0; }
        60% { transform: scale(1.35); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      .confetti-layer {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        overflow: hidden; pointer-events: none; z-index: 5;
      }
      .confetti {
        position: absolute; top: -12px; display: block; opacity: 0;
        animation-name: confetti-fall1; animation-fill-mode: forwards;
      }
      .confetti-fall2 { animation-name: confetti-fall2; }
      .confetti-fall3 { animation-name: confetti-fall3; }
      @keyframes confetti-fall1 {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        85% { opacity: 1; }
        100% { transform: translateY(340px) rotate(680deg); opacity: 0; }
      }
      @keyframes confetti-fall2 {
        0% { transform: translateY(0) rotate(0deg) translateX(0); opacity: 1; }
        40% { transform: translateY(140px) rotate(240deg) translateX(26px); opacity: 1; }
        100% { transform: translateY(340px) rotate(520deg) translateX(-14px); opacity: 0; }
      }
      @keyframes confetti-fall3 {
        0% { transform: translateY(0) rotate(0deg) translateX(0); opacity: 1; }
        50% { transform: translateY(170px) rotate(-260deg) translateX(-30px); opacity: 1; }
        100% { transform: translateY(340px) rotate(-540deg) translateX(18px); opacity: 0; }
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
      /* v2.7.3: date exception banners (Tages-Ausnahmen) */
      .sick-banner-exc-free {
        background: linear-gradient(135deg, rgba(124,77,255,0.22), rgba(41,182,246,0.18));
        border: 1px solid rgba(124,77,255,0.45);
      }
      .sick-banner-exc-free ha-icon { color:#7c4dff; }
      .sick-banner-exc-partial {
        background: linear-gradient(135deg, rgba(255,183,77,0.20), rgba(255,112,67,0.16));
        border: 1px solid rgba(255,183,77,0.45);
      }
      .sick-banner-exc-partial ha-icon { color:#ffb74d; }
      .ssc-exc-error {
        display:flex; align-items:center; gap:6px;
        margin-top:8px; padding:8px 12px;
        border-radius:10px; font-size:12px; font-weight:600;
        color:#ff8a65;
        background:rgba(255,112,67,0.12);
        border:1px solid rgba(255,112,67,0.35);
      }
      .ssc-exc-type {
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color, rgba(255,255,255,0.7));
        background: rgba(124,77,255,0.14);
        border: 1px solid rgba(124,77,255,0.25);
        padding: 1px 8px;
        border-radius: 10px;
        white-space: nowrap;
      }

      /* v2.7.2: cancelled lessons (Einzelstunden-Ausfall) */
      .lc-cancelled {
        border-style: dashed !important;
        opacity: 0.72;
        background: color-mix(in srgb, #ff7043 6%, transparent) !important;
      }
      .lc-cancelled .lc-subject {
        text-decoration: line-through;
        text-decoration-thickness: 2px;
        text-decoration-color: #ff7043;
        opacity: 0.85;
      }
      .lc-cancelled .lc-num,
      .lc-cancelled .lc-time,
      .lc-cancelled .lc-rail {
        opacity: 0.55;
      }
      .lc-cancelled-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.06em;
        color: #fff;
        background: linear-gradient(135deg, #ff7043, #f4511e);
        box-shadow: 0 2px 8px rgba(255, 112, 67, 0.35);
      }
      .lc-cancelled-row {
        margin-top: 4px;
      }
      .lc-cancelled-note {
        margin-top: 3px;
        font-size: 10px;
        color: rgba(255, 138, 101, 0.95);
        font-style: italic;
      }
      .lc-cancel-btn-active {
        color: #ff7043 !important;
        border-color: rgba(255, 112, 67, 0.5) !important;
      }
      .ssc-cancel-entry .ssc-cancel-num {
        font-weight: 700;
        font-size: 11px;
        color: var(--secondary-text-color, #aaa);
      }
      .ssc-btn-restore {
        border-color: rgba(105, 240, 174, 0.4) !important;
      }
      .ssc-btn-danger {
        border-color: rgba(255, 112, 67, 0.5) !important;
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
          <input class="ssc-editor-input" id="ssc-edit-child" type="text" value="${this._config.child_name || ""}" placeholder="z.B. Max" />
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
  description: "Stundenplan-Karte Ultra Premium v2.7.4",
  preview: false,
});