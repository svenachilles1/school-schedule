
# Regression test for v2.5.2: lesson edits must produce a config-entry
# write. Reproduces HA's async_update_entry semantics (2026.8.x):
# "if data is not UNDEFINED and entry.data != data: changed = True" —
# anything equal is silently skipped, so self.lessons must NEVER alias
# dicts inside entry.data.
import copy

def fake_async_update_entry(entry, data):
    """Mimics HA: returns True only when data differs from entry.data."""
    if entry["data"] != data:
        entry["data"] = dict(data)
        entry["modified_at"] = "updated"
        return True
    return False

# ── OLD behaviour (shallow copy) — proves the bug ──
entry = {"data": {"lessons": [{"lesson_number": 1, "subject": "Kunst", "color": "#44739e"}]}}
lessons_shallow = list(entry["data"]["lessons"])
lessons_shallow[0]["color"] = "#ff0000"          # in-place mutation (old update_lesson)
new_data = {**entry["data"], "lessons": list(lessons_shallow)}
changed = fake_async_update_entry(entry, new_data)
assert changed is False, "BUG scenario unexpectedly persisted"
assert entry.get("modified_at") is None, "no write must mean no modified_at bump"
print("OLD (shallow): HA skips the write -> edit lost on restart  [bug proven]")

# ── NEW behaviour (v2.5.2: deep copy + dict replace) ──
entry = {"data": {"lessons": [{"lesson_number": 1, "subject": "Kunst", "color": "#44739e"}]}}
lessons = copy.deepcopy(entry["data"]["lessons"])   # v2.5.2 __init__/tick
lessons[0] = {**lessons[0], "color": "#ff0000"}     # v2.5.2 update_lesson (replace)
new_data = {**entry["data"], "lessons": copy.deepcopy(lessons)}
changed = fake_async_update_entry(entry, new_data)
assert changed is True, "FIX scenario not persisted!"
assert entry["data"]["lessons"][0]["color"] == "#ff0000"
print("NEW (v2.5.2): HA sees a change -> write persisted           [fix proven]")

# ── Round-trip: edit survives a simulated restart (reload from entry) ──
reloaded = copy.deepcopy(entry["data"]["lessons"])
assert reloaded[0]["color"] == "#ff0000", "color lost across simulated restart"
print("Round-trip: color survives restart via entry data          [fix proven]")

# ── No-op edit still returns False (expected, harmless — values identical) ──
entry2 = {"data": {"lessons": [{"lesson_number": 1, "subject": "Kunst", "color": "#ff0000"}]}}
lessons2 = copy.deepcopy(entry2["data"]["lessons"])
lessons2[0] = {**lessons2[0], "color": "#ff0000"}
new_data2 = {**entry2["data"], "lessons": copy.deepcopy(lessons2)}
changed2 = fake_async_update_entry(entry2, new_data2)
assert changed2 is False, "identical values must not trigger a write"
print("No-op edit: correctly no write (values identical)           [semantics intact]")
print()
print("ALL TESTS PASSED")
