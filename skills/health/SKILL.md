---
name: health
description: 查询和分析本人的可穿戴设备健康数据（Garmin：心率、睡眠、HRV、压力、身体电量、步数、运动；以后会有 Oura、饮食）。用户问到睡眠、恢复、运动、心率、压力趋势或相关性时使用。
---

# 个人健康数据库

云端 Postgres（Neon），时区 America/Los_Angeles。连接串在项目 `.env` 的 `DATABASE_URL_RO`（只读）。

## 怎么查

- 有 `health` MCP：先 `schema()` 看表，再 `query(sql)`。只读。
- 没有 MCP（shell）：在项目目录 `/Users/outman/workspace/personal/health` 下
  `uv run python -c "import health,psycopg;print(psycopg.connect(health.RO_DSN).execute('<SQL>').fetchall())"`

## 先用这些视图

| 视图 | 粒度 | 内容 |
|---|---|---|
| `garmin.day` | 每天 | 步数、卡路里、静息心率、压力均值、身体电量高低、睡眠时长/分期/得分、HRV、训练准备度 |
| `garmin.halfday` | 每天 AM/PM | 心率、压力、身体电量、步数、呼吸 |
| `garmin.hourly` | 每小时 | 同上 |
| `garmin.sample` | 原始采样 | `(ts, metric, value)`，metric ∈ hr / stress / body_battery / steps / respiration |
| `garmin.activities` | 每次运动 | 类型、时长、距离、心率、训练效果、负荷 |

视图里没有的字段去原始表找：`garmin.daily(metric, day, data jsonb)`，metric 是
user_summary / sleep_data / heart_rates / stress_data / steps_data / hrv_data / respiration_data /
spo2_data / training_readiness / training_status / max_metrics；`garmin.activity(id, start_time, data jsonb)`。
用 `jsonb_object_keys(data)` 探索结构。

## 注意

- 睡眠记在醒来那天（`garmin.day.day` = 起床日期）。
- 当天数据不完整，同步每小时跑一次；做趋势时排除今天。
- 分析时给出数字和样本天数，别下医学诊断。
