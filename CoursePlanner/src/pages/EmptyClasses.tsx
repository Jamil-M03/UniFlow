import { useEffect, useMemo, useState } from 'react';
import MeetingRoomOutlinedIcon from '@mui/icons-material/MeetingRoomOutlined';
import type { Course } from '../types.ts';
import { TopNav } from '../components/TopNav.tsx';
import {
  buildClassroomAvailability,
  type ClassroomAvailability,
} from '../utils/classroomAvailability.ts';
import { mapApiCoursesToCourses } from '../utils/courseApi.ts';
import { type FreeSlot, timeToMinutes, type WeekdayKey } from '../utils/schedule.ts';

const API_ROOT = import.meta.env.VITE_API_URL || "";
const START_OF_DAY = '08:00';
const END_OF_DAY = '21:00';
const ROOM_SORTER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

type RoomStatus = {
  tone: 'free' | 'busy';
  headline: string;
  detail: string;
};

function getTodayKey(now: Date): WeekdayKey {
  const day = now.getDay();
  switch (day) {
    case 1: return 'Mon';
    case 2: return 'Tue';
    case 3: return 'Wed';
    case 4: return 'Thu';
    case 5: return 'Fri';
    case 6: return 'Sat';
    default: return 'Mon';
  }
}

function formatClock(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const normalizedHours = Number.isFinite(hours) ? hours : 0;
  const normalizedMinutes = Number.isFinite(minutes) ? minutes : 0;
  const h12 = normalizedHours % 12 || 12;
  const period = normalizedHours >= 12 ? 'PM' : 'AM';
  return `${h12}:${String(normalizedMinutes).padStart(2, '0')} ${period}`;
}

function formatDurationMinutes(durationMinutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(durationMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours && minutes) {
    return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ${minutes} mins`;
  }
  if (hours) {
    return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
  }
  return `${minutes} mins`;
}

function getSlotDuration(slot: FreeSlot): number {
  const start = timeToMinutes(slot.start) ?? 0;
  const end = timeToMinutes(slot.end) ?? start;
  return Math.max(0, end - start);
}

function isAllDaySlot(slot: FreeSlot | undefined): boolean {
  return Boolean(slot && slot.start === START_OF_DAY && slot.end === END_OF_DAY);
}

function getRoomStatus(
  room: ClassroomAvailability,
  day: WeekdayKey,
  currentTime: string,
): RoomStatus {
  const nowMinutes = timeToMinutes(currentTime) ?? 0;
  const dayEndMinutes = timeToMinutes(END_OF_DAY) ?? (21 * 60);
  const freeSlots = room.freeSlotsByDay[day] ?? [];

  if (freeSlots.length === 1 && isAllDaySlot(freeSlots[0])) {
    return {
      tone: 'free',
      headline: 'Free all day',
      detail: `${formatClock(START_OF_DAY)} - ${formatClock(END_OF_DAY)}`,
    };
  }

  const currentFreeSlot = freeSlots.find((slot) => {
    const start = timeToMinutes(slot.start) ?? 0;
    const end = timeToMinutes(slot.end) ?? 0;
    return nowMinutes >= start && nowMinutes < end;
  });

  if (currentFreeSlot) {
    const slotEnd = timeToMinutes(currentFreeSlot.end) ?? dayEndMinutes;
    if (slotEnd >= dayEndMinutes) {
      return {
        tone: 'free',
        headline: 'Free for the rest of the day',
        detail: `Until ${formatClock(currentFreeSlot.end)}`,
      };
    }

    return {
      tone: 'free',
      headline: `Free until ${formatClock(currentFreeSlot.end)}`,
      detail: `${formatDurationMinutes(slotEnd - nowMinutes)} left`,
    };
  }

  const nextFreeSlot = freeSlots.find((slot) => {
    const end = timeToMinutes(slot.end) ?? 0;
    return end > nowMinutes;
  });

  if (nextFreeSlot) {
    const slotStart = timeToMinutes(nextFreeSlot.start) ?? 0;
    const slotEnd = timeToMinutes(nextFreeSlot.end) ?? dayEndMinutes;

    if (nowMinutes < slotStart) {
      if (slotEnd >= dayEndMinutes) {
        return {
          tone: 'free',
          headline: `Free from ${formatClock(nextFreeSlot.start)}`,
          detail: 'For the rest of the day',
        };
      }

      return {
        tone: 'free',
        headline: `${formatClock(nextFreeSlot.start)} - ${formatClock(nextFreeSlot.end)}`,
        detail: `${formatDurationMinutes(slotEnd - slotStart)} open window`,
      };
    }

    if (slotEnd >= dayEndMinutes) {
      return {
        tone: 'busy',
        headline: `Free at ${formatClock(nextFreeSlot.start)}`,
        detail: 'For the rest of the day',
      };
    }

    return {
      tone: 'busy',
      headline: `Free at ${formatClock(nextFreeSlot.start)}`,
      detail: `For ${formatDurationMinutes(slotEnd - slotStart)}`,
    };
  }

  return {
    tone: 'busy',
    headline: 'Occupied for the rest of the day',
    detail: 'No open window remains today',
  };
}

export default function EmptyClasses() {
  const [semesters, setSemesters] = useState<{ id: string; label: string }[]>([]);
  const [semesterId, setSemesterId] = useState('');
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [buildingDraft, setBuildingDraft] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState('');
  const [loadingTerms, setLoadingTerms] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const semesterLabel = useMemo(
    () => semesters.find((semester) => semester.id === semesterId)?.label ?? 'Semester',
    [semesterId, semesters],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoadingTerms(true);
    fetch(`${API_ROOT}/api/terms`)
      .then((response) => response.json())
      .then((data) => {
        const formatted = Array.isArray(data)
          ? data.map((term: { code: string; description: string }) => ({
            id: term.code,
            label: term.description,
          }))
          : [];
        setSemesters(formatted);

        const current = Array.isArray(data)
          ? data.find((term: any) => Boolean(term?.is_current))
          : null;
        if (current?.code) {
          setSemesterId(String(current.code));
        }
      })
      .catch(() => {
        setSemesters([]);
        setError('Could not load semesters from the local API.');
      })
      .finally(() => setLoadingTerms(false));
  }, []);

  useEffect(() => {
    if (!semesterId) return;

    setLoadingCourses(true);
    setError(null);
    setBuildingDraft('');
    setSelectedBuilding('');

    fetch(`${API_ROOT}/api/courses?term=${semesterId}`)
      .then((response) => response.json())
      .then((data) => setAllCourses(mapApiCoursesToCourses(data)))
      .catch(() => {
        setAllCourses([]);
        setError('Could not load classrooms for that semester.');
      })
      .finally(() => setLoadingCourses(false));
  }, [semesterId]);

  const roomAvailability = useMemo(
    () => buildClassroomAvailability(allCourses, {
      startOfDay: START_OF_DAY,
      endOfDay: END_OF_DAY,
      minGapMinutes: 15,
    }),
    [allCourses],
  );

  const buildingOptions = useMemo(() => (
    [...new Set(roomAvailability.map((room) => room.building))]
      .sort((left, right) => ROOM_SORTER.compare(left, right))
  ), [roomAvailability]);

  useEffect(() => {
    if (buildingDraft && !buildingOptions.includes(buildingDraft)) {
      setBuildingDraft('');
    }
    if (selectedBuilding && !buildingOptions.includes(selectedBuilding)) {
      setSelectedBuilding('');
    }
  }, [buildingDraft, buildingOptions, selectedBuilding]);

  const today = useMemo(() => new Date(now), [now]);
  const todayKey = useMemo(() => getTodayKey(today), [today]);
  const currentTime = useMemo(
    () => `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`,
    [today],
  );
  const formattedNow = useMemo(
    () => today.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    [today],
  );

  const visibleRooms = useMemo(() => (
    roomAvailability
      .filter((room) => room.building === selectedBuilding)
      .sort((left, right) => ROOM_SORTER.compare(left.room, right.room))
  ), [roomAvailability, selectedBuilding]);

  const roomCards = useMemo(() => (
    visibleRooms.map((room) => ({
      room,
      status: getRoomStatus(room, todayKey, currentTime),
    }))
  ), [currentTime, todayKey, visibleRooms]);

  const freeNowCount = roomCards.filter((entry) => entry.status.tone === 'free').length;
  const busyCount = roomCards.length - freeNowCount;

  return (
    <div className="emptyClassesShell">
      <TopNav
        appName="UniFlow"
        semesterId={semesterId}
        semesters={semesters}
        semesterLabel={semesterLabel}
        lastUpdatedText={selectedBuilding ? `Viewing ${selectedBuilding}` : 'Room availability'}
        onSemesterChange={setSemesterId}
        scheduledCourses={[]}
        activePage="empty-classes"
      />

      <main className="emptyClassesContent">
        <section className="emptyClassesHero">
          <div className="emptyClassesHero__copy">
            <div className="emptyClassesHero__eyebrow">
              <MeetingRoomOutlinedIcon fontSize="small" />
              Empty Classes
            </div>
            <h1 className="emptyClassesHero__title">Discover when each classroom opens up.</h1>
            <p className="emptyClassesHero__text">
              Pick your semester and building, and we will reverse the course schedule into room-by-room
              open windows for today.
            </p>
          </div>

          <div className="emptyClassesFilters">
            <label className="emptyClassesField">
              <span>Semester</span>
              <select
                className="emptyClassesSelect"
                value={semesterId}
                onChange={(event) => setSemesterId(event.target.value)}
                disabled={loadingTerms}
              >
                <option value="">{loadingTerms ? 'Loading semesters...' : 'Select semester'}</option>
                {semesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="emptyClassesField">
              <span>Building</span>
              <select
                className="emptyClassesSelect"
                value={buildingDraft}
                onChange={(event) => setBuildingDraft(event.target.value)}
                disabled={!semesterId || loadingCourses || buildingOptions.length === 0}
              >
                <option value="">
                  {loadingCourses
                    ? 'Loading buildings...'
                    : buildingOptions.length
                      ? 'Select building'
                      : 'No classrooms found'}
                </option>
                {buildingOptions.map((building) => (
                  <option key={building} value={building}>
                    {building}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="emptyClassesButton"
              disabled={!buildingDraft}
              onClick={() => setSelectedBuilding(buildingDraft)}
            >
              Select
            </button>
          </div>
        </section>

        {selectedBuilding ? (
          <section className="emptyClassesSummary">
            <div className="emptyClassesStat">
              <span className="emptyClassesStat__label">Showing</span>
              <strong className="emptyClassesStat__value">{roomCards.length} rooms</strong>
              <span className="emptyClassesStat__hint">{selectedBuilding}</span>
            </div>
            <div className="emptyClassesStat">
              <span className="emptyClassesStat__label">Free right now</span>
              <strong className="emptyClassesStat__value">{freeNowCount}</strong>
              <span className="emptyClassesStat__hint">{todayKey} at {formattedNow}</span>
            </div>
            <div className="emptyClassesStat">
              <span className="emptyClassesStat__label">Currently occupied</span>
              <strong className="emptyClassesStat__value">{busyCount}</strong>
              <span className="emptyClassesStat__hint">Based on today&apos;s section times</span>
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="emptyClassesState">
            <strong>Could not load classroom availability.</strong>
            <span>{error}</span>
          </section>
        ) : null}

        {!error && !selectedBuilding ? (
          <section className="emptyClassesState">
            <strong>Select a building to begin.</strong>
            <span>We&apos;ll show every tracked room and when it becomes free today.</span>
          </section>
        ) : null}

        {!error && selectedBuilding && roomCards.length === 0 ? (
          <section className="emptyClassesState">
            <strong>No rooms found for {selectedBuilding}.</strong>
            <span>Try a different semester or building.</span>
          </section>
        ) : null}

        {!error && roomCards.length > 0 ? (
          <section className="emptyClassesRooms">
            {roomCards.map(({ room, status }) => (
              <article key={room.roomKey} className="roomCard">
                <div className="roomCard__header">
                  <div>
                    <div className="roomCard__eyebrow">Room</div>
                    <h2 className="roomCard__title">{room.room}</h2>
                  </div>
                  <span className={`roomCard__badge is-${status.tone}`}>
                    {status.tone === 'free' ? 'Open' : 'Busy'}
                  </span>
                </div>

                <p className={`roomCard__status is-${status.tone}`}>{status.headline}</p>
                <p className="roomCard__detail">{status.detail}</p>

                <div className="roomCard__meta">
                  <span>Today&apos;s open windows</span>
                  <span>{room.courseCodes.length} tracked {room.courseCodes.length === 1 ? 'course' : 'courses'}</span>
                </div>

                <div className="roomCard__slots">
                  {room.freeSlotsByDay[todayKey].length === 0 ? (
                    <span className="roomCard__empty">No open window of 15+ minutes today.</span>
                  ) : room.freeSlotsByDay[todayKey].map((slot) => {
                    const slotStart = timeToMinutes(slot.start) ?? 0;
                    const slotEnd = timeToMinutes(slot.end) ?? slotStart;
                    const nowMinutes = timeToMinutes(currentTime) ?? 0;
                    const isCurrent = nowMinutes >= slotStart && nowMinutes < slotEnd;

                    return (
                      <span
                        key={`${room.roomKey}-${slot.start}-${slot.end}`}
                        className={`roomCard__slot${isCurrent ? ' isCurrent' : ''}`}
                      >
                        {formatClock(slot.start)} - {formatClock(slot.end)} ({formatDurationMinutes(getSlotDuration(slot))})
                      </span>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </main>
    </div>
  );
}
