import React, { useState } from "react";
import CourseForm from "../components/CourseForm";
import GPA from "./GPA";
import GPACourses from "./GPACourses";
import GradeCalculator from "../components/GradeCalculator";


export default function GPAPage() {
  const [courses, setCourses] = useState([
    { id: 1, name: "CS101", credits: 3, grade: "A", semester: "Fall2026" },
  ]);

  return (
    <div
      style={{
        padding: "30px",
        backgroundColor: "#1a1a2e",
        minHeight: "100vh",
        color: "#fff",
      }}
    >
      <GPA courses={courses} />
      <br />
      <GPACourses courses={courses} setCourses={setCourses} />
      <GradeCalculator />
    </div>
  );
}
