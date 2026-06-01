import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import type { Course } from "../types";
import { useSupabase } from "../hooks/useSupabase.ts";

const API = import.meta.env.VITE_API_URL || "";
const PAGE_SIZE = 20;

type Props = {
  allCourses: Course[];
  scheduled: Course[];
  favorites: Course[];
  onSelectCourse: (course: Course) => void;
  onToggleSchedule: (course: Course) => void;
  onToggleFavorite: (course: Course) => void;
  onHoverCourse: (course: Course | null) => void;
  averageDifficulty: number | null;
  totalCredits: number;
  activeSlot: number;
  onSlotChange: (slot: number) => void;
};

type ViewModal = { course: Course } | null;
type ModalTab = "reviews" | "syllabus";

interface CourseRating {
  id: string;
  rating: number;
  difficulty: number;
  review: string;
  created_at: string;
}

function buildCourseSummary(courseCode: string, ratings: CourseRating[]) {
  if (!ratings.length) return null;
  const average = ratings.reduce((sum, r) => sum + Number(r.rating || 0), 0) / ratings.length;
  const writtenCount = ratings.filter((r) => r.review?.trim()).length;
  const difficultyValues = ratings.map((r) => Number(r.difficulty || 0)).filter((d) => d > 0);
  const difficultyAverage = difficultyValues.length
    ? difficultyValues.reduce((sum, d) => sum + d, 0) / difficultyValues.length
    : null;
  const positive = ratings.filter((r) => Number(r.rating) >= 4).length;
  const negative = ratings.filter((r) => Number(r.rating) <= 2).length;
  const tone = positive >= negative + 2 ? "mostly positive" : negative >= positive + 2 ? "mostly critical" : "mixed";
  const difficultyText = difficultyAverage !== null ? ` Students rate the difficulty around ${difficultyAverage.toFixed(1)}/5.` : "";
  return `Based on ${writtenCount} written ${writtenCount === 1 ? "review" : "reviews"} and ${ratings.length} total ${ratings.length === 1 ? "rating" : "ratings"} for ${courseCode}, the overall feedback is ${tone} with an average rating of ${average.toFixed(1)}/5.${difficultyText} This summary only reflects reviews that students submitted in the app.`;
}

interface Syllabus {
  id: string;
  course_code: string;
  file_url: string;
  file_name: string;
  uploaded_by: string;
  created_at: string;
}

function isSchemaMismatchError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /column|schema cache|could not find/i.test(error.message ?? "")
  );
}

export function RightSearchPanel({
  allCourses,
  scheduled,
  favorites,
  onSelectCourse,
  onToggleSchedule,
  onToggleFavorite,
  onHoverCourse,
  averageDifficulty,
  totalCredits,
  activeSlot,
  onSlotChange,
}: Props) {
  const navigate = useNavigate();
  const supabase = useSupabase();
  const { user } = useUser();
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination when query changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const [viewModal, setViewModal] = useState<ViewModal>(null);
  const [modalTab, setModalTab] = useState<ModalTab>("reviews");
  const [modalRatings, setModalRatings] = useState<CourseRating[]>([]);
  const [modalAvg, setModalAvg] = useState<{ rating: string; difficulty: string; count: number } | null>(null);
  const [modalSummary, setModalSummary] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  const [syllabi, setSyllabi] = useState<Syllabus[]>([]);
  const [syllabusLoading, setSyllabusLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  useEffect(() => {
    if (!viewModal) return;
    setModalLoading(true);
    setModalTab("reviews");
    setSyllabi([]);
    setUploadError(null);
    setUploadSuccess(false);
    setModalSummary(null);
    const [dept, num] = viewModal.course.code.split(" ");
    fetch(`${API}/api/ratings/course/${dept}/${num}`)
      .then((r) => r.json())
      .then((data) => {
        const ratings = data.ratings || [];
        setModalRatings(ratings);
        setModalAvg(data.averages || null);
        setModalSummary(data.summary || buildCourseSummary(viewModal.course.code, ratings));
      })
      .finally(() => setModalLoading(false));
  }, [viewModal]);

  useEffect(() => {
    if (modalTab !== "syllabus" || !viewModal) return;
    setSyllabusLoading(true);
    supabase
      .from("syllabi")
      .select("*")
      .eq("course_code", viewModal.course.code)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("Could not load approved syllabi:", error);
          setSyllabi([]);
          setSyllabusLoading(false);
          return;
        }
        setSyllabi(data || []);
        setSyllabusLoading(false);
      });
  }, [modalTab, viewModal, supabase]);

  const handleSyllabusUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !viewModal) return;
    if (file.type !== "application/pdf") { setUploadError("Only PDF files are allowed."); return; }
    if (file.size > 10 * 1024 * 1024) { setUploadError("File must be under 10MB."); return; }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);

    const fileName = `${viewModal.course.code.replace(" ", "_")}_${Date.now()}.pdf`;
    const { error: storageError } = await supabase.storage.from("syllabi").upload(fileName, file, { contentType: "application/pdf" });
    if (storageError) { setUploadError("Upload failed. Make sure you are logged in."); setUploading(false); return; }

    const { data: urlData } = supabase.storage.from("syllabi").getPublicUrl(fileName);
    const pendingSyllabus = {
      course_code: viewModal.course.code,
      file_url: urlData.publicUrl,
      file_name: file.name,
      uploaded_by: user?.primaryEmailAddress?.emailAddress ?? user?.id ?? "anonymous",
      status: "pending",
      admin_comment: null,
      reviewed_by: null,
      reviewed_at: null,
    };

    const { error: dbError } = await supabase.from("syllabi").insert(pendingSyllabus);
    let finalDbError = dbError;

    if (isSchemaMismatchError(dbError)) {
      const { error: fallbackError } = await supabase.from("syllabi").insert({
        course_code: pendingSyllabus.course_code,
        file_url: pendingSyllabus.file_url,
        file_name: pendingSyllabus.file_name,
        uploaded_by: pendingSyllabus.uploaded_by,
      });
      finalDbError = fallbackError;
    }

    if (finalDbError) {
      console.error("Could not save syllabus info:", finalDbError);
      setUploadError(`Could not save syllabus info: ${finalDbError.message}`);
    } else {
      setUploadSuccess(true);
    }
    setUploading(false);
  };

  // All filtered results (no slice yet)
  const allResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Course[];
    const tokens = q.split(/\s+/);
    return allCourses.filter((c) => {
      const hay = `${c.code} ${c.title} ${c.instructor} ${c.crn}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [allCourses, query]);

  // Visible slice for infinite scroll
  const results = useMemo(() => allResults.slice(0, visibleCount), [allResults, visibleCount]);
  const hasMore = visibleCount < allResults.length;

  // IntersectionObserver to load more when sentinel is visible
  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasMore) loadMore(); },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const scheduledIds = useMemo(() => new Set(scheduled.map((c) => c.id)), [scheduled]);
  const favoriteIds = useMemo(() => new Set(favorites.map((c) => c.id)), [favorites]);

  const modalStyle = {
    overlay: {
      position: "fixed" as const,
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 99999,
    },
    box: {
      backgroundColor: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: "12px",
      minWidth: "340px",
      maxWidth: "500px",
      width: "90%",
      maxHeight: "82vh",
      display: "flex",
      flexDirection: "column" as const,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    },
  };

  const CourseItem = ({ c }: { c: Course }) => {
    const inSchedule = scheduledIds.has(c.id);
    const isFav = favoriteIds.has(c.id);
    return (
      <li
        className="resultItem"
        onMouseEnter={() => onHoverCourse(c)}
        onMouseLeave={() => onHoverCourse(null)}
        style={{ flexDirection: "column", gap: 0, padding: 0 }}
      >
        <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
          <button
            className={`resultAction ${inSchedule ? "isOn" : ""}`}
            type="button"
            onClick={() => onToggleSchedule(c)}
            title={inSchedule ? "Remove from schedule" : "Add to schedule"}
          >
            {inSchedule ? "☑" : "☐"}
          </button>
          <button
            className="resultMain"
            type="button"
            onClick={() => onSelectCourse(c)}
            title="Open course details"
            style={{ flex: 1 }}
          >
            <div className="resultMain__line1">
              {c.crn} {c.code} — {c.section} <span className="muted">{c.instructor}</span>
            </div>
            <div className="resultMain__line2 muted">{c.title}</div>
          </button>
          <button
            className={`resultFav ${isFav ? "isOn" : ""}`}
            type="button"
            onClick={() => onToggleFavorite(c)}
            title={isFav ? "Remove from favorites" : "Add to favorites"}
          >
            ★
          </button>
        </div>
        <div style={{ display: "flex", gap: "4px", padding: "3px 8px 5px 34px" }}>
          <button
            type="button"
            onClick={() => setViewModal({ course: c })}
            style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--muted)", cursor: "pointer" }}
          >
            ⭐ View Reviews
          </button>
          <button
            type="button"
            onClick={() => navigate(`/reviews?course=${encodeURIComponent(c.code)}`)}
            style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--muted)", cursor: "pointer" }}
          >
            ✏️ Write Review
          </button>
        </div>
      </li>
    );
  };

  return (
    <aside className="rightPanel">
      <div className="rightPanel__top">
        <div className="schTabs" role="tablist" aria-label="Schedules">
          {[1, 2, 3].map((slot) => (
            <button key={slot} className={`schTab ${activeSlot === slot ? "isActive" : ""}`} type="button" onClick={() => onSlotChange(slot)}>
              Schedule {slot}
            </button>
          ))}
        </div>
        <input
          className="searchBox"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search… (e.g. CMPS 271, arab 232, 27101)"
        />
        <div className="miniStats">
          <div className="miniStats__item">
            <div className="miniStats__label">Selected</div>
            <div className="miniStats__value">{scheduled.length}</div>
          </div>
          <div className="miniStats__item">
            <div className="miniStats__label">Avg difficulty</div>
            <div className="miniStats__value">{averageDifficulty == null ? "—" : averageDifficulty.toFixed(2)}</div>
          </div>
          <div className="miniStats__item">
            <div className="miniStats__label">Credits</div>
            <div className="miniStats__value">{totalCredits}</div>
          </div>
        </div>
      </div>

      <div className="rightPanel__scroll">
        <div className="resultsSection">
          <div className="sectionTitle" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Results</span>
            {query.trim() && allResults.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>
                {results.length} of {allResults.length}
              </span>
            )}
          </div>

          {!query.trim() ? (
            <div className="emptyState">Start typing to search.</div>
          ) : allResults.length === 0 ? (
            <div className="emptyState">No matches.</div>
          ) : (
            <>
              <ul className="resultList">
                {results.map((c) => (
                  <CourseItem key={c.id} c={c} />
                ))}
              </ul>

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} style={{ height: 1 }} />

              {/* Loading indicator when more exist */}
              {hasMore && (
                <div style={{
                  textAlign: "center",
                  padding: "12px 0",
                  fontSize: 12,
                  color: "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}>
                  <span style={{
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    border: "2px solid var(--border)",
                    borderTopColor: "#A32638",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }} />
                  Loading more…
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              )}

              {/* End of results message */}
              {!hasMore && allResults.length > PAGE_SIZE && (
                <div style={{ textAlign: "center", padding: "10px 0", fontSize: 11, color: "var(--muted)" }}>
                  All {allResults.length} results shown
                </div>
              )}
            </>
          )}
        </div>

        <hr className="divider" />

        <div className="resultsSection">
          <div className="sectionTitle">★ Favorites</div>
          {favorites.length === 0 ? (
            <div className="emptyState">No favorites yet. Click ★ on any course.</div>
          ) : (
            <ul className="resultList">
              {favorites.map((c) => (
                <CourseItem key={c.id} c={c} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {viewModal && (
        <div style={modalStyle.overlay} onClick={() => setViewModal(null)}>
          <div style={modalStyle.box} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "18px 20px 0", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                <div>
                  <div style={{ fontWeight: "bold", fontSize: "15px", color: "var(--text)" }}>{viewModal.course.code}</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>{viewModal.course.title}</div>
                </div>
                <button type="button" onClick={() => setViewModal(null)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "18px", cursor: "pointer" }}>✕</button>
              </div>

              <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)" }}>
                {(["reviews", "syllabus"] as ModalTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setModalTab(tab)}
                    style={{
                      padding: "7px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: modalTab === tab ? "var(--text)" : "var(--muted)",
                      borderBottom: modalTab === tab ? "2px solid #A32638" : "2px solid transparent",
                      marginBottom: "-1px",
                      transition: "all 0.15s",
                      textTransform: "capitalize",
                    }}
                  >
                    {tab === "reviews" ? "⭐ Reviews" : "📄 Syllabus"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ overflowY: "auto", padding: "16px 20px", flex: 1 }}>
              {modalTab === "reviews" && (
                <>
                  {modalAvg && modalAvg.count > 0 && (
                    <div style={{ display: "flex", gap: "16px", marginBottom: "16px", padding: "12px", backgroundColor: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                      {[{ val: modalAvg.rating, label: "Rating" }, { val: modalAvg.difficulty, label: "Difficulty" }, { val: modalAvg.count, label: "Reviews" }].map(({ val, label }) => (
                        <div key={label} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: "28px", fontWeight: "bold", color: "var(--text)" }}>{val}</div>
                          <div style={{ fontSize: "11px", color: "var(--muted)" }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {modalSummary && modalAvg && modalAvg.count > 0 && (
                    <div style={{ backgroundColor: "var(--bg)", borderRadius: "8px", padding: "12px", border: "1px solid var(--border)", marginBottom: "16px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 800, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>AI Review Summary</div>
                      <p style={{ margin: 0, color: "var(--text)", fontSize: "13px", lineHeight: 1.6 }}>{modalSummary}</p>
                    </div>
                  )}
                  {modalLoading ? (
                    <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>Loading...</div>
                  ) : modalRatings.length === 0 ? (
                    <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>
                      No reviews yet.
                      <div style={{ marginTop: "8px" }}>
                        <button type="button" onClick={() => { setViewModal(null); navigate(`/reviews?course=${encodeURIComponent(viewModal.course.code)}`); }} style={{ fontSize: "12px", color: "#A32638", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                          Be the first to review!
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {modalRatings.map((r) => (
                        <div key={r.id} style={{ backgroundColor: "var(--bg)", borderRadius: "8px", padding: "12px", border: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: "12px", marginBottom: r.review ? "8px" : 0 }}>
                            <span style={{ backgroundColor: r.rating >= 4 ? "#22c55e" : r.rating >= 3 ? "#f59e0b" : "#ef4444", color: "#fff", fontWeight: "bold", fontSize: "13px", padding: "2px 8px", borderRadius: "4px" }}>
                              {r.rating}/5
                            </span>
                            {r.difficulty > 0 && <span style={{ fontSize: "12px", color: "var(--muted)" }}>Difficulty: {r.difficulty}/5</span>}
                            <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "auto" }}>{new Date(r.created_at).toLocaleDateString()}</span>
                          </div>
                          {r.review && <p style={{ margin: 0, fontSize: "13px", color: "var(--text)", lineHeight: 1.6 }}>{r.review}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => { setViewModal(null); navigate(`/reviews?course=${encodeURIComponent(viewModal.course.code)}`); }} style={{ marginTop: "16px", width: "100%", padding: "9px", backgroundColor: "#A32638", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}>
                    ✏️ Write a Review
                  </button>
                </>
              )}

              {modalTab === "syllabus" && (
                <div>
                  <div style={{ backgroundColor: "var(--bg)", borderRadius: "10px", padding: "16px", marginBottom: "16px", border: "1px dashed var(--border)" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "6px" }}>📤 Upload Syllabus</div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "12px" }}>PDF only, max 10MB. Anyone logged in can upload.</div>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "10px", borderRadius: "8px", cursor: "pointer", backgroundColor: uploading ? "var(--border)" : "#A32638", color: "#fff", fontSize: "13px", fontWeight: 600, opacity: uploading ? 0.7 : 1, transition: "all 0.2s" }}>
                      {uploading ? "Uploading..." : "+ Choose PDF"}
                      <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={uploading} onChange={handleSyllabusUpload} />
                    </label>
                    {uploadError && <div style={{ marginTop: "8px", fontSize: "12px", color: "#ef4444" }}>⚠ {uploadError}</div>}
                    {uploadSuccess && <div style={{ marginTop: "8px", fontSize: "12px", color: "#f59e0b" }}>⏳ Uploaded! Your syllabus is pending admin review.</div>}
                  </div>

                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "10px" }}>Available Syllabi</div>

                  {syllabusLoading ? (
                    <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>Loading...</div>
                  ) : syllabi.length === 0 ? (
                    <div style={{ textAlign: "center", color: "var(--muted)", padding: "24px 0", fontSize: "13px" }}>
                      No syllabus uploaded yet.<br />
                      <span style={{ fontSize: "11px" }}>Be the first to share one!</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {syllabi.map((s) => (
                        <div key={s.id} style={{ backgroundColor: "var(--bg)", borderRadius: "8px", padding: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", border: "1px solid var(--border)" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "13px", color: "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {s.file_name}</div>
                            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "3px" }}>By {s.uploaded_by} · {new Date(s.created_at).toLocaleDateString()}</div>
                          </div>
                          <a href={s.file_url} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 12px", backgroundColor: "var(--accent)", color: "#fff", borderRadius: "6px", fontSize: "12px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
                            View PDF
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}