import { SERVICES } from '../config/services.js';
import { seededInteger } from '../geo/random.js';

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const OFFSET = 480 * MINUTE; // UTC+8, matching the dashboard.
const WINDOW_MINUTES = 480;

export function dailyPlan(day) {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(midnight)
      || new Date(midnight).toISOString().slice(0, 10) !== day)
    throw new Error('invalid_schedule_date');
  const entries = [];
  for (let round = 0; round < 3; round++) {
    const execution = `daily:v1:${day}:${round}`;
    const integer = seededInteger(`time:${execution}`);
    const minutes = Array.from({ length: WINDOW_MINUTES }, (_, i) => i);
    for (let i = minutes.length - 1; i > 0; i--) {
      const j = integer(0, i);
      [minutes[i], minutes[j]] = [minutes[j], minutes[i]];
    }
    SERVICES.forEach((service, index) => entries.push({
      service, execution,
      plannedAt: new Date(midnight - OFFSET + (round * WINDOW_MINUTES + minutes[index]) * MINUTE).toISOString()
    }));
  }
  return entries.sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
}

export function dueCheckins(stamp) {
  if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(stamp))
    throw new Error('invalid_schedule_time');
  const time = Date.parse(stamp);
  if (!Number.isFinite(time)) throw new Error('invalid_schedule_time');
  const minute = Math.floor(time / MINUTE) * MINUTE;
  const day = new Date(Math.floor((time + OFFSET) / DAY) * DAY).toISOString().slice(0, 10);
  return dailyPlan(day).filter(entry => Date.parse(entry.plannedAt) === minute);
}
