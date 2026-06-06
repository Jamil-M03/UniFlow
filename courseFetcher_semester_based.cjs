const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const BASE_URL = 'https://sturegss.aub.edu.lb/StudentRegistrationSsb';
const PAGE_SIZE = 500;

// ── Term selection ──────────────────────────────────────────────────────────
// Pick a term in whichever way is most convenient:
//
//   1) Season + academic-year start (recommended):
//        node courseFetcher_semester_based.cjs summer 2026
//        node courseFetcher_semester_based.cjs 30 2026      (30 == summer)
//      The <startYear> is the FALL (start) year of the academic year, i.e.
//      2026 == academic year "2026-2027". NOTE: this is the start year, not the
//      calendar year the classes run in — so `spring 2026` and `summer 2026`
//      resolve to the 2026-2027 academic year (classes in calendar 2027), while
//      `fall 2026` runs in calendar fall 2026. The 6-digit Banner code and the
//      human label are built automatically.
//
//   2) Full 6-digit Banner code (still supported for backwards compatibility):
//        node courseFetcher_semester_based.cjs 202730
//        node courseFetcher_semester_based.cjs 202730 "Summer 2026-2027"
//      If you omit the label it is derived from the code.
//
//   3) Environment variables / nothing (falls back to the defaults below):
//        TERM_CODE=202730 TERM_LABEL="Summer 2026-2027" node courseFetcher_semester_based.cjs
//
// Banner term code = <4-digit year><2-digit season>.
//   The 4-digit year is the year the academic year ENDS (its spring/summer
//   calendar year), NOT the fall calendar year.
//   Semester numbers (the last two digits):
//        Fall = 10        Spring = 20        Summer = 30
//
//   Worked decode table (verified against AUB Banner's term dropdown):
//        202610 -> Fall   2025-2026   (classes Sep 2025)
//        202620 -> Spring 2025-2026   (classes spring 2026)
//        202630 -> Summer 2025-2026   (classes summer 2026)
//        202710 -> Fall   2026-2027   (classes Sep 2026)
//        202530 -> Summer 2024-2025   (classes summer 2025)
//   So a Fall term's code year is one AHEAD of its fall calendar year
//   (Fall 2025 lives under 2026 because that academic year ends in 2026).
//
// Flags:
//   --not-current   Save the term WITHOUT marking it as the app's current/default
//                   semester. (By default a fetched term becomes the current one.)
//   --help, -h      Print this usage and exit.
const DEFAULT_TERM_CODE = '202710';
const DEFAULT_TERM_LABEL = 'Fall 2026-2027';

const SEASON_TO_SUFFIX = { fall: '10', spring: '20', summer: '30' };
const SUFFIX_TO_SEASON = { '10': 'Fall', '20': 'Spring', '30': 'Summer' };

function usageText() {
  return [
    'Usage:',
    '  node courseFetcher_semester_based.cjs <season|TT> <startYear> [--not-current]',
    '  node courseFetcher_semester_based.cjs <6-digit-code> ["Label"] [--not-current]',
    '',
    '  season : fall | spring | summer      TT : 10 (Fall) | 20 (Spring) | 30 (Summer)',
    '  startYear : fall year of the academic year, e.g. 2026 for "2026-2027"',
    '',
    'Examples:',
    '  node courseFetcher_semester_based.cjs summer 2026     -> 202730  "Summer 2026-2027"',
    '  node courseFetcher_semester_based.cjs 30 2026         -> 202730  "Summer 2026-2027"',
    '  node courseFetcher_semester_based.cjs 202710          -> 202710  "Fall 2026-2027"',
  ].join('\n');
}

function exitWithUsage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(usageText());
  process.exit(message ? 1 : 0);
}

// "202730" -> "Summer 2026-2027" (null if the code is not parseable)
function deriveLabelFromCode(code) {
  if (!/^\d{6}$/.test(code)) return null;
  const bannerYear = Number(code.slice(0, 4));
  const suffix = code.slice(4);
  const season = SUFFIX_TO_SEASON[suffix];
  if (!season || Number.isNaN(bannerYear)) return null;
  return `${season} ${bannerYear - 1}-${bannerYear}`;
}

function resolveTerm(positionals) {
  // No positional args: fall back to env vars, then to the defaults above.
  if (positionals.length === 0) {
    const code = process.env.TERM_CODE || DEFAULT_TERM_CODE;
    const label =
      process.env.TERM_LABEL || deriveLabelFromCode(code) || DEFAULT_TERM_LABEL;
    return { code, label };
  }

  const first = positionals[0];

  // Form 2: full 6-digit Banner code (+ optional explicit label).
  if (/^\d{6}$/.test(first)) {
    const code = first;
    const label = positionals[1] || deriveLabelFromCode(code);
    if (!label) {
      exitWithUsage(
        `could not derive a label from code "${code}" — pass one as the 2nd argument.`,
      );
    }
    return { code, label };
  }

  // Form 1: <season|TT> <startYear>.
  const key = String(first).toLowerCase();
  const suffix = SEASON_TO_SUFFIX[key]
    || (['10', '20', '30'].includes(first) ? first : null);

  if (!suffix) {
    exitWithUsage(
      `unknown semester "${first}" — use fall/spring/summer or 10/20/30, or a 6-digit code.`,
    );
  }

  const startYearArg = positionals[1];
  if (!startYearArg || !/^\d{4}$/.test(startYearArg)) {
    exitWithUsage(
      'missing or invalid start year — pass the fall year, e.g. 2026 for the 2026-2027 academic year.',
    );
  }

  const startYear = Number(startYearArg);
  const bannerYear = startYear + 1;
  const season = SUFFIX_TO_SEASON[suffix];
  return {
    code: `${bannerYear}${suffix}`,
    label: `${season} ${startYear}-${bannerYear}`,
  };
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  exitWithUsage();
}

const IS_CURRENT = !rawArgs.includes('--not-current');
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('--'));

const { code: TERM_CODE, label: TERM_LABEL } = resolveTerm(positionalArgs);

// Ingestion writes to courses/terms/professors, so it uses the service-role
// key (server-side only — keep it out of the frontend and out of git).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function saveTermToDB() {
  const { error } = await supabase
    .from('terms')
    .upsert(
      {
        code: TERM_CODE,
        description: TERM_LABEL,
        is_current: IS_CURRENT,
      },
      { onConflict: 'code' }
    );

  if (error) {
    console.error(`  Warning: term save error (${TERM_LABEL}): ${error.message}`);
  } else {
    console.log(
      `Saved term: ${TERM_LABEL} (${TERM_CODE})${IS_CURRENT ? ' [current]' : ' [not current]'}`,
    );
  }
}

async function navigateToTerm(context) {
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.goto(
    `${BASE_URL}/ssb/term/termSelection?mode=search`,
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  );
  await page.waitForTimeout(2000);

  await page.evaluate((termValue) => {
    const select = document.querySelector('#txt_term');
    if (select) {
      select.value = termValue;
      select.dispatchEvent(new Event('change', { bubbles: true }));

      const $select = window.$ ? window.$('#txt_term') : null;
      if ($select && $select.select2) {
        $select.select2('val', termValue);
      }
    }
  }, TERM_CODE);

  await page.waitForTimeout(1000);

  const [popup] = await Promise.all([
    new Promise((resolve) => {
      context.once('page', resolve);
      setTimeout(() => resolve(null), 2000);
    }),
    page.click('#term-go'),
  ]);

  let searchPage = page;
  if (popup) {
    searchPage = popup;
    await searchPage.waitForLoadState('domcontentloaded');
  } else {
    try {
      await page.waitForNavigation({ timeout: 3000 });
    } catch (_) {
      // Some Banner pages update in place instead of performing a full navigation.
    }
  }

  await searchPage.waitForTimeout(2000);
  return searchPage;
}

async function getAllSubjects(page) {
  const response = await page.evaluate(async (term) => {
    const res = await fetch(
      `/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${term}&offset=1&max=500`,
      { headers: { Accept: 'application/json' } }
    );
    return res.json();
  }, TERM_CODE);

  if (!response || response.length === 0) {
    return [];
  }

  return response;
}

async function returnToSearchForm(searchPage) {
  const courseNumberVisible = await searchPage.isVisible('#txt_courseNumber');
  if (courseNumberVisible) {
    return;
  }

  await searchPage.click(
    '#search-again-button, button:has-text("Search Again"), a:has-text("Search Again")',
    { force: true, timeout: 10000 }
  );
  await searchPage.waitForTimeout(1000);
}

async function setSubject(searchPage, subjectCode) {
  await searchPage.evaluate((code) => {
    const input = document.querySelector('#txt_subject, input[name="txt_subject"]');
    if (input) {
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, subjectCode);
}

async function clearCourseNumber(searchPage) {
  await searchPage.fill('#txt_courseNumber', '');
  await searchPage.waitForTimeout(300);
  await searchPage.keyboard.press('Escape');
  await searchPage.waitForTimeout(200);
  await searchPage.click('body');
  await searchPage.waitForTimeout(200);
}

async function fetchRemainingSections(searchPage, subjectCode, totalCount, alreadyFetched) {
  return searchPage.evaluate(async ({ term, subject, pageSize, totalCount, alreadyFetched }) => {
    const results = [];
    let offset = alreadyFetched + 1;

    while (offset <= totalCount) {
      const res = await fetch(
        `/StudentRegistrationSsb/ssb/searchResults/searchResults?term=${term}&subject=${subject}&offset=${offset}&pageMaxSize=${pageSize}`,
        { headers: { Accept: 'application/json' } }
      );
      const data = await res.json();

      if (!data.data || data.data.length === 0) {
        break;
      }

      results.push(...data.data);
      offset += data.data.length;
    }

    return results;
  }, {
    term: TERM_CODE,
    subject: subjectCode,
    pageSize: PAGE_SIZE,
    totalCount,
    alreadyFetched,
  });
}

function buildCourseRows(sections) {
  const courses = [];

  for (const section of sections) {
    const instructors = (section.faculty || [])
      .map((faculty) => faculty.displayName)
      .join(', ') || 'TBA';

    const credits = section.creditHours
      ?? section.creditHourLow
      ?? section.creditHourHigh
      ?? null;

    if (credits == null) {
      console.warn(
        `  Warning: no credit info for CRN ${section.courseReferenceNumber} (${section.subject} ${section.courseNumber})`
      );
    }

    let days = 'TBA';
    let time = 'TBA';
    let location = 'TBA';

    const firstMeetingWithTime = (section.meetingsFaculty || [])
      .find((meeting) => meeting.meetingTime);

    if (firstMeetingWithTime?.meetingTime) {
      const meetingTime = firstMeetingWithTime.meetingTime;
      const activeDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
        .filter((day) => meetingTime[day]);

      days = activeDays.join(', ') || 'TBA';
      time = meetingTime.beginTime && meetingTime.endTime
        ? `${meetingTime.beginTime} - ${meetingTime.endTime}`
        : 'TBA';
      location = `${meetingTime.building || ''} ${meetingTime.room || ''}`.trim() || 'TBA';
    }

    courses.push({
      crn: section.courseReferenceNumber,
      code: `${section.subject} ${section.courseNumber}`,
      courseNumber: section.courseNumber != null ? String(section.courseNumber).padStart(3, '0') : null,
      section: section.sequenceNumber,
      title: section.courseTitle,
      credits,
      instructors,
      days,
      time,
      location,
      seatsAvailable: section.seatsAvailable,
      maxEnrollment: section.maximumEnrollment,
      status: section.seatsAvailable > 0 ? 'Open' : 'Full',
      scheduleType: section.scheduleTypeDescription || 'N/A',
      subjectCode: section.subject,
      termCode: TERM_CODE,
      prerequisites: section.prerequisiteDescription ?? null,
      attributes: Array.isArray(section.sectionAttributes)
        ? section.sectionAttributes
          .map((attribute) => attribute.description ?? attribute.code ?? String(attribute))
          .filter(Boolean)
        : [],
      linkedCourses: section.isSectionLinked && section.linkedSection
        ? [String(section.linkedSection)]
        : [],
    });
  }

  const seen = new Map();
  for (const course of courses) {
    if (!seen.has(course.crn)) {
      seen.set(course.crn, course);
    }
  }

  return [...seen.values()];
}

async function fetchAllCoursesForSubject(searchPage, subjectCode) {
  try {
    await returnToSearchForm(searchPage);
    await searchPage.waitForSelector('#txt_courseNumber', { state: 'visible', timeout: 10000 });
    await setSubject(searchPage, subjectCode);
    await clearCourseNumber(searchPage);

    const [firstResponse] = await Promise.all([
      searchPage.waitForResponse(
        (resp) => resp.url().includes('searchResults') && resp.status() === 200,
        { timeout: 20000 }
      ),
      searchPage.click('#search-go', { force: true }),
    ]);

    const firstData = await firstResponse.json();
    const totalCount = firstData.totalCount || 0;
    if (totalCount === 0) {
      return [];
    }

    let allSections = [...(firstData.data || [])];

    if (totalCount > allSections.length) {
      const remainingSections = await fetchRemainingSections(
        searchPage,
        subjectCode,
        totalCount,
        allSections.length
      );
      allSections = [...allSections, ...remainingSections];
    }

    return buildCourseRows(allSections);
  } catch (err) {
    console.error(`  Warning: error fetching ${subjectCode}: ${err.message}`);
    return [];
  }
}

const professorCache = {};

async function getOrCreateProfessor(fullName) {
  if (fullName === 'TBA') {
    return null;
  }

  if (professorCache[fullName] !== undefined) {
    return professorCache[fullName];
  }

  const { data: existing } = await supabase
    .from('professors')
    .select('id')
    .eq('full_name', fullName)
    .single();

  if (existing) {
    professorCache[fullName] = existing.id;
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from('professors')
    .insert({ full_name: fullName })
    .select('id')
    .single();

  if (error) {
    console.error(`  Warning: professor error (${fullName}): ${error.message}`);
    professorCache[fullName] = null;
    return null;
  }

  professorCache[fullName] = inserted.id;
  return inserted.id;
}

async function saveCoursesToDB(courses) {
  let saved = 0;

  for (const course of courses) {
    try {
      const professorId = await getOrCreateProfessor(course.instructors);

      const { error } = await supabase
        .from('courses')
        .upsert(
          {
            crn: course.crn,
            title: course.title,
            department: course.subjectCode,
            course_number: course.courseNumber,
            section: course.section,
            credits: course.credits,
            schedule: {
              days: course.days,
              time: course.time,
              location: course.location,
              section: course.section,
              type: course.scheduleType,
            },
            professor_id: professorId,
            semester: course.termCode,
            capacity: course.maxEnrollment,
            enrolled_count: course.maxEnrollment - course.seatsAvailable,
            prerequisites: course.prerequisites,
            attributes: course.attributes,
            linked_courses: course.linkedCourses.map(String),
          },
          { onConflict: 'crn,semester' }
        );

      if (error) {
        console.error(`  Warning: course error (CRN ${course.crn}): ${error.message}`);
      } else {
        saved++;
      }
    } catch (err) {
      console.error(`  Warning: unexpected error for CRN ${course.crn}: ${err.message}`);
    }
  }

  return saved;
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`   AUB Fetcher - ${TERM_LABEL} (${TERM_CODE})`);
  console.log(`${'='.repeat(70)}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.navigator.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  let totalFetched = 0;
  let totalSaved = 0;

  try {
    await saveTermToDB();

    const searchPage = await navigateToTerm(context);
    const subjects = await getAllSubjects(searchPage);
    console.log(`${subjects.length} subjects found for ${TERM_LABEL}\n`);

    for (let index = 0; index < subjects.length; index++) {
      const { code, description } = subjects[index];
      process.stdout.write(`[${index + 1}/${subjects.length}] ${code} (${description})... `);

      const courses = await fetchAllCoursesForSubject(searchPage, code);

      if (courses.length === 0) {
        console.log('no courses.');
        continue;
      }

      const saved = await saveCoursesToDB(courses);
      totalFetched += courses.length;
      totalSaved += saved;
      console.log(`${courses.length} fetched, ${saved} saved.`);

      await searchPage.waitForTimeout(300);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Done. ${totalFetched} fetched, ${totalSaved} saved to Supabase.`);
    console.log(`${'='.repeat(70)}\n`);
  } catch (error) {
    console.error(`\nFatal error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();