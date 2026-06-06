# UniFlow

**AI-powered course planning for AUB students.**

UniFlow lets students at the American University of Beirut search the live
course catalog, build conflict-free schedules visually, find empty
classrooms, review professors anonymously, calculate GPA, and ask an AI
assistant for personalized scheduling help — all in one place.

**Live:** https://uniflow-planner.vercel.app/
**Stack:** React 19 · TypeScript · Vite · Node.js · Express · Supabase (PostgreSQL) · Clerk · Vercel · Render · Groq (Llama 3.3 70B) · Hugging Face · Playwright

---

## Features

**Schedule builder** — place courses on a custom calendar grid and see
time conflicts surface immediately. Up to four parallel schedule "slots"
let you compare alternatives side-by-side, with a PDF export of the final
timetable. Registered courses re-sync to the live catalog on load — seats,
times, and instructors update automatically, and sections that are no
longer offered drop out (no need to remove and re-add them).

**AI scheduling assistant** — a chat interface backed by Groq's Llama 3.3
70B. Ask things like *"build me a 15-credit MWF-only schedule with no
class before 10am"* or *"summarize the reviews for Professor [name]"*.
The server is aware of what you already have scheduled, so proposals avoid
time conflicts and duplicates, respect "give me N courses" limits, keep
linked lecture/lab/recitation sections together, and read seat
availability correctly. It returns either a proposed schedule (applied
with one click) or a review digest.

**Live course data** — two Playwright-based scrapers (`fetchCourses.cjs`
and `courseFetcher_semester_based.cjs`) drive a headless Chromium against
AUBsis, the official AUB Banner system, navigating term selection and
pagination to pull the full section list. Banner term codes use the
academic year's *ending* year plus a season suffix (10 = Fall, 20 =
Spring, 30 = Summer), so `202610` is Fall 2025-2026. Data is normalized
and stored in Supabase, so the front-end always reads from a clean
snapshot.

**Empty classroom finder** — given a day and time window, returns every
classroom on campus with no scheduled class in that window. Computed
client-side from the same course data using interval logic in
`utils/classroomAvailability.ts`.

**Anonymous review system** — students rate and review courses and
professors without their identity attached to the public review. Each
submission is moderated by a Hugging Face inference call before going
live, with rejection reasons surfaced to the user. The author's identity
is verified server-side from their Clerk session token (never trusted from
the request body), so reviews can't be forged while staying anonymous to
other students.

**GPA calculator** — semester-aware GPA computation with letter-grade
inputs, supporting AUB's 4.0 scale and credit-weighted averaging across
multiple semesters.

**Role-based admin portal** — moderators see a queue of flagged reviews,
uploaded syllabi, and pending data corrections, gated by a custom
`AdminRoute` component that checks roles in both Clerk metadata and the
Supabase `users` table.

**Mobile-responsive** — the timetable, course search, and chat all reflow
cleanly down to ~360px width. Tested across phone and tablet breakpoints.

**Remembers your preferences** — the last semester you had selected and
your light/dark theme choice persist across sessions (per browser), so the
app reopens exactly where you left it.

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

### Security model

- **Reads** use Supabase's anon key (shipped in the front-end bundle) and
  are restricted to read-only by Row Level Security.
- **Writes** never go through the anon key. Catalog ingestion (the
  scrapers) and review submissions (the server) use the Supabase
  **service-role key**, which stays server-side only.
- Review endpoints verify the caller's Clerk session token and derive the
  user id from it, rather than trusting an id sent in the request body.
- The RLS policies that enforce this live in [`db/policies.sql`](./db/policies.sql)
  and must be applied to the Supabase project (adjust table/column names to
  your schema before running).

---

## Local development

### Prerequisites

- Node.js ≥ 22 (the test runner uses `--experimental-strip-types`)
- A Supabase project (free tier is fine)
- A Clerk application (publishable key for the front-end, secret key for the server)
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
SUPABASE_SERVICE_ROLE_KEY=...   # server-side only — never expose to the front-end
CLERK_SECRET_KEY=...            # verifies session tokens on review writes
GROQ_API_KEY=...
HF_TOKEN=...
PORT=3001
```

**`./CoursePlannerr/.env`** (front-end):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...      # read-only under RLS
VITE_CLERK_PUBLISHABLE_KEY=...
VITE_API_URL=http://localhost:3001
```

Then apply the RLS policies once: run [`db/policies.sql`](./db/policies.sql)
in the Supabase SQL editor.

### Run

```bash
# Terminal 1: backend (from repo root)
npm start                  # = node server.cjs

# Terminal 2: frontend
cd CoursePlannerr
npm run dev
```

Open http://localhost:5173.

### Refresh course catalog

From the repo root:

```bash
npm run fetch                              # full AUBsis scrape
# or a specific semester (season + academic-year start year):
npm run fetch:term -- summer 2026          # -> term code 202730
# or pass the 6-digit Banner code directly:
npm run fetch:term -- 202610               # Fall 2025-2026
```

These launch a Chromium window, scrape AUBsis, and upsert into Supabase.
Expect 5–15 minutes depending on department count.

---

## Tests

The schedule logic (free-slot finding, classroom availability, and
registered-course resolution against the live catalog) has unit tests
under `CoursePlannerr/tests/`:

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
├── courseFetcher_semester_based.cjs    semester-parametrized scraper
├── db/
│   └── policies.sql                    Supabase Row Level Security policies
├── package.json                        backend deps (Express, Playwright, Groq, HF, Clerk)
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
    │   │   ├── ScheduleGrid.tsx        custom timetable + PDF export
    │   │   ├── RightSearchPanel.tsx    course search + filters
    │   │   ├── LeftInfoPanel.tsx       selected-course detail
    │   │   ├── TopNav.tsx              top nav, user menu, theme toggle
    │   │   ├── AdminRoute.tsx          role-gated wrapper
    │   │   ├── ProtectedRoute.tsx      auth-gated wrapper
    │   │   └── GradeCalculator.jsx     letter-grade input widget
    │   ├── hooks/                      Clerk/Supabase/app-user hooks
    │   ├── utils/
    │   │   ├── courseApi.ts            shape normalizer
    │   │   ├── schedule.ts             free-slot / conflict solver
    │   │   ├── registeredCourses.ts    re-resolves saved courses vs live catalog
    │   │   └── classroomAvailability.ts
    │   ├── gpaCalculator.ts            GPA logic (grade map + weighting)
    │   └── types.ts                    shared TypeScript types
    └── tests/                          schedule + resolver unit tests
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

---

© 2026 Jamil M. and contributors. Licensed under PolyForm Noncommercial 1.0.0.