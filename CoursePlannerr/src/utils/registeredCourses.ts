import type { Course } from "../types";

/**
 * Reconcile a slot's saved (registered) courses against the live catalog.
 *
 * - If a saved course still exists in the catalog, the live version is returned
 *   so updated seats/schedule/instructor/status are reflected automatically.
 * - If the catalog is loaded but the course is gone, it is dropped (no longer
 *   offered, e.g. a cancelled section).
 * - If the catalog is not ready yet, the saved snapshot is kept so the slot
 *   does not flash empty (or get wiped) while data is still loading.
 *
 * Pure function — no React/DOM/Supabase deps — so it can be unit tested.
 */
export function resolveRegisteredCourses(
  saved: Course[],
  allCourses: Course[],
  catalogReady: boolean,
): Course[] {
  const liveById = new Map(allCourses.map((course) => [course.id, course]));

  return saved
    .map((snapshot) => {
      const live = liveById.get(snapshot.id);
      if (live) return live;
      return catalogReady ? null : snapshot;
    })
    .filter((course): course is Course => course !== null);
}
