# School Schedule

A custom Home Assistant integration for managing school schedules with an Ultra Premium Lovelace card.

![School Schedule Card](brand/icon.png)

## Features

### Integration
- **Multi-child support:** Each child gets their own schedule with 7 sensors (Today, Tomorrow, Monday–Friday)
- **Config Flow:** Set up via Home Assistant UI — no YAML needed
- **Services:** `add_lesson`, `remove_lesson`, `update_lesson`, `get_schedule`
- **Local push:** Sensors update in real-time when lessons are modified
- **Break/Pause support:** Mark lessons as breaks — displayed differently (no room/teacher, dashed border, coffee icon) with time info
- **Apply to all days:** When adding a lesson or break, optionally apply it to all weekdays (Mon–Fri) at once
- **Holiday calendar:** German school holidays (mehr-schulferien.de) per federal state with countdown — beach button
- **Visual card editor:** Height/width configurable via the dashboard editor (no YAML)
- **Automatic card setup:** The integration registers the Lovelace card resource automatically (browser_mod-style) — no manual `www/` copy, no manual resource registration, automatic cache busting on updates

### Lovelace Card (Ultra Premium)
- **3D Glassmorphism** design with animated aurora background
- **Hero section:** Shows currently running lesson (JETZT) and next lesson (ALS NÄCHSTES) with pulsing indicator
- **Day view toggle:** Switch between week view (5-column grid) and day view (single column, larger cards) via button
- **Inline management:** Add, edit, and delete lessons directly from the card — no need to open the config flow
  - **Add:** "+" button per day opens inline form
  - **Edit:** Pencil icon on each lesson
  - **Delete:** Trash icon with confirmation dialog
- **Color-coded lessons:** Each lesson has a custom color and icon
- **Break/Pause rendering:** Breaks shown with dashed border, italic subject, coffee icon — no room/teacher displayed
- **Break/Pause form:** Checkbox "Als Pause markieren" + "Auf alle Tage anwenden" in the inline add form. Room/teacher auto-disabled for breaks
- **Holiday calendar:** German school holidays from mehr-schulferien.de — pick your federal state, see current/upcoming holidays with countdown (stored per browser)
- **Responsive auto-fill columns:** Days flow into the next row automatically on narrow cards — no scrolling
- **Visual editor:** Set the card's height and width via the dashboard visual editor
- **Hero section:** Currently running lesson (JETZT) and next lesson (ALS NÄCHSTES)
- **Responsive:** Adapts to mobile and desktop

## Installation

### Via HACS (recommended)

1. Open HACS in your Home Assistant instance
2. Go to **Integrations** → **+ Explore & Download Repositories**
3. Search for "School Schedule" and click **Download**
4. Restart Home Assistant
5. Go to **Settings** → **Devices & Services** → **Add Integration**
6. Search for "School Schedule" and enter the child's name

That's it — the Lovelace card is set up automatically:

- The integration serves the bundled card from its own directory and registers the dashboard resource for you (URL: `/school_schedule.js?v=<version>`)
- No manual copy to `<config>/www/`, no manual resource registration
- If you previously set up the card manually, the old resource is migrated to the new URL automatically — just reload your browser after the update
- On every HACS update, the version parameter busts the browser cache automatically

### Manual

1. Download the latest release from the [releases page](https://github.com/svenachilles1/school-schedule/releases)
2. Copy `custom_components/school_schedule/` to `<config>/custom_components/school_schedule/`
3. Restart Home Assistant
4. Add the integration via **Settings** → **Devices & Services** → **Add Integration** → "School Schedule"

The Lovelace card resource is registered automatically — no copy to `www/` and no resource registration needed.

## Configuration

### Setting up a child

1. Go to **Settings** → **Devices & Services** → **Add Integration**
2. Search for "School Schedule"
3. Enter the child's name (e.g., "Tom")
4. The integration creates 7 sensors automatically

### Adding lessons

**Via the card (recommended):**
1. Add the School Schedule Card to your dashboard
2. Configure the card with the `child_name` parameter
3. Click "Bearbeiten" to enter edit mode
4. Click the "+" button on any day to add a lesson
5. Fill in the form (subject, time, room, teacher, color, icon)
6. Click "Hinzufügen"

**Via services:**
```yaml
service: school_schedule.add_lesson
data:
  child_name: your_child
  weekday: monday
  lesson_number: 1
  subject: Mathematik
  room: R204
  teacher: Herr Müller
  start_time: "08:00"
  end_time: "08:45"
  color: "#44739e"
  icon: mdi:school
  is_break: false
  apply_to_all_days: false
```

**Adding a break (pause) to all days at once:**
```yaml
service: school_schedule.add_lesson
data:
  child_name: your_child
  weekday: monday
  lesson_number: 3
  start_time: "10:00"
  end_time: "10:15"
  is_break: true
  apply_to_all_days: true
```

### Card configuration

```yaml
type: custom:school-schedule-card
child_name: Tom
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `child_name` | string | yes | Name of the child (must match the integration config) |

## Services

| Service | Description |
|---------|-------------|
| `school_schedule.add_lesson` | Add a lesson to a child's schedule |
| `school_schedule.remove_lesson` | Remove a lesson by weekday and lesson number |
| `school_schedule.update_lesson` | Update an existing lesson |
| `school_schedule.get_schedule` | Get the schedule for a specific day or all days |

## Sensors

Each child gets 7 sensors:

| Sensor | Description |
|--------|-------------|
| `sensor.stundenplan_<child>_heute` | Today's lessons |
| `sensor.stundenplan_<child>_morgen` | Tomorrow's lessons |
| `sensor.stundenplan_<child>_montag` | Monday's lessons |
| `sensor.stundenplan_<child>_dienstag` | Tuesday's lessons |
| `sensor.stundenplan_<child>_mittwoch` | Wednesday's lessons |
| `sensor.stundenplan_<child>_donnerstag` | Thursday's lessons |
| `sensor.stundenplan_<child>_freitag` | Friday's lessons |

The `heute` sensor also provides `current_lesson` and `next_lesson` attributes. Both include an `is_break` flag for break/pause lessons.

### Break/Pause lessons

Lessons can be marked as breaks (`is_break: true`). Breaks are rendered differently in the card:
- Dashed border instead of solid
- Italic subject text (defaults to "Pause")
- Coffee icon instead of lesson number
- No room or teacher displayed
- Time is still shown

When adding a break, `subject` is optional (defaults to "Pause"), and `room`/`teacher` are automatically cleared. Use `apply_to_all_days: true` to add the same break to all weekdays at once.

## License

MIT License — see [LICENSE](https://github.com/svenachilles1/school-schedule/blob/main/LICENSE)