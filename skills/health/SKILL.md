---
name: health
description: Query and analyze the user's own wearable health data (Garmin: heart rate, resting HR, sleep, HRV, stress, body battery, steps, activities/workouts; Oura and diet later). Use when the user asks about sleep, recovery, exercise, heart rate, stress, trends, or correlations.
---

# Personal health database

Postgres; times are in the database timezone (check with `SHOW timezone`). The read-only connection string is `DATABASE_URL_RO` in the project's `.env`.

## How to query

- With the `health` MCP: call `schema()` to see the tables, then `query(sql)`. Read-only.
- Without MCP (shell): from this project's directory run
  `uv run python -c "import health,psycopg;print(psycopg.connect(health.RO_DSN).execute('<SQL>').fetchall())"`

## Start with these views

| View | Granularity | Contents |
|---|---|---|
| `garmin.day` | Daily | Steps, calories, resting HR, average stress, body battery high/low, sleep duration/stages/score, HRV, training readiness |
| `garmin.halfday` | Daily AM/PM | Heart rate, stress, body battery, steps, respiration |
| `garmin.hourly` | Hourly | Same as above |
| `garmin.sample` | Raw samples | `(ts, metric, value)`, metric ∈ hr / stress / body_battery / steps / respiration |
| `garmin.activities` | Per workout | Type, duration, distance, heart rate, training effect, load |

For fields not in the views, use the raw tables: `garmin.daily(metric, day, data jsonb)`, where metric is
user_summary / sleep_data / heart_rates / stress_data / steps_data / hrv_data / respiration_data /
spo2_data / training_readiness / training_status / max_metrics; and `garmin.activity(id, start_time, data jsonb)`.
Explore the structure with `jsonb_object_keys(data)`.

## Notes

- Sleep is attributed to the wake-up day (`garmin.day.day` = the date you got up).
- Today's data is incomplete (synced on a schedule, not real-time); exclude today when looking at trends.
- When analyzing, give the numbers and the number of days in the sample; don't make medical diagnoses.
