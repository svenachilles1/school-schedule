"""DataUpdateCoordinator for the School Schedule integration."""
from __future__ import annotations

import copy
import logging
from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    CONF_CHILD_NAME,
    CONF_FEDERAL_STATE,
    CONF_IS_BREAK,
    CONF_LESSONS,
    CONF_WEEKDAY,
    CONF_LESSON_NUMBER,
    CONF_LESSON_UID,
    CONF_ABSENCES,
    DOMAIN,
    UPDATE_INTERVAL_MINUTES,
    WEEKDAYS,
)
from .holiday_logic import (
    day_status,
    next_event,
    next_school_day,
    vacations_for_card,
)
from .lesson_logic import ensure_lesson_uids, lesson_uid_for, slot_taken
from .absence_logic import (
    get_entry_absences,
    mark_sick_range,
    prune_absences,
    sick_summary,
    update_absence_note,
    upsert_absence,
    remove_absence,
)
from .cancellation_logic import (
    annotate_lessons,
    get_entry_cancellations,
    prune_cancellations,
    remove_cancellation,
    upsert_cancellation,
)
from .const import ABSENCE_TYPE_SICK, CONF_LESSON_CANCELLATIONS
from .holidays import (
    SharedHolidaysCoordinator,
    federal_state_from_entry,
    get_holidays_coordinator,
)

_LOGGER = logging.getLogger(__name__)


class SchoolScheduleCoordinator(DataUpdateCoordinator):
    """Coordinator for the School Schedule integration."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the coordinator."""
        self.entry = entry
        self.child_name: str = entry.data.get(CONF_CHILD_NAME, "")
        # Deep copy: entry.data is a MappingProxyType over the stored dict —
        # a shallow list() copy would share the lesson dicts with entry.data,
        # so in-place mutation (update_lesson) would silently change
        # entry.data too. async_update_entry() then sees
        # new_data == entry.data and skips the storage write entirely
        # (no modified_at bump, nothing persisted) — the lesson edit lives
        # only in RAM until the next restart wipes it. Deep-copying here
        # keeps self.lessons fully detached from entry.data (v2.5.2).
        self.lessons: list[dict[str, Any]] = copy.deepcopy(
            entry.data.get(CONF_LESSONS, [])
        )
        # v2.6.0: sick-day absences. Same deep-copy discipline as lessons —
        # self.absences must stay fully detached from entry.data so an
        # in-place edit can never silently alias into the stored dict
        # (the v2.5.1/v2.5.2 persistence lesson, applied from day one).
        self.absences: list[dict[str, Any]] = get_entry_absences(dict(entry.data))
        # v2.7.2: single-lesson cancellations (Einzelstunden-Ausfall).
        # Same deep-copy discipline — self.cancellations must stay fully
        # detached from entry.data (the v2.5.1/v2.5.2 persistence lesson,
        # applied from day one).
        self.cancellations: list[dict[str, Any]] = get_entry_cancellations(
            dict(entry.data)
        )
        # v2.5.7: backfill deterministic lesson uids for legacy
        # entries so the card can address every lesson uniquely.
        ensure_lesson_uids(self.lessons)
        # Shared holiday data for this entry's federal state (one instance
        # per state — all children in the same state share the API fetch).
        self.holidays: SharedHolidaysCoordinator = get_holidays_coordinator(
            hass, federal_state_from_entry(entry)
        )
        self.holidays.async_setup_with_entry(entry)
        _LOGGER.info("Coordinator init: loaded %d lessons for %s", len(self.lessons), self.child_name)

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self.child_name}",
            update_interval=timedelta(minutes=UPDATE_INTERVAL_MINUTES),
            update_method=self._async_update_data,
        )

    def _refresh_entry_ref(self) -> None:
        """Update self.entry to point to the latest ConfigEntry object."""
        updated = self.hass.config_entries.async_get_entry(self.entry.entry_id)
        if updated is not None:
            self.entry = updated

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data — periodic refresh, reload lessons/absences from config entry."""
        updated = self.hass.config_entries.async_get_entry(self.entry.entry_id)
        if updated is not None:
            self.entry = updated
            # Deep copy — see __init__: never share dicts with entry.data
            self.lessons = copy.deepcopy(updated.data.get(CONF_LESSONS, []))
            ensure_lesson_uids(self.lessons)
            self.absences = get_entry_absences(dict(updated.data))
            self.cancellations = get_entry_cancellations(dict(updated.data))

        # v2.6.0: prune absence entries older than the retention window.
        # Runs on every coordinator refresh (15 min) so entry.data cannot
        # grow forever even when no absence service is ever called.
        today = datetime.now().date()
        pruned, changed = prune_absences(self.absences, today)
        if changed:
            self.absences = pruned
            await self._persist_absences()

        # v2.7.2: same retention pruning for lesson cancellations.
        pruned_c, changed_c = prune_cancellations(self.cancellations, today)
        if changed_c:
            self.cancellations = pruned_c
            await self._persist_cancellations()

        # Refresh holiday data if stale (at most one API request per 24h
        # per federal state — shared between all children in that state).
        # Falls back to the entry-cached periods when the API is offline.
        if await self.holidays.async_ensure_current():
            if self.holidays.dirty:
                self.holidays.persist_into(self.entry)
                self.holidays.dirty = False
                self._refresh_entry_ref()

        return self._build_schedule_data()

    def _build_schedule_data(self) -> dict[str, Any]:
        """Build the schedule data structure for sensors."""
        today = datetime.now()
        tomorrow = today + timedelta(days=1)
        today_date = today.date()
        tomorrow_date = tomorrow.date()

        today_weekday = WEEKDAYS[today.weekday()] if today.weekday() < 5 else None
        tomorrow_weekday = WEEKDAYS[tomorrow.weekday()] if tomorrow.weekday() < 5 else None

        periods = self.holidays.periods
        today_h = day_status(today_date, periods)
        tomorrow_h = day_status(tomorrow_date, periods)

        # v2.7.2: single-lesson cancellations. Concrete-date semantics:
        # - today/tomorrow lessons are annotated with THAT date's cancels
        # - each weekday sensor shows the NEXT occurrence of its weekday
        #   (today counts — a Tuesday sensor on a Tuesday shows today),
        #   annotated with exactly that date's cancellations. The card
        #   uses the *_date metadata to address its cancel service calls,
        #   so backend and card can never disagree about the target day.
        next_dates = {
            day: self._next_date_for_weekday(day, today_date) for day in WEEKDAYS
        }

        # v2.6.0: complete sick-day picture (streak, attest thresholds).
        sick = sick_summary(self.absences, today_date, periods)

        data: dict[str, Any] = {
            "child_name": self.child_name,
            "today": self._get_annotated_lessons_for_date(today_date, today_weekday),
            "tomorrow": self._get_annotated_lessons_for_date(tomorrow_date, tomorrow_weekday),
            "today_weekday": today_weekday,
            "tomorrow_weekday": tomorrow_weekday,
            "today_date": today_date.isoformat(),
            "tomorrow_date": tomorrow_date.isoformat(),
            "last_update": today.isoformat(),
            # Holiday / school-free data (v2.5.0)
            "federal_state": self.holidays.federal_state,
            "today_status": today_h["status"],
            "today_reason": today_h["reason"],
            "today_school_free": today_h["status"] != "school_day",
            "tomorrow_status": tomorrow_h["status"],
            "tomorrow_reason": tomorrow_h["reason"],
            "tomorrow_school_free": tomorrow_h["status"] != "school_day",
            "next_school_day": next_school_day(today_date, periods),
            "next_vacation": next_event(today_date, periods, event_type="vacation"),
            "next_public_holiday": next_event(today_date, periods, event_type="holiday"),
            "holidays_count": len(periods),
            "holidays_last_updated": self.holidays.last_updated_at,
            # v2.7.1: card holiday data from the BACKEND — one data path,
            # always in sync with the school-free logic, survives browser
            # cache clears (fixes "holiday settings lost after update").
            "vacations": vacations_for_card(periods),
            # v2.7.1: distinguishes "user explicitly configured a state"
            # from "default thueringen never touched" — the card uses this
            # to MIGRATE a legacy localStorage choice into the backend on
            # first contact instead of overwriting it with the default.
            "federal_state_configured": CONF_FEDERAL_STATE in self.entry.data,
            # Sick days / absences (v2.6.0)
            "sick_today": sick["sick_today"],
            "sick_tomorrow": sick["sick_tomorrow"],
            "sick_streak": sick["streak"],
            "sick_streak_active_today": sick["streak_active_today"],
            "attest_required": sick["attest_required"],
            "attest_warning": sick["attest_warning"],
            "last_sick_day": sick["last_sick_day"],
            "sick_days_year": sick["sick_days_year"],
            "next_sick_dates": sick["next_sick_dates"],
            "recent_sick_days": sick["recent_sick_days"],
            # v2.7.0: full absence list for the card's editable sick-day
            # manager (the modal list needs every entry, not just 5)
            "sick_entries": [
                {"date": str(e.get("date")), "note": str(e.get("note") or "")}
                for e in self.absences
                if e.get("type") == ABSENCE_TYPE_SICK
            ],
            "absence_count": sum(1 for e in self.absences if e.get("type") == ABSENCE_TYPE_SICK),
            # v2.7.2: lesson cancellations for the card and automations.
            # cancelled_today/cancelled_tomorrow give the per-day lists;
            # upcoming_cancellations feeds the modal list in the card.
            "cancelled_today": [
                {"lesson_number": e["lesson_number"], "note": str(e.get("note") or "")}
                for e in self.cancellations
                if e.get("date") == today_date.isoformat()
            ],
            "cancelled_tomorrow": [
                {"lesson_number": e["lesson_number"], "note": str(e.get("note") or "")}
                for e in self.cancellations
                if e.get("date") == tomorrow_date.isoformat()
            ],
            "upcoming_cancellations": [
                {"date": e["date"], "lesson_number": e["lesson_number"], "note": str(e.get("note") or "")}
                for e in self.cancellations
                if e.get("date", "") >= today_date.isoformat()
            ],
        }

        for day in WEEKDAYS:
            day_date = next_dates[day]
            data[day] = annotate_lessons(
                self._get_lessons_for_day(day), self.cancellations, day_date
            )
            data[f"{day}_date"] = day_date.isoformat()

        _LOGGER.debug("Built schedule: today=%d, monday=%d, total_lessons=%d", len(data["today"]), len(data.get("monday", [])), len(self.lessons))
        return data

    def _get_lessons_for_day(self, weekday: str | None) -> list[dict[str, Any]]:
        """Get all lessons for a given weekday, sorted by lesson number."""
        if weekday is None:
            return []
        day_lessons = [
            {**lesson, CONF_IS_BREAK: lesson.get(CONF_IS_BREAK, False)}
            for lesson in self.lessons
            if lesson.get(CONF_WEEKDAY) == weekday
        ]
        return sorted(day_lessons, key=lambda l: l.get(CONF_LESSON_NUMBER, 0))

    def _next_date_for_weekday(self, weekday: str, today: date) -> date:
        """The concrete date a weekday sensor currently stands for (v2.7.2).

        Today counts: on a Tuesday the tuesday sensor shows today's plan,
        from Wednesday on it shows next week's Tuesday. Used to apply
        date-exact cancellations to the weekday sensors.
        """
        target = WEEKDAYS.index(weekday)  # 0=Mon..4=Fri
        offset = (target - today.weekday()) % 7
        return today + timedelta(days=offset)

    def _get_annotated_lessons_for_date(
        self, day: date, weekday: str | None
    ) -> list[dict[str, Any]]:
        """Lessons for a concrete date, annotated with that date's
        cancellations (v2.7.2)."""
        return annotate_lessons(
            self._get_lessons_for_day(weekday), self.cancellations, day
        )

    async def add_lesson(self, lesson: dict[str, Any]) -> bool:
        """Add a new lesson to the schedule.

        v2.5.7: refuses a duplicate (weekday, lesson_number) slot —
        the card addresses lessons by that pair, so a second entry
        made edits and deletes ambiguous (the edit form showed the
        wrong subject). Every new lesson gets a deterministic
        lesson_uid.
        """
        weekday = lesson.get(CONF_WEEKDAY)
        number = lesson.get(CONF_LESSON_NUMBER)
        if slot_taken(self.lessons, weekday, number):
            _LOGGER.warning(
                "add_lesson refused: slot %s #%s already taken",
                weekday,
                number,
            )
            raise ValueError(
                f"Lesson {weekday} #{number} already exists — edit it instead"
            )
        lesson = {**lesson, CONF_LESSON_UID: lesson_uid_for(weekday, number)}
        self.lessons.append(lesson)
        self._sort_lessons()
        await self._persist_lessons()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info("add_lesson: %s, total now %d", lesson.get("subject"), len(self.lessons))
        return True

    async def remove_lesson(
        self, weekday: str, lesson_number: int, lesson_uid: str | None = None
    ) -> bool:
        """Remove a lesson by weekday and lesson number.

        v2.5.7: removes exactly ONE entry — by lesson_uid when
        provided (unique even in a slot with legacy duplicates),
        otherwise the first slot match. The old behaviour filtered
        ALL matches, silently deleting both duplicates in an
        ambiguous slot.
        """
        if lesson_uid:
            for idx, lesson in enumerate(self.lessons):
                if (
                    lesson.get(CONF_LESSON_UID) == lesson_uid
                    and lesson.get(CONF_WEEKDAY) == weekday
                ):
                    del self.lessons[idx]
                    await self._persist_lessons()
                    self.async_set_updated_data(self._build_schedule_data())
                    return True
        for idx, lesson in enumerate(self.lessons):
            if lesson.get(CONF_WEEKDAY) == weekday and lesson.get(CONF_LESSON_NUMBER) == lesson_number:
                del self.lessons[idx]
                await self._persist_lessons()
                self.async_set_updated_data(self._build_schedule_data())
                return True
        return False

    async def update_lesson(
        self,
        weekday: str,
        lesson_number: int,
        updates: dict[str, Any],
        lesson_uid: str | None = None,
    ) -> bool:
        """Update an existing lesson.

        v2.5.7: addresses the lesson by its unique lesson_uid when
        provided — unique even in a slot that still holds legacy
        duplicates (the "wrong subject in the edit form" bug).
        Falls back to the first (weekday, lesson_number) match for
        callers without a uid.
        """
        if lesson_uid:
            for idx, lesson in enumerate(self.lessons):
                if (
                    lesson.get(CONF_LESSON_UID) == lesson_uid
                    and lesson.get(CONF_WEEKDAY) == weekday
                ):
                    return await self._apply_lesson_update(idx, updates)
        for idx, lesson in enumerate(self.lessons):
            if lesson.get(CONF_WEEKDAY) == weekday and lesson.get(CONF_LESSON_NUMBER) == lesson_number:
                return await self._apply_lesson_update(idx, updates)
        return False

    async def _apply_lesson_update(self, idx: int, updates: dict[str, Any]) -> bool:
        """Shared update core for uid and slot addressing (v2.5.7).

        Replaces the lesson dict instead of mutating it — a fresh
        dict guarantees new_data differs from the previously
        persisted entry.data even if all field values are equal
        (second line of defence behind the deep copy in __init__).
        """
        lesson = self.lessons[idx]
        new_lesson = {**lesson, **updates}
        if new_lesson == lesson:
            # No-op save: every submitted value matches the stored
            # lesson. Nothing changed, nothing to persist — HA's
            # async_update_entry would skip the write anyway
            # (new_data == entry.data). Detect it here so the
            # anomaly guard in _persist_lessons stays reserved for
            # real regressions (v2.5.3).
            _LOGGER.debug(
                "update_lesson: no changes for %s #%s — nothing to persist",
                lesson.get(CONF_WEEKDAY),
                lesson.get(CONF_LESSON_NUMBER),
            )
            return True
        self.lessons[idx] = new_lesson
        self._sort_lessons()
        await self._persist_lessons()
        self.async_set_updated_data(self._build_schedule_data())
        return True

    def get_schedule(self, weekday: str | None = None) -> list[dict[str, Any]] | dict[str, list]:
        """Get the schedule for a specific day or all days."""
        if weekday is not None:
            return self._get_lessons_for_day(weekday)
        return {day: self._get_lessons_for_day(day) for day in WEEKDAYS}

    def _sort_lessons(self) -> None:
        """Sort lessons by weekday then lesson number."""
        self.lessons.sort(
            key=lambda l: (
                WEEKDAYS.index(l[CONF_WEEKDAY]) if l.get(CONF_WEEKDAY) in WEEKDAYS else 5,
                l.get(CONF_LESSON_NUMBER, 0),
            )
        )

    async def _persist_lessons(self) -> None:
        """Persist lessons to the config entry data without triggering a reload."""
        new_data = {**self.entry.data, CONF_LESSONS: copy.deepcopy(self.lessons)}
        # NOTE: reload_on_update was removed in HA 2026.8.x — do NOT pass it.
        changed = self.hass.config_entries.async_update_entry(
            self.entry, data=new_data
        )
        # Update entry reference but keep self.lessons as-is (we just wrote them).
        if not changed:
            # Should be unreachable: update_lesson short-circuits no-op
            # saves before calling this, and the deep copies above keep
            # self.lessons fully detached from entry.data. If this fires
            # right after a real lesson change, the persistence isolation
            # has regressed — the edit would NOT survive a restart
            # (the v2.5.1 bug). ERROR so it is impossible to miss (v2.5.3).
            _LOGGER.error(
                "Persist skipped for %s: lesson data identical to entry data "
                "(%d lessons) — persistence isolation may have regressed, "
                "lesson edits would NOT survive a restart",
                self.child_name,
                len(self.lessons),
            )
        self._refresh_entry_ref()
        _LOGGER.debug("Persisted %d lessons for %s", len(self.lessons), self.child_name)

    # ─── Sick days / absences (v2.6.0) ─────────────────────────────────

    async def mark_sick_day(self, day: date, note: str = "") -> bool:
        """Mark ``day`` as a sick day (idempotent, note upsert).

        The day is stored verbatim — marking yesterday sick today (Nachtrag)
        and marking tomorrow sick today (Vormeldung) both work because the
        date is always explicit, never defaulted to "now".
        """
        new_absences, changed = upsert_absence(self.absences, day, ABSENCE_TYPE_SICK, note)
        if not changed:
            _LOGGER.debug(
                "mark_sick_day: %s for %s unchanged (already marked, same note)",
                day.isoformat(), self.child_name,
            )
            return True
        self.absences = new_absences
        await self._persist_absences()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info(
            "mark_sick_day: %s marked sick for %s (note=%r, total sick days now %d)",
            day.isoformat(), self.child_name, note,
            sum(1 for e in self.absences if e.get("type") == ABSENCE_TYPE_SICK),
        )
        return True

    async def unmark_sick_day(self, day: date) -> bool:
        """Remove the sick mark for ``day``. Returns False when it was not marked."""
        new_absences, removed = remove_absence(self.absences, day, ABSENCE_TYPE_SICK)
        if not removed:
            return False
        self.absences = new_absences
        await self._persist_absences()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info(
            "unmark_sick_day: %s unmarked for %s",
            day.isoformat(), self.child_name,
        )
        return True

    async def mark_sick_range(self, start: date, end: date, note: str = "") -> int:
        """Mark ``start..end`` (inclusive) as sick days (v2.7.0).

        Returns the number of days actually added/updated. Raises
        ValueError (translated by the service handler) when the range is
        invalid — the absence list stays untouched then.
        """
        new_absences, changed, error = mark_sick_range(self.absences, start, end, note)
        if error is not None:
            raise ValueError(error)
        if changed == 0:
            _LOGGER.debug(
                "mark_sick_range: %s..%s for %s unchanged (all days already marked, same note)",
                start.isoformat(), end.isoformat(), self.child_name,
            )
            return 0
        self.absences = new_absences
        await self._persist_absences()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info(
            "mark_sick_range: %s..%s marked sick for %s (%d days, note=%r)",
            start.isoformat(), end.isoformat(), self.child_name, changed, note,
        )
        return changed

    async def update_sick_day(self, day: date, note: str) -> bool:
        """Update the note of an existing sick entry (v2.7.0).

        Kept separate from mark_sick_day: editing must NEVER create an
        entry that does not exist (an edit on a deleted row would silently
        resurrect it). Returns False when ``day`` is not marked sick.
        """
        existing = [
            e for e in self.absences
            if e.get("date") == day.isoformat() and e.get("type") == ABSENCE_TYPE_SICK
        ]
        if not existing:
            return False
        if str(existing[0].get("note") or "") == str(note or ""):
            return True  # no-op edit — already has this note
        new_absences, _ = update_absence_note(self.absences, day, note)
        self.absences = new_absences
        await self._persist_absences()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info(
            "update_sick_day: note updated for %s (%s): %r",
            day.isoformat(), self.child_name, note,
        )
        return True

    async def _persist_absences(self) -> None:
        """Persist absences to the config entry data (same discipline as lessons).

        Same isolation guarantees as _persist_lessons: a fresh dict built
        from entry.data so async_update_entry always sees a real change,
        never an aliasing no-op (the v2.5.2 lesson).
        """
        new_data = {
            **self.entry.data,
            CONF_ABSENCES: copy.deepcopy(self.absences),
        }
        self.hass.config_entries.async_update_entry(self.entry, data=new_data)
        self._refresh_entry_ref()
        _LOGGER.debug(
            "Persisted %d absences for %s", len(self.absences), self.child_name
        )

    # ─── Lesson cancellations (v2.7.2) ─────────────────────────────────

    async def mark_lesson_cancelled(
        self, day: date, lesson_number: int, note: str = ""
    ) -> bool:
        """Mark a single lesson occurrence as cancelled (v2.7.2).

        Idempotent: re-marking only updates the note. The weekly plan is
        never touched — the cancellation lives on its concrete date.
        """
        new_cancellations, changed = upsert_cancellation(
            self.cancellations, day, lesson_number, note
        )
        if not changed:
            _LOGGER.debug(
                "mark_lesson_cancelled: %s #%s for %s unchanged (already cancelled, same note)",
                day.isoformat(), lesson_number, self.child_name,
            )
            return True
        self.cancellations = new_cancellations
        await self._persist_cancellations()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info(
            "mark_lesson_cancelled: %s #%s cancelled for %s (note=%r, total cancellations now %d)",
            day.isoformat(), lesson_number, self.child_name, note,
            len(self.cancellations),
        )
        return True

    async def unmark_lesson_cancelled(
        self, day: date, lesson_number: int
    ) -> bool:
        """Remove a lesson cancellation. Returns False when there was none."""
        new_cancellations, removed = remove_cancellation(
            self.cancellations, day, lesson_number
        )
        if not removed:
            return False
        self.cancellations = new_cancellations
        await self._persist_cancellations()
        self.async_set_updated_data(self._build_schedule_data())
        _LOGGER.info(
            "unmark_lesson_cancelled: %s #%s restored for %s",
            day.isoformat(), lesson_number, self.child_name,
        )
        return True

    async def _persist_cancellations(self) -> None:
        """Persist cancellations to the config entry data (same discipline)."""
        new_data = {
            **self.entry.data,
            CONF_LESSON_CANCELLATIONS: copy.deepcopy(self.cancellations),
        }
        self.hass.config_entries.async_update_entry(self.entry, data=new_data)
        self._refresh_entry_ref()
        _LOGGER.debug(
            "Persisted %d cancellations for %s",
            len(self.cancellations), self.child_name,
        )