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

function hasAdminMetadata(metadata: ClerkMetadata | undefined) {
  if (!metadata) return false;
  return metadata.role === "admin" || metadata.is_admin === true || metadata.admin === true;
}

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
  const { user } = useUser();
  const { appUserId, clerkUserId, email } = useAppUser();

  // ── MOBILE: hamburger state ──────────────────────────────
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close menu on route change / outside click
  useEffect(() => {
    const handler = () => setMobileMenuOpen(false);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const [showGpa, setShowGpa] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
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

  useEffect(() => {
    if (!appUserId) {
      Promise.resolve().then(() => setIsAdmin(false));
      return;
    }

    const normalizedEmail = email?.toLowerCase() ?? "";
    const clerkAllowsAdmin =
      Boolean(normalizedEmail && ADMIN_EMAILS.has(normalizedEmail)) ||
      Boolean(clerkUserId && ADMIN_CLERK_IDS.has(clerkUserId)) ||
      hasAdminMetadata(user?.publicMetadata as ClerkMetadata | undefined);

    if (clerkAllowsAdmin) {
      Promise.resolve().then(() => setIsAdmin(true));
      return;
    }

    supabase
      .from("users")
      .select("is_admin")
      .eq("id", appUserId)
      .maybeSingle<AdminRow>()
      .then(({ data: userRow }) => {
        setIsAdmin(userRow?.is_admin ?? false);
      });
  }, [supabase, appUserId, clerkUserId, email, user?.publicMetadata]);

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
  const gpaColor =
    gpaValue === null
      ? "var(--muted)"
      : gpaValue >= 3.5
        ? "#22c55e"
        : gpaValue >= 2.5
          ? "#f59e0b"
          : "#ef4444";

  const gpaLabel =
    gpaValue === null
      ? "No data"
      : gpaValue >= 3.7
        ? "Dean's List"
        : gpaValue >= 3.5
          ? "Excellent"
          : gpaValue >= 3.0
            ? "Very Good"
            : gpaValue >= 2.5
              ? "Good Standing"
              : gpaValue >= 2.0
                ? "Satisfactory"
                : "Needs Improvement";

  const gpaPercent =
    gpaValue !== null ? Math.min((gpaValue / 4.3) * 100, 100) : 0;

  const totalCredits = rows.reduce((s, r) => {
    const c = parseFloat(r.credits);
    return s + (isNaN(c) ? 0 : c);
  }, 0);

  const activeCourses = rows.filter((r) => parseFloat(r.credits) > 0).length;

  const addRow = () =>
    setRows((p) => [...p, { course: "", grade: "A+", credits: "" }]);

  const removeRow = (i: number) =>
    setRows((p) => p.filter((_, idx) => idx !== i));

  const updateRow = (i: number, field: string, value: string) =>
    setRows((p) =>
      p.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)),
    );

  const resetRows = () =>
    setRows([
      { course: "", grade: "A+", credits: "" },
      { course: "", grade: "A+", credits: "" },
    ]);

  const [lightMode, setLightMode] = useState(false);
  const toggleTheme = () => {
    setLightMode((prev) => {
      document.body.classList.toggle("light", !prev);
      return !prev;
    });
  };

  const updateGradeRow = (id: number, field: string, val: string) =>
    setGradeRows((p) =>
      p.map((r) => (r.id === id ? { ...r, [field]: val } : r)),
    );

  const addGradeRow = () => {
    setGradeRows((p) => [...p, { id: nextId, name: "", weight: 0, score: "" }]);
    setNextId((n) => n + 1);
  };

  const removeGradeRow = (id: number) => {
    if (gradeRows.length > 1) {
      setGradeRows((p) => p.filter((r) => r.id !== id));
    }
  };

  const totalWeight = gradeRows.reduce(
    (s, r) => s + (parseFloat(String(r.weight)) || 0),
    0,
  );

  const filledRows = gradeRows.filter(
    (r) => r.score !== "" && r.weight !== 0 && parseFloat(String(r.weight)) > 0,
  );

  const usedWeight = filledRows.reduce(
    (s, r) => s + parseFloat(String(r.weight)),
    0,
  );

  const isPartial = Math.abs(usedWeight - 100) > 0.01;

  let finalPct: number | null = null;
  let finalLetter: string | null = null;
  let finalGp: number | null = null;

  if (filledRows.length > 0) {
    const weighted = filledRows.reduce(
      (s, r) =>
        s + parseFloat(r.score as string) * parseFloat(String(r.weight)),
      0,
    );
    finalPct = weighted / usedWeight;
    finalLetter = scoreToLetter(finalPct);
    finalGp = gradePointsMap[finalLetter] ?? 0;
  }

  const letterColor =
    finalLetter === null
      ? "#475569"
      : ["A+", "A", "A-"].includes(finalLetter)
        ? "#22c55e"
        : ["B+", "B", "B-"].includes(finalLetter)
          ? "#f59e0b"
          : ["C+", "C"].includes(finalLetter)
            ? "#fb923c"
            : "#ef4444";

  const openGpaCalculator = () => {
    setRows(
      scheduledCourses.length > 0
        ? scheduledCourses.map((course) => ({
            course: course.code,
            grade: "A+",
            credits: String(course.credits),
          }))
        : [
            { course: "", grade: "A+", credits: "" },
            { course: "", grade: "A+", credits: "" },
          ],
    );
    setShowGpa(true);
    setMobileMenuOpen(false);
  };

  const openGradeCalculator = () => {
    setGradeRows(defaultGradeRows());
    setShowGrade(true);
    setMobileMenuOpen(false);
  };

  const goHome = () => {
    setMobileMenuOpen(false);
    if (activePage === "home") {
      document
        .querySelector(".middlePanel")
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    navigate("/");
  };

  return (
    <>
      <style>{`
        @keyframes gpaIn { from{opacity:0;transform:scale(0.96) translateY(12px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes gpaBg { from{opacity:0} to{opacity:1} }

        .gpa-overlay {
          position:fixed; inset:0; z-index:99999;
          background:rgba(0,0,0,0.78);
          backdrop-filter:blur(7px);
          display:flex; align-items:center; justify-content:center;
          padding:16px;
          animation:gpaBg 0.18s ease;
        }
        .gpa-modal {
          width:720px; max-width:100%;
          background:var(--panel);
          border:1px solid var(--border);
          border-radius:18px;
          overflow:hidden;
          display:flex; flex-direction:column;
          max-height:92vh;
          animation:gpaIn 0.26s cubic-bezier(0.34,1.3,0.64,1);
          box-shadow:0 40px 80px rgba(0,0,0,0.4);
        }
        .gpa-mhead {
          display:flex; align-items:center; justify-content:space-between;
          padding:16px 20px;
          border-bottom:1px solid var(--border);
          background:var(--panel2);
          flex-shrink:0;
        }
        .gpa-mhead-left { display:flex; align-items:center; gap:10px; }
        .gpa-mhead-icon {
          width:32px; height:32px; border-radius:8px;
          background:linear-gradient(135deg,#A32638,#6e1425);
          display:flex; align-items:center; justify-content:center; font-size:15px;
        }
        .gpa-mhead-title { font-size:14px; font-weight:700; color:var(--text); }
        .gpa-mhead-sub { font-size:11px; color:var(--muted); margin-top:1px; }
        .gpa-mhead-close {
          width:28px; height:28px; border-radius:7px;
          background:transparent; border:1px solid var(--border);
          color:var(--muted); font-size:12px; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          transition:all 0.15s;
        }
        .gpa-mhead-close:hover { background:rgba(163,38,56,0.25); color:var(--text); border-color:rgba(163,38,56,0.4); }

        .gpa-body {
          display:grid; grid-template-columns:1fr 220px;
          flex:1; overflow:hidden; min-height:0;
        }
        .gpa-left {
          padding:16px 18px; overflow-y:auto;
          border-right:1px solid var(--border);
        }
        .gpa-left::-webkit-scrollbar { width:3px; }
        .gpa-left::-webkit-scrollbar-thumb { background:#A32638; border-radius:4px; }
        .gpa-left-title {
          font-size:10px; font-weight:700; color:var(--muted);
          text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;
        }
        .gpa-col-heads {
          display:grid; grid-template-columns:1fr 80px 62px 26px;
          gap:6px; margin-bottom:6px; padding:0 2px;
        }
        .gpa-col-head { font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.6px; }
        .gpa-col-head.c { text-align:center; }

        .gpa-rows { display:flex; flex-direction:column; gap:5px; }
        .gpa-row {
          display:grid; grid-template-columns:1fr 80px 62px 26px;
          gap:6px; align-items:center;
          background:var(--bg);
          border:1px solid var(--border);
          border-radius:9px; padding:7px 9px; transition:border-color 0.15s;
        }
        .gpa-row:focus-within { border-color:rgba(163,38,56,0.45); }

        .gc-row {
          display:grid; grid-template-columns:1fr 80px 80px 26px;
          gap:6px; align-items:center;
          background:var(--bg);
          border:1px solid var(--border);
          border-radius:9px; padding:7px 9px;
          transition:border-color 0.15s;
          margin-bottom:5px;
        }
        .gc-row:focus-within { border-color:rgba(163,38,56,0.45); }

        .g-in {
          background:transparent; border:none;
          color:var(--text); font-size:12px; outline:none;
          width:100%; font-family:inherit;
        }
        .g-in::placeholder { color:var(--border); }

        .g-sel {
          background:var(--panel); border:1px solid var(--border);
          color:var(--text); border-radius:6px;
          padding:4px 4px; font-size:12px;
          cursor:pointer; outline:none; width:100%;
          font-family:inherit; transition:border-color 0.15s;
        }
        .g-sel:focus { border-color:rgba(163,38,56,0.5); }

        .g-num {
          background:var(--panel); border:1px solid var(--border);
          color:var(--text); border-radius:6px;
          padding:4px 5px; font-size:12px;
          outline:none; width:100%; font-family:inherit;
          transition:border-color 0.15s; text-align:center;
        }
        .g-num:focus { border-color:rgba(163,38,56,0.5); }

        .g-del {
          background:none; border:none; cursor:pointer; padding:0;
          color:var(--muted); font-size:13px;
          display:flex; align-items:center; justify-content:center;
          width:26px; height:28px; border-radius:5px; transition:all 0.15s; margin:0 auto;
        }
        .g-del:not(:disabled):hover { color:#ef4444; background:rgba(239,68,68,0.1); }
        .g-del:disabled { cursor:default; opacity:0.3; }

        .gpa-add {
          width:100%; margin-top:8px; padding:8px;
          background:transparent; border:1px dashed var(--border);
          color:var(--muted); border-radius:8px; cursor:pointer;
          font-size:12px; font-weight:600; font-family:inherit;
          transition:all 0.18s;
          display:flex; align-items:center; justify-content:center; gap:5px;
        }
        .gpa-add:hover { border-color:#A32638; color:#A32638; background:rgba(163,38,56,0.05); }

        .gpa-right {
          display:flex; flex-direction:column;
          padding:16px; background:var(--panel2); gap:12px;
        }
        .gpa-right-title { font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.8px; }

        .gpa-card {
          border-radius:12px; background:var(--panel);
          border:1px solid var(--border); overflow:hidden; flex-shrink:0;
        }
        .gpa-card-top { padding:14px 14px 10px; }
        .gpa-card-label { font-size:10px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:0.6px; }
        .gpa-card-number { font-size:54px; font-weight:800; line-height:1; letter-spacing:-4px; margin-top:4px; font-variant-numeric:tabular-nums; transition:color 0.3s; }
        .gpa-card-scale { font-size:11px; color:var(--muted); margin-top:2px; }
        .gpa-card-bar { height:3px; background:var(--border); }
        .gpa-card-bar-fill { height:100%; transition:width 0.4s ease, background 0.3s; }
        .gpa-card-badge { padding:8px 14px; display:flex; align-items:center; gap:6px; }
        .gpa-badge-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
        .gpa-badge-text { font-size:12px; font-weight:700; }

        .gpa-stat-grid { display:flex; flex-direction:column; gap:6px; flex:1; }
        .gpa-stat-row {
          background:var(--panel); border:1px solid var(--border);
          border-radius:9px; padding:9px 12px;
          display:flex; align-items:center; justify-content:space-between;
        }
        .gpa-stat-lbl { font-size:11px; color:var(--muted); font-weight:600; }
        .gpa-stat-val { font-size:16px; font-weight:700; color:var(--text); }

        .gpa-footer {
          display:flex; gap:10px; padding:12px 18px;
          border-top:1px solid var(--border);
          background:var(--panel2); flex-shrink:0;
        }
        .gpa-btn-reset {
          padding:9px 20px; background:var(--panel); color:var(--muted);
          border:1px solid var(--border); border-radius:9px;
          cursor:pointer; font-size:13px; font-weight:600;
          font-family:inherit; transition:all 0.15s;
        }
        .gpa-btn-reset:hover { border-color:#A32638; color:var(--text); }
        .gpa-btn-done {
          flex:1; padding:9px;
          background:linear-gradient(135deg,#A32638,#6e1425);
          color:#fff; border:none; border-radius:9px;
          cursor:pointer; font-size:13px; font-weight:700;
          font-family:inherit; letter-spacing:0.3px;
          box-shadow:0 4px 14px rgba(163,38,56,0.4); transition:all 0.18s;
        }
        .gpa-btn-done:hover { box-shadow:0 6px 22px rgba(163,38,56,0.6); transform:translateY(-1px); }
        .gpa-btn-done:active { transform:translateY(0); }
        .gc-result {
          border-radius:12px;
          background:linear-gradient(135deg,#A32638,#6e1425);
          padding:14px;
          display:flex; align-items:center; justify-content:space-between;
          flex-shrink:0;
        }
        .gc-result-pct { font-size:28px; font-weight:800; color:#fff; letter-spacing:-1px; }
        .gc-result-lbl { font-size:10px; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:0.6px; }
        .gc-result-gp { font-size:11px; color:rgba(255,255,255,0.7); margin-top:3px; }
        .gc-result-letter {
          font-size:36px; font-weight:800; color:#fff;
          background:rgba(255,255,255,0.15);
          border-radius:10px; padding:4px 16px;
        }
        .gc-warn { font-size:11px; color:#ef4444; margin-top:6px; }
      `}</style>

      <header className="topNav">
        <div className="topNav__brand">
          <div className="topNav__logo" aria-hidden="true">
            {appName.slice(0, 1)}
          </div>
          <button
            type="button"
            className="topNav__brandButton"
            onClick={() => window.location.reload()}
            title={`Refresh ${appName}`}
          >
            <span className="topNav__brandText">{appName}</span>
          </button>
        </div>

        {/* ── Nav links — toggled by isOpen on mobile ── */}
        <nav
          className={`topNav__links${mobileMenuOpen ? " isOpen" : ""}`}
          aria-label="Primary"
        >
          <button
            type="button"
            className={`topNav__link topNav__linkButton${activePage === "home" ? " isActive" : ""}`}
            onClick={goHome}
          >
            Home
          </button>
          <button
            type="button"
            className="topNav__link topNav__linkButton"
            onClick={() => { navigate("/reviews"); setMobileMenuOpen(false); }}
          >
            Reviews
          </button>
          <button
            type="button"
            className={`topNav__link topNav__linkButton${activePage === "empty-classes" ? " isActive" : ""}`}
            onClick={() => { navigate("/empty-classes"); setMobileMenuOpen(false); }}
          >
            <MeetingRoomOutlinedIcon fontSize="inherit" />
            Empty Classes
          </button>
          <button
            type="button"
            className="topNav__link topNav__linkButton"
            onClick={openGpaCalculator}
          >
            GPA Calculator
          </button>
          <button
            type="button"
            className="topNav__link topNav__linkButton"
            onClick={openGradeCalculator}
          >
            Grade Calculator
          </button>
          {isAdmin && (
            <button
              type="button"
              className="topNav__link topNav__linkButton"
              style={{ cursor: "pointer", color: "#A32638", fontWeight: 700 }}
              onClick={() => { navigate("/admin"); setMobileMenuOpen(false); }}
            >
              Admin
            </button>
          )}

          {/* ── Logout inside the mobile menu ── */}
          <button
            className="topNav__link topNav__linkButton topNav__logoutMobile"
            type="button"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </nav>

        <div className="topNav__status" title={lastUpdatedText}>
          <span className="topNav__statusText">
            {semesterLabel} — {lastUpdatedText}
          </span>
        </div>

        <div className="topNav__controls">
          <span className="topNav__controlLabel">Change semester:</span>
          <select
            className="topNav__select"
            value={semesterId}
            onChange={(e) => onSemesterChange(e.target.value)}
            aria-label="Change semester"
          >
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            className="topNav__logout topNav__themeToggle"
            type="button"
            onClick={toggleTheme}
            title="Toggle light/dark mode"
          >
            {lightMode ? "🌙" : "☀️"}
          </button>
          <UserButton />
          <button
            className="topNav__logout topNav__logoutBtn"
            type="button"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            Logout
          </button>
          {/* ── MOBILE: hamburger button — lives at end of controls ── */}
          <button
            type="button"
            className="topNav__hamburger"
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      {/* ── GPA Calculator Modal ─────────────────────────────────── */}
      {showGpa && (
        <div className="gpa-overlay" onClick={() => setShowGpa(false)}>
          <div className="gpa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gpa-mhead">
              <div className="gpa-mhead-left">
                <div className="gpa-mhead-icon">🎓</div>
                <div>
                  <div className="gpa-mhead-title">GPA Calculator</div>
                  <div className="gpa-mhead-sub">
                    American University of Beirut
                  </div>
                </div>
              </div>
              <button
                className="gpa-mhead-close"
                onClick={() => setShowGpa(false)}
              >
                ✕
              </button>
            </div>

            <div className="gpa-body">
              <div className="gpa-left">
                <div className="gpa-left-title">Courses</div>
                <div className="gpa-col-heads">
                  <span className="gpa-col-head">Course</span>
                  <span className="gpa-col-head c">Grade</span>
                  <span className="gpa-col-head c">Credits</span>
                  <span></span>
                </div>
                <div className="gpa-rows">
                  {rows.map((row, i) => (
                    <div key={i} className="gpa-row">
                      <input
                        type="text"
                        className="g-in"
                        placeholder={`Course ${i + 1}`}
                        value={row.course}
                        onChange={(e) => updateRow(i, "course", e.target.value)}
                      />
                      <select
                        className="g-sel"
                        value={row.grade}
                        onChange={(e) => updateRow(i, "grade", e.target.value)}
                      >
                        {Object.keys(gradePoints).map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="g-num"
                        placeholder="Cr"
                        min="0"
                        max="6"
                        value={row.credits}
                        onChange={(e) =>
                          updateRow(i, "credits", e.target.value)
                        }
                      />
                      <button
                        className="g-del"
                        onClick={() => removeRow(i)}
                        disabled={rows.length <= 1}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button className="gpa-add" onClick={addRow}>
                  <span style={{ fontSize: "15px" }}>+</span> Add Course
                </button>
              </div>

              <div className="gpa-right">
                <div className="gpa-right-title">Live Summary</div>
                <div className="gpa-card">
                  <div className="gpa-card-top">
                    <div className="gpa-card-label">Your GPA</div>
                    <div
                      className="gpa-card-number"
                      style={{ color: gpaColor }}
                    >
                      {gpa ?? "—"}
                    </div>
                    <div className="gpa-card-scale">out of 4.30</div>
                  </div>
                  <div className="gpa-card-bar">
                    <div
                      className="gpa-card-bar-fill"
                      style={{ width: `${gpaPercent}%`, background: gpaColor }}
                    />
                  </div>
                  <div
                    className="gpa-card-badge"
                    style={{ background: `${gpaColor}18` }}
                  >
                    <div
                      className="gpa-badge-dot"
                      style={{ background: gpaColor }}
                    />
                    <span
                      className="gpa-badge-text"
                      style={{ color: gpaColor }}
                    >
                      {gpaLabel}
                    </span>
                  </div>
                </div>
                <div className="gpa-stat-grid">
                  <div className="gpa-stat-row">
                    <span className="gpa-stat-lbl">Courses</span>
                    <span className="gpa-stat-val">{activeCourses || "—"}</span>
                  </div>
                  <div className="gpa-stat-row">
                    <span className="gpa-stat-lbl">Total Credits</span>
                    <span className="gpa-stat-val">{totalCredits || "—"}</span>
                  </div>
                  <div className="gpa-stat-row">
                    <span className="gpa-stat-lbl">Scale</span>
                    <span className="gpa-stat-val">4.30</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="gpa-footer">
              <button className="gpa-btn-reset" onClick={resetRows}>
                Reset
              </button>
              <button
                className="gpa-btn-done"
                onClick={() => setShowGpa(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Grade Calculator Modal ───────────────────────────────── */}
      {showGrade && (
        <div className="gpa-overlay" onClick={() => setShowGrade(false)}>
          <div className="gpa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gpa-mhead">
              <div className="gpa-mhead-left">
                <div className="gpa-mhead-icon">📊</div>
                <div>
                  <div className="gpa-mhead-title">Grade Calculator</div>
                  <div className="gpa-mhead-sub">
                    American University of Beirut
                  </div>
                </div>
              </div>
              <button
                className="gpa-mhead-close"
                onClick={() => setShowGrade(false)}
              >
                ✕
              </button>
            </div>

            <div className="gpa-body">
              <div className="gpa-left">
                <div className="gpa-left-title">Components</div>
                <div
                  className="gpa-col-heads"
                  style={{ gridTemplateColumns: "1fr 80px 80px 26px" }}
                >
                  <span className="gpa-col-head">Name</span>
                  <span className="gpa-col-head c">Weight %</span>
                  <span className="gpa-col-head c">Score %</span>
                  <span></span>
                </div>
                <div className="gpa-rows">
                  {gradeRows.map((r) => (
                    <div key={r.id} className="gc-row">
                      <input
                        type="text"
                        className="g-in"
                        placeholder="e.g. Midterm"
                        value={r.name}
                        onChange={(e) =>
                          updateGradeRow(r.id, "name", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        className="g-num"
                        placeholder="%"
                        min={0}
                        max={100}
                        step={1}
                        value={r.weight}
                        onChange={(e) =>
                          updateGradeRow(r.id, "weight", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        className="g-num"
                        placeholder="%"
                        min={0}
                        max={100}
                        step={0.1}
                        value={r.score}
                        onChange={(e) =>
                          updateGradeRow(r.id, "score", e.target.value)
                        }
                      />
                      <button
                        className="g-del"
                        onClick={() => removeGradeRow(r.id)}
                        disabled={gradeRows.length <= 1}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {Math.abs(totalWeight - 100) > 0.01 &&
                  gradeRows.some((r) => r.weight !== 0) && (
                    <div className="gc-warn">
                      Weights sum to {totalWeight.toFixed(1)}% — must equal 100%
                    </div>
                  )}

                <button className="gpa-add" onClick={addGradeRow}>
                  <span style={{ fontSize: "15px" }}>+</span> Add Component
                </button>
              </div>

              <div className="gpa-right">
                <div className="gpa-right-title">Live Result</div>

                {finalPct !== null ? (
                  <div className="gc-result">
                    <div>
                      <div className="gc-result-lbl">Final grade</div>
                      <div className="gc-result-pct">
                        {isPartial ? "~" : ""}
                        {finalPct.toFixed(1)}%
                      </div>
                      <div className="gc-result-gp">
                        GPA pts: {finalGp!.toFixed(1)}
                        {isPartial ? " (partial)" : ""}
                      </div>
                    </div>
                    <div className="gc-result-letter">{finalLetter}</div>
                  </div>
                ) : (
                  <div className="gpa-card" style={{ padding: "14px" }}>
                    <div className="gpa-card-label">Final grade</div>
                    <div
                      className="gpa-card-number"
                      style={{ color: "#334155", fontSize: "40px" }}
                    >
                      —
                    </div>
                    <div className="gpa-card-scale">
                      Enter scores to calculate
                    </div>
                  </div>
                )}

                <div className="gpa-stat-grid">
                  <div className="gpa-stat-row">
                    <span className="gpa-stat-lbl">Components</span>
                    <span className="gpa-stat-val">{gradeRows.length}</span>
                  </div>
                  <div className="gpa-stat-row">
                    <span className="gpa-stat-lbl">Weight used</span>
                    <span
                      className="gpa-stat-val"
                      style={{
                        color:
                          Math.abs(totalWeight - 100) > 0.01
                            ? "#ef4444"
                            : "#94a3b8",
                      }}
                    >
                      {totalWeight.toFixed(0)}%
                    </span>
                  </div>
                  <div className="gpa-stat-row">
                    <span className="gpa-stat-lbl">Letter grade</span>
                    <span
                      className="gpa-stat-val"
                      style={{ color: letterColor }}
                    >
                      {finalLetter ?? "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="gpa-footer">
              <button
                className="gpa-btn-reset"
                onClick={() => setGradeRows(defaultGradeRows())}
              >
                Reset
              </button>
              <button
                className="gpa-btn-done"
                onClick={() => setShowGrade(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
