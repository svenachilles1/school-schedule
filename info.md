# School Schedule

A custom Home Assistant integration for managing school schedules with an Ultra Premium Lovelace card.

## Features

- **Schedule management:** Add lessons per weekday with subject, room, teacher, time, color, and icon
- **7 sensors per child:** Today, Tomorrow, Monday–Friday
- **Ultra Premium Lovelace Card:** 3D Glassmorphism, animated aurora background
- **Day view toggle:** Switch between week and day view directly in the card
- **Inline management:** Add, edit, and delete lessons directly from the card
- **Hero section:** Shows currently running lesson (JETZT) and next lesson (ALS NÄCHSTES)
- **Break/Pause support:** Mark lessons as breaks with their own visual style
- **Holiday calendar:** German school holidays per federal state (mehr-schulferien.de)
- **Responsive auto-fill columns** and a visual editor for card height/width
- **Services:** `add_lesson`, `remove_lesson`, `update_lesson`, `get_schedule`
- **Multi-child:** Each child gets their own schedule

## Installation

Via HACS or manually. See [README.md](https://github.com/svenachilles1/school-schedule/blob/main/README.md) for detailed instructions.

## Note

This repository ships both the integration (`custom_components/school_schedule/`) and the Lovelace card (`school-schedule-card.js`). The card is set up automatically: the integration serves it from its own directory and registers the dashboard resource for you (browser_mod-style). On update, the browser cache is busted automatically.