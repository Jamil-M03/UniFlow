// components/GradeCalculator.jsx
import React, { useState } from "react";
import { gradePointsMap } from "../gpaCalculator";

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

const defaultRows = [
  { id: 1, name: "Midterm",       weight: 30, score: "" },
  { id: 2, name: "Final Exam",    weight: 40, score: "" },
  { id: 3, name: "Assignments",   weight: 20, score: "" },
  { id: 4, name: "Participation", weight: 10, score: "" },
];

export default function GradeCalculator() {
  const [rows, setRows] = useState(defaultRows);
  const [nextId, setNextId] = useState(5);

  const update = (id, field, val) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));

  const addRow = () => {
    setRows([...rows, { id: nextId, name: "", weight: "", score: "" }]);
    setNextId(nextId + 1);
  };

  const removeRow = (id) => {
    if (rows.length > 1) setRows(rows.filter((r) => r.id !== id));
  };

  const totalWeight = rows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
  const filled = rows.filter(
    (r) => r.score !== "" && r.weight !== "" && parseFloat(r.weight) > 0
  );
  const usedWeight = filled.reduce((s, r) => s + parseFloat(r.weight), 0);
  const isPartial = Math.abs(usedWeight - 100) > 0.01;

  let finalPct = null, letter = null, gp = null;
  if (filled.length > 0) {
    const weighted = filled.reduce(
      (s, r) => s + parseFloat(r.score) * parseFloat(r.weight), 0
    );
    finalPct = weighted / usedWeight;
    letter = scoreToLetter(finalPct);
    gp = gradePointsMap[letter];
  }

  const inputStyle = {
    padding: "7px 10px", borderRadius: "5px",
    border: "1px solid #ccc", fontSize: "14px", width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div>
      <h2 style={{ color: "#A32638" }}>Grade Calculator</h2>

      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 36px", gap: "8px", marginBottom: "4px" }}>
        {["Component", "Weight (%)", "Score (%)", ""].map((h, i) => (
          <span key={i} style={{ fontSize: "12px", color: "#888" }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      {rows.map((r) => (
        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 36px", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
          <input style={inputStyle} placeholder="e.g. Midterm" value={r.name}
            onChange={(e) => update(r.id, "name", e.target.value)} />
          <input style={inputStyle} type="number" placeholder="%" min={0} max={100}
            value={r.weight} onChange={(e) => update(r.id, "weight", e.target.value)} />
          <input style={inputStyle} type="number" placeholder="%" min={0} max={100} step={0.1}
            value={r.score} onChange={(e) => update(r.id, "score", e.target.value)} />
          <button onClick={() => removeRow(r.id)}
            style={{ background: "none", border: "1px solid #ccc", borderRadius: "5px",
              cursor: "pointer", color: "#dc3545", fontSize: "16px", height: "36px" }}>
            ×
          </button>
        </div>
      ))}

      <button onClick={addRow}
        style={{ background: "none", border: "1px solid #ccc", borderRadius: "5px",
          padding: "7px 14px", cursor: "pointer", fontSize: "13px", color: "#555", marginTop: "4px" }}>
        + Add component
      </button>

      {/* Weight warning */}
      {Math.abs(totalWeight - 100) > 0.01 && rows.some((r) => r.weight !== "") && (
        <p style={{ color: "#dc3545", fontSize: "12px", marginTop: "8px" }}>
          Weights sum to {totalWeight.toFixed(1)}% — must equal 100%
        </p>
      )}

      {/* Result card */}
      {finalPct !== null && (
        <div style={{ marginTop: "24px", backgroundColor: "#A32638", borderRadius: "15px",
          padding: "20px 25px", display: "flex", alignItems: "center",
          justifyContent: "space-between", boxShadow: "0 6px 12px rgba(0,0,0,0.2)", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "13px", margin: "0 0 4px" }}>Final grade</p>
            <p style={{ color: "#fff", fontSize: "28px", fontWeight: "bold", margin: 0 }}>
              {isPartial ? "~" : ""}{finalPct.toFixed(1)}%
            </p>
            <span style={{ background: "rgba(255,255,255,0.15)", borderRadius: "8px",
              padding: "3px 10px", fontSize: "13px", color: "#fff", marginTop: "6px", display: "inline-block" }}>
              GPA points: {gp.toFixed(1)}{isPartial ? " (partial)" : ""}
            </span>
          </div>
          <div style={{ fontSize: "42px", fontWeight: "bold", color: "#fff",
            background: "rgba(255,255,255,0.15)", borderRadius: "10px", padding: "6px 20px" }}>
            {letter}
          </div>
        </div>
      )}
    </div>
  );
}