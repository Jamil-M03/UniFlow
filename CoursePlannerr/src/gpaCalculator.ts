// gpaCalculator.js

// Grade-to-point mapping
export const gradePointsMap = {
    "A+": 4.3,
    A: 4.0,
    "A-": 3.7,
    "B+": 3.3,
    B: 3.0,
    "B-": 2.7,
    "C+": 2.3,
    C: 2.0,
    D: 1.0,
    F: 0.0,
  };
  
  /**
   * Calculate GPA for given courses
   * @param {Array} courses - Array of course objects {credits, grade, semester}
   * @param {string} semester - Optional filter by semester
   * @returns {number} GPA rounded to 2 decimals
   */
  export function calculateGPA(courses, semester = null) {
    let totalPoints = 0;
    let totalCredits = 0;
  
    const filteredCourses = semester
      ? courses.filter((course) => course.semester === semester)
      : courses;
  
    for (const course of filteredCourses) {
      const points = gradePointsMap[course.grade];
      if (points === undefined) {
        throw new Error(`Unknown grade: ${course.grade}`) ;
      }
      totalPoints += points * course.credits;
      totalCredits += course.credits;
    }
  
    if (totalCredits === 0) return 0;
  
    return parseFloat((totalPoints / totalCredits).toFixed(2));
  }