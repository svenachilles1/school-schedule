#!/usr/bin/env python3
"""Icon existence guard: every mdi: icon used by the card must be in the
verified MDI allowlist (each entry proven against @mdi/js 7.4.47).

Prevents icons that do not exist in the MDI set (v2.8.0 fix: the day view
toggle used 'mdi:calendar-day' which is NOT part of MDI — the button rendered
text-only in Home Assistant). When this test fails: verify the new icon exists
(https://pictogrammers.com/docs/library/mdi/ or @mdi/js), then add it here.
"""
import os
import re

ALLOWED = {
    "mdi:alert", "mdi:alert-circle", "mdi:arrow-left", "mdi:beach", "mdi:bus-school",
    "mdi:calendar-check", "mdi:calendar-range", "mdi:calendar-remove",
    "mdi:calendar-remove-outline", "mdi:calendar-today", "mdi:calendar-week",
    "mdi:certificate", "mdi:check", "mdi:check-circle", "mdi:close", "mdi:coffee",
    "mdi:coffee-off", "mdi:delete", "mdi:pencil", "mdi:plus", "mdi:school",
    "mdi:thermometer", "mdi:trash-can", "mdi:weather-sunset",
}

FILES = [
    "school-schedule-card.js",
    "custom_components/school_schedule/school-schedule-card.js",
]


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    failed = False
    for rel in FILES:
        path = os.path.join(here, rel)
        with open(path, encoding="utf-8") as f:
            src = f.read()
        icons = set(re.findall(r"mdi:[a-z0-9-]+", src))
        unknown = icons - ALLOWED
        if unknown:
            print("FAIL {}: icons NOT in the verified MDI allowlist: {}".format(rel, sorted(unknown)))
            print("     -> verify the icon exists in MDI first, then add it to ALLOWED")
            failed = True
        else:
            print("OK   {}: {} icons, all in the verified MDI allowlist".format(rel, len(icons)))
    if failed:
        raise SystemExit(1)
    print("ALL ICON EXISTENCE CHECKS PASSED ✅")


if __name__ == "__main__":
    main()
