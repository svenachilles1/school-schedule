"""Unit tests for date_exception_logic (v2.7.3 — Datum-basierte Ausnahmen).

Pure-logic tests, no Home Assistant imports — same pattern as
test_cancellation_logic / test_absence_logic. Run directly:
    python3 tests/test_date_exception_logic.py
"""
from __future__ import annotations

import os
import sys
import types
from datetime import date

# Import WITHOUT executing school_schedule/__init__.py (HA imports) —
# same stub-package pattern as test_cancellation_logic.py.
_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")
if "school_schedule" not in sys.modules:
    _pkg = types.ModuleType("school_schedule")
    _pkg.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = _pkg

from school_schedule.date_exception_logic import (  # noqa: E402
    annotate_with_exceptions,
    day_exception,
    effective_cancellations,
    effective_day_status,
    exception_cancellation_entries,
    exception_reason,
    free_exception_dates,
    get_entry_exceptions,
    is_day_fully_free,
    mark_exception_range,
    next_school_day_with_exceptions,
    normalise_exceptions,
    prune_exceptions,
    remove_exception,
    upsert_exception,
)
from school_schedule.holiday_logic import (  # noqa: E402
    STATUS_PUBLIC_HOLIDAY,
    STATUS_SCHOOL_DAY,
    STATUS_VACATION,
    STATUS_WEEKEND,
    day_status,
)
from school_schedule.const import (  # noqa: E402
    STATUS_DATE_EXCEPTION,
)

PASSED = 0
FAILED = 0


def check(name, condition, detail=""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  ✅ {name}")
    else:
        FAILED += 1
        print(f"  ❌ {name} {detail}")


def make_lesson(number, subject="Test", weekday="monday"):
    return {
        "weekday": weekday,
        "lesson_number": number,
        "subject": subject,
        "start_time": "08:00",
        "end_time": "08:45",
    }


print("=== normalise_exceptions ===")
n = normalise_exceptions([
    {"date": "2026-10-15", "exception_type": "free", "note": "Klassenfahrt"},
    {"date": "bogus", "exception_type": "free"},                       # unparseable date -> drop
    {"date": "2026-10-16", "exception_type": "unknown"},               # unknown type -> drop
    {"date": "2026-10-16", "exception_type": "partial"},               # partial without until -> drop
    {"date": "2026-10-17", "exception_type": "partial", "until_lesson": 4},
    {"date": "2026-10-17", "exception_type": "partial", "until_lesson": 99},  # >12 -> drop
    {"date": "2026-10-18", "exception_type": "partial", "until_lesson": "2"},  # str coerce
    {"date": "2026-10-15", "exception_type": "free", "note": "dup"},   # duplicate date
    {"date": "2026-10-19", "exception_type": "partial", "note": "h", "until_lesson": 3, "extra": 1},
])
check("drops malformed entries", len(n) == 4, f"got {len(n)}")
check("free keeps no until_lesson", n[0]["until_lesson"] is None)
check("partial int coercion", n[1]["until_lesson"] == 4)
check("str until coerced", n[2]["until_lesson"] == 2)
check("first occurrence wins on dup", n[0]["note"] == "Klassenfahrt")
check("sorted ascending", [e["date"] for e in n] == sorted(e["date"] for e in n))

# free wins over duplicate partial
n2 = normalise_exceptions([
    {"date": "2026-10-15", "exception_type": "partial", "until_lesson": 3},
    {"date": "2026-10-15", "exception_type": "free", "note": "Klassenfahrt"},
])
check("free beats duplicate partial", len(n2) == 1 and n2[0]["exception_type"] == "free")
n3 = normalise_exceptions([
    {"date": "2026-10-15", "exception_type": "free", "note": "Klassenfahrt"},
    {"date": "2026-10-15", "exception_type": "partial", "until_lesson": 3},
])
check("free wins even when first", len(n3) == 1 and n3[0]["exception_type"] == "free")
check("None input -> empty", normalise_exceptions(None) == [])

print("=== prune_exceptions ===")
today = date(2026, 10, 8)
excs = normalise_exceptions([
    {"date": "2025-01-01", "exception_type": "free"},   # >365 days old
    {"date": "2026-10-15", "exception_type": "free"},
])
pruned, changed = prune_exceptions(excs, today)
check("prunes old entries", changed is True and len(pruned) == 1)
pruned2, changed2 = prune_exceptions(pruned, today)
check("no-op prune reports no change", changed2 is False)

print("=== day_exception / is_day_fully_free / free_exception_dates ===")
excs = normalise_exceptions([
    {"date": "2026-10-15", "exception_type": "free", "note": "Klassenfahrt"},
    {"date": "2026-10-16", "exception_type": "partial", "until_lesson": 4},
])
check("finds entry by date", day_exception(excs, date(2026, 10, 15))["note"] == "Klassenfahrt")
check("missing day -> None", day_exception(excs, date(2026, 10, 20)) is None)
check("free detected", is_day_fully_free(excs, date(2026, 10, 15)) is True)
check("partial is not fully free", is_day_fully_free(excs, date(2026, 10, 16)) is False)
check("free_exception_dates", free_exception_dates(excs) == {"2026-10-15"})

print("=== exception_reason ===")
check("note wins", exception_reason(excs[0]) == "Klassenfahrt")
check("free fallback", exception_reason({"exception_type": "free", "note": ""}) == "Kein Unterricht")
check("partial fallback", exception_reason({"exception_type": "partial", "note": "", "until_lesson": 4}) == "Halbtag bis Stunde 4")
check("None -> empty", exception_reason(None) == "")

print("=== effective_day_status (priority) ===")
periods = [{
    "name": "Herbstferien",
    "starts_on": date(2026, 10, 12),
    "ends_on": date(2026, 10, 18),
    "is_public_holiday": False,
    "is_school_vacation": True,
}]
# free exception beats vacation
st = effective_day_status(date(2026, 10, 13), periods, excs_empty := normalise_exceptions([
    {"date": "2026-10-13", "exception_type": "free", "note": "Klassenfahrt trotz Ferienwoche"},
]))
check("free exception beats vacation", st["status"] == STATUS_DATE_EXCEPTION and st["reason"] == "Klassenfahrt trotz Ferienwoche")
# partial does NOT change day status
st2 = effective_day_status(date(2026, 10, 13), periods, normalise_exceptions([
    {"date": "2026-10-13", "exception_type": "partial", "until_lesson": 2},
]))
check("partial keeps vacation status", st2["status"] == STATUS_VACATION)
# no exception -> plain day_status (weekend)
st3 = effective_day_status(date(2026, 10, 10), periods, [])
check("no exception -> weekend passthrough", st3["status"] == STATUS_WEEKEND)
# school day untouched
st4 = effective_day_status(date(2026, 10, 9), periods, [])
check("school day untouched", st4["status"] == STATUS_SCHOOL_DAY)

print("=== next_school_day_with_exceptions ===")
# 08.10.2026 = Thursday. 09.10 Fri school day.
nsd = next_school_day_with_exceptions(date(2026, 10, 8), periods, [])
check("next school day without exceptions", nsd is not None and nsd["date"] == "2026-10-09")
# Friday 09.10 is free (Klassenfahrt) -> next must be Monday 19.10 (after vacation)
excs2 = normalise_exceptions([{"date": "2026-10-09", "exception_type": "free"}])
nsd2 = next_school_day_with_exceptions(date(2026, 10, 8), periods, excs2)
check("free exception skipped in next_school_day", nsd2 is not None and nsd2["date"] == "2026-10-19", f"got {nsd2}")

print("=== exception_cancellation_entries / effective_cancellations ===")
exc_free = {"date": "2026-10-15", "exception_type": "free", "note": "Klassenfahrt", "until_lesson": None}
entries = exception_cancellation_entries(exc_free, [1, 2, 3])
check("free cancels all lessons", [e["lesson_number"] for e in entries] == [1, 2, 3])
check("synthetic entries carry note", all(e["note"] == "Klassenfahrt" for e in entries))
exc_partial = {"date": "2026-10-16", "exception_type": "partial", "until_lesson": 4, "note": ""}
entries2 = exception_cancellation_entries(exc_partial, [1, 2, 3, 4, 5, 6])
check("partial cancels only after until", [e["lesson_number"] for e in entries2] == [5, 6])

# explicit cancellation wins over synthetic
cancels = [{"date": "2026-10-15", "lesson_number": 2, "note": "Lehrer krank (explizit)"}]
merged = effective_cancellations(cancels, normalise_exceptions([exc_free]), date(2026, 10, 15), [1, 2, 3])
by_num = {e["lesson_number"]: e for e in merged if e["date"] == "2026-10-15"}
check("explicit cancel kept", by_num[2]["note"] == "Lehrer krank (explizit)")
check("synthetic added for other slots", by_num[1]["note"] == "Klassenfahrt" and by_num[3]["note"] == "Klassenfahrt")
check("no duplicate entry for slot 2", sum(1 for e in merged if e["date"] == "2026-10-15" and e["lesson_number"] == 2) == 1)

print("=== annotate_with_exceptions ===")
lessons = [make_lesson(1, "Mathe"), make_lesson(2, "Sport"), make_lesson(3, "Kunst")]
# no exception -> identical to plain annotate
plain = annotate_with_exceptions(lessons, [], [], date(2026, 10, 15))
check("no exception -> no cancels", all(not l["cancelled"] for l in plain))
# free day -> all cancelled
ann = annotate_with_exceptions(lessons, [], normalise_exceptions([exc_free]), date(2026, 10, 15))
check("free day cancels everything", all(l["cancelled"] for l in ann))
check("free day note propagates", ann[0]["cancelled_note"] == "Klassenfahrt")
# partial day -> only after until (until_lesson=2: lessons 1-2 take place, 3 falls away)
exc_partial2 = {"date": "2026-10-16", "exception_type": "partial", "until_lesson": 2, "note": ""}
ann2 = annotate_with_exceptions(lessons, [], normalise_exceptions([exc_partial2]), date(2026, 10, 16))
check("partial keeps first lessons", not ann2[0]["cancelled"] and not ann2[1]["cancelled"])
check("partial cancels rest", ann2[2]["cancelled"])
# input lessons untouched (new dicts, no mutation)
check("input not mutated", "cancelled" not in lessons[0])

print("=== upsert_exception / mark_exception_range / remove_exception ===")
base = normalise_exceptions([{"date": "2026-10-15", "exception_type": "free", "note": "A"}])
new_list, changed = upsert_exception(base, date(2026, 10, 15), "free", "B")
check("upsert updates note", changed and new_list[0]["note"] == "B")
new_list2, changed2 = upsert_exception(new_list, date(2026, 10, 15), "free", "B")
check("idempotent upsert", not changed2)
new_list3, changed3 = upsert_exception(base, date(2026, 10, 20), "partial", "Z", 3)
check("upsert adds new day", changed3 and any(e["date"] == "2026-10-20" and e["until_lesson"] == 3 for e in new_list3))
# type switch free -> partial keeps one entry
new_list4, _ = upsert_exception(base, date(2026, 10, 15), "partial", "", 2)
check("type switch keeps single entry", len(new_list4) == 1 and new_list4[0]["exception_type"] == "partial")

rng, count, err = mark_exception_range([], date(2026, 10, 12), date(2026, 10, 15), "free", "Klassenfahrt")
check("range marks every day", err is None and count == 4 and len(rng) == 4)
_, count2, err2 = mark_exception_range(rng, date(2026, 10, 12), date(2026, 10, 15), "free", "Klassenfahrt")
check("idempotent range", err2 is None and count2 == 0)
_, _, err3 = mark_exception_range([], date(2026, 10, 15), date(2026, 10, 12), "free")
check("swapped range refused", err3 == "start_after_end")
_, _, err4 = mark_exception_range([], date(2026, 10, 12), date(2027, 10, 15), "free")
check("too long range refused", err4 == "range_too_long")
check("refused range leaves list untouched", True)  # atomicity covered by err returns

removed_list, removed = remove_exception(normalise_exceptions([{"date": "2026-10-15", "exception_type": "free"}]), date(2026, 10, 15))
check("remove works", removed and removed_list == [])
_, removed2 = remove_exception([], date(2026, 10, 15))
check("remove missing -> False", removed2 is False)

print("=== get_entry_exceptions (config entry data) ===")
data = {"date_exceptions": [{"date": "2026-10-15", "exception_type": "free", "note": "x"}]}
check("reads from entry data", get_entry_exceptions(data)[0]["note"] == "x")
check("missing key -> empty", get_entry_exceptions({}) == [])

print("=== calendar interplay: effective day status used by build_events ===")
# Regression guard: vacation + partial exception -> status stays vacation
# (partial only derives cancellations, never flips the day status)
st5 = effective_day_status(date(2026, 10, 13), periods, normalise_exceptions([
    {"date": "2026-10-13", "exception_type": "partial", "until_lesson": 1},
]))
check("partial inside vacation stays vacation", st5["status"] == STATUS_VACATION)

# public holiday priority unaffected
periods_h = [{
    "name": "Weltkindertag",
    "starts_on": date(2026, 10, 9),
    "ends_on": date(2026, 10, 9),
    "is_public_holiday": True,
    "is_school_vacation": False,
}]
st6 = effective_day_status(date(2026, 10, 9), periods_h, [])
check("public holiday passthrough", st6["status"] == STATUS_PUBLIC_HOLIDAY)

print()
print(f"RESULT: {PASSED} passed, {FAILED} failed")
sys.exit(0 if FAILED == 0 else 1)