import test from 'node:test';
import assert from 'node:assert/strict';

import { findFreeSlots, type WeeklyMeetingSlot } from '../src/utils/schedule.ts';

test('marks days with no classes as fully free', () => {
  const result = findFreeSlots([
    { day: 'Mon', start: '09:00', end: '10:00' },
  ]);

  assert.deepStrictEqual(result.Mon, [
    { start: '08:00', end: '09:00' },
    { start: '10:00', end: '18:00' },
  ]);

  assert.deepStrictEqual(result.Tue, [
    { start: '08:00', end: '18:00' },
  ]);
});

test('finds free time before and after a single class in the middle of the day', () => {
  const result = findFreeSlots([
    { day: 'Wed', start: '10:00', end: '11:15' },
  ]);

  assert.deepStrictEqual(result.Wed, [
    { start: '08:00', end: '10:00' },
    { start: '11:15', end: '18:00' },
  ]);
});

test('does not create a gap for back-to-back classes', () => {
  const result = findFreeSlots([
    { day: 'Thu', start: '09:00', end: '10:00' },
    { day: 'Thu', start: '10:00', end: '11:30' },
  ]);

  assert.deepStrictEqual(result.Thu, [
    { start: '08:00', end: '09:00' },
    { start: '11:30', end: '18:00' },
  ]);
});

test('finds multiple gaps in one day', () => {
  const result = findFreeSlots([
    { day: 'Fri', start: '08:30', end: '09:30' },
    { day: 'Fri', start: '11:00', end: '12:00' },
    { day: 'Fri', start: '14:00', end: '15:00' },
  ]);

  assert.deepStrictEqual(result.Fri, [
    { start: '08:00', end: '08:30' },
    { start: '09:30', end: '11:00' },
    { start: '12:00', end: '14:00' },
    { start: '15:00', end: '18:00' },
  ]);
});

test('ignores gaps shorter than the minimum threshold', () => {
  const result = findFreeSlots([
    { day: 'Mon', start: '09:00', end: '09:20' },
    { day: 'Mon', start: '09:40', end: '10:00' },
  ], '08:00', '18:00', 30);

  assert.deepStrictEqual(result.Mon, [
    { start: '08:00', end: '09:00' },
    { start: '10:00', end: '18:00' },
  ]);
});

test('returns the same free slots for sorted and unsorted input', () => {
  const sortedMeetings: WeeklyMeetingSlot[] = [
    { day: 'Tue', start: '08:30', end: '09:30' },
    { day: 'Tue', start: '11:00', end: '12:00' },
    { day: 'Tue', start: '15:00', end: '16:00' },
  ];

  const unsortedMeetings: WeeklyMeetingSlot[] = [
    { day: 'Tue', start: '15:00', end: '16:00' },
    { day: 'Tue', start: '08:30', end: '09:30' },
    { day: 'Tue', start: '11:00', end: '12:00' },
  ];

  assert.deepStrictEqual(
    findFreeSlots(unsortedMeetings),
    findFreeSlots(sortedMeetings)
  );
});

test('merges overlapping classes defensively before computing gaps', () => {
  const result = findFreeSlots([
    { day: 'Sat', start: '09:00', end: '10:30' },
    { day: 'Sat', start: '10:00', end: '11:00' },
  ]);

  assert.deepStrictEqual(result.Sat, [
    { start: '08:00', end: '09:00' },
    { start: '11:00', end: '18:00' },
  ]);
});
