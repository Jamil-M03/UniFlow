import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { UserButton, useClerk, useUser } from "@clerk/clerk-react";
import MeetingRoomOutlinedIcon from "@mui/icons-material/MeetingRoomOutlined";
import { useSupabase } from "../hooks/useSupabase.ts";
import { useAppUser } from "../hooks/useAppUser.ts";
import { gradePointsMap, calculateGPA } from "../gpaCalculator";
import type { Course } from "../types";

type Props = {
  appName: string;
  semesterLabel: string;
  semesterId: string;
  semesters: { id: string; label: string }[];
  lastUpdatedText: string;
  onSemesterChange: (id: string) => void;
  scheduledCourses: Course[];
  activePage?: "home" | "empty-classes";
};

type AdminRow = {
  is_admin: boolean | null;
};

type ClerkMetadata = {
  role?: unknown;
  is_admin?: unknown;
  admin?: unknown;
};

// admin allowlists from env (emails + clerk ids)
const ADMIN_EMAILS = new Set(
  (import.meta.env.VITE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email: string) => email.trim().toLowerCase())
    .filter(Boolean),
);

const ADMIN_CLERK_IDS = new Set(
  (import.meta.env.VITE_ADMIN_CLERK_IDS ?? "")
    .split(",")
    .map((id: string) => id.trim())
    .filter(Boolean),
);

// checks clerk metadata for admin flag
function hasAdminMetadata(metadata: ClerkMetadata | undefined) {
  if (!metadata) return false;
  return (
    metadata.role === "admin" ||
    metadata.is_admin === true ||
    metadata.admin === true
  );
}

// converts percentage to letter grade
function scoreToLetter(pct) {
  if (pct >= 93) return "A+";
  if (pct >= 87) return "A";
  if (pct >= 83) return "A-";
  if (pct >= 79) return "B+";
  if (pct >= 75) return "B";
  if (pct >= 72) return "B-";
  if (pct >= 69) return "C+";
  if (pct >= 66) return "C";
  if (pct >= 63) return "C-";
  if (pct >= 61) return "D+";
  if (pct >= 60) return "D";
  return "F";
}

// default structure for grade calculator
const defaultGradeRows = () => [
  { id: 1, name: "Midterm", weight: 30, score: "" },
  { id: 2, name: "Final Exam", weight: 40, score: "" },
  { id: 3, name: "Assignments", weight: 20, score: "" },
  { id: 4, name: "Participation", weight: 10, score: "" },
];

export function TopNav({
  appName,
  semesterLabel,
  semesterId,
  semesters,
  lastUpdatedText,
  scheduledCourses,
  onSemesterChange,
  activePage = "home",
}: Props) {
  const navigate = useNavigate();
  const supabase = useSupabase();
  const { signOut } = useClerk();
  const { user, isSignedIn } = useUser();

  const { appUserId, clerkUserId, email } = useAppUser();

  // mobile menu toggle state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // close mobile menu on resize
  useEffect(() => {
    const handler = () => setMobileMenuOpen(false);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const [showGpa, setShowGpa] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // GPA calculator rows (pre-filled if courses exist)
  const [rows, setRows] = useState(
    scheduledCourses.length > 0
      ? scheduledCourses.map((c) => ({
          course: c.code,
          grade: "A+",
          credits: String(c.credits),
        }))
      : [
          { course: "", grade: "A+", credits: "" },
          { course: "", grade: "A+", credits: "" },
        ],
  );

  const [showGrade, setShowGrade] = useState(false);
  const [gradeRows, setGradeRows] = useState(defaultGradeRows());
  const [nextId, setNextId] = useState(5);

  const gradePoints = gradePointsMap;

  // determine admin status (env + clerk + DB fallback)
  useEffect(() => {
    if (!appUserId) {
      setIsAdmin(false);
      return;
    }

    const normalizedEmail = email?.toLowerCase() ?? "";

    const clerkAllowsAdmin =
      Boolean(normalizedEmail && ADMIN_EMAILS.has(normalizedEmail)) ||
      Boolean(clerkUserId && ADMIN_CLERK_IDS.has(clerkUserId)) ||
      hasAdminMetadata(user?.publicMetadata as ClerkMetadata | undefined);

    if (clerkAllowsAdmin) {
      setIsAdmin(true);
      return;
    }

    supabase
      .from("users")
      .select("is_admin")
      .eq("id", appUserId)
      .maybeSingle<AdminRow>()
      .then(({ data }) => {
        setIsAdmin(data?.is_admin ?? false);
      });
  }, [supabase, appUserId, clerkUserId, email, user?.publicMetadata]);

  // GPA calculation (safe fallback if no data)
  const gpa = (() => {
    const mapped = rows
      .filter((r) => !isNaN(parseFloat(r.credits)) && parseFloat(r.credits) > 0)
      .map((r) => ({
        credits: parseFloat(r.credits),
        grade: r.grade,
        semester: "",
      }));

    if (mapped.length === 0) return null;

    try {
      return calculateGPA(mapped).toFixed(2);
    } catch {
      return null;
    }
  })();

  const gpaValue = gpa !== null ? parseFloat(gpa) : null;

  // light/dark mode toggle state
  const [lightMode, setLightMode] = useState(false);

  const toggleTheme = () => {
    setLightMode((prev) => {
      document.body.classList.toggle("light", !prev);
      return !prev;
    });
  };

  // navigation helper for home button
  const goHome = () => {
    setMobileMenuOpen(false);

    if (activePage === "home") {
      document.querySelector(".middlePanel")?.scrollIntoView({
        behavior: "smooth",
      });
      return;
    }

    navigate("/");
  };

  return (
    <>
      <header className="topNav">
        <div className="topNav__brand">
          <div className="topNav__logo">{appName.slice(0, 1)}</div>

          <button
            className="topNav__brandButton"
            onClick={() => window.location.reload()}
          >
            <span className="topNav__brandText">{appName}</span>
          </button>
        </div>

        {/* main navigation links */}
        <nav className={`topNav__links${mobileMenuOpen ? " isOpen" : ""}`}>
          <button onClick={goHome} className="topNav__linkButton">
            Home
          </button>

          <button
            onClick={() => {
              navigate("/reviews");
              setMobileMenuOpen(false);
            }}
          >
            Reviews
          </button>

          <button
            onClick={() => {
              navigate("/empty-classes");
              setMobileMenuOpen(false);
            }}
          >
            <MeetingRoomOutlinedIcon fontSize="inherit" />
            Empty Classes
          </button>

          <button onClick={() => setShowGpa(true)}>GPA Calculator</button>

          <button onClick={() => setShowGrade(true)}>Grade Calculator</button>

          {isAdmin && (
            <button
              onClick={() => {
                navigate("/admin");
                setMobileMenuOpen(false);
              }}
              style={{ color: "#A32638", fontWeight: 700 }}
            >
              Admin
            </button>
          )}

          <button
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </nav>

        <div className="topNav__status">
          {semesterLabel} — {lastUpdatedText}
        </div>

        <div className="topNav__controls">
          <select
            value={semesterId}
            onChange={(e) => onSemesterChange(e.target.value)}
          >
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          {/* theme toggle */}
          <button onClick={toggleTheme}>
            {lightMode ? "☀️" : "🌙"}
          </button>

          {/* auth UI */}
          {isSignedIn ? (
            <>
              <UserButton />
              <button
                onClick={async () => {
                  await signOut();
                  navigate("/login");
                }}
              >
                Logout
              </button>
            </>
          ) : (
            <button onClick={() => navigate("/login")}>Login</button>
          )}

          {/* mobile menu toggle */}
          <button
            className="topNav__hamburger"
            onClick={() => setMobileMenuOpen((o) => !o)}
          >
            ☰
          </button>
        </div>
      </header>
    </>
  );
}
