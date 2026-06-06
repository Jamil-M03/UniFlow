// src/components/AIScheduler.tsx
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Course } from "../types";

const API = import.meta.env.VITE_API_URL || "";

type Message = { role: "user" | "assistant"; content: string };
type ReviewTarget = {
  label: string;
  url: string;
};

type Props = {
  allCourses: Course[];
  scheduledCourses: Course[];
  onApplySchedule: (courses: Course[]) => void;
  activeSlot: number;
};

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const DAY_LABELS: Record<string, string> = {
  M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat",
};

function dayLabel(d: string) {
  return DAY_LABELS[d] ?? d;
}

function normalizeCourseCode(code: string): string {
  const match = code.toUpperCase().match(/^([A-Z]{2,5})\s*(\d{3}[A-Z]*)$/);
  return match ? `${match[1]} ${match[2]}` : code.toUpperCase().replace(/\s+/, " ").trim();
}

function extractCourseCodes(text: string): string[] {
  const matches = text.toUpperCase().match(/[A-Z]{2,5}\s*\d{3}[A-Z]*/g) ?? [];
  return [...new Set(matches.map(normalizeCourseCode))];
}

const ATTRIBUTE_TOKEN_STOP_WORDS = new Set([
  "a", "an", "and", "attribute", "attributes", "class", "course", "courses",
  "department", "departments", "dept", "requirement", "requirements", "the", "with",
]);

const DEPARTMENT_ALIASES: Record<string, string[]> = {
  ENGL: ["english", "engl"],
  MUSC: ["music", "musc"],
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
};

type AttributeMatch = { attribute: string; score: number };
type InstructorMatch = { instructor: string; score: number };

type SchedulerSection = Pick<
  Course,
  | "id" | "code" | "title" | "instructor" | "section" | "capacity"
  | "meetings" | "isSectionLinked" | "linkIdentifier" | "scheduleType" | "subjectCourse"
> & {
  seatsRemaining: number | null;
  isFull: boolean;
  capacityNote: string;
};

type SchedulerContext = {
  attributeQuery: string;
  courseCodes: string[];
  instructorQuery: string;
};

function getCourseDepartment(course: Course): string {
  return normalizeCourseCode(course.code).split(" ")[0] ?? "";
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter((token) => token && !ATTRIBUTE_TOKEN_STOP_WORDS.has(token));
}

const INSTRUCTOR_TOKEN_STOP_WORDS = new Set([
  "and", "by", "doctor", "dr", "instructor", "prof", "professor", "taught", "teacher", "the", "with",
]);

function tokenizeInstructorName(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter((token) => token.length > 1 && !INSTRUCTOR_TOKEN_STOP_WORDS.has(token) && token !== "tba");
}

function tokenMatchesMessage(token: string, normalizedMessage: string): boolean {
  if (normalizedMessage.includes(token)) return true;
  if (token === "cultural") return normalizedMessage.includes("culture") || normalizedMessage.includes("cultures");
  if (token === "historical") return normalizedMessage.includes("history") || normalizedMessage.includes("histories");
  if (token.endsWith("ies")) return normalizedMessage.includes(`${token.slice(0, -3)}y`);
  if (token.endsWith("s") && token.length > 3) return normalizedMessage.includes(token.slice(0, -1));
  return false;
}

function findAttributeMatches(text: string, courses: Course[]): AttributeMatch[] {
  const normalizedMessage = normalizeSearchText(text);
  if (!normalizedMessage) return [];

  const attributes = new Map<string, string>();
  courses.forEach((course) => {
    course.attributes?.forEach((attribute) => {
      const trimmed = String(attribute).trim();
      if (!trimmed) return;
      attributes.set(trimmed.toLowerCase(), trimmed);
    });
  });

  return [...attributes.values()]
    .map((attribute) => {
      const normalizedAttribute = normalizeSearchText(attribute);
      const tokens = tokenizeSearchText(attribute);
      if (!normalizedAttribute || !tokens.length) return { attribute, score: 0 };

      let score = normalizedMessage.includes(normalizedAttribute) ? 20 : 0;
      const matchedTokens = tokens.filter((token) => tokenMatchesMessage(token, normalizedMessage));

      if (matchedTokens.length === tokens.length) score += 12;
      else score += matchedTokens.length * 4;

      if (matchedTokens.length > 0 && /\b(attribute|requirement|gen ed|general education|theme)\b/.test(normalizedMessage)) score += 2;

      return { attribute, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.attribute.localeCompare(b.attribute));
}

function findInstructorMatches(text: string, courses: Course[]): InstructorMatch[] {
  const normalizedMessage = normalizeSearchText(text);
  if (!normalizedMessage) return [];

  const instructors = new Map<string, string>();
  courses.forEach((course) => {
    const instructor = String(course.instructor ?? "").trim();
    if (!instructor || normalizeSearchText(instructor) === "tba") return;
    instructors.set(instructor.toLowerCase(), instructor);
  });

  return [...instructors.values()]
    .map((instructor) => {
      const tokens = tokenizeInstructorName(instructor);
      if (!tokens.length) return { instructor, score: 0 };

      const normalizedInstructor = tokens.join(" ");
      let score = normalizedMessage.includes(normalizedInstructor) ? 20 : 0;
      const matchedTokens = tokens.filter((token) => normalizedMessage.includes(token));

      if (matchedTokens.length === tokens.length) score += 12;
      else if (matchedTokens.length >= Math.min(2, tokens.length)) score += matchedTokens.length * 5;
      else if (matchedTokens.length === 1 && matchedTokens[0].length >= 5 && /\b(by|dr|doctor|instructor|prof|professor|taught|teacher|with)\b/.test(normalizedMessage)) score += 6;

      return { instructor, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.instructor.localeCompare(b.instructor));
}

function getStrongInstructorMatches(text: string, courses: Course[]): InstructorMatch[] {
  const matches = findInstructorMatches(text, courses);
  const bestScore = matches[0]?.score ?? 0;
  if (bestScore <= 0) return [];
  return matches.filter((match) => match.score === bestScore).slice(0, 3);
}

function filterCoursesByInstructors(courses: Course[], instructorMatches: InstructorMatch[]) {
  if (!instructorMatches.length) return courses;
  const allowed = new Set(instructorMatches.map((match) => match.instructor.toLowerCase()));
  return courses.filter((course) => allowed.has(String(course.instructor ?? "").trim().toLowerCase()));
}

function extractDepartmentFilters(text: string, courses: Course[]): string[] {
  const normalizedMessage = normalizeSearchText(text);
  if (!normalizedMessage) return [];

  const availableDepartments = new Set(
    courses.map(getCourseDepartment).filter(Boolean).map((department) => department.toUpperCase()),
  );
  const filters = new Set<string>();

  availableDepartments.forEach((department) => {
    const normalizedDepartment = normalizeSearchText(department);
    if (new RegExp(`\\b${normalizedDepartment}\\b`).test(normalizedMessage)) filters.add(department);
  });

  Object.entries(DEPARTMENT_ALIASES).forEach(([department, aliases]) => {
    if (!availableDepartments.has(department)) return;
    if (aliases.some((alias) => new RegExp(`\\b${normalizeSearchText(alias)}\\b`).test(normalizedMessage))) filters.add(department);
  });

  return [...filters].sort();
}

function hasAttributeIntent(text: string): boolean {
  return /\b(attribute|attributes|culture|cultures|gen ed|general education|history|histories|humanity|humanities|requirement|requirements|science|sciences|theme)\b/.test(normalizeSearchText(text));
}

function hasInstructorIntent(text: string): boolean {
  return /\b(by|dr|doctor|instructor|prof|professor|taught|teacher)\b/.test(normalizeSearchText(text));
}

function isFollowUpRequest(text: string): boolean {
  return /\b(again|another|also|anyway|change|different|else|instead|it|more|next|one more|other|same|still|that|this|try)\b/.test(normalizeSearchText(text));
}

function hasScheduleActionReference(text: string): boolean {
  const normalized = normalizeSearchText(text);
  return /\b(add|include|keep|put|schedule|select|use)\b/.test(normalized) && /\b(anyway|it|same|still|that|this)\b/.test(normalized);
}

function hasPreferenceText(text: string): boolean {
  return /\b(avoid|easy|earlier|early|friday|fridays|late|later|morning|mornings|afternoon|afternoons|no|without|skip)\b/.test(normalizeSearchText(text));
}

function mergeCoursesById(courses: Course[]): Course[] {
  const seen = new Set<string>();
  const merged: Course[] = [];
  courses.forEach((course) => {
    if (seen.has(course.id)) return;
    seen.add(course.id);
    merged.push(course);
  });
  return merged;
}

function extractSuggestionLimit(text: string): number {
  const normalized = normalizeSearchText(text);
  const digitMatch = normalized.match(/\b([1-5])\s+(?:more\s+)?(?:course|courses|class|classes)\b/);
  if (digitMatch) return Number(digitMatch[1]);
  for (const [word, count] of Object.entries(NUMBER_WORDS)) {
    const pattern = new RegExp(`\\b${word}\\s+(?:more\\s+)?(?:course|courses|class|classes)\\b`);
    if (pattern.test(normalized)) return count;
  }
  return 1;
}

function buildAttributeCandidateSections(text: string, allCourses: Course[], scheduledCourses: Course[]) {
  const matches = findAttributeMatches(text, allCourses);
  const departmentFilters = extractDepartmentFilters(text, allCourses);
  const instructorMatches = getStrongInstructorMatches(text, allCourses);

  if (!matches.length) {
    const instructorSections = filterCoursesByInstructors(
      allCourses.filter((course) => {
        if (!instructorMatches.length) return false;
        if (departmentFilters.length > 0 && !departmentFilters.includes(getCourseDepartment(course))) return false;
        return !scheduledCourses.some((scheduled) => scheduled.code === course.code);
      }),
      instructorMatches,
    );
    return {
      sections: instructorSections,
      matchedAttributes: [] as string[],
      matchedDepartments: departmentFilters,
      matchedInstructors: instructorMatches.map((match) => match.instructor),
    };
  }

  const matchScores = new Map(matches.map((match) => [match.attribute, match.score]));
  const allowedDepartments = new Set(departmentFilters);
  const allowedInstructors = new Set(instructorMatches.map((match) => match.instructor.toLowerCase()));
  const scheduledCodes = new Set(scheduledCourses.map((course) => course.code));
  const codeScores = new Map<string, number>();

  allCourses.forEach((course) => {
    if (allowedDepartments.size > 0 && !allowedDepartments.has(getCourseDepartment(course))) return;
    if (scheduledCodes.has(course.code)) return;
    if (allowedInstructors.size > 0 && !allowedInstructors.has(String(course.instructor ?? "").trim().toLowerCase())) return;

    const score = (course.attributes ?? []).reduce((best, attribute) => Math.max(best, matchScores.get(attribute) ?? 0), 0);
    if (score <= 0) return;

    const limit = Number(course.capacity?.limit ?? 0);
    const enrolled = Number(course.capacity?.enrolled ?? 0);
    const hasOpenSeat = limit > 0 && enrolled < limit;
    const existingScore = codeScores.get(course.code) ?? 0;
    codeScores.set(course.code, Math.max(existingScore, score + (hasOpenSeat ? 1 : 0)));
  });

  const candidateCodes = new Set(
    [...codeScores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([code]) => code),
  );

  return {
    sections: allCourses.filter((course) => candidateCodes.has(course.code)),
    matchedAttributes: matches.slice(0, 3).map((match) => match.attribute),
    matchedDepartments: departmentFilters,
    matchedInstructors: instructorMatches.map((match) => match.instructor),
  };
}

function getCapacityNote(enrolled: number, limit: number): string {
  if (limit <= 0) return "No capacity data";
  if (enrolled === 0) return `Empty — 0 of ${limit} seats taken, ${limit} seats available`;
  if (enrolled >= limit) return `Full — ${enrolled} of ${limit} seats taken, 0 seats available`;
  return `${enrolled} of ${limit} seats taken, ${limit - enrolled} seats available`;
}

function compactCourseForScheduler(course: Course): SchedulerSection {
  const limit = Number(course.capacity?.limit ?? 0);
  const enrolled = Number(course.capacity?.enrolled ?? 0);
  const seatsRemaining = limit > 0 ? Math.max(0, limit - enrolled) : null;

  return {
    id: course.id,
    code: course.code,
    title: course.title,
    instructor: course.instructor,
    section: course.section,
    capacity: course.capacity,
    seatsRemaining,
    isFull: limit > 0 && enrolled >= limit,
    capacityNote: getCapacityNote(enrolled, limit),
    meetings: course.meetings,
    isSectionLinked: course.isSectionLinked,
    linkIdentifier: course.linkIdentifier,
    scheduleType: course.scheduleType,
    subjectCourse: course.subjectCourse,
  };
}

async function fetchDifficulty(code: string): Promise<number | null> {
  try {
    const [dept, num] = code.split(" ");
    const res = await fetch(`${API}/api/ratings/course/${dept}/${num}`);
    const data = await res.json();
    if (data.averages?.difficulty > 0) return parseFloat(data.averages.difficulty);
  } catch {
    return null;
  }
  return null;
}

export function AIScheduler({ allCourses, scheduledCourses, onApplySchedule, activeSlot }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI course assistant.\n\nI can do two things:\n1. Build a schedule from the course codes you want.\n2. Summarize what students wrote about a professor.\n\nTry:\n\"I want CMPS 271, MATH 201, ARAB 201. No Fridays, prefer mornings.\"\n\nOr:\n\"Summarize the reviews for Professor Jane Doe.\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [proposedSchedule, setProposedSchedule] = useState<Course[] | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [schedulerContext, setSchedulerContext] = useState<SchedulerContext>({
    attributeQuery: "",
    courseCodes: [],
    instructorQuery: "",
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Refocus the input whenever loading finishes so the user can
  // keep typing without having to click the box again.
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const directCourseCodes = extractCourseCodes(text);
      const hasPreviousSchedulerContext =
        schedulerContext.courseCodes.length > 0 ||
        Boolean(schedulerContext.attributeQuery) ||
        Boolean(schedulerContext.instructorQuery);
      const shouldUseContext =
        directCourseCodes.length === 0 &&
        hasPreviousSchedulerContext &&
        (isFollowUpRequest(text) || hasPreferenceText(text) || hasScheduleActionReference(text));
      const courseCodes =
        shouldUseContext && schedulerContext.courseCodes.length > 0
          ? schedulerContext.courseCodes
          : directCourseCodes;
      const attributeText =
        shouldUseContext && schedulerContext.attributeQuery && directCourseCodes.length === 0
          ? `${schedulerContext.attributeQuery} ${text}`
          : text;
      const shouldUseInstructorContext =
        Boolean(schedulerContext.instructorQuery) && (shouldUseContext || isFollowUpRequest(text));
      const instructorText =
        shouldUseInstructorContext && schedulerContext.instructorQuery
          ? `${schedulerContext.instructorQuery} ${text}`
          : text;
      const instructorMatches = getStrongInstructorMatches(instructorText, allCourses);
      const excludedFromSuggestions = mergeCoursesById([...scheduledCourses, ...(proposedSchedule ?? [])]);
      const explicitSections = courseCodes.length
        ? filterCoursesByInstructors(
            allCourses.filter((c) => courseCodes.some((code) => normalizeCourseCode(c.code) === code)),
            instructorMatches,
          )
        : [];
      const attributeCandidates = courseCodes.length
        ? { sections: [] as Course[], matchedAttributes: [] as string[], matchedDepartments: [] as string[], matchedInstructors: instructorMatches.map((match) => match.instructor) }
        : buildAttributeCandidateSections(`${attributeText} ${instructorText}`, allCourses, excludedFromSuggestions);
      const sections = explicitSections.length ? explicitSections : attributeCandidates.sections;
      const isAttributeSuggestion = !explicitSections.length && attributeCandidates.sections.length > 0;
      const isInstructorSuggestion = !explicitSections.length && !attributeCandidates.matchedAttributes.length && attributeCandidates.matchedInstructors.length > 0 && attributeCandidates.sections.length > 0;
      const suggestionLimit =
        isAttributeSuggestion || isInstructorSuggestion || hasAttributeIntent(attributeText) || hasInstructorIntent(instructorText)
          ? extractSuggestionLimit(text)
          : undefined;

      if (sections.length > 0 && hasInstructorIntent(instructorText) && !instructorMatches.length) {
        setMessages((prev) => [...prev, { role: "assistant", content: "I could not match that professor to an instructor teaching current-semester sections. Try the instructor name exactly as it appears on the course card." }]);
        setLoading(false);
        return;
      }

      if (!sections.length && shouldUseContext) {
        setMessages((prev) => [...prev, { role: "assistant", content: "I need one detail to continue that: mention a course code or an attribute like Humanities II, Quantitative Thought, or Arabic Communication Skills." }]);
        setLoading(false);
        return;
      }

      if (!sections.length && instructorMatches.length > 0) {
        setMessages((prev) => [...prev, { role: "assistant", content: `I found ${instructorMatches.map((match) => match.instructor).join(" or ")} in the course list, but I could not find matching current-semester sections for that request.` }]);
        setLoading(false);
        return;
      }

      if (!sections.length && hasInstructorIntent(instructorText)) {
        setMessages((prev) => [...prev, { role: "assistant", content: "I could not match that professor to an instructor teaching current-semester sections. Try the instructor name exactly as it appears on the course card." }]);
        setLoading(false);
        return;
      }

      if (!sections.length && hasAttributeIntent(attributeText)) {
        const scopedText =
          attributeCandidates.matchedAttributes.length && attributeCandidates.matchedDepartments.length
            ? `I found the ${attributeCandidates.matchedAttributes.join(", ")} attribute, but I could not find current-semester sections for it in ${attributeCandidates.matchedDepartments.join(" or ")}.`
            : "I could not match that to a course attribute in the current semester. Try the exact wording shown on a course card, like Humanities II, Cultures and Histories, or Quantitative Thought.";
        setMessages((prev) => [...prev, { role: "assistant", content: scopedText }]);
        setLoading(false);
        return;
      }

      const requestText = isAttributeSuggestion || isInstructorSuggestion ? `${attributeText} ${instructorText}`.trim() : text;
      const existingSectionsForConflict = isAttributeSuggestion || isInstructorSuggestion ? excludedFromSuggestions : scheduledCourses;
      const matchedAttributes = attributeCandidates.matchedAttributes;
      const matchedDepartments = attributeCandidates.matchedDepartments;
      const matchedInstructors = attributeCandidates.matchedInstructors;

      setSchedulerContext((prev) => ({
        attributeQuery: matchedAttributes.length ? attributeText : prev.attributeQuery,
        courseCodes: courseCodes.length ? courseCodes : prev.courseCodes,
        instructorQuery: matchedInstructors.length ? instructorText : prev.instructorQuery,
      }));

      const difficulties: Record<string, number> = {};
      if (sections.length > 0) {
        const uniqueCodes = [...new Set(sections.map((c) => c.code))];
        await Promise.all(uniqueCodes.map(async (code) => {
          const d = await fetchDifficulty(code);
          if (d !== null) difficulties[code] = d;
        }));
      }

      const res = await fetch(`${API}/api/ai-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          requestText,
          sections: sections.map(compactCourseForScheduler),
          existingSections: existingSectionsForConflict.map(compactCourseForScheduler),
          suggestionLimit,
          matchedAttributes,
          matchedDepartments,
          matchedInstructors,
          difficulties,
          capacityRule: "CRITICAL: isFull=false means the class has open seats. isFull=true means it is full. seatsRemaining=0 AND isFull=false means no capacity data. enrolled=0 means ZERO students, the class is EMPTY. Never treat 0 enrolled as full.",
        }),
      });

      const rawResponse = await res.text();
      let data: {
        error?: string;
        mode?: string;
        professor?: { id?: string; full_name?: string };
        schedule?: string[];
        summary?: string;
      } = {};
      try {
        data = rawResponse ? JSON.parse(rawResponse) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        const message = data.error || `AI scheduler request failed with status ${res.status}.`;
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${message}` }]);
        setLoading(false);
        return;
      }

      if (data.error) {
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${data.error}` }]);
        setLoading(false);
        return;
      }

      if (data.schedule && data.schedule.length > 0) {
        const scheduledIds = new Set(scheduledCourses.map((c) => c.id));
        const picked = data.schedule
          .map((id: string) => allCourses.find((c) => c.id === id))
          .filter((course): course is Course => Boolean(course))
          .filter((course) => !scheduledIds.has(course.id));
        setProposedSchedule(picked.length ? picked : null);
      } else {
        setProposedSchedule(null);
      }

      if (data.mode === "professor-summary" && data.professor?.id) {
        setReviewTarget({
          label: `Open ${data.professor.full_name} in Reviews`,
          url: `/reviews?professor=${encodeURIComponent(data.professor.id)}&professorName=${encodeURIComponent(data.professor.full_name)}`,
        });
      } else {
        setReviewTarget(null);
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.summary }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Make sure your server is running." }]);
    }

    setLoading(false);
  };

  const handleApply = () => {
    if (!proposedSchedule) return;
    const scheduledIds = new Set(scheduledCourses.map((course) => course.id));
    const newCourses = proposedSchedule.filter((course) => !scheduledIds.has(course.id));
    if (!newCourses.length) {
      setProposedSchedule(null);
      return;
    }
    onApplySchedule(proposedSchedule);
    setMessages((prev) => [...prev, { role: "assistant", content: `Done! Added ${newCourses.length} ${newCourses.length === 1 ? "course" : "courses"} to Schedule ${activeSlot}. You can see ${newCourses.length === 1 ? "it" : "them"} on the grid now.` }]);
    setProposedSchedule(null);
  };

  return (
    <>
      <style>{css}</style>

      <button className="ai-fab" onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        AI Assistant
      </button>

      {open && (
        <div className="ai-panel">
          <div className="ai-panel__header">
            <div className="ai-panel__title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
              AI Course Assistant
            </div>
            <button className="ai-panel__close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="ai-panel__messages">
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ai-msg--${m.role}`}>
                <div className="ai-msg__bubble">{m.content}</div>
              </div>
            ))}

            {reviewTarget && (
              <button className="ai-review-link" type="button" onClick={() => navigate(reviewTarget.url)}>
                {reviewTarget.label}
              </button>
            )}

            {proposedSchedule && proposedSchedule.length > 0 && (
              <div className="ai-proposal">
                <div className="ai-proposal__title">Proposed Schedule</div>
                {proposedSchedule.map((c) => (
                  <div key={c.id} className="ai-proposal__course">
                    <div className="ai-proposal__code">{c.code} — {c.section}</div>
                    <div className="ai-proposal__meta">{c.title}</div>
                    <div className="ai-proposal__meta">
                      {c.instructor} · {c.meetings.map((m) => `${m.days.map(dayLabel).join("/")} ${formatTime(m.start)}–${formatTime(m.end)}`).join(" · ")}
                    </div>
                  </div>
                ))}
                <button className="ai-proposal__apply" onClick={handleApply}>Apply to Schedule {activeSlot}</button>
              </div>
            )}

            {loading && (
              <div className="ai-msg ai-msg--assistant">
                <div className="ai-msg__bubble ai-msg__bubble--loading">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="ai-panel__input">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Ask for a schedule or professor review summary"
              disabled={loading}
            />
            <button onClick={sendMessage} disabled={loading || !input.trim()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const css = `
  .ai-fab {
    position: fixed;
    bottom: 28px;
    right: 28px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: #A32638;
    color: #fff;
    border: none;
    border-radius: 100px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(163,38,56,0.4);
    transition: transform .2s, box-shadow .2s;
    z-index: 1000;
  }
  .ai-fab:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(163,38,56,0.5); }

  @media (max-width: 480px) {
    .ai-fab { bottom: 16px; right: 16px; padding: 10px 16px; font-size: 13px; }
    .ai-panel { width: calc(100vw - 24px) !important; right: 12px !important; bottom: 72px !important; height: 70vh !important; }
  }

  .ai-panel {
    position: fixed;
    bottom: 90px;
    right: 28px;
    width: 390px;
    height: 580px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 60px rgba(0,0,0,0.3);
    z-index: 1000;
    overflow: hidden;
  }

  .ai-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel2);
    flex-shrink: 0;
  }
  .ai-panel__title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text); }
  .ai-panel__close { background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; transition: color .15s; }
  .ai-panel__close:hover { color: var(--text); }

  .ai-panel__messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .ai-msg { display: flex; }
  .ai-msg--user { justify-content: flex-end; }
  .ai-msg--assistant { justify-content: flex-start; }

  .ai-msg__bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .ai-msg--user .ai-msg__bubble { background: #A32638; color: #fff; border-bottom-right-radius: 4px; }
  .ai-msg--assistant .ai-msg__bubble { background: var(--panel2); color: var(--text); border: 1px solid var(--border); border-bottom-left-radius: 4px; }

  .ai-msg__bubble--loading { display: flex; gap: 4px; align-items: center; padding: 14px 18px; }
  .ai-msg__bubble--loading span { width: 6px; height: 6px; background: var(--muted); border-radius: 50%; animation: aiDot 1.2s ease-in-out infinite; }
  .ai-msg__bubble--loading span:nth-child(2) { animation-delay: 0.2s; }
  .ai-msg__bubble--loading span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes aiDot { 0%,80%,100% { transform: scale(1); opacity: .4; } 40% { transform: scale(1.3); opacity: 1; } }

  .ai-proposal { background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .ai-proposal__title { font-size: 11px; font-weight: 600; color: #A32638; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .ai-proposal__course { padding: 8px 10px; background: var(--bg); border-radius: 6px; border-left: 3px solid #A32638; }
  .ai-proposal__code { font-size: 12px; font-weight: 600; color: var(--text); }
  .ai-proposal__meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .ai-proposal__apply { margin-top: 4px; width: 100%; padding: 9px; background: #A32638; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .ai-proposal__apply:hover { background: #8a1f2f; }

  .ai-review-link { align-self: flex-start; margin: 2px 0 6px; border: 1px solid rgba(163,38,56,0.45); background: rgba(163,38,56,0.12); color: var(--text); border-radius: 6px; padding: 8px 10px; font-size: 12px; font-weight: 700; cursor: pointer; text-align: left; }
  .ai-review-link:hover { background: rgba(163,38,56,0.2); }

  .ai-panel__input { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--panel2); flex-shrink: 0; }
  .ai-panel__input input { flex: 1; padding: 10px 13px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; outline: none; transition: border-color .2s; }
  .ai-panel__input input:focus { border-color: #A32638; }
  .ai-panel__input input::placeholder { color: var(--muted); }
  .ai-panel__input button { width: 38px; height: 38px; background: #A32638; border: none; border-radius: 8px; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background .15s; }
  .ai-panel__input button:hover:not(:disabled) { background: #8a1f2f; }
  .ai-panel__input button:disabled { opacity: 0.4; cursor: not-allowed; }
`;
