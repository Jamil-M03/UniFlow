export type Day = 'M' | 'T' | 'W' | 'R' | 'F' | 'S';

export type Meeting = {
  days: Day[]; // e.g. ['M','W']
  start: string; // 'HH:MM' 24h
  end: string; // 'HH:MM' 24h
  location?: string;
  type?: string;
};

export type Course = {
  id: string; // stable id, e.g. 'CMPS271-1'
  crn: string;
  code: string; // e.g. 'CMPS 271'
  title: string;
  instructor: string;
  campus: string;
  section: string;
  credits: number;
  capacity: { enrolled: number; limit: number };
  attributes: string[];
  prerequisites?: string;
  restrictions?: string;
  difficulty: number; // 1..5 (demo)
  workload: number; // 1..5 (demo)
  meetings: Meeting[];
  // Linking fields (from Banner isSectionLinked / linkIdentifier)
  isSectionLinked?: boolean;
  linkIdentifier?: string | null;
  scheduleType?: string; // e.g. 'Lecture', 'Lab', 'Recitation'
  subjectCourse?: string; // e.g. 'CMPS201' — used to scope linked-section lookup
};
