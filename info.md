# School Schedule

A custom Home Assistant integration for managing school schedules with an Ultra Premium Lovelace card.

## Features

- **Schedule management:** Add lessons per weekday with subject, room, teacher, time, color, and icon
- **7 sensors per child:** Today, Tomorrow, Monday–Friday
- **Ultra Premium Lovelace Card:** 3D Glassmorphism, animated aurora background
- **Day view toggle:** Switch between week and day view directly in the card
- **Inline management:** Add, edit, and delete lessons directly from the card
- **Hero section:** Shows currently running lesson (JETZT) and next lesson (ALS NÄCHSTES)
- **Services:** `add_lesson`, `remove_lesson`, `update_lesson`, `get_schedule`
- **Multi-child:** Each child gets their own schedule

## Installation

Via HACS or manually. See [README.md](https://github.com/svenachilles1/school-schedule/blob/main/README.md) for detailed instructions.

## Note

This repository ships both the integration (`custom_components/school_schedule/`) and the Lovelace card (`school-schedule-card.js`). After installing the integration, you also need to register the card as a dashboard resource — see the README for details.