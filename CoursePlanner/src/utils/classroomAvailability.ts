import type { Course, Day } from '../types.ts';
import {
  findFreeSlots,
  type FreeSlotsByDay,
  type WeekdayKey,
  type WeeklyMeetingSlot,
} from './schedule.ts';

const DAY_TO_WEEKDAY: Record<Day, WeekdayKey> = {
  M: 'Mon',
  T: 'Tue',
  W: 'Wed',
  R: 'Thu',
  F: 'Fri',
  S: 'Sat',
};

const SORTER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface ClassroomLocation {
  building: string;
  room: string;
}

export interface ClassroomAvailability {
  building: string;
  room: string;
  roomKey: string;
  meetings: WeeklyMeetingSlot[];
  freeSlotsByDay: FreeSlotsByDay;
  courseCodes: string[];
}

export interface ClassroomAvailabilityOptions {
  startOfDay?: string;
  endOfDay?: string;
  minGapMinutes?: number;
}

export function parseClassroomLocation(location: string): ClassroomLocation | null {
  const normalized = String(location ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const upper = normalized.toUpperCase();
  if (
    upper === 'TBA'
    || upper === 'ONLINE'
    || upper === 'ARR'
    || upper.includes('TO BE ANNOUNCED')
  ) {
    return null;
  }

  const match = normalized.match(/^(.*)\s+([A-Za-z0-9/-]+)$/);
  if (!match) return null;

  const building = match[1].trim();
  const room = match[2].trim();
  if (!building || !room) return null;

  return { building, room };
}

function buildRoomKey(building: string, room: string): string {
  return `${building.toLowerCase()}::${room.toLowerCase()}`;
}

export function buildClassroomAvailability(
  courses: Course[],
  options: ClassroomAvailabilityOptions = {},
): ClassroomAvailability[] {
  const {
    startOfDay = '08:00',
    endOfDay = '21:00',
    minGapMinutes = 15,
  } = options;

  const rooms = new Map<string, {
    building: string;
    room: string;
    meetings: WeeklyMeetingSlot[];
    courseCodes: Set<string>;
  }>();

  for (const course of courses ?? []) {
    for (const meeting of course.meetings ?? []) {
      const parsedLocation = parseClassroomLocation(meeting.location ?? '');
      if (!parsedLocation) continue;

      const roomKey = buildRoomKey(parsedLocation.building, parsedLocation.room);
      const roomEntry = rooms.get(roomKey) ?? {
        building: parsedLocation.building,
        room: parsedLocation.room,
        meetings: [],
        courseCodes: new Set<string>(),
      };

      for (const day of meeting.days ?? []) {
        const weekday = DAY_TO_WEEKDAY[day];
        if (!weekday) continue;

        roomEntry.meetings.push({
          day: weekday,
          start: meeting.start,
          end: meeting.end,
        });
      }

      if (course.code) {
        roomEntry.courseCodes.add(course.code);
      }

      rooms.set(roomKey, roomEntry);
    }
  }

  return [...rooms.values()]
    .map((roomEntry) => ({
      building: roomEntry.building,
      room: roomEntry.room,
      roomKey: buildRoomKey(roomEntry.building, roomEntry.room),
      meetings: roomEntry.meetings,
      freeSlotsByDay: findFreeSlots(roomEntry.meetings, startOfDay, endOfDay, minGapMinutes),
      courseCodes: [...roomEntry.courseCodes].sort((left, right) => SORTER.compare(left, right)),
    }))
    .sort((left, right) => (
      SORTER.compare(left.building, right.building) || SORTER.compare(left.room, right.room)
    ));
}
