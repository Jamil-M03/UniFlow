import { Suspense, lazy, useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import "./App.css";
import type { Course } from "./types";
import { TopNav } from "./components/TopNav";
import { LeftInfoPanel } from "./components/LeftInfoPanel";
import { ScheduleGrid } from "./components/ScheduleGrid";
import { RightSearchPanel } from "./components/RightSearchPanel";
import ProtectedRoute from "./components/ProtectedRoute";
import { AIScheduler } from "./components/AiScheduler.tsx";
import AdminRoute from "./components/AdminRoute";
import { mapApiCoursesToCourses } from "./utils/courseApi.ts";
import { resolveRegisteredCourses } from "./utils/registeredCourses.ts";
import { useSupabase } from "./hooks/useSupabase.ts";
import { useAppUser } from "./hooks/useAppUser.ts";

const API_URL = import.meta.env.VITE_API_URL || "";
const COURSE_CACHE_PREFIX = "uniflow:courses:v2:";
const TERMS_CACHE_KEY = "uniflow:terms";
// Persisted across browser sessions (localStorage, not sessionStorage) so the
// app reopens to whatever semester the user last had selected.
const SELECTED_TERM_KEY = "uniflow:selectedTerm";
const EMPTY_COURSES: Course[] = [];

function readSelectedTerm(): string {
  try {
    return localStorage.getItem(SELECTED_TERM_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSelectedTerm(code: string) {
  try {
    if (code) localStorage.setItem(SELECTED_TERM_KEY, code);
  } catch {
    /* ignore storage failures (e.g. private mode) */
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

function sanitizeCourse(course: Course): Course {
  return { ...course, title: decodeHtmlEntities(course.title) };
}

type TermRecord = {
  code: string;
  description: string;
  is_current?: boolean;
};

type TermOption = {
  id: string;
  label: string;
};

type RawCourse = Record<string, unknown>;

type SavedScheduleRow = {
  slot: number;
  courses: Course[] | null;
  colors?: Record<string, string> | null;
};

type SchedulePayload = {
  user_id: string;
  term_id: string;
  slot: number;
  courses: Course[];
  colors: Record<string, string>;
  updated_at: string;
};

type FavoriteRow = {
  course_id?: string | null;
};

type FavoriteLookupRow = {
  course_id: string;
};

type MobileTab = "search" | "schedule";

function isMissingConflictTargetError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42P10" ||
    /no unique|no exclusion|conflict target|constraint/i.test(error.message ?? "")
  );
}

const Login = lazy(() => import("./pages/Login"));
const Reviews = lazy(() => import("./pages/Reviews"));
const EmptyClasses = lazy(() => import("./pages/EmptyClasses.tsx"));
const UpdatePassword = lazy(() => import("./pages/UpdatePassword.tsx"));
const GPAPage = lazy(() => import("./pages/GPAPage"));
const GradeCalculator = lazy(() => import("./components/GradeCalculator"));
const AdminPortal = lazy(() => import("./pages/AdminPortal"));

function readCachedJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeCachedJson(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can fail in private mode or if quota is exhausted.
  }
}

function formatTermOptions(terms: TermRecord[]): TermOption[] {
  return terms.map((term) => ({
    id: term.code,
    label: term.description,
  }));
}

function PageFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--muted)",
        fontSize: 14,
      }}
    >
      Loading...
    </div>
  );
}

const COURSE_COLORS = [
  "#1a5fa8",
  "#1a7a45",
  "#6b2d8b",
  "#b35a0a",
  "#0e6b5e",
  "#8a6d0b",
  "#123d6e",
  "#7a1f1f",
  "#1a6e8a",
  "#2d5a1a",
];

export default function App() {
  const appName = "UniFlow";
  const navigate = useNavigate();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const [showLoginHint, setShowLoginHint] = useState(true);
  const supabase = useSupabase();
  const { appUserId, loading: appUserLoading } = useAppUser();
  const userId = appUserId ?? null;
  const initialTerms = useMemo(
    () => readCachedJson<TermRecord[]>(TERMS_CACHE_KEY) ?? [],
    [],
  );

  const [semesters, setSemesters] = useState<TermOption[]>(() =>
    formatTermOptions(initialTerms),
  );
  const [semesterId, setSemesterId] = useState(() => {
    const saved = readSelectedTerm();
    if (saved && initialTerms.some((term) => term.code === saved)) return saved;
    return initialTerms.find((term) => term.is_current)?.code ?? saved;
  });
  const semesterLabel = useMemo(
    () => semesters.find((s) => s.id === semesterId)?.label ?? "Semester",
    [semesterId, semesters],
  );

  // Remember the last selected semester across sessions.
  useEffect(() => {
    writeSelectedTerm(semesterId);
  }, [semesterId]);

  useEffect(() => {
    fetch(`${API_URL}/api/terms`)
      .then((res) => res.json())
      .then((data: TermRecord[]) => {
        writeCachedJson(TERMS_CACHE_KEY, data);
        setSemesters(formatTermOptions(data));
        setSemesterId((prev) => {
          // Keep the in-session selection if it's still a valid term.
          if (prev && data.some((term) => term.code === prev)) return prev;
          // Otherwise restore the last selection saved from a previous visit.
          const saved = readSelectedTerm();
          if (saved && data.some((term) => term.code === saved)) return saved;
          // Fall back to the current term only when nothing else is valid.
          return data.find((term) => term.is_current)?.code ?? prev;
        });
      })
      .catch(() => setSemesters([]));
  }, []);

  const [allCourses, setAllCourses] = useState<Course[]>([]);

  useEffect(() => {
    if (!semesterId) return;
    const cacheKey = `${COURSE_CACHE_PREFIX}${semesterId}`;
    const cachedCourses = readCachedJson<RawCourse[]>(cacheKey);
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;
      setAllCourses(
        cachedCourses?.length ? mapApiCoursesToCourses(cachedCourses).map(sanitizeCourse) : [],
      );
    });

    const controller = new AbortController();
    fetch(`${API_URL}/api/courses?term=${semesterId}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: RawCourse[]) => {
        writeCachedJson(cacheKey, data);
        setAllCourses(mapApiCoursesToCourses(data).map(sanitizeCourse));
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && !cachedCourses?.length) {
          setAllCourses([]);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [semesterId]);

  const [activeLeftTab, setActiveLeftTab] = useState<"welcome" | "info" | "crn">("info");
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [hoveredCourse, setHoveredCourse] = useState<Course | null>(null);
  const [favorites, setFavorites] = useState<Course[]>([]);
  const [customColors, setCustomColors] = useState<Map<string, string>>(new Map());

  const [activeSlot, setActiveSlot] = useState(1);
  const [schedules, setSchedules] = useState<Record<number, Course[]>>({
    1: [],
    2: [],
    3: [],
  });

  const [mobileTab, setMobileTab] = useState<MobileTab>("schedule");

  // Load schedules — filtered by term_id
  useEffect(() => {
    let cancelled = false;

    async function loadSchedules() {
      if (!userId || !semesterId) return;

      const result = await supabase
        .from("schedules")
        .select("slot, courses, colors")
        .eq("user_id", userId)
        .eq("term_id", semesterId);

      if (cancelled) return;

      if (result.error) {
        console.error("Could not load schedules:", result.error);
        return;
      }

      const rows = result.data as SavedScheduleRow[] | null;
      const loaded: Record<number, Course[]> = { 1: [], 2: [], 3: [] };
      const loadedColors = new Map<string, string>();

      // Only treat the catalog as authoritative once it has actually loaded;
      // while it's still empty we keep snapshots so the slots don't flash empty.
      const catalogReady = allCourses.length > 0;

      (rows ?? []).forEach((row) => {
        // Re-resolve registered courses against the live catalog: live data when
        // still offered, dropped when no longer offered, snapshot while loading.
        loaded[row.slot] = resolveRegisteredCourses(
          row.courses ?? [],
          allCourses,
          catalogReady,
        ).map(sanitizeCourse);
        if (row.colors) {
          Object.entries(row.colors).forEach(([id, color]) => {
            loadedColors.set(id, color);
          });
        }
      });

      setSchedules(loaded);
      setCustomColors(loadedColors);
    }

    if (appUserLoading) return;
    if (!userId || !semesterId) {
      Promise.resolve().then(() => {
        setSchedules({ 1: [], 2: [], 3: [] });
        setCustomColors(new Map());
      });
      return;
    }
    void loadSchedules();

    return () => {
      cancelled = true;
    };
  }, [supabase, userId, semesterId, appUserLoading, allCourses]);

  // Load favorites — wait for allCourses to be ready before resolving course objects
  useEffect(() => {
    let cancelled = false;

    async function loadFavorites() {
      if (!userId) return;

      const result = await supabase
        .from("favorites")
        .select("course_id")
        .eq("user_id", userId);

      if (cancelled) return;

      if (result.error) {
        console.error("Could not load favorites:", result.error);
        return;
      }

      const rows = result.data as FavoriteRow[] | null;

      setFavorites(
        (rows ?? [])
          .map((row) => allCourses.find((course) => course.id === row.course_id) ?? null)
          .filter((course): course is Course => Boolean(course))
          .map(sanitizeCourse),
      );
    }

    if (appUserLoading) return;
    if (!userId) {
      Promise.resolve().then(() => setFavorites([]));
      return;
    }
    // Wait until courses are loaded so we can resolve course objects from IDs
    if (!allCourses.length) return;

    void loadFavorites();

    return () => {
      cancelled = true;
    };
  }, [supabase, userId, appUserLoading, allCourses]);

  // Save a schedule slot — always includes term_id
  const saveSlot = useCallback(
    async (slot: number, courses: Course[], colors?: Map<string, string>) => {
      if (!userId || !semesterId) {
        console.warn("Skipped schedule save because the user or semester is not ready yet.");
        return false;
      }

      const payload: SchedulePayload = {
        user_id: userId,
        term_id: semesterId,
        slot,
        courses,
        colors: colors ? Object.fromEntries(colors) : Object.fromEntries(customColors),
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("schedules")
        .upsert(payload, { onConflict: "user_id,slot,term_id" });

      if (!upsertError) return true;

      // Fallback: if upsert conflict target fails, do manual check-then-write
      if (isMissingConflictTargetError(upsertError)) {
        const { data: existing, error: lookupError } = await supabase
          .from("schedules")
          .select("slot")
          .eq("user_id", userId)
          .eq("term_id", semesterId)
          .eq("slot", slot)
          .maybeSingle<{ slot: number }>();

        if (lookupError) {
          console.error("Could not check existing schedule:", lookupError);
          return false;
        }

        const { error: writeError } = existing
          ? await supabase
              .from("schedules")
              .update(payload)
              .eq("user_id", userId)
              .eq("term_id", semesterId)
              .eq("slot", slot)
          : await supabase.from("schedules").insert(payload);

        if (writeError) {
          console.error("Could not save schedule:", writeError);
          return false;
        }

        return true;
      }

      console.error("Could not save schedule:", upsertError);
      return false;
    },
    [supabase, userId, semesterId, customColors],
  );

  const toggleFavorite = useCallback(
    async (course: Course) => {
      if (!userId) {
        console.warn("Skipped favorite save because the user is not ready yet.");
        return;
      }

      const exists = favorites.some((c) => c.id === course.id);

      if (exists) {
        const previousFavorites = favorites;
        setFavorites((prev) => prev.filter((c) => c.id !== course.id));
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", userId)
          .eq("course_id", course.id);
        if (error) {
          console.error("Could not remove favorite:", error);
          setFavorites(previousFavorites);
        }
      } else {
        const previousFavorites = favorites;
        setFavorites((prev) => [...prev, course]);

        const payload = { user_id: userId, course_id: course.id };
        const { error: upsertError } = await supabase
          .from("favorites")
          .upsert(payload, { onConflict: "user_id,course_id" });

        let writeError = upsertError;

        // Fallback: if upsert conflict target fails, do manual check-then-write
        if (isMissingConflictTargetError(upsertError)) {
          const { data: existing, error: lookupError } = await supabase
            .from("favorites")
            .select("course_id")
            .eq("user_id", userId)
            .eq("course_id", course.id)
            .maybeSingle<FavoriteLookupRow>();

          if (lookupError) {
            writeError = lookupError;
          } else if (existing) {
            writeError = null;
          } else {
            const { error: insertError } = await supabase
              .from("favorites")
              .insert(payload);
            writeError = insertError;
          }
        }

        if (writeError) {
          console.error("Could not save favorite:", writeError);
          setFavorites(previousFavorites);
        }
      }
    },
    [supabase, userId, favorites],
  );

  const scheduled = useMemo(
    () => schedules[activeSlot] ?? EMPTY_COURSES,
    [schedules, activeSlot],
  );

  const toggleSchedule = (course: Course) => {
    const current = schedules[activeSlot];
    const exists = current.some((c) => c.id === course.id);
    const updated = exists
      ? current.filter((c) => c.id !== course.id)
      : [...current, course];
    const newSchedules = { ...schedules, [activeSlot]: updated };
    setSchedules(newSchedules);
    void saveSlot(activeSlot, updated);
    if (!exists) {
      const alreadyFav = favorites.some((f) => f.id === course.id);
      if (!alreadyFav) toggleFavorite(course);
    }
  };

  const scheduledIds = useMemo(
    () => new Set(scheduled.map((c) => c.id)),
    [scheduled],
  );
  const favoriteIds = useMemo(
    () => new Set(favorites.map((c) => c.id)),
    [favorites],
  );
  const selectedCrns = useMemo(() => scheduled.map((c) => c.crn), [scheduled]);
  const totalCredits = useMemo(
    () => scheduled.reduce((acc, c) => acc + (c.credits ?? 0), 0),
    [scheduled],
  );
  const [courseDifficulties, setCourseDifficulties] = useState<Record<string, number>>({});
  const courseDifficultiesRef = useRef(courseDifficulties);
  const difficultyRequestsRef = useRef(new Set<string>());

  useEffect(() => {
    courseDifficultiesRef.current = courseDifficulties;
  }, [courseDifficulties]);

  useEffect(() => {
    scheduled.forEach((c) => {
      const [dept, num] = c.code.split(" ");
      if (
        courseDifficultiesRef.current[c.code] !== undefined ||
        difficultyRequestsRef.current.has(c.code)
      ) {
        return;
      }
      difficultyRequestsRef.current.add(c.code);
      fetch(`${API_URL}/api/ratings/course/${dept}/${num}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.averages?.difficulty > 0) {
            setCourseDifficulties((prev) => {
              if (prev[c.code] !== undefined) return prev;
              return { ...prev, [c.code]: parseFloat(data.averages.difficulty) };
            });
          }
          difficultyRequestsRef.current.delete(c.code);
        })
        .catch(() => {
          difficultyRequestsRef.current.delete(c.code);
        });
    });
  }, [scheduled]);

  const averageDifficulty = useMemo(() => {
    const rated = scheduled.filter((c) => courseDifficulties[c.code] !== undefined);
    if (rated.length === 0) return null;
    return rated.reduce((acc, c) => acc + courseDifficulties[c.code], 0) / rated.length;
  }, [scheduled, courseDifficulties]);

  const courseColorMap = useMemo(() => {
    const map = new Map<string, string>();
    scheduled.forEach((c, i) => {
      map.set(c.id, customColors.get(c.id) ?? COURSE_COLORS[i % COURSE_COLORS.length]);
    });
    return map;
  }, [scheduled, customColors]);

  const handleColorChange = (courseId: string, color: string) => {
    const updated = new Map(customColors).set(courseId, color);
    setCustomColors(updated);
    void saveSlot(activeSlot, scheduled, updated);
  };

  const displayedCourse = hoveredCourse ?? selectedCourse;

  const selectCourse = (course: Course) => {
    setSelectedCourse(course);
    setActiveLeftTab("info");
  };

  const handleHoverCourse = (course: Course | null) => {
    setHoveredCourse(course);
    if (course) setActiveLeftTab("info");
  };

  const handleApplyAISchedule = (courses: Course[]) => {
    const current = schedules[activeSlot] ?? [];
    const currentIds = new Set(current.map((course) => course.id));
    const coursesToAdd = courses.filter((course) => !currentIds.has(course.id));
    const mergedCourses = [...current, ...coursesToAdd];
    const newSchedules = { ...schedules, [activeSlot]: mergedCourses };
    setSchedules(newSchedules);
    void saveSlot(activeSlot, mergedCourses);
    coursesToAdd.forEach((c) => {
      const alreadyFav = favorites.some((f) => f.id === c.id);
      if (!alreadyFav) toggleFavorite(c);
    });
  };

  const mainApp = appUserLoading ? <PageFallback /> : (
    <div className="appShell" style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TopNav
        appName={appName}
        semesterId={semesterId}
        semesters={semesters}
        semesterLabel={semesterLabel}
        lastUpdatedText={semesterId ? semesterLabel : "Demo data"}
        onSemesterChange={setSemesterId}
        scheduledCourses={scheduled}
        activePage="home"
      />

      <div className="mobileTabs">
        <button
          className={`mobileTab${mobileTab === "schedule" ? " isActive" : ""}`}
          onClick={() => setMobileTab("schedule")}
        >
          📅 Schedule
        </button>
        <button
          className={`mobileTab${mobileTab === "search" ? " isActive" : ""}`}
          onClick={() => setMobileTab("search")}
        >
          🔍 Search
        </button>
      </div>

      <div className="mainContainer" style={{ flex: 1, minHeight: 0 }}>
        <LeftInfoPanel
          activeTab={activeLeftTab}
          onTabChange={setActiveLeftTab}
          selectedCourse={displayedCourse}
          selectedCrns={selectedCrns}
          scheduled={scheduled}
          onToggleSchedule={toggleSchedule}
        />

        <div
          style={{ display: "contents" }}
          className={`mobilePanel mobilePanel--schedule${mobileTab === "schedule" ? " isVisible" : ""}`}
        >
          <ScheduleGrid
            courses={scheduled}
            hoveredCourse={hoveredCourse}
            scheduledIds={scheduledIds}
            courseColorMap={courseColorMap}
            onSelectCourse={selectCourse}
            onHoverCourse={handleHoverCourse}
            onColorChange={handleColorChange}
            onToggleFavorite={toggleFavorite}
            onToggleSchedule={toggleSchedule}
            favoriteIds={favoriteIds}
            semesterLabel={semesterLabel}
          />
        </div>

        <div
          style={{ display: "contents" }}
          className={`mobilePanel mobilePanel--search${mobileTab === "search" ? " isVisible" : ""}`}
        >
          <RightSearchPanel
            allCourses={allCourses}
            scheduled={scheduled}
            favorites={favorites}
            onSelectCourse={selectCourse}
            onToggleSchedule={toggleSchedule}
            onToggleFavorite={toggleFavorite}
            onHoverCourse={handleHoverCourse}
            averageDifficulty={averageDifficulty}
            totalCredits={totalCredits}
            activeSlot={activeSlot}
            onSlotChange={setActiveSlot}
          />
        </div>
      </div>

      <AIScheduler
        allCourses={allCourses}
        scheduledCourses={scheduled}
        onApplySchedule={handleApplyAISchedule}
        activeSlot={activeSlot}
      />

      {authLoaded && !isSignedIn && showLoginHint && (
        <div className="uf-login-hint" role="status">
          <span className="uf-login-hint__text">
            You&apos;re browsing as a guest. Sign in to save your schedule to your account.
          </span>
          <div className="uf-login-hint__actions">
            <button
              type="button"
              className="uf-login-hint__signin"
              onClick={() => navigate("/login")}
            >
              Sign in
            </button>
            <button
              type="button"
              className="uf-login-hint__close"
              aria-label="Dismiss"
              onClick={() => setShowLoginHint(false)}
            >
              ✕
            </button>
          </div>
          <style>{`
            .uf-login-hint {
              position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
              z-index: 9999; display: flex; align-items: center; gap: 12px;
              max-width: 92vw;
              background: var(--panel, #fff); color: var(--text, #111827);
              border: 1px solid var(--border, #e5e7eb); border-radius: 12px;
              padding: 10px 12px 10px 16px;
              box-shadow: 0 8px 28px rgba(0,0,0,0.18);
              font-size: 13px; line-height: 1.4;
            }
            .uf-login-hint__text { font-weight: 600; }
            .uf-login-hint__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
            .uf-login-hint__signin {
              border: 0; border-radius: 8px; background: #2563eb; color: #fff;
              font: inherit; font-weight: 700; font-size: 12px;
              padding: 7px 14px; cursor: pointer; white-space: nowrap;
            }
            .uf-login-hint__signin:hover { background: #1d4ed8; }
            .uf-login-hint__close {
              border: 0; background: transparent; color: var(--muted, #9ca3af);
              font-size: 13px; cursor: pointer; width: 26px; height: 26px;
              border-radius: 7px; flex-shrink: 0;
            }
            .uf-login-hint__close:hover { background: rgba(0,0,0,0.06); }
          `}</style>
        </div>
      )}
    </div>
  );

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={mainApp} />
        <Route
          path="/reviews"
          element={
            <ProtectedRoute>
              <Reviews />
            </ProtectedRoute>
          }
        />
        <Route
          path="/empty-classes"
          element={
            <ProtectedRoute>
              <EmptyClasses />
            </ProtectedRoute>
          }
        />
        <Route path="/update-password" element={<UpdatePassword />} />
        <Route path="/gpa" element={<GPAPage />} />
        <Route path="/grade-calculator" element={<GradeCalculator />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminPortal />
            </AdminRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}