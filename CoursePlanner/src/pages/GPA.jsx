import React, { useState, useEffect } from "react";
import { calculateGPA } from "../gpaCalculator";

const semesters = ["Fall2026", "Spring2026", "Summer2026"];

export default function GPA({ courses }) {
  const [semesterFilter, setSemesterFilter] = useState("");
  const [displayGPA, setDisplayGPA] = useState(0);

  const gpa = calculateGPA(courses, semesterFilter || null);

  // Simple animation
  useEffect(() => {
    let start = displayGPA;
    let end = gpa;
    let step = (end - start) / 20;
    let i = 0;
    const interval = setInterval(() => {
      start += step;
      setDisplayGPA(parseFloat(start.toFixed(2)));
      i++;
      if (i >= 20) clearInterval(interval);
    }, 20);
  }, [gpa]);

  return (
    <div>
      <h2 style={{ color: "#A32638" }}>GPA Calculator</h2>
      <label>Filter by Semester: </label>
      <select
        value={semesterFilter}
        onChange={(e) => setSemesterFilter(e.target.value)}
        style={{
          padding: "8px",
          borderRadius: "5px",
          border: "1px solid #ccc",
          marginLeft: "10px",
        }}
      >
        <option value="">All Semesters</option>
        {semesters.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <div
        style={{
          marginTop: "30px",
          fontSize: "28px",
          fontWeight: "bold",
          color: "#fff",
          backgroundColor: "#A32638",
          padding: "25px",
          borderRadius: "15px",
          width: "fit-content",
          boxShadow: "0 6px 12px rgba(0,0,0,0.2)",
        }}
      >
        GPA: {displayGPA}
      </div>
    </div>
  );
}
