Courses.jsx;

// pages/Courses.jsx
import React, { useState } from "react";
import CourseForm from "../components/CourseForm";

export default function Courses({ courses, setCourses }) {
  const [confirmDelete, setConfirmDelete] = useState({ show: false, id: null });

  const addCourse = (course) => setCourses([...courses, course]);
  const removeCourse = (id) => setCourses(courses.filter((c) => c.id !== id));

  const gradeColor = (grade) => {
    if (grade === "A+" || grade === "A") return "#28a745";
    if (["A-", "B+", "B", "B-"].includes(grade)) return "#ffc107";
    if (["C+", "C", "D"].includes(grade)) return "#fd7e14";
    return "#dc3545"; // F
  };

  return (
    <div>
      <h2 style={{ color: "#A32638" }}>Courses</h2>
      <CourseForm addCourse={addCourse} />

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          backgroundColor: "#fff",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        }}
      >
        <thead style={{ backgroundColor: "#A32638", color: "#fff" }}>
          <tr>
            <th style={{ padding: "10px" }}>Name</th>
            <th style={{ padding: "10px" }}>Credits</th>
            <th style={{ padding: "10px" }}>Grade</th>
            <th style={{ padding: "10px" }}>Semester</th>
            <th style={{ padding: "10px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((c, i) => (
            <tr
              key={c.id}
              style={{
                backgroundColor: i % 2 === 0 ? "#f9f9f9" : "#fff",
                textAlign: "center",
                borderBottom: "1px solid #ddd",
                transition: "background-color 0.2s",
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.backgroundColor = "#ffe5e5")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.backgroundColor =
                  i % 2 === 0 ? "#f9f9f9" : "#fff")
              }
            >
              <td style={{ padding: "8px" }}>{c.name}</td>
              <td style={{ padding: "8px" }}>{c.credits}</td>
              <td
                style={{
                  padding: "8px",
                  fontWeight: "bold",
                  color: gradeColor(c.grade),
                }}
              >
                {c.grade}
              </td>
              <td style={{ padding: "8px" }}>{c.semester}</td>
              <td style={{ padding: "8px" }}>
                <button
                  onClick={() => setConfirmDelete({ show: true, id: c.id })}
                  style={{
                    backgroundColor: "#dc3545",
                    color: "#fff",
                    border: "none",
                    padding: "5px 10px",
                    borderRadius: "5px",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Confirmation Modal */}
      {confirmDelete.show && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              padding: "30px",
              borderRadius: "10px",
              textAlign: "center",
            }}
          >
            <p>Are you sure you want to remove this course?</p>
            <div
              style={{ display: "flex", gap: "10px", justifyContent: "center" }}
            >
              <button
                style={{
                  padding: "8px 15px",
                  backgroundColor: "#dc3545",
                  color: "#fff",
                  border: "none",
                  borderRadius: "5px",
                  cursor: "pointer",
                }}
                onClick={() => {
                  removeCourse(confirmDelete.id);
                  setConfirmDelete({ show: false, id: null });
                }}
              >
                Yes
              </button>
              <button
                style={{
                  padding: "8px 15px",
                  backgroundColor: "#6c757d",
                  color: "#fff",
                  border: "none",
                  borderRadius: "5px",
                  cursor: "pointer",
                }}
                onClick={() => setConfirmDelete({ show: false, id: null })}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
