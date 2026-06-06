import test from 'node:test';
import assert from 'node:assert/strict';

import type { Course } from '../src/types.ts';
import {
  buildClassroomAvailability,
  parseClassroomLocation,
} from '../src/utils/classroomAvailability.ts';

function createCourse(
  id: string,
  code: string,
  meeting: Course['meetings'][number],
): Course {
  return {
    id,
    crn: id,
    code,
    title: code,
    instructor: 'TBA',
    campus: 'Main Campus',
    section: '1',
    credits: 3,
    capacity: { enrolled: 0, limit: 30 },
    attributes: [],
    difficulty: 0,
    workload: 0,
    meetings: [meeting],
  };
}

test('parses multi-word building names into building and room', () => {
  assert.deepStrictEqual(
    parseClassroomLocation('Charles Hostler Student Center 205'),
    {
      building: 'Charles Hostler Student Center',
      room: '205',
    },
  );
});

test('ignores placeholder classroom locations', () => {
  assert.equal(parseClassroomLocation('TBA'), null);
  assert.equal(parseClassroomLocation('ONLINE'), null);
});

test('groups meetings by room and computes room free slots', () => {
  const availability = buildClassroomAvailability([
    createCourse('1', 'CMPS 271', {
      days: ['M'],
      start: '09:00',
      end: '10:15',
      location: 'Nicely Hall 101',
      type: 'Lecture',
    }),
    createCourse('2', 'MATH 201', {
      days: ['M'],
      start: '11:00',
      end: '12:15',
      location: 'Nicely Hall 101',
      type: 'Lecture',
    }),
    createCourse('3', 'PHYS 210', {
      days: ['T'],
      start: '10:00',
      end: '11:15',
      location: 'Nicely Hall 102',
      type: 'Lecture',
    }),
  ], {
    startOfDay: '08:00',
    endOfDay: '18:00',
    minGapMinutes: 15,
  });

  const room101 = availability.find((room) => room.roomKey === 'nicely hall::101');
  assert.ok(room101);
  assert.deepStrictEqual(room101.courseCodes, ['CMPS 271', 'MATH 201']);
  assert.deepStrictEqual(room101.freeSlotsByDay.Mon, [
    { start: '08:00', end: '09:00' },
    { start: '10:15', end: '11:00' },
    { start: '12:15', end: '18:00' },
  ]);
});

test('sorts rooms naturally inside the same building', () => {
  const availability = buildClassroomAvailability([
    createCourse('1', 'CMPS 271', {
      days: ['M'],
      start: '09:00',
      end: '10:15',
      location: 'Nicely Hall 210',
      type: 'Lecture',
    }),
    createCourse('2', 'CMPS 272', {
      days: ['M'],
      start: '11:00',
      end: '12:15',
      location: 'Nicely Hall 101',
      type: 'Lecture',
    }),
  ]);

  assert.deepStrictEqual(
    availability.map((room) => room.room),
    ['101', '210'],
  );
});
