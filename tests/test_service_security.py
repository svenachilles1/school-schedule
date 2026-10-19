"""Unit tests for v2.7.5 security hardening (Frenck HACS review #10564).

Validates:
  A) the _hex_color service validator rejects XSS style payloads
  B) the service schemas actually wire _hex_color / cv.icon
     (full check when voluptuous is importable, structural check otherwise)
  C) both registration paths (__init__.py + services.py) are consistent

Run locally:  python3 tests/test_service_security.py
Run in CI:    invoked by .github/workflows/tests.yaml (voluptuous optional)
"""
from __future__ import annotations

import importlib
import os
import sys
import types

_PKG_DIR = os.path.join(os.path.dirname(__file__), "..", "custom_components", "school_schedule")

# ─── voluptuous: use the real package when available, else a stub ─────
try:
    import voluptuous as _vol  # noqa: F401
    HAVE_VOL = True
except ImportError:
    HAVE_VOL = False

    class _Invalid(Exception):
        pass

    class _Marker:
        def __init__(self, key, default=None, **_kw):
            self.key = key
            self.default = default

    class _Schema:
        def __init__(self, schema):
            self.schema = schema

    class _VolStub(types.ModuleType):
        Invalid = _Invalid
        Schema = _Schema
        Required = _Marker
        Optional = _Marker
        Boolean = bool

    _vol = _VolStub("voluptuous")
    # Lambdas must be instance attributes — as class attributes of the
    # module subclass they would bind `self` on attribute access.
    _vol.In = lambda value: value
    _vol.Coerce = lambda value: value
    _vol.Any = lambda *a, **k: None
    _vol.All = lambda *a, **k: (a[0] if a else None)
    _vol.Range = lambda *a, **k: None
    sys.modules["voluptuous"] = _vol

_InvalidExc = _vol.Invalid


def _mk_module(name: str, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod


# ─── Home Assistant stubs (import-time only; nothing is executed) ──────
if "homeassistant" not in sys.modules:
    def _cv_icon(value):
        # Mirrors cv.icon closely enough for schema tests: requires
        # a "prefix:name" reference. Payloads containing ":" pass the
        # schema — the card-side _escAttr is the defense (see
        # tests/test_card_xss_v275.js E5), exactly as in upstream HA.
        if ":" not in str(value):
            raise _InvalidExc(f"Invalid icon {value!r}")
        return str(value)

    ha = types.ModuleType("homeassistant")
    ha_core = _mk_module(
        "homeassistant.core",
        HomeAssistant=object, ServiceCall=object, ServiceResponse=dict,
        SupportsResponse=_mk_module("SupportsResponse", ONLY="only", OPTIONAL="optional"),
        callback=lambda f: f,
    )
    ha.config_entries = _mk_module("homeassistant.config_entries", ConfigEntry=object)
    ha.exceptions = _mk_module("homeassistant.exceptions", HomeAssistantError=Exception)
    ha_helpers = types.ModuleType("homeassistant.helpers")
    ha_helpers.config_validation = _mk_module(
        "homeassistant.helpers.config_validation",
        string=str, icon=_cv_icon, boolean=bool,
    )
    ha_helpers.update_coordinator = _mk_module(
        "homeassistant.helpers.update_coordinator", DataUpdateCoordinator=object,
    )
    ha_helpers.aiohttp_client = _mk_module(
        "homeassistant.helpers.aiohttp_client", async_get_clientsession=lambda hass: None,
    )
    ha_components = types.ModuleType("homeassistant.components")
    ha_components.http = _mk_module("homeassistant.components.http", StaticPathConfig=object)
    ha_components.lovelace = types.ModuleType("homeassistant.components.lovelace")
    ha_components.lovelace.resources = _mk_module(
        "homeassistant.components.lovelace.resources", ResourceStorageCollection=object,
    )
    ha.core, ha.helpers, ha.components = ha_core, ha_helpers, ha_components
    sys.modules["homeassistant"] = ha
    sys.modules["homeassistant.core"] = ha_core
    sys.modules["homeassistant.config_entries"] = ha.config_entries
    sys.modules["homeassistant.exceptions"] = ha.exceptions
    sys.modules["homeassistant.helpers"] = ha_helpers
    sys.modules["homeassistant.helpers.config_validation"] = ha_helpers.config_validation
    sys.modules["homeassistant.helpers.update_coordinator"] = ha_helpers.update_coordinator
    sys.modules["homeassistant.helpers.aiohttp_client"] = ha_helpers.aiohttp_client
    sys.modules["homeassistant.components"] = ha_components
    sys.modules["homeassistant.components.http"] = ha_components.http
    sys.modules["homeassistant.components.lovelace"] = ha_components.lovelace
    sys.modules["homeassistant.components.lovelace.resources"] = ha_components.lovelace.resources

# ─── import the integration: load __init__.py explicitly ───────────────
# The stub-package trick (test_holiday_logic.py) skips __init__.py, but we
# need its validators and schemas — load the file directly under the
# package name so its relative imports resolve through __path__.
if "school_schedule" not in sys.modules:
    import importlib.util

    _init_path = os.path.join(_PKG_DIR, "__init__.py")
    _spec = importlib.util.spec_from_file_location("school_schedule", _init_path)
    ss = importlib.util.module_from_spec(_spec)
    ss.__path__ = [os.path.abspath(_PKG_DIR)]
    sys.modules["school_schedule"] = ss
    _spec.loader.exec_module(ss)                            # __init__.py

svc = importlib.import_module("school_schedule.services")   # services.py

# ─── tiny runner ──────────────────────────────────────────────────────
pass_count = 0
fail_count = 0
failures: list[str] = []


def check(name, cond):
    global pass_count, fail_count
    if cond:
        pass_count += 1
    else:
        fail_count += 1
        failures.append(name)
        print(f"FAIL: {name}")


# ═══ Suite A: _hex_color validator (always runs) ═══════════════════════
GOOD_COLORS = ["#44739e", "#ABC123", "#000000", "#ffffff", " #ff9800 "]
BAD_COLORS = [
    "red", "", "#12345", "#1234567", "javascript:alert(1)", "var(--primary-color)",
    "#12g45z", "rgb(1,2,3)", "#44739e;--c:red", '#44739e;background:url(x)',
    "url(javascript:alert(1))", "expression(alert(1))", "#44739e\" onmouseover=\"x",
]

for c in GOOD_COLORS:
    try:
        out = ss._hex_color(c)
        check(f"A _hex_color accepts {c!r}", out == c.strip())
    except _InvalidExc:
        check(f"A _hex_color accepts {c!r}", False)

for c in BAD_COLORS:
    try:
        ss._hex_color(c)
        check(f"A _hex_color rejects {c!r}", False)
    except _InvalidExc:
        check(f"A _hex_color rejects {c!r}", True)

# services.py has the same validator (duplicate path stays consistent)
for c in BAD_COLORS[:3]:
    try:
        svc._hex_color(c)
        check(f"A services._hex_color rejects {c!r}", False)
    except _InvalidExc:
        check(f"A services._hex_color rejects {c!r}", True)

# ═══ Suite B: full schema wiring (only with real voluptuous) ═════════
if HAVE_VOL:
    good = {
        "child_name": "Michelle", "weekday": "monday", "lesson_number": 1,
        "subject": "Mathe", "start_time": "08:00", "end_time": "08:45",
        "color": "#44739e", "icon": "mdi:school",
    }
    try:
        ss.ADD_LESSON_SCHEMA(good)
        check("B ADD_LESSON_SCHEMA accepts a valid lesson", True)
    except _InvalidExc:
        check("B ADD_LESSON_SCHEMA accepts a valid lesson", False)

    for bad_color in ["#44739e;--c:red", "javascript:alert(1)", "red"]:
        try:
            ss.ADD_LESSON_SCHEMA({**good, "color": bad_color})
            check(f"B ADD_LESSON_SCHEMA rejects color {bad_color!r}", False)
        except _InvalidExc:
            check(f"B ADD_LESSON_SCHEMA rejects color {bad_color!r}", True)

    try:
        ss.UPDATE_LESSON_SCHEMA({**good, "lesson_uid": None, "color": "#12345"})
        check("B UPDATE_LESSON_SCHEMA rejects short hex color", False)
    except _InvalidExc:
        check("B UPDATE_LESSON_SCHEMA rejects short hex color", True)

    try:
        ss.ADD_LESSON_SCHEMA({**good, "icon": "school"})
        check("B ADD_LESSON_SCHEMA rejects icon without prefix", False)
    except _InvalidExc:
        check("B ADD_LESSON_SCHEMA rejects icon without prefix", True)

    # Icon payloads that pass the schema (":" present) are neutralized
    # by the card-side _escAttr — proven in tests/test_card_xss_v275.js.
    try:
        ss.ADD_LESSON_SCHEMA({**good, "icon": 'mdi:school" onerror="alert(1)'})
        check("B schema lets cv.icon-shaped payloads through (card _escAttr is the defense)", True)
    except _InvalidExc:
        check("B schema lets cv.icon-shaped payloads through (card _escAttr is the defense)", False)
else:
    print("NOTE: voluptuous not available — Suite B (full schema wiring) skipped;")
    print("      run locally with a voluptuous-enabled interpreter for the full proof.")

# ═══ Suite C: structural consistency (always runs) ════════════════════
init_src = open(os.path.join(_PKG_DIR, "__init__.py"), encoding="utf-8").read()
svc_src = open(os.path.join(_PKG_DIR, "services.py"), encoding="utf-8").read()
check("C __init__.py wires color to _hex_color (ADD)",
      'vol.Optional("color", default=DEFAULT_COLOR): _hex_color' in init_src)
check("C __init__.py wires icon to cv.icon (ADD)",
      'vol.Optional("icon", default=DEFAULT_ICON): cv.icon' in init_src)
check("C __init__.py wires color to _hex_color (UPDATE)",
      'vol.Optional("color"): _hex_color' in init_src)
check("C __init__.py wires icon to cv.icon (UPDATE)",
      'vol.Optional("icon"): cv.icon' in init_src)
check("C services.py wires color to _hex_color (ADD)",
      "vol.Optional(ATTR_COLOR, default=DEFAULT_COLOR): _hex_color" in svc_src)
check("C services.py wires icon to cv.icon (ADD)",
      "vol.Optional(ATTR_ICON, default=DEFAULT_ICON): cv.icon" in svc_src)
check("C __init__.py registers get_schedule with supports_response",
      "supports_response=SupportsResponse.ONLY" in init_src)
check("C services.py registers get_schedule with supports_response",
      "supports_response=SupportsResponse.ONLY" in svc_src)
check("C __init__.py handle_get_schedule returns ServiceResponse",
      "async def handle_get_schedule(call: ServiceCall) -> ServiceResponse" in init_src)
check("C services.py handle_get_schedule returns ServiceResponse",
      "async def handle_get_schedule(call: ServiceCall) -> ServiceResponse" in svc_src)

# ═══ summary ═══════════════════════════════════════════════════════════
print(f"\nservice security tests: {pass_count} passed, {fail_count} failed"
      f" (voluptuous={'real' if HAVE_VOL else 'stub'})")
if fail_count:
    print("FAILED checks:\n  " + "\n  ".join(failures))
    sys.exit(1)
print("ALL SERVICE SECURITY CHECKS PASSED ✅")