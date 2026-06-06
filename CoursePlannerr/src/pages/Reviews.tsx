import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useSupabase } from "../hooks/useSupabase.ts";
import { useAppUser } from "../hooks/useAppUser.ts";

const API = import.meta.env.VITE_API_URL || "";
console.log("API URL:", API);

type Tab = "courses" | "professors";

type ProfessorResult = { id: string; full_name: string };

type TermRecord = {
  code: string;
  is_current?: boolean;
};

interface CourseRating {
  id: string;
  user_id?: string;
  department: string;
  course_number: string;
  rating: number;
  difficulty: number;
  review: string;
  created_at: string;
}

interface ProfessorRating {
  id: string;
  user_id?: string;
  professor_id: string;
  department: string;
  course_number: string;
  rating: number;
  review: string;
  created_at: string;
}

interface SyllabusSubmission {
  id: string;
  course_code: string;
  file_url: string;
  file_name: string;
  uploaded_by: string;
  created_at: string;
  status?: "pending" | "approved" | "rejected" | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function StarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <span style={{ display: "inline-flex", gap: 6, cursor: "pointer" }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          style={{
            color: i < (hovered || value) ? "var(--accent)" : "var(--border)",
            fontSize: 28,
            transition: "color 0.1s",
          }}
          onMouseEnter={() => setHovered(i + 1)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(i + 1)}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function formatProfName(fullName: string) {
  const [last, first] = fullName.split(",").map((s) => s.trim());
  return first && last ? `${first} ${last}` : fullName;
}

function isDemoTopRatedProfessor(fullName: string | null | undefined) {
  const normalized = normalizeSearchText(formatProfName(String(fullName ?? "")));
  return normalized.includes("zalghout") && (normalized.includes("mohamed") || normalized.includes("mohamad"));
}

function normalizeSearchText(value: string) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSearchTokens(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function scoreProfessorSearch(query: string, professor: ProfessorResult) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = getSearchTokens(query);
  if (!normalizedQuery || !tokens.length) return 0;

  const displayName = normalizeSearchText(formatProfName(professor.full_name));
  const rawName = normalizeSearchText(professor.full_name);
  const haystack = `${displayName} ${rawName}`;

  if (displayName === normalizedQuery || rawName === normalizedQuery) return 120;
  if (displayName.includes(normalizedQuery) || rawName.includes(normalizedQuery)) return 95;

  if (tokens.length > 1 && !tokens.every((token) => haystack.includes(token))) {
    return 0;
  }

  const startsWithScore = tokens.filter((token) =>
    haystack.split(" ").some((part) => part.startsWith(token)),
  ).length * 18;
  const containsScore = tokens.filter((token) => haystack.includes(token)).length * 9;
  return startsWithScore + containsScore;
}

function rankProfessorResults(query: string, professors: ProfessorResult[]) {
  const seen = new Map<string, ProfessorResult>();
  professors.forEach((professor) => {
    if (professor?.id) seen.set(professor.id, professor);
  });

  return [...seen.values()]
    .map((professor) => ({
      professor,
      score: scoreProfessorSearch(query, professor),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || formatProfName(a.professor.full_name).localeCompare(formatProfName(b.professor.full_name)))
    .map(({ professor }) => professor);
}

function getRatingLabel(r: number) {
  if (r >= 5) return "Awesome";
  if (r >= 4) return "Great";
  if (r >= 3) return "Good";
  if (r >= 2) return "OK";
  return "Awful";
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 4 ? "#22c55e" : score >= 3 ? "#f59e0b" : "#ef4444";
  return (
    <div
      style={{
        display: "inline-block",
        background: color,
        color: "#fff",
        fontWeight: 800,
        fontSize: 15,
        padding: "4px 12px",
        borderRadius: 6,
        minWidth: 48,
        textAlign: "center",
        flexShrink: 0,
      }}
    >
      {score.toFixed(1)}
    </div>
  );
}

function AIReviewSummary({ summary }: { summary: string | null }) {
  if (!summary) return null;

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 18,
        marginBottom: 18,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: "var(--text)",
          marginBottom: 8,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        AI Review Summary
      </div>
      <p
        style={{
          margin: 0,
          color: "var(--text)",
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        {summary}
      </p>
    </div>
  );
}

function getDistribution(ratings: { rating: number }[]) {
  const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  ratings.forEach((r) => {
    if (dist[r.rating] !== undefined) dist[r.rating]++;
  });
  return dist;
}

// ── Analytics helpers ──────────────────────────────────────────────────────────

function getScoreColor(score: number) {
  if (score >= 4) return "#22c55e";
  if (score >= 3) return "#f59e0b";
  return "#ef4444";
}

function getDifficultyColor(d: number) {
  if (d >= 4) return "#ef4444";
  if (d >= 3) return "#f59e0b";
  return "#22c55e";
}

function getDifficultyLabel(d: number) {
  if (d >= 4.5) return "Very Hard";
  if (d >= 3.5) return "Hard";
  if (d >= 2.5) return "Moderate";
  if (d >= 1.5) return "Easy";
  return "Very Easy";
}

function getDifficultyDistribution(ratings: CourseRating[]) {
  const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  ratings.forEach((r) => {
    const rounded = Math.round(r.difficulty);
    if (rounded >= 1 && rounded <= 5) dist[rounded]++;
  });
  return dist;
}

function getMonthlyTrend(ratings: { rating: number; created_at: string }[]) {
  const map: Record<string, { sum: number; count: number }> = {};
  ratings.forEach((r) => {
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!map[key]) map[key] = { sum: 0, count: 0 };
    map[key].sum += r.rating;
    map[key].count++;
  });
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { sum, count }]) => ({
      month,
      avg: parseFloat((sum / count).toFixed(2)),
      count,
    }));
}

function getSentiment(reviews: string[]) {
  const positive = [
    "great", "excellent", "amazing", "love", "good", "best", "helpful",
    "clear", "easy", "recommend", "enjoyed", "well", "interesting", "fun",
    "kind", "fair", "passionate",
  ];
  const negative = [
    "hard", "difficult", "bad", "worst", "boring", "confusing", "unclear",
    "avoid", "terrible", "awful", "disappointing", "heavy", "unfair",
    "tough", "strict", "rude",
  ];
  let pos = 0, neg = 0;
  reviews.forEach((r) => {
    if (!r) return;
    const lower = r.toLowerCase();
    positive.forEach((w) => { if (lower.includes(w)) pos++; });
    negative.forEach((w) => { if (lower.includes(w)) neg++; });
  });
  const total = pos + neg;
  if (total === 0) return null;
  return { positive: pos, negative: neg, score: Math.round((pos / total) * 100) };
}

function averageRating(ratings: { rating: number }[]) {
  if (!ratings.length) return null;
  return ratings.reduce((sum, rating) => sum + Number(rating.rating || 0), 0) / ratings.length;
}

function describeTone(ratings: { rating: number }[]) {
  const positive = ratings.filter((rating) => Number(rating.rating) >= 4).length;
  const negative = ratings.filter((rating) => Number(rating.rating) <= 2).length;
  if (positive >= negative + 2) return "mostly positive";
  if (negative >= positive + 2) return "mostly critical";
  return "mixed";
}

function buildClientCourseSummary(courseLabel: string, ratings: CourseRating[]): string | null {
  if (!ratings.length) return null;
  const avg = averageRating(ratings);
  const writtenCount = ratings.filter((rating) => rating.review?.trim()).length;
  const difficultyValues = ratings
    .map((rating) => Number(rating.difficulty || 0))
    .filter((difficulty) => difficulty > 0);
  const difficultyAvg = difficultyValues.length
    ? difficultyValues.reduce((sum, difficulty) => sum + difficulty, 0) / difficultyValues.length
    : null;
  const difficultyText = difficultyAvg !== null
    ? ` Students rate the difficulty around ${difficultyAvg.toFixed(1)}/5.`
    : "";
  return `Based on ${writtenCount} written ${writtenCount === 1 ? "review" : "reviews"} and ${ratings.length} total ${ratings.length === 1 ? "rating" : "ratings"} for ${courseLabel}, the overall feedback is ${describeTone(ratings)} with an average rating of ${avg?.toFixed(1)}/5.${difficultyText} This summary only reflects reviews that students submitted in the app.`;
}

function buildClientProfessorSummary(professorName: string, ratings: ProfessorRating[]): string | null {
  if (!ratings.length) return null;
  const avg = averageRating(ratings);
  const writtenCount = ratings.filter((rating) => rating.review?.trim()).length;
  const courseCodes = new Set(
    ratings
      .filter((rating) => rating.department && rating.course_number)
      .map((rating) => `${rating.department} ${rating.course_number}`),
  );
  const courseText = courseCodes.size
    ? ` Most of the submitted feedback covers ${[...courseCodes].slice(0, 3).join(", ")}.`
    : "";
  return `Based on ${writtenCount} written ${writtenCount === 1 ? "review" : "reviews"} and ${ratings.length} total ${ratings.length === 1 ? "rating" : "ratings"} for ${professorName}, the overall feedback is ${describeTone(ratings)} with an average rating of ${avg?.toFixed(1)}/5.${courseText} This summary only reflects reviews that students submitted in the app.`;
}

// ── Analytics sub-components ───────────────────────────────────────────────────

function AnalyticsBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ width: 76, textAlign: "right", fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: "var(--bg)", borderRadius: 99, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: color, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      <span style={{ width: 24, fontSize: 12, color: "var(--muted)", textAlign: "right", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>{sub}</div>}
    </div>
  );
}

function Sparkline({ trend }: { trend: { month: string; avg: number }[] }) {
  const SW = 220, SH = 52;
  const sparkPoints = trend
    .map((p, i) => {
      const x = trend.length === 1 ? SW / 2 : (i / (trend.length - 1)) * SW;
      const y = SH - ((p.avg - 1) / 4) * SH;
      return `${x},${y}`;
    })
    .join(" ");

  if (trend.length < 2) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 12, textAlign: "center", paddingTop: 8 }}>
        {trend.length === 1 ? (
          <>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>{trend[0].avg}★</div>
            Only 1 month of data
          </>
        ) : "Not enough data for trend"}
      </div>
    );
  }

  return (
    <>
      <svg width="100%" viewBox={`0 0 ${SW} ${SH}`} style={{ overflow: "visible" }}>
        {[1, 2, 3, 4, 5].map((v) => {
          const y = SH - ((v - 1) / 4) * SH;
          return <line key={v} x1={0} y1={y} x2={SW} y2={y} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3" />;
        })}
        <polyline points={`0,${SH} ${sparkPoints} ${SW},${SH}`} fill="rgba(163,38,56,0.08)" stroke="none" />
        <polyline points={sparkPoints} fill="none" stroke="#A32638" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {trend.map((p, i) => {
          const x = trend.length === 1 ? SW / 2 : (i / (trend.length - 1)) * SW;
          const y = SH - ((p.avg - 1) / 4) * SH;
          return <circle key={i} cx={x} cy={y} r="3" fill="#A32638" />;
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "var(--muted)" }}>
        <span>{trend[0].month}</span>
        <span>{trend[trend.length - 1].month}</span>
      </div>
    </>
  );
}

// ── Course Analytics ───────────────────────────────────────────────────────────

function CourseAnalytics({ ratings, avg }: { ratings: CourseRating[]; avg: { rating: string; difficulty: string; count: number } }) {
  const ratingDist = useMemo(() => getDistribution(ratings), [ratings]);
  const diffDist = useMemo(() => getDifficultyDistribution(ratings), [ratings]);
  const trend = useMemo(() => getMonthlyTrend(ratings), [ratings]);
  const sentiment = useMemo(() => getSentiment(ratings.map((r) => r.review)), [ratings]);

  const ratingVal = parseFloat(avg.rating);
  const diffVal = parseFloat(avg.difficulty);
  const count = avg.count;
  const withReviews = ratings.filter((r) => r.review?.trim()).length;
  const withDiff = ratings.filter((r) => r.difficulty > 0).length;

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 24px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", flexWrap: "wrap", gap: 24, marginBottom: 28 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: getScoreColor(ratingVal) }}>{avg.rating}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Overall Rating</div>
          </div>
          <div style={{ width: 1, height: 60, background: "var(--border)" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: getDifficultyColor(diffVal) }}>{avg.difficulty}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Difficulty · {getDifficultyLabel(diffVal)}</div>
          </div>
          <div style={{ width: 1, height: 60, background: "var(--border)" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: "var(--text)" }}>{count}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Reviews</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Rating</div>
            <div style={{ background: "var(--border)", borderRadius: 99, height: 8, overflow: "hidden" }}>
              <div style={{ width: `${(ratingVal / 5) * 100}%`, height: "100%", background: getScoreColor(ratingVal), borderRadius: 99, transition: "width 0.8s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--muted)" }}><span>1</span><span>5</span></div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Difficulty</div>
            <div style={{ background: "var(--border)", borderRadius: 99, height: 8, overflow: "hidden" }}>
              <div style={{ width: `${(diffVal / 5) * 100}%`, height: "100%", background: getDifficultyColor(diffVal), borderRadius: 99, transition: "width 0.8s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--muted)" }}><span>Easy</span><span>Hard</span></div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Rating Breakdown</div>
          {[5, 4, 3, 2, 1].map((n) => (
            <AnalyticsBar key={n} label={`${getRatingLabel(n)} ${n}★`} count={ratingDist[n] ?? 0} total={count} color={getScoreColor(n >= 4 ? 4 : n >= 3 ? 3 : 2)} />
          ))}
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Difficulty Breakdown</div>
          {[{ n: 5, label: "Very Hard 5" }, { n: 4, label: "Hard 4" }, { n: 3, label: "Moderate 3" }, { n: 2, label: "Easy 2" }, { n: 1, label: "Very Easy 1" }].map(({ n, label }) => (
            <AnalyticsBar key={n} label={label} count={diffDist[n] ?? 0} total={withDiff || count} color={getDifficultyColor(n)} />
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <StatPill label="With written review" value={`${withReviews}`} sub={`${count > 0 ? Math.round((withReviews / count) * 100) : 0}% of raters`} />
          <StatPill label="Avg difficulty" value={withDiff > 0 ? avg.difficulty : "—"} sub={withDiff > 0 ? getDifficultyLabel(diffVal) : "No data"} />
          <StatPill label="Difficulty rated by" value={`${withDiff}`} sub={`of ${count} reviewers`} />
        </div>
        <SentimentPanel sentiment={sentiment} />
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Rating Over Time</div>
          <Sparkline trend={trend} />
        </div>
      </div>
    </div>
  );
}

// ── Professor Analytics ────────────────────────────────────────────────────────

function ProfessorAnalytics({ ratings, avg }: { ratings: ProfessorRating[]; avg: { rating: string; count: number } }) {
  const ratingDist = useMemo(() => getDistribution(ratings), [ratings]);
  const trend = useMemo(() => getMonthlyTrend(ratings), [ratings]);
  const sentiment = useMemo(() => getSentiment(ratings.map((r) => r.review)), [ratings]);

  const ratingVal = parseFloat(avg.rating);
  const count = avg.count;
  const withReviews = ratings.filter((r) => r.review?.trim()).length;

  const uniqueCourses = useMemo(() => {
    const seen = new Set<string>();
    return ratings.filter((r) => {
      const key = `${r.department}-${r.course_number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [ratings]);

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 24px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", flexWrap: "wrap", gap: 24, marginBottom: 28 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: getScoreColor(ratingVal) }}>{avg.rating}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Overall Rating</div>
          </div>
          <div style={{ width: 1, height: 60, background: "var(--border)" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: "var(--text)" }}>{count}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Reviews</div>
          </div>
          <div style={{ width: 1, height: 60, background: "var(--border)" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: "var(--text)" }}>{uniqueCourses.length}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Courses Rated</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Overall Rating</div>
          <div style={{ background: "var(--border)", borderRadius: 99, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${(ratingVal / 5) * 100}%`, height: "100%", background: getScoreColor(ratingVal), borderRadius: 99, transition: "width 0.8s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--muted)" }}><span>1</span><span>5</span></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Rating Breakdown</div>
          {[5, 4, 3, 2, 1].map((n) => (
            <AnalyticsBar key={n} label={`${getRatingLabel(n)} ${n}★`} count={ratingDist[n] ?? 0} total={count} color={getScoreColor(n >= 4 ? 4 : n >= 3 ? 3 : 2)} />
          ))}
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Courses Reviewed For</div>
          {uniqueCourses.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>No course data</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {uniqueCourses.map((r) => {
                const courseRatings = ratings.filter((x) => x.department === r.department && x.course_number === r.course_number);
                const courseAvg = courseRatings.reduce((a, x) => a + x.rating, 0) / courseRatings.length;
                return (
                  <div key={`${r.department}-${r.course_number}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r.department} {r.course_number}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{courseRatings.length} review{courseRatings.length !== 1 ? "s" : ""}</span>
                      <span style={{ background: getScoreColor(courseAvg), color: "#fff", fontWeight: 700, fontSize: 11, padding: "2px 7px", borderRadius: 4 }}>{courseAvg.toFixed(1)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <StatPill label="With written review" value={`${withReviews}`} sub={`${count > 0 ? Math.round((withReviews / count) * 100) : 0}% of raters`} />
          <StatPill label="Courses reviewed for" value={`${uniqueCourses.length}`} />
          <StatPill label="Avg reviews per course" value={uniqueCourses.length > 0 ? (count / uniqueCourses.length).toFixed(1) : "—"} />
        </div>
        <SentimentPanel sentiment={sentiment} />
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Rating Over Time</div>
          <Sparkline trend={trend} />
        </div>
      </div>
    </div>
  );
}

// ── Shared sentiment panel ─────────────────────────────────────────────────────

function SentimentPanel({ sentiment }: { sentiment: ReturnType<typeof getSentiment> }) {
  if (!sentiment) {
    return (
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
        Not enough review text for sentiment analysis
      </div>
    );
  }
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 14 }}>Review Sentiment</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 36, fontWeight: 900, color: sentiment.score >= 60 ? "#22c55e" : sentiment.score >= 40 ? "#f59e0b" : "#ef4444" }}>{sentiment.score}%</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{sentiment.score >= 60 ? "😊 Positive" : sentiment.score >= 40 ? "😐 Mixed" : "😟 Negative"}</div>
      </div>
      <div style={{ background: "var(--border)", borderRadius: 99, height: 8, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ width: `${sentiment.score}%`, height: "100%", borderRadius: 99, transition: "width 0.8s ease", background: sentiment.score >= 60 ? "#22c55e" : sentiment.score >= 40 ? "#f59e0b" : "#ef4444" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
        <span>👍 {sentiment.positive} positive</span>
        <span>👎 {sentiment.negative} negative</span>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Reviews() {
  const supabase = useSupabase();
  const { getToken } = useAuth();
  const { appUserId: userId, email, loading: authLoading } = useAppUser();
  const suppressProfSearch = useRef(false);
  const suppressCourseSearch = useRef(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("courses");

  const [courseSearch, setCourseSearch] = useState("");
  const [courseResults, setCourseResults] = useState<{ department: string; course_number: string; title: string }[]>([]);
  const [courseSearchLoading, setCourseSearchLoading] = useState(false);
  const [reviewTermId, setReviewTermId] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<{ department: string; course_number: string; title: string } | null>(null);
  const [courseRatings, setCourseRatings] = useState<CourseRating[]>([]);
  const [courseAvg, setCourseAvg] = useState<{ rating: string; difficulty: string; count: number } | null>(null);
  const [courseSummary, setCourseSummary] = useState<string | null>(null);
  const [courseSyllabi, setCourseSyllabi] = useState<SyllabusSubmission[]>([]);
  const [syllabusLoading, setSyllabusLoading] = useState(false);
  const [syllabusError, setSyllabusError] = useState<string | null>(null);
  const [syllabusUploading, setSyllabusUploading] = useState(false);
  const [syllabusUploadMessage, setSyllabusUploadMessage] = useState<string | null>(null);

  const [profSearch, setProfSearch] = useState("");
  const [profApiQuery, setProfApiQuery] = useState("");
  const [profResults, setProfResults] = useState<ProfessorResult[]>([]);
  const [profSearchLoading, setProfSearchLoading] = useState(false);
  const [selectedProf, setSelectedProf] = useState<{ id: string; full_name: string } | null>(null);
  const [profRatings, setProfRatings] = useState<ProfessorRating[]>([]);
  const [profAvg, setProfAvg] = useState<{ rating: string; count: number } | null>(null);
  const [profSummary, setProfSummary] = useState<string | null>(null);
  const [profCourses, setProfCourses] = useState<{ department: string; course_number: string; title: string }[]>([]);

  // ── FIX 5: Professor course filter ──
  const [selectedProfCourseFilter, setSelectedProfCourseFilter] = useState<string>("all");

  const filteredProfRatings = useMemo(() => {
    if (selectedProfCourseFilter === "all") return profRatings;
    const [dept, num] = selectedProfCourseFilter.split("|");
    return profRatings.filter((r) => r.department === dept && r.course_number === num);
  }, [profRatings, selectedProfCourseFilter]);

  const profCourseOptions = useMemo(() => {
    const seen = new Set<string>();
    return profRatings.filter((r) => {
      const key = `${r.department}|${r.course_number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [profRatings]);

  const [showForm, setShowForm] = useState(false);
  const [formRating, setFormRating] = useState(0);
  const [formDifficulty, setFormDifficulty] = useState(0);
  const [formReview, setFormReview] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formCourseNum, setFormCourseNum] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const buildCourseSearchUrl = useCallback((search: string) => {
    const params = new URLSearchParams();
    if (reviewTermId) params.set("term", reviewTermId);
    params.set("search", search);
    return `${API}/api/courses?${params.toString()}`;
  }, [reviewTermId]);

  useEffect(() => {
    fetch(`${API}/api/terms?fresh=1`)
      .then((r) => r.json())
      .then((terms: TermRecord[]) => {
        const currentTerm = terms.find((term) => term.is_current) ?? terms[0];
        setReviewTermId(currentTerm?.code ?? "");
      })
      .catch(() => {
        setReviewTermId("");
      });
  }, []);

  const loadCourseRatings = useCallback((dept: string, num: string) => {
    fetch(`${API}/api/ratings/course/${dept}/${num}`)
      .then((r) => r.json())
      .then((data) => {
        const ratings = data.ratings || [];
        setCourseRatings(ratings);
        setCourseAvg(data.averages || null);
        setCourseSummary(data.summary || buildClientCourseSummary(`${dept} ${num}`, ratings));
      });
  }, []);

  const loadCourseSyllabi = useCallback(async (dept: string, num: string) => {
    const courseCode = `${dept} ${num}`;
    setSyllabusLoading(true);
    setSyllabusError(null);
    const { data, error } = await supabase
      .from("syllabi")
      .select("id, course_code, file_url, file_name, uploaded_by, created_at, status")
      .eq("course_code", courseCode)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Could not load syllabi:", error);
      setCourseSyllabi([]);
      setSyllabusError(error.message);
    } else {
      setCourseSyllabi((data ?? []) as SyllabusSubmission[]);
    }
    setSyllabusLoading(false);
  }, [supabase]);

  const handleSelectCourse = useCallback((c: { department: string; course_number: string; title: string }) => {
    suppressCourseSearch.current = true;
    setSelectedCourse(c);
    setCourseSearch(`${c.department} ${c.course_number}`);
    setCourseResults([]);
    setCourseSearchLoading(false);
    setShowForm(false);
    setSubmitted(false);
    setSubmitError(null);
    setCourseSummary(null);
    setCourseSyllabi([]);
    setSyllabusError(null);
    setSyllabusUploadMessage(null);
    loadCourseRatings(c.department, c.course_number);
    void loadCourseSyllabi(c.department, c.course_number);
  }, [loadCourseRatings, loadCourseSyllabi]);

  useEffect(() => {
    const course = searchParams.get("course");
    if (!course) return;
    const parts = course.trim().toUpperCase().split(" ");
    const dept = parts[0];
    const num = parts[1] || "";
    setCourseSearch(course);
    setTab("courses");
    setShowForm(true);
    fetch(buildCourseSearchUrl(dept))
      .then((r) => r.json())
      .then((data) => {
        for (const c of data) {
          if (c.department === dept && c.course_number === num) {
            handleSelectCourse({ department: c.department, course_number: c.course_number, title: c.title });
            break;
          }
        }
      });
  }, [buildCourseSearchUrl, handleSelectCourse, searchParams]);

  useEffect(() => {
    if (suppressCourseSearch.current) {
      suppressCourseSearch.current = false;
      return;
    }
    const searchText = courseSearch.trim();
    if (searchText.length < 2) {
      setCourseResults([]);
      setCourseSearchLoading(false);
      return;
    }

    setCourseSearchLoading(true);
    const timeout = window.setTimeout(() => {
      const parts = searchText.toUpperCase().split(/\s+/);
      const dept = parts[0];
      const num = parts[1] || "";
      const apiSearch = /^[A-Z]{2,5}$/.test(dept) ? dept : searchText;
      const tokens = searchText.toLowerCase().split(/\s+/).filter(Boolean);

      fetch(buildCourseSearchUrl(apiSearch))
        .then((r) => r.json())
        .then((data) => {
          const seen = new Set<string>();
          const unique: { department: string; course_number: string; title: string }[] = [];
          for (const c of data) {
            const key = `${c.department}-${c.course_number}`;
            const haystack = `${c.department} ${c.course_number} ${c.title}`.toLowerCase();
            if (!seen.has(key) && c.course_number && (!num || c.course_number.startsWith(num)) && tokens.every((token) => haystack.includes(token))) {
              seen.add(key);
              unique.push({ department: c.department, course_number: c.course_number, title: c.title });
            }
          }
          setCourseResults(unique.slice(0, 8));
          setCourseSearchLoading(false);
        })
        .catch(() => { setCourseResults([]); setCourseSearchLoading(false); });
    }, 180);

    return () => { window.clearTimeout(timeout); setCourseSearchLoading(false); };
  }, [buildCourseSearchUrl, courseSearch]);

  useEffect(() => {
    if (suppressProfSearch.current) {
      suppressProfSearch.current = false;
      return;
    }
    if (!profApiQuery || profApiQuery.length < 2) {
      setProfResults([]);
      setProfSearchLoading(false);
      return;
    }

    setProfSearchLoading(true);
    const timeout = window.setTimeout(() => {
      const searchText = profApiQuery.trim();
      const queries = [searchText, ...getSearchTokens(searchText)].filter((query, index, all) => query.length >= 2 && all.indexOf(query) === index);

      Promise.all(queries.map((query) =>
        fetch(`${API}/api/professors?search=${encodeURIComponent(query)}&fresh=1`).then((r) => r.json()).catch(() => []),
      ))
        .then((responses) => {
          const merged = responses.flat().filter(Boolean) as ProfessorResult[];
          setProfResults(rankProfessorResults(searchText, merged).slice(0, 8));
          setProfSearchLoading(false);
        })
        .catch(() => { setProfResults([]); setProfSearchLoading(false); });
    }, 180);

    return () => { window.clearTimeout(timeout); setProfSearchLoading(false); };
  }, [profApiQuery]);

  const loadProfRatings = useCallback((profId: string, professorName = "this professor") => {
    fetch(`${API}/api/ratings/professor/${profId}`)
      .then((r) => r.json())
      .then((data) => {
        const ratings = data.ratings || [];
        setProfRatings(ratings);
        setProfAvg(data.averages || null);
        setProfSummary(data.summary || buildClientProfessorSummary(professorName, ratings));
      });
  }, []);

  const handleSelectProf = useCallback((p: { id: string; full_name: string }) => {
    suppressProfSearch.current = true;
    setSelectedProf(p);
    setProfSearch(formatProfName(p.full_name));
    setProfApiQuery("");
    setProfResults([]);
    setProfSearchLoading(false);
    setShowForm(false);
    setSubmitted(false);
    setSubmitError(null);
    setFormDept("");
    setFormCourseNum("");
    setProfCourses([]);
    setProfSummary(null);
    setSelectedProfCourseFilter("all"); // reset filter on new prof
    loadProfRatings(p.id, formatProfName(p.full_name));
    fetch(`${API}/api/professors/${p.id}/courses`)
      .then((r) => r.json())
      .then((data) => setProfCourses(Array.isArray(data) ? data : []))
      .catch(() => setProfCourses([]));
  }, [loadProfRatings]);

  useEffect(() => {
    const professorId = searchParams.get("professor");
    if (!professorId) return;
    const professorName = searchParams.get("professorName") || "Selected professor";
    setTab("professors");
    setShowForm(false);
    handleSelectProf({ id: professorId, full_name: professorName });
  }, [handleSelectProf, searchParams]);

  // ── FIX 3: Delete handlers ──

  const handleDeleteCourseReview = async (reviewId: string) => {
    if (!window.confirm("Delete your review? This cannot be undone.")) return;
    const { error } = await supabase.from("course_ratings").delete().eq("id", reviewId);
    if (!error) {
      setCourseRatings((prev) => prev.filter((r) => r.id !== reviewId));
      if (selectedCourse) loadCourseRatings(selectedCourse.department, selectedCourse.course_number);
    }
  };

  const handleDeleteProfReview = async (reviewId: string) => {
    if (!window.confirm("Delete your review? This cannot be undone.")) return;
    const { error } = await supabase.from("professor_ratings").delete().eq("id", reviewId);
    if (!error) {
      setProfRatings((prev) => prev.filter((r) => r.id !== reviewId));
    }
  };

  const handleSubmitCourse = async () => {
    if (!selectedCourse || formRating === 0 || !userId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/ratings/course`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          department: selectedCourse.department,
          course_number: selectedCourse.course_number,
          rating: formRating,
          difficulty: formDifficulty || null,
          review: formReview || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) setSubmitError("Your session expired. Please sign in again.");
        else if (res.status === 409 || err?.code === "23505") setSubmitError("You've already rated this course.");
        else if (res.status === 400) setSubmitError("Your review contains inappropriate content and was not submitted.");
        else if (res.status === 503) setSubmitError("Review moderation is temporarily unavailable. Please try again later.");
        else setSubmitError("Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
      setShowForm(false);
      setFormRating(0);
      setFormDifficulty(0);
      setFormReview("");
      loadCourseRatings(selectedCourse.department, selectedCourse.course_number);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitProf = async () => {
    if (!selectedProf || formRating === 0 || !formDept || !formCourseNum || !userId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/api/ratings/professor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          professor_id: selectedProf.id,
          department: formDept.toUpperCase(),
          course_number: formCourseNum,
          rating: formRating,
          review: formReview || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409 || err?.code === "23505") setSubmitError("You've already rated this professor for that course.");
        else if (res.status === 400) setSubmitError("Your review contains inappropriate content and was not submitted.");
        else if (res.status === 503) setSubmitError("Review moderation is temporarily unavailable. Please try again later.");
        else setSubmitError("Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
      setShowForm(false);
      setFormRating(0);
      setFormReview("");
      setFormDept("");
      setFormCourseNum("");
      loadProfRatings(selectedProf.id);
    } finally {
      setSubmitting(false);
    }
  };

  const card: React.CSSProperties = {
    background: "var(--panel)",
    borderRadius: 12,
    padding: 20,
    border: "1px solid var(--border)",
    position: "relative",
  };

  const renderForm = (onSubmit: () => void, showDiff = false, showCourse = false) => (
    <div style={{ ...card, marginBottom: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 18, color: "var(--text)" }}>Your Review</div>
      {showCourse && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 6 }}>Course</label>
          {profCourses.length > 0 ? (
            <select
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              value={formDept && formCourseNum ? `${formDept}|${formCourseNum}` : ""}
              onChange={(e) => { const [dept, num] = e.target.value.split("|"); setFormDept(dept || ""); setFormCourseNum(num || ""); }}
            >
              <option value="">— Select a course —</option>
              {profCourses.map((c) => (
                <option key={`${c.department}-${c.course_number}`} value={`${c.department}|${c.course_number}`}>
                  {c.department} {c.course_number} — {c.title}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <input style={inputStyle} placeholder="CMPS" value={formDept} onChange={(e) => setFormDept(e.target.value)} />
              <input style={inputStyle} placeholder="201" value={formCourseNum} onChange={(e) => setFormCourseNum(e.target.value)} />
            </div>
          )}
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 6 }}>Overall Rating</label>
        <StarInput value={formRating} onChange={setFormRating} />
      </div>
      {showDiff && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 6 }}>Difficulty</label>
          <StarInput value={formDifficulty} onChange={setFormDifficulty} />
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 6 }}>Review (optional)</label>
        <textarea style={{ ...inputStyle, width: "100%", resize: "vertical", boxSizing: "border-box" }} value={formReview} onChange={(e) => setFormReview(e.target.value)} placeholder="Share your experience..." rows={3} />
      </div>
      {submitError && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{submitError}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onSubmit} disabled={formRating === 0 || submitting || (showCourse && (!formDept || !formCourseNum))} style={{ background: "var(--accent)", color: "#fff", border: "none", padding: "10px 28px", borderRadius: 30, cursor: "pointer", fontSize: 14, fontWeight: 700, opacity: formRating === 0 || submitting ? 0.6 : 1 }}>
          {submitting ? "Submitting..." : "Submit"}
        </button>
        <button onClick={() => { setShowForm(false); setSubmitError(null); }} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", padding: "10px 24px", borderRadius: 30, cursor: "pointer", fontSize: 14 }}>
          Cancel
        </button>
      </div>
    </div>
  );

  const renderWriteButton = () =>
    !showForm && !submitted ? (
      authLoading ? null : !userId ? (
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Sign in to leave a review</span>
      ) : (
        <button onClick={() => { setShowForm(true); setSubmitError(null); }} style={{ background: "#A32638", color: "#fff", border: "none", padding: "9px 24px", borderRadius: 30, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
          ✏️ Write a Review
        </button>
      )
    ) : submitted ? (
      <span style={{ color: "#34d399", fontSize: 14 }}>✅ Thanks for your review!</span>
    ) : null;

  const handleSyllabusUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedCourse) return;

    if (!userId) {
      setSyllabusUploadMessage("Sign in to upload a syllabus.");
      return;
    }

    if (file.type !== "application/pdf") {
      setSyllabusUploadMessage("Only PDF files are allowed.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setSyllabusUploadMessage("File must be under 10MB.");
      return;
    }

    const courseCode = `${selectedCourse.department} ${selectedCourse.course_number}`;
    const safeCourseCode = courseCode.replace(/[^A-Z0-9]+/gi, "_");
    const storagePath = `${safeCourseCode}/${Date.now()}_${file.name.replace(/[^a-z0-9_.-]/gi, "_")}`;

    setSyllabusUploading(true);
    setSyllabusUploadMessage(null);

    const { error: storageError } = await supabase.storage
      .from("syllabi")
      .upload(storagePath, file, { contentType: "application/pdf" });

    if (storageError) {
      console.error("Could not upload syllabus file:", storageError);
      setSyllabusUploadMessage(`Upload failed: ${storageError.message}`);
      setSyllabusUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("syllabi").getPublicUrl(storagePath);
    const { error: dbError } = await supabase.from("syllabi").insert({
      course_code: courseCode,
      file_url: urlData.publicUrl,
      file_name: file.name,
      uploaded_by: email ?? "anonymous",
      status: "pending",
      admin_comment: null,
      reviewed_by: null,
      reviewed_at: null,
    });

    if (dbError) {
      console.error("Could not save syllabus submission:", dbError);
      setSyllabusUploadMessage(`Could not submit syllabus: ${dbError.message}`);
    } else {
      setSyllabusUploadMessage("Uploaded. It will appear here after admin approval.");
    }
    setSyllabusUploading(false);
  };

  const renderSyllabusSection = () => {
    if (!selectedCourse) return null;

    return (
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>Syllabi</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Approved files for {selectedCourse.department} {selectedCourse.course_number}
            </div>
          </div>
          <label
            style={{
              background: userId ? "var(--accent)" : "var(--panel2)",
              color: userId ? "#fff" : "var(--muted)",
              border: userId ? "none" : "1px solid var(--border)",
              padding: "9px 18px",
              borderRadius: 8,
              cursor: userId && !syllabusUploading ? "pointer" : "not-allowed",
              fontSize: 14,
              fontWeight: 800,
              opacity: syllabusUploading ? 0.65 : 1,
            }}
          >
            {syllabusUploading ? "Uploading..." : "Upload syllabus"}
            <input
              type="file"
              accept="application/pdf"
              disabled={!userId || syllabusUploading}
              onChange={handleSyllabusUpload}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {syllabusUploadMessage && (
          <div style={{ color: syllabusUploadMessage.startsWith("Uploaded") ? "#34d399" : "#ef4444", fontSize: 13, marginBottom: 14 }}>
            {syllabusUploadMessage}
          </div>
        )}

        {syllabusLoading ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>Loading syllabi...</div>
        ) : syllabusError ? (
          <div style={{ color: "#ef4444", fontSize: 13 }}>{syllabusError}</div>
        ) : courseSyllabi.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>No approved syllabi yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {courseSyllabi.map((syllabus) => (
              <div key={syllabus.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {syllabus.file_name}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>
                    Uploaded by {syllabus.uploaded_by} · {new Date(syllabus.created_at).toLocaleDateString()}
                  </div>
                </div>
                <a
                  href={syllabus.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#fff", background: "var(--accent)", textDecoration: "none", borderRadius: 6, padding: "7px 12px", fontSize: 13, fontWeight: 800 }}
                >
                  View PDF
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "system-ui, sans-serif" }}>
      <style>{`
        @keyframes demoTopRatedShimmer {
          0% {
            background-position: 0% 50%;
            box-shadow: 0 10px 24px rgba(251, 191, 36, 0.18);
          }
          50% {
            background-position: 100% 50%;
            box-shadow: 0 12px 30px rgba(251, 191, 36, 0.28);
          }
          100% {
            background-position: 0% 50%;
            box-shadow: 0 10px 24px rgba(251, 191, 36, 0.18);
          }
        }

        .demo-top-rated-badge {
          background-size: 200% 200%;
          animation: demoTopRatedShimmer 2.6s ease-in-out infinite;
        }
      `}</style>
      {/* ── FIX 2: Mobile-friendly header ── */}
      <header style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--panel)", gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
          ← Planner
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Reviews</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {(["courses", "professors"] as Tab[]).map((t) => (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); setSubmitted(false); setSubmitError(null); }} style={{ background: tab === t ? "var(--accent)" : "none", border: "1px solid", borderColor: tab === t ? "var(--accent)" : "var(--border)", color: tab === t ? "#fff" : "var(--muted)", padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 14, textTransform: "capitalize" }}>
              {t}
            </button>
          ))}
        </div>
      </header>

      {/* ── FIX 2: Mobile-friendly container ── */}
      <div style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
        <div style={{ marginBottom: 32 }}>
          <input
            style={{ ...inputStyle, width: "100%", fontSize: 16, padding: "16px 18px", boxSizing: "border-box" }}
            placeholder={tab === "courses" ? "Search course (e.g. CMPS 201)" : "Search professor name"}
            value={tab === "courses" ? courseSearch : profSearch}
            onChange={(e) => {
              if (tab === "courses") { setCourseSearch(e.target.value); setSelectedCourse(null); setShowForm(false); }
              else { setProfSearch(e.target.value); setProfApiQuery(e.target.value); setSelectedProf(null); setShowForm(false); }
            }}
          />
          {((tab === "courses" && courseSearch.trim().length >= 2 && !selectedCourse) || (tab === "professors" && profSearch.trim().length >= 2 && !selectedProf)) && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, marginTop: 10, overflow: "hidden", boxShadow: "0 18px 44px rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <span>{tab === "courses" ? "Matching Courses" : "Matching Professors"}</span>
                <span>{tab === "courses" ? (courseSearchLoading ? "Searching..." : `${courseResults.length} shown`) : (profSearchLoading ? "Searching..." : `${profResults.length} shown`)}</span>
              </div>

              {tab === "courses" ? (
                <div style={{ display: "grid" }}>
                  {courseResults.map((c) => (
                    <button key={`${c.department}-${c.course_number}`} onClick={() => handleSelectCourse(c)} style={{ width: "100%", padding: "14px 18px", cursor: "pointer", borderBottom: "1px solid var(--border)", borderTop: 0, borderLeft: 0, borderRight: 0, background: "transparent", display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}>
                      <span style={{ fontWeight: 800, color: "var(--text)", minWidth: 90, fontSize: 15 }}>{c.department} {c.course_number}</span>
                      <span style={{ fontSize: 14, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                    </button>
                  ))}
                  {!courseSearchLoading && courseResults.length === 0 && (
                    <div style={{ padding: "18px", color: "var(--muted)", fontSize: 14 }}>No course matches yet. Try a course code, CRN, or title keyword.</div>
                  )}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, padding: 10 }}>
                  {profResults.map((p) => (
                    <button key={p.id} onClick={() => handleSelectProf(p)} style={{ padding: "14px 16px", cursor: "pointer", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel2)", textAlign: "left" }}>
                      <span style={{ fontWeight: 800, color: "var(--text)", fontSize: 15 }}>{formatProfName(p.full_name)}</span>
                      <span style={{ display: "block", color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Open reviews and courses</span>
                    </button>
                  ))}
                  {!profSearchLoading && profResults.length === 0 && (
                    <div style={{ padding: "8px", color: "var(--muted)", fontSize: 14 }}>No professor matches yet. Try first name, last name, or the exact spelling from the course card.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── COURSES TAB ── */}
        {tab === "courses" && selectedCourse && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{selectedCourse.department} {selectedCourse.course_number}</div>
                <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>{selectedCourse.title}</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{renderWriteButton()}</div>
            </div>
            {showForm && renderForm(handleSubmitCourse, true)}
            {renderSyllabusSection()}
            {courseAvg && courseAvg.count > 0 ? (
              <CourseAnalytics ratings={courseRatings} avg={courseAvg} />
            ) : (
              <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 48, marginBottom: 24 }}>No reviews yet. Be the first!</div>
            )}
            {courseAvg && courseAvg.count > 0 && <AIReviewSummary summary={courseSummary} />}
            {courseRatings.length > 0 && (
              <>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 14 }}>
                  All Reviews <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 13 }}>({courseRatings.length})</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {courseRatings.map((r) => (
                    <div key={r.id} style={card}>
                      {/* ── FIX 3: Delete button for course reviews ── */}
                      {userId && r.user_id === userId && (
                        <button
                          onClick={() => handleDeleteCourseReview(r.id)}
                          title="Delete your review"
                          style={{ position: "absolute", top: 10, right: 10, background: "transparent", border: "1px solid var(--border)", color: "#ef4444", cursor: "pointer", fontSize: 13, padding: "3px 8px", borderRadius: 6, lineHeight: 1 }}
                        >
                          🗑
                        </button>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: r.review ? 12 : 0, flexWrap: "wrap" }}>
                        <ScoreBadge score={r.rating} />
                        {r.difficulty > 0 && (
                          <span style={{ fontSize: 13, color: "var(--muted)" }}>
                            Difficulty: <span style={{ color: r.difficulty >= 4 ? "#ef4444" : r.difficulty >= 3 ? "#f59e0b" : "#22c55e", fontWeight: 700 }}>{r.difficulty}/5</span>
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{new Date(r.created_at).toLocaleDateString()}</span>
                      </div>
                      {r.review && <p style={{ margin: 0, fontSize: 14, color: "var(--text)", lineHeight: 1.7 }}>{r.review}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PROFESSORS TAB ── */}
        {tab === "professors" && selectedProf && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{formatProfName(selectedProf.full_name)}</div>
                  {isDemoTopRatedProfessor(selectedProf.full_name) && (
                    <span
                      className="demo-top-rated-badge"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "7px 14px",
                        borderRadius: 999,
                        background: "linear-gradient(135deg, rgba(250, 204, 21, 0.28), rgba(251, 146, 60, 0.24), rgba(244, 114, 182, 0.22))",
                        border: "1px solid rgba(250, 204, 21, 0.6)",
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.06) inset, 0 10px 24px rgba(251, 191, 36, 0.2)",
                        color: "#fde68a",
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <span style={{ fontSize: 13, filter: "drop-shadow(0 0 8px rgba(250, 204, 21, 0.55))" }}>★</span>
                      Top rated
                    </span>
                  )}
                </div>
                {profAvg && profAvg.count > 0 && (
                  <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>
                    {profAvg.count} review{profAvg.count !== 1 ? "s" : ""} · avg {profAvg.rating}/5
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{renderWriteButton()}</div>
            </div>

            {showForm && renderForm(handleSubmitProf, false, true)}

            {profAvg && profAvg.count > 0 ? (
              <ProfessorAnalytics ratings={profRatings} avg={profAvg} />
            ) : (
              <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 48, marginBottom: 24 }}>No reviews yet. Be the first!</div>
            )}
            {profAvg && profAvg.count > 0 && <AIReviewSummary summary={profSummary} />}

            {profRatings.length > 0 && (
              <>
                {/* ── FIX 5: Course filter for professor reviews ── */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
                    All Reviews <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 13 }}>({filteredProfRatings.length}{selectedProfCourseFilter !== "all" ? ` of ${profRatings.length}` : ""})</span>
                  </div>
                  {profCourseOptions.length > 1 && (
                    <select
                      value={selectedProfCourseFilter}
                      onChange={(e) => setSelectedProfCourseFilter(e.target.value)}
                      style={{ ...inputStyle, marginLeft: "auto", fontSize: 13, padding: "6px 12px" }}
                    >
                      <option value="all">All Courses</option>
                      {profCourseOptions.map((r) => (
                        <option key={`${r.department}|${r.course_number}`} value={`${r.department}|${r.course_number}`}>
                          {r.department} {r.course_number}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {filteredProfRatings.map((r) => (
                    <div key={r.id} style={card}>
                      {/* ── FIX 3: Delete button for professor reviews ── */}
                      {userId && r.user_id === userId && (
                        <button
                          onClick={() => handleDeleteProfReview(r.id)}
                          title="Delete your review"
                          style={{ position: "absolute", top: 10, right: 10, background: "transparent", border: "1px solid var(--border)", color: "#ef4444", cursor: "pointer", fontSize: 13, padding: "3px 8px", borderRadius: 6, lineHeight: 1 }}
                        >
                          🗑
                        </button>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: r.review ? 12 : 0, flexWrap: "wrap" }}>
                        <ScoreBadge score={r.rating} />
                        <span style={{ fontSize: 13, color: "var(--muted)" }}>{r.department} {r.course_number}</span>
                        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{new Date(r.created_at).toLocaleDateString()}</span>
                      </div>
                      {r.review && <p style={{ margin: 0, fontSize: 14, color: "var(--text)", lineHeight: 1.7 }}>{r.review}</p>}
                    </div>
                  ))}
                  {filteredProfRatings.length === 0 && (
                    <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 32 }}>No reviews for this course yet.</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--panel2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
};
