import type { Course, Day } from '../types.ts';

export const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type WeekdayKey = (typeof WEEKDAY_ORDER)[number];

export interface WeeklyMeetingSlot {
  day: string;
  start: string;
  end: string;
}

export interface FreeSlot {
  start: string;
  end: string;
}

export type FreeSlotsByDay = Record<WeekdayKey, FreeSlot[]>;

const DEFAULT_START_OF_DAY = '08:00';
const DEFAULT_END_OF_DAY = '18:00';

const DAY_CODE_TO_WEEKDAY: Record<Day, WeekdayKey> = {
  M: 'Mon',
  T: 'Tue',
  W: 'Wed',
  R: 'Thu',
  F: 'Fri',
  S: 'Sat',
};

const DAY_ALIASES: Record<string, WeekdayKey> = {
  m: 'Mon',
  mon: 'Mon',
  monday: 'Mon',
  t: 'Tue',
  tue: 'Tue',
  tues: 'Tue',
  tuesday: 'Tue',
  w: 'Wed',
  wed: 'Wed',
  wednesday: 'Wed',
  r: 'Thu',
  th: 'Thu',
  thu: 'Thu',
  thur: 'Thu',
  thurs: 'Thu',
  thursday: 'Thu',
  f: 'Fri',
  fri: 'Fri',
  friday: 'Fri',
  s: 'Sat',
  sat: 'Sat',
  saturday: 'Sat',
};

type MinuteRange = {
  start: number;
  end: number;
};

function createEmptyFreeSlots(): FreeSlotsByDay {
  return {
    Mon: [],
    Tue: [],
    Wed: [],
    Thu: [],
    Fri: [],
    Sat: [],
  };
}

function createEmptyMinuteRanges(): Record<WeekdayKey, MinuteRange[]> {
  return {
    Mon: [],
    Tue: [],
    Wed: [],
    Thu: [],
    Fri: [],
    Sat: [],
  };
}

export function normalizeWeekday(day: string): WeekdayKey | null {
  const normalized = String(day).trim().toLowerCase();
  return DAY_ALIASES[normalized] ?? null;
}

export function timeToMinutes(time: string): number | null {
  const match = String(time).trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  const [, hours, minutes] = match;
  return (Number(hours) * 60) + Number(minutes);
}

export function minutesToTime(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  if (!ranges.length) return [];

  const merged: MinuteRange[] = [];

  for (const range of ranges) {
    const current = merged[merged.length - 1];

    if (!current || range.start > current.end) {
      merged.push({ ...range });
      continue;
    }

    current.end = Math.max(current.end, range.end);
  }

  return merged;
}

export function expandCoursesToMeetingSlots(courses: Course[]): WeeklyMeetingSlot[] {
  const slots: WeeklyMeetingSlot[] = [];

  for (const course of courses) {
    for (const meeting of course.meetings ?? []) {
      if (!meeting?.start || !meeting?.end || !Array.isArray(meeting.days)) continue;

      for (const day of meeting.days) {
        const normalizedDay = DAY_CODE_TO_WEEKDAY[day];
        if (!normalizedDay) continue;

        slots.push({
          day: normalizedDay,
          start: meeting.start,
          end: meeting.end,
        });
      }
    }
  }

  return slots;
}

export function findFreeSlots(
  meetings: WeeklyMeetingSlot[],
  startOfDay = DEFAULT_START_OF_DAY,
  endOfDay = DEFAULT_END_OF_DAY,
  minGapMinutes = 30
): FreeSlotsByDay {
  const fallbackStart = timeToMinutes(DEFAULT_START_OF_DAY) ?? 8 * 60;
  const fallbackEnd = timeToMinutes(DEFAULT_END_OF_DAY) ?? 18 * 60;
  const dayStart = timeToMinutes(startOfDay) ?? fallbackStart;
  const parsedDayEnd = timeToMinutes(endOfDay) ?? fallbackEnd;
  const dayEnd = parsedDayEnd > dayStart ? parsedDayEnd : Math.max(dayStart, fallbackEnd);
  const minimumGap = Math.max(0, minGapMinutes);

  const groupedByDay = WEEKDAY_ORDER.reduce<Record<WeekdayKey, MinuteRange[]>>((acc, day) => {
    acc[day] = [];
    return acc;
  }, createEmptyMinuteRanges());

  for (const meeting of meetings ?? []) {
    const normalizedDay = normalizeWeekday(meeting?.day ?? '');
    const start = timeToMinutes(meeting?.start ?? '');
    const end = timeToMinutes(meeting?.end ?? '');

    if (!normalizedDay || start === null || end === null) continue;

    const clampedStart = Math.max(start, dayStart);
    const clampedEnd = Math.min(end, dayEnd);

    if (clampedEnd <= clampedStart) continue;

    groupedByDay[normalizedDay].push({ start: clampedStart, end: clampedEnd });
  }

  const freeSlots = createEmptyFreeSlots();

  for (const day of WEEKDAY_ORDER) {
    const mergedMeetings = mergeRanges(
      groupedByDay[day].sort((a, b) => a.start - b.start || a.end - b.end)
    );

    let cursor = dayStart;

    for (const meeting of mergedMeetings) {
      const gapMinutes = meeting.start - cursor;

      if (meeting.start > cursor && gapMinutes >= minimumGap) {
        freeSlots[day].push({
          start: minutesToTime(cursor),
          end: minutesToTime(meeting.start),
        });
      }

      cursor = Math.max(cursor, meeting.end);
    }

    const finalGapMinutes = dayEnd - cursor;
    if (dayEnd > cursor && finalGapMinutes >= minimumGap) {
      freeSlots[day].push({
        start: minutesToTime(cursor),
        end: minutesToTime(dayEnd),
      });
    }
  }

  return freeSlots;
}
