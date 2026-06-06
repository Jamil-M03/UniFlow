import type { Course, Day, Meeting } from '../types.ts';

// Raw rows come from Supabase / the scraper API with no compile-time shape, so
// they're typed as an open record of unknowns and narrowed at each access.
type RawCourse = Record<string, unknown>;

function asRecord(value: unknown): RawCourse {
  return value && typeof value === 'object' ? (value as RawCourse) : {};
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

const DAY_NAME_MAP: Record<string, Day> = {
  m: 'M',
  mon: 'M',
  monday: 'M',
  t: 'T',
  tue: 'T',
  tues: 'T',
  tuesday: 'T',
  w: 'W',
  wed: 'W',
  wednesday: 'W',
  r: 'R',
  th: 'R',
  thu: 'R',
  thur: 'R',
  thurs: 'R',
  thursday: 'R',
  f: 'F',
  fri: 'F',
  friday: 'F',
  s: 'S',
  sat: 'S',
  saturday: 'S',
};

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Ensure a space on both sides of & (e.g. "Computer &Information" → "Computer & Information")
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

function normalizeMeetingDay(token: string): Day | null {
  return DAY_NAME_MAP[String(token).trim().toLowerCase()] ?? null;
}

function parseMeetingDays(rawDays: unknown): Day[] {
  if (Array.isArray(rawDays)) {
    return rawDays
      .map((value) => normalizeMeetingDay(String(value)))
      .filter((value): value is Day => value !== null);
  }

  return String(rawDays ?? '')
    .split(/[\s,/|-]+/)
    .map((value) => normalizeMeetingDay(value))
    .filter((value): value is Day => value !== null);
}

function normalizeMilitaryTime(rawTime: unknown): string | null {
  const time = String(rawTime ?? '').trim();
  if (!time) return null;

  const hhmmMatch = time.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (hhmmMatch) {
    return `${hhmmMatch[1].padStart(2, '0')}:${hhmmMatch[2]}`;
  }

  const digits = time.replace(/\D/g, '');
  if (digits.length === 3) {
    return `0${digits[0]}:${digits.slice(1)}`;
  }
  if (digits.length === 4) {
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }

  return null;
}

function parseScheduleMeeting(schedule: unknown): Meeting[] {
  const s = asRecord(schedule);
  const days = parseMeetingDays(s.days);
  const rawTime = String(s.time ?? '');
  const [rawStart = '', rawEnd = ''] = rawTime.split(/-|–|—/).map((value) => value.trim());
  const start = normalizeMilitaryTime(rawStart);
  const end = normalizeMilitaryTime(rawEnd);

  if (!days.length || !start || !end) {
    return [];
  }

  return [{
    days,
    start,
    end,
    location: String(s.location ?? '').trim(),
    type: String(s.type ?? 'Lecture').trim() || 'Lecture',
  }];
}

function getInstructorName(rawCourse: RawCourse): string {
  const profs = rawCourse.professors;

  const directName = asRecord(profs).full_name;
  if (typeof directName === 'string' && directName.trim()) {
    return directName.trim();
  }

  if (Array.isArray(profs)) {
    const instructor = profs.find((entry: unknown) => {
      const name = asRecord(entry).full_name;
      return typeof name === 'string' && name.trim().length > 0;
    });
    const name = asRecord(instructor).full_name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }

  return 'TBA';
}

export function mapApiCourseToCourse(rawCourse: RawCourse): Course {
  const department = String(rawCourse.department ?? '').trim();
  const courseNumber = String(rawCourse.course_number ?? '').trim();
  const schedule = asRecord(rawCourse.schedule);

  return {
    id: String(rawCourse.id ?? `${department}-${courseNumber}-${String(rawCourse.crn ?? 'section')}`),
    crn: String(rawCourse.crn ?? ''),
    code: `${department} ${courseNumber}`.trim(),
    title: decodeHtml(String(rawCourse.title ?? 'Untitled course')),
    instructor: getInstructorName(rawCourse),
    campus: String(rawCourse.campus ?? 'Main Campus'),
    section: String(schedule.section ?? rawCourse.section ?? ''),
    credits: Number(rawCourse.credits ?? rawCourse.creditHourHigh ?? rawCourse.creditHourLow ?? 0),
    capacity: {
      enrolled: Number(rawCourse.enrolled_count ?? 0),
      limit: Number(rawCourse.capacity ?? 0),
    },
    attributes: Array.isArray(rawCourse.attributes) ? (rawCourse.attributes as string[]) : [],
    prerequisites: optString(rawCourse.prerequisites),
    restrictions: optString(rawCourse.restrictions),
    difficulty: Number(rawCourse.difficulty ?? 0),
    workload: Number(rawCourse.workload ?? 0),
    meetings: parseScheduleMeeting(rawCourse.schedule),
    isSectionLinked: Boolean(rawCourse.is_section_linked ?? rawCourse.isSectionLinked),
    linkIdentifier: (rawCourse.link_identifier ?? rawCourse.linkIdentifier ?? null) as string | null,
    scheduleType: optString(schedule.type) ?? optString(rawCourse.scheduleTypeDescription),
    subjectCourse: department && courseNumber ? `${department}${courseNumber}` : undefined,
  };
}

export function mapApiCoursesToCourses(rawCourses: unknown): Course[] {
  return Array.isArray(rawCourses)
    ? rawCourses.map((entry) => mapApiCourseToCourse(asRecord(entry)))
    : [];
}
