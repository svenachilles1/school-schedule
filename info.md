# School Schedule

A custom Home Assistant integration for managing school schedules with an Ultra Premium Lovelace card.

## Features

- **Schedule management:** Add lessons per weekday with subject, room, teacher, time, color, and icon
- **7 sensors per child:** Today, Tomorrow, Monday–Friday
- **Ultra Premium Lovelace Card:** 3D Glassmorphism, animated aurora background
- **Day view toggle:** Switch between week and day view directly in the card
- **Inline management:** Add, edit, and delete lessons directly from the card
- **Hero section:** Shows currently running lesson (JETZT) and next lesson (ALS NÄCHSTES)
- **Daily progress bar (v2.5.6):** "TAGESFORTSCHRITT" section under the hero pills — counts finished lessons plus a proportional share of the currently running lesson (breaks excluded), gradient bar with animated shimmer, switches to a golden "TAG GESCHAFFT!" state with glow when the last lesson ends
- **Star gamification + confetti (v2.5.6):** One star per real lesson — grey while pending, golden with glow when earned (pop animation on new stars); a colorful confetti burst fires exactly once when school is over
- **Break/Pause support:** Mark lessons as breaks with their own visual style
- **Holiday calendar:** German school holidays per federal state (mehr-schulferien.de)
- **Responsive auto-fill columns** and a visual editor for card height/width
- **Services:** `add_lesson`, `remove_lesson`, `update_lesson`, `get_schedule`
- **Multi-child:** Each child gets their own schedule
- **Child switcher:** Switch between children directly in the card
- **Holiday countdown:** Days until the next school holidays in the hero section
- **Calendar entity (v2.5.4):** Real HA calendar per child — lessons as events, school-free days skipped

## Installation

Via HACS or manually. See [README.md](https://github.com/svenachilles1/school-schedule/blob/main/README.md) for detailed instructions.

## Note

This repository ships both the integration (`custom_components/school_schedule/`) and the Lovelace card (`school-schedule-card.js`). The card is set up automatically: the integration serves it from its own directory and registers the dashboard resource for you (browser_mod-style). On update, the browser cache is busted automatically.