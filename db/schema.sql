-- Idempotent: uv run health.py init-db
-- Principle: store raw JSON as-is (data jsonb) and project analysis columns in views, so new API fields need no migration.

CREATE SCHEMA IF NOT EXISTS garmin;

-- Garmin login token (incl. refresh token). Lives in public because the read-only role health_ro has no access to public
CREATE TABLE IF NOT EXISTS public.garmin_token (
  id         int         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data       text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One raw response per metric per day; metric = garminconnect method name without the get_ prefix
CREATE TABLE IF NOT EXISTS garmin.daily (
  metric     text        NOT NULL,
  day        date        NOT NULL,
  data       jsonb       NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric, day)
);

CREATE TABLE IF NOT EXISTS garmin.activity (
  id         bigint      PRIMARY KEY,
  start_time timestamptz,
  data       jsonb       NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Intraday samples normalized to (ts, metric, value). Garmin uses -1/-2 for unmeasured stress; filter those out.
CREATE OR REPLACE VIEW garmin.sample AS
SELECT to_timestamp((v->>0)::bigint / 1000.0) AS ts, 'hr' AS metric, (v->>1)::numeric AS value
  FROM garmin.daily d, jsonb_array_elements(d.data->'heartRateValues') v
 WHERE d.metric = 'heart_rates' AND jsonb_typeof(d.data->'heartRateValues') = 'array' AND v->>1 IS NOT NULL
UNION ALL
SELECT to_timestamp((v->>0)::bigint / 1000.0), 'stress', (v->>1)::numeric
  FROM garmin.daily d, jsonb_array_elements(d.data->'stressValuesArray') v
 WHERE d.metric = 'stress_data' AND jsonb_typeof(d.data->'stressValuesArray') = 'array' AND (v->>1)::numeric >= 0
UNION ALL
SELECT to_timestamp((v->>0)::bigint / 1000.0), 'body_battery', (v->>2)::numeric
  FROM garmin.daily d, jsonb_array_elements(d.data->'bodyBatteryValuesArray') v
 WHERE d.metric = 'stress_data' AND jsonb_typeof(d.data->'bodyBatteryValuesArray') = 'array' AND v->>2 IS NOT NULL
UNION ALL
SELECT (e->>'startGMT')::timestamp AT TIME ZONE 'UTC', 'steps', (e->>'steps')::numeric
  FROM garmin.daily d, jsonb_array_elements(d.data) e
 WHERE d.metric = 'steps_data' AND jsonb_typeof(d.data) = 'array'
UNION ALL
SELECT to_timestamp((v->>0)::bigint / 1000.0), 'respiration', (v->>1)::numeric
  FROM garmin.daily d, jsonb_array_elements(d.data->'respirationValuesArray') v
 WHERE d.metric = 'respiration_data' AND jsonb_typeof(d.data->'respirationValuesArray') = 'array' AND (v->>1)::numeric > 0;
COMMENT ON VIEW garmin.sample IS 'Raw intraday samples: hr (~2 min) / stress (3 min) / body_battery / steps (15 min) / respiration. ts is timestamptz.';

CREATE OR REPLACE VIEW garmin.hourly AS
SELECT date_trunc('hour', ts) AS hour,
       round(avg(value) FILTER (WHERE metric = 'hr'))           AS hr_avg,
       min(value)       FILTER (WHERE metric = 'hr')            AS hr_min,
       max(value)       FILTER (WHERE metric = 'hr')            AS hr_max,
       round(avg(value) FILTER (WHERE metric = 'stress'))       AS stress_avg,
       min(value)       FILTER (WHERE metric = 'body_battery')  AS body_battery_min,
       max(value)       FILTER (WHERE metric = 'body_battery')  AS body_battery_max,
       sum(value)       FILTER (WHERE metric = 'steps')         AS steps,
       round(avg(value) FILTER (WHERE metric = 'respiration'), 1) AS respiration_avg
  FROM garmin.sample GROUP BY 1;
COMMENT ON VIEW garmin.hourly IS 'Hourly aggregates (database timezone).';

CREATE OR REPLACE VIEW garmin.halfday AS
SELECT ts::date AS day,
       CASE WHEN extract(hour FROM ts) < 12 THEN 'AM' ELSE 'PM' END AS half,
       round(avg(value) FILTER (WHERE metric = 'hr'))           AS hr_avg,
       min(value)       FILTER (WHERE metric = 'hr')            AS hr_min,
       max(value)       FILTER (WHERE metric = 'hr')            AS hr_max,
       round(avg(value) FILTER (WHERE metric = 'stress'))       AS stress_avg,
       min(value)       FILTER (WHERE metric = 'body_battery')  AS body_battery_min,
       max(value)       FILTER (WHERE metric = 'body_battery')  AS body_battery_max,
       sum(value)       FILTER (WHERE metric = 'steps')         AS steps,
       round(avg(value) FILTER (WHERE metric = 'respiration'), 1) AS respiration_avg
  FROM garmin.sample GROUP BY 1, 2;
COMMENT ON VIEW garmin.halfday IS 'Aggregates by morning (AM, 00-12h) / afternoon (PM, 12-24h), database timezone.';

CREATE OR REPLACE VIEW garmin.day AS
SELECT s.day,
       (s.data->>'totalSteps')::int                 AS steps,
       (s.data->>'totalDistanceMeters')::numeric    AS distance_m,
       (s.data->>'activeKilocalories')::numeric     AS active_kcal,
       (s.data->>'totalKilocalories')::numeric      AS total_kcal,
       (s.data->>'restingHeartRate')::int           AS resting_hr,
       (s.data->>'minHeartRate')::int               AS min_hr,
       (s.data->>'maxHeartRate')::int               AS max_hr,
       (s.data->>'averageStressLevel')::int         AS stress_avg,
       (s.data->>'bodyBatteryHighestValue')::int    AS body_battery_max,
       (s.data->>'bodyBatteryLowestValue')::int     AS body_battery_min,
       (s.data->>'moderateIntensityMinutes')::int   AS moderate_min,
       (s.data->>'vigorousIntensityMinutes')::int   AS vigorous_min,
       (s.data->>'floorsAscended')::numeric         AS floors,
       (s.data->>'averageSpo2')::numeric            AS spo2_avg,
       (sl.data->'dailySleepDTO'->>'sleepTimeSeconds')::int / 3600.0  AS sleep_h,
       (sl.data->'dailySleepDTO'->>'deepSleepSeconds')::int / 3600.0  AS deep_h,
       (sl.data->'dailySleepDTO'->>'remSleepSeconds')::int / 3600.0   AS rem_h,
       (sl.data->'dailySleepDTO'->>'awakeSleepSeconds')::int / 3600.0 AS awake_h,
       (sl.data->'dailySleepDTO'->'sleepScores'->'overall'->>'value')::int AS sleep_score,
       (h.data->'hrvSummary'->>'lastNightAvg')::int AS hrv_last_night,
       (h.data->'hrvSummary'->>'weeklyAvg')::int    AS hrv_weekly,
       h.data->'hrvSummary'->>'status'              AS hrv_status,
       (r.data->0->>'score')::int                   AS training_readiness
  FROM garmin.daily s
  LEFT JOIN garmin.daily sl ON sl.metric = 'sleep_data'         AND sl.day = s.day
  LEFT JOIN garmin.daily h  ON h.metric  = 'hrv_data'           AND h.day  = s.day
  LEFT JOIN garmin.daily r  ON r.metric  = 'training_readiness' AND r.day  = s.day
 WHERE s.metric = 'user_summary';
COMMENT ON VIEW garmin.day IS 'Daily summary: activity, resting HR, stress, body battery, sleep (attributed to the wake-up day), HRV, training readiness.';

CREATE OR REPLACE VIEW garmin.activities AS
SELECT id, start_time,
       data->>'activityName'                  AS name,
       data->'activityType'->>'typeKey'       AS type,
       (data->>'duration')::numeric / 60      AS duration_min,
       (data->>'distance')::numeric / 1000    AS distance_km,
       (data->>'averageHR')::numeric          AS hr_avg,
       (data->>'maxHR')::numeric              AS hr_max,
       (data->>'calories')::numeric           AS kcal,
       (data->>'aerobicTrainingEffect')::numeric AS aerobic_te,
       (data->>'activityTrainingLoad')::numeric  AS training_load
  FROM garmin.activity;
COMMENT ON VIEW garmin.activities IS 'Workouts (running, cycling, strength, etc.).';
