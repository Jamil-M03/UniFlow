import React, { useState } from "react";

const semesters = ["Fall2026", "Spring2026", "Summer2026"];
const grades = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"];

export default function CourseForm({ addCourse }) {
  const [name, setName] = useState("");
  const [credits, setCredits] = useState(3);
  const [grade, setGrade] = useState("A");
  const [semester, setSemester] = useState(semesters[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    addCourse({ id: Date.now(), name, credits, grade, semester });
    setName("");
    setCredits(3);
    setGrade("A");
    setSemester(semesters[0]);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        gap: "10px",
        flexWrap: "wrap",
        marginBottom: "20px",
      }}
    >
      <input
        placeholder="Course Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        style={{
          padding: "8px",
          borderRadius: "5px",
          border: "1px solid #ccc",
        }}
      />
      <input
        type="number"
        min="1"
        max="6"
        value={credits}
        onChange={(e) => setCredits(parseInt(e.target.value))}
        required
        style={{
          padding: "8px",
          borderRadius: "5px",
          border: "1px solid #ccc",
          width: "80px",
        }}
      />
      <select
        value={grade}
        onChange={(e) => setGrade(e.target.value)}
        style={{
          padding: "8px",
          borderRadius: "5px",
          border: "1px solid #ccc",
        }}
      >
        {grades.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <select
        value={semester}
        onChange={(e) => setSemester(e.target.value)}
        style={{
          padding: "8px",
          borderRadius: "5px",
          border: "1px solid #ccc",
        }}
      >
        {semesters.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="submit"
        style={{
          backgroundColor: "#A32638",
          color: "#fff",
          border: "none",
          padding: "8px 15px",
          borderRadius: "5px",
          cursor: "pointer",
          transition: "background 0.2s",
        }}
        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#7a1f2a")}
        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#A32638")}
      >
        Add Course
      </button>
    </form>
  );
}
