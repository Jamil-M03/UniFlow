import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { useSupabase } from "../hooks/useSupabase.ts";

type Status = "pending" | "approved" | "rejected";

interface Syllabus {
  id: string;
  course_code: string;
  file_url: string;
  file_name: string;
  uploaded_by: string;
  created_at: string;
  status: Status;
  admin_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

type RawSyllabus = Omit<Syllabus, "status" | "admin_comment" | "reviewed_by" | "reviewed_at"> & {
  status?: Status | null;
  admin_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
};

const STATUS_COLOR: Record<Status, string> = {
  pending: "#f59e0b",
  approved: "#22c55e",
  rejected: "#ef4444",
};

const STATUS_BG: Record<Status, string> = {
  pending: "rgba(245,158,11,0.12)",
  approved: "rgba(34,197,94,0.12)",
  rejected: "rgba(239,68,68,0.12)",
};

function normalizeSyllabus(row: RawSyllabus): Syllabus {
  return {
    ...row,
    status: row.status ?? "pending",
    admin_comment: row.admin_comment ?? null,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ?? null,
  };
}

export default function AdminPortal() {
  const navigate = useNavigate();
  const supabase = useSupabase();
  const { user } = useUser();
  const [syllabi, setSyllabi] = useState<Syllabus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "all">("pending");
  const adminEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  // Review modal state
  const [reviewing, setReviewing] = useState<Syllabus | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const loadSyllabi = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("syllabi")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Could not load syllabus submissions:", error);
      setLoadError(error.message);
      setSyllabi([]);
      setLoading(false);
      return;
    }
    setSyllabi(((data ?? []) as RawSyllabus[]).map(normalizeSyllabus));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    Promise.resolve().then(loadSyllabi);
  }, [loadSyllabi]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDecision = async (decision: "approved" | "rejected") => {
    if (!reviewing) return;
    if (decision === "rejected" && !comment.trim()) {
      showToast("Please add a reason for rejection.", false);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("syllabi")
      .update({
        status: decision,
        admin_comment: comment.trim() || null,
        reviewed_by: adminEmail,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reviewing.id);

    if (error) {
      console.error("Could not update syllabus submission:", error);
      showToast("Something went wrong. Try again.", false);
    } else {
      showToast(
        decision === "approved"
          ? "✓ Syllabus approved!"
          : "✕ Syllabus rejected.",
        decision === "approved",
      );
      setReviewing(null);
      setComment("");
      await loadSyllabi();
    }
    setSubmitting(false);
  };

  const filtered =
    filter === "all" ? syllabi : syllabi.filter((s) => s.status === filter);

  const counts = {
    all: syllabi.length,
    pending: syllabi.filter((s) => s.status === "pending").length,
    approved: syllabi.filter((s) => s.status === "approved").length,
    rejected: syllabi.filter((s) => s.status === "rejected").length,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* ── Toast ── */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 99999,
            background: toast.ok ? "#22c55e" : "#ef4444",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            animation: "fadeIn 0.2s ease",
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 32px",
          borderBottom: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            flexShrink: 0,
            background: "linear-gradient(135deg, #A32638, #6e1425)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          🛡️
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>
            Admin Portal
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Syllabus Review Queue · {adminEmail}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            onClick={() => navigate("/")}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              padding: "7px 16px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ← Back to Planner
          </button>
          <button
            onClick={loadSyllabi}
            style={{
              background: "var(--panel2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              padding: "7px 16px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        {/* ── Stats bar ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 14,
            marginBottom: 28,
          }}
        >
          {(
            [
              { key: "all", label: "Total", emoji: "📋" },
              { key: "pending", label: "Pending", emoji: "⏳" },
              { key: "approved", label: "Approved", emoji: "✅" },
              { key: "rejected", label: "Rejected", emoji: "❌" },
            ] as const
          ).map(({ key, label, emoji }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                background: filter === key ? "var(--panel)" : "var(--panel2)",
                border: `1px solid ${filter === key ? (key === "all" ? "var(--accent)" : (STATUS_COLOR[key as Status] ?? "var(--accent)")) : "var(--border)"}`,
                borderRadius: 12,
                padding: "16px",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{emoji}</div>
              <div
                style={{ fontSize: 26, fontWeight: 800, color: "var(--text)" }}
              >
                {counts[key]}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}
              >
                {label}
              </div>
            </button>
          ))}
        </div>

        {/* ── Table ── */}
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}
            >
              {filter === "all"
                ? "All Submissions"
                : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Submissions`}
              <span
                style={{
                  marginLeft: 8,
                  color: "var(--muted)",
                  fontWeight: 400,
                  fontSize: 13,
                }}
              >
                ({filtered.length})
              </span>
            </div>
            {counts.pending > 0 && filter !== "pending" && (
              <div
                style={{
                  background: "rgba(245,158,11,0.15)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.3)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {counts.pending} awaiting review
              </div>
            )}
          </div>

          {loading ? (
            <div
              style={{
                padding: 48,
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
              }}
            >
              Loading submissions…
            </div>
          ) : loadError ? (
            <div
              style={{
                padding: 48,
                textAlign: "center",
                color: "#ef4444",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              Could not load syllabus submissions.
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                {loadError}
              </div>
              <button
                onClick={loadSyllabi}
                style={{
                  marginTop: 16,
                  background: "var(--panel2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  padding: "7px 16px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                padding: 48,
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>
                {filter === "pending" ? "🎉" : "📭"}
              </div>
              {filter === "pending"
                ? "No pending submissions — all caught up!"
                : "Nothing here yet."}
            </div>
          ) : (
            <div>
              {/* Column headers */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 160px 100px 120px",
                  gap: 12,
                  padding: "10px 20px",
                  background: "var(--panel2)",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.6px",
                }}
              >
                <span>Course</span>
                <span>File</span>
                <span>Submitted by</span>
                <span>Status</span>
                <span>Action</span>
              </div>

              {filtered.map((s, i) => (
                <div
                  key={s.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr 160px 100px 120px",
                    gap: 12,
                    padding: "14px 20px",
                    borderBottom:
                      i < filtered.length - 1
                        ? "1px solid var(--border)"
                        : "none",
                    alignItems: "center",
                    background:
                      s.status === "pending"
                        ? "rgba(245,158,11,0.03)"
                        : "transparent",
                    transition: "background 0.15s",
                  }}
                >
                  {/* Course */}
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: "var(--text)",
                    }}
                  >
                    {s.course_code}
                  </div>

                  {/* File */}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      📄 {s.file_name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        marginTop: 2,
                      }}
                    >
                      {new Date(s.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    {s.admin_comment && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          marginTop: 3,
                          fontStyle: "italic",
                        }}
                      >
                        💬 {s.admin_comment}
                      </div>
                    )}
                  </div>

                  {/* Submitted by */}
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.uploaded_by}
                  </div>

                  {/* Status badge */}
                  <div>
                    <span
                      style={{
                        display: "inline-block",
                        background: STATUS_BG[s.status],
                        color: STATUS_COLOR[s.status],
                        border: `1px solid ${STATUS_COLOR[s.status]}40`,
                        borderRadius: 6,
                        padding: "3px 10px",
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "capitalize",
                      }}
                    >
                      {s.status}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <a
                      href={s.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: "var(--panel2)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      👁 View
                    </a>
                    {s.status === "pending" && (
                      <button
                        onClick={() => {
                          setReviewing(s);
                          setComment("");
                        }}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          background: "#A32638",
                          border: "none",
                          color: "#fff",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Review
                      </button>
                    )}
                    {s.status !== "pending" && (
                      <button
                        onClick={() => {
                          setReviewing(s);
                          setComment(s.admin_comment ?? "");
                        }}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--muted)",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Redo
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Review Modal ── */}
      {reviewing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99998,
            padding: 16,
          }}
          onClick={() => !submitting && setReviewing(null)}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              width: "100%",
              maxWidth: 520,
              boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{
                padding: "18px 22px",
                borderBottom: "1px solid var(--border)",
                background: "var(--panel2)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 15,
                    color: "var(--text)",
                  }}
                >
                  Review Submission
                </div>
                <div
                  style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}
                >
                  {reviewing.course_code} · {reviewing.file_name}
                </div>
              </div>
              <button
                onClick={() => !submitting && setReviewing(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "22px" }}>
              {/* File info */}
              <div
                style={{
                  background: "var(--bg)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  marginBottom: 20,
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                  >
                    📄 {reviewing.file_name}
                  </span>
                  <a
                    href={reviewing.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 12,
                      color: "var(--accent)",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    Open PDF ↗
                  </a>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Submitted by{" "}
                  <strong style={{ color: "var(--text)" }}>
                    {reviewing.uploaded_by}
                  </strong>{" "}
                  on{" "}
                  {new Date(reviewing.created_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
                {reviewing.reviewed_by && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    Previously {reviewing.status} by {reviewing.reviewed_by}
                  </div>
                )}
              </div>

              {/* Comment box */}
              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--muted)",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Comment / Reason{" "}
                  <span
                    style={{
                      color: "var(--muted)",
                      fontWeight: 400,
                      textTransform: "none",
                    }}
                  >
                    (required for rejection)
                  </span>
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="e.g. Wrong course, outdated syllabus, or 'Looks good!'"
                  rows={3}
                  disabled={submitting}
                  style={{
                    width: "100%",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)",
                    fontSize: 13,
                    padding: "10px 12px",
                    resize: "vertical",
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* Decision buttons */}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => handleDecision("rejected")}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    padding: "11px",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.4)",
                    color: "#ef4444",
                    borderRadius: 10,
                    cursor: submitting ? "not-allowed" : "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    opacity: submitting ? 0.6 : 1,
                    transition: "all 0.15s",
                  }}
                >
                  ✕ Reject
                </button>
                <button
                  onClick={() => handleDecision("approved")}
                  disabled={submitting}
                  style={{
                    flex: 1,
                    padding: "11px",
                    background: "rgba(34,197,94,0.1)",
                    border: "1px solid rgba(34,197,94,0.4)",
                    color: "#22c55e",
                    borderRadius: 10,
                    cursor: submitting ? "not-allowed" : "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    opacity: submitting ? 0.6 : 1,
                    transition: "all 0.15s",
                  }}
                >
                  ✓ Approve
                </button>
              </div>
              {submitting && (
                <div
                  style={{
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 12,
                    marginTop: 10,
                  }}
                >
                  Saving…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
