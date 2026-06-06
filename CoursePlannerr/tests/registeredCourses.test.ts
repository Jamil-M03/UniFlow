import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRegisteredCourses } from '../src/utils/registeredCourses.ts';
import type { Course } from '../src/types.ts';

// Minimal Course-shaped fixtures; only `id` and the field we assert on matter.
function course(id: string, seatsAvailable: number): Course {
  return { id, seatsAvailable } as unknown as Course;
}

test('uses the live catalog version when a registered course still exists', () => {
  const saved = [course('CMPS-271-27101', 30)];
  const live = [course('CMPS-271-27101', 5)];

  const result = resolveRegisteredCourses(saved, live, true);

  assert.equal(result.length, 1);
  // Live data (5 seats) replaces the stale snapshot (30 seats).
  assert.equal((result[0] as unknown as { seatsAvailable: number }).seatsAvailable, 5);
});

test('drops a registered course that is no longer in the loaded catalog', () => {
  const saved = [course('CMPS-271-27101', 30), course('MATH-201-99999', 10)];
  const live = [course('CMPS-271-27101', 5)];

  const result = resolveRegisteredCourses(saved, live, true);

  assert.deepEqual(result.map((c) => c.id), ['CMPS-271-27101']);
});

test('keeps snapshots when the catalog is not ready yet', () => {
  const saved = [course('CMPS-271-27101', 30)];

  const result = resolveRegisteredCourses(saved, [], false);

  assert.equal(result.length, 1);
  assert.equal((result[0] as unknown as { seatsAvailable: number }).seatsAvailable, 30);
});

test('does not wipe a slot if the catalog momentarily loads empty', () => {
  const saved = [course('CMPS-271-27101', 30)];

  // catalogReady=false guards against an empty/failed catalog fetch.
  assert.equal(resolveRegisteredCourses(saved, [], false).length, 1);
});
