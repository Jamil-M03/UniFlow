# UniFlow

**AI-powered course planning for AUB students.**

UniFlow lets students at the American University of Beirut search the live
course catalog, build conflict-free schedules visually, find empty
classrooms, review professors anonymously, calculate GPA, and ask an AI
assistant for personalized scheduling help — all in one place.

**Live:** https://cmps-271.vercel.app
**Stack:** React 19 · TypeScript · Vite · Node.js · Express · Supabase (PostgreSQL) · Clerk · Vercel · Render · Groq (Llama 3.3 70B) · Hugging Face · Playwright

---

## Features

**Schedule builder** — drag courses onto a calendar grid (FullCalendar) and
see time conflicts surface immediately. Up to four parallel schedule
"slots" let you compare alternatives side-by-side. Generates a PDF export
of the final timetable.

**AI scheduling assistant** — a chat interface backed by Groq's Llama 3.3
70B. Ask things like *"build me a 15-credit MWF-only schedule with no
class before 10am"* or *"summarize the reviews for Professor [name]"*.
The server resolves preferences, runs a constraint solver over the
catalog, and returns either a proposed schedule or a review digest.

**Live course data** — three Playwright-based scrapers (`fetchCourses.cjs`,
`courseFetcher_spring.cjs`, `courseFetcher_semester_based.cjs`) drive a
headless Chromium against AUBsis, the official AUB Banner system,
navigating term selection and pagination to pull the full section list.
Data is normalized and stored in Supabase, so the front-end always reads
from a clean snapshot.

**Empty classroom finder** — given a day and time window, returns every
classroom on campus with no scheduled class in that window. Computed
client-side from the same course data using interval logic in
`utils/classroomAvailability.ts`.

**Anonymous review system** — students rate and review courses and
professors without their identity attached to the public review. Each
submission is moderated by a Hugging Face inference call before going
live, with rejection reasons surfaced to the user.

**GPA calculator** — semester-aware GPA computation with letter-grade
inputs, supporting AUB's 4.0 scale and credit-weighted averaging across
multiple semesters.

**Role-based admin portal** — moderators see a queue of flagged reviews,
uploaded syllabi, and pending data corrections, gated by a custom
`AdminRoute` component that checks roles in both Clerk metadata and the
Supabase `users` table.

**Mobile-responsive** — the timetable, course search, and chat all reflow
cleanly down to ~360px width. Tested across phone and tablet breakpoints.

---

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  React + TypeScript SPA  │ ──HTTP→ │   Node / Express API     │
│  (Vercel)                │         │   (Render)               │
│  - Schedule builder      │         │   - /api/ai-schedule     │
│  - AI chat               │         │   - /api/ratings/*       │
│  - Reviews UI            │         │   - /api/syllabi/*       │
│  - GPA calculator        │         │   - HF moderation        │
└──────────┬───────────────┘         │   - Groq Llama 3.3       │
           │                         └──────────┬───────────────┘
           │           Clerk auth                │
           │     (JWT verified on both)          │
           ▼                                     ▼
┌────────────────────────────────────────────────────────────────┐
│                  Supabase (PostgreSQL)                         │
│  courses · professors · ratings · schedules · syllabi · users  │
└────────────────────────────────────────────────────────────────┘
                              ▲
                              │
                      ┌───────┴───────┐
                      │   Playwright  │
                      │   scrapers    │
                      │  (cron / CLI) │
                      └───────┬───────┘
                              │
                              ▼
                       AUBsis (Banner)
```

The scrapers run as standalone Node scripts, not part of the deployed
backend — they're invoked manually each semester (or on cron) to refresh
the Supabase catalog.

---

## Local development

### Prerequisites

- Node.js ≥ 20
- A Supabase project (free tier is fine)
- A Clerk application
- API keys for Groq and Hugging Face Inference

### Setup

```bash
git clone https://github.com/<your-username>/uniflow.git
cd uniflow

# Install root-level deps (scrapers + server)
npm install

# Install front-end deps
cd CoursePlannerr
npm install
cd ..
```

### Environment

Two `.env` files are needed.

**`./.env`** (server + scrapers):
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GROQ_API_KEY=...
HF_TOKEN=...
PORT=3001
```

**`./CoursePlannerr/.env`** (front-end):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_CLERK_PUBLISHABLE_KEY=...
VITE_API_URL=http://localhost:3001
```

### Run

```bash
# Terminal 1: backend
node server.cjs

# Terminal 2: frontend
cd CoursePlannerr
npm run dev
```

Open http://localhost:5173.

### Refresh course catalog

```bash
node fetchCourses.cjs
# or, for a specific semester:
node courseFetcher_spring.cjs
```

These will launch a Chromium window, scrape AUBsis, and upsert into
Supabase. Expect 5–15 minutes depending on department count.

---

## Tests

The schedule logic (free-slot finding and classroom availability) has
unit tests under `CoursePlannerr/tests/`:

```bash
cd CoursePlannerr
npm test
```

---

## Project layout

```
uniflow/
├── server.cjs                          deployed Node/Express API
├── fetchCourses.cjs                    full AUBsis scraper
├── courseFetcher_spring.cjs            spring-term scraper
├── courseFetcher_semester_based.cjs    semester-parametrized scraper
├── package.json                        root deps (Express, Playwright, Groq, HF)
└── CoursePlannerr/                     React + TypeScript front-end
    ├── src/
    │   ├── pages/                      route-level views
    │   │   ├── AdminPortal.tsx         moderator queue (admin-only)
    │   │   ├── EmptyClasses.tsx        empty classroom finder
    │   │   ├── Reviews.tsx             anonymous reviews
    │   │   ├── GPA*.jsx                GPA calculator
    │   │   └── Login.tsx               Clerk sign-in / sign-up
    │   ├── components/
    │   │   ├── AiScheduler.tsx         Groq-powered chat assistant
    │   │   ├── ScheduleGrid.tsx        FullCalendar timetable
    │   │   ├── RightSearchPanel.tsx    course search + filters
    │   │   ├── LeftInfoPanel.tsx       selected-course detail
    │   │   ├── TopNav.tsx              top nav + user menu
    │   │   ├── AdminRoute.tsx          role-gated wrapper
    │   │   ├── ProtectedRoute.tsx      auth-gated wrapper
    │   │   └── GradeCalculator.jsx     letter-grade input widget
    │   ├── hooks/                      Clerk/Supabase/schedules hooks
    │   ├── utils/
    │   │   ├── courseApi.ts            shape normalizer
    │   │   ├── schedule.ts             free-slot / conflict solver
    │   │   └── classroomAvailability.ts
    │   └── types.ts                    shared TypeScript types
    └── tests/                          schedule unit tests
```

---

## Team

UniFlow was built as the final project for AUB's CMPS 271 (Software
Engineering) by a 4-person Agile team using Jira and Scrum, with a
rotating Scrum Master role.

---

## License

**PolyForm Noncommercial 1.0.0** — see [`LICENSE`](./LICENSE).

You are free to view, fork, modify, and use UniFlow for personal,
educational, and other non-commercial purposes. **Commercial use —
including selling, monetizing, or building paid products on top of this
code — is not permitted under this license.** If you're interested in
commercial licensing or partnership, please reach out via my
[GitHub profile](https://github.com/Jamil-M03).

Course data scraped from AUBsis is the property of the American
University of Beirut and is used here only to power the student-facing
planner.