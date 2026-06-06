// const { chromium } = require('playwright');
// const { createClient } = require('@supabase/supabase-js');
// require('dotenv').config();

// const BASE_URL = 'https://sturegss.aub.edu.lb/StudentRegistrationSsb';
// const PAGE_SIZE = 500;

// // ─── Term filtering ───────────────────────────────────────────────────────────
// // Keep any term from Fall 2025-2026 onwards.
// // Exclude clubs, online, executive, and medical school terms.
// const EXCLUDED_KEYWORDS = ['club', 'online', 'executive', 'med', 'medicine', 'medical'];

// // Matches any year >= 2025 with a season prefix
// const TERM_YEAR_REGEX = /\b(fall|spring|summer)\s+(202[5-9]|20[3-9]\d)/i;

// // Spring 2025 and Summer 2025 (standalone, not 2025-2026) predate Fall 2025-2026
// // and should be excluded. But Spring/Summer 2025-2026 should be kept.
// function isExcludedEarlyTerm(description) {
//   const lower = description.toLowerCase();
//   // Only exclude if it's exactly "spring/summer 2025" with no "2026" in the description
//   return (
//     (lower.includes('spring') || lower.includes('summer')) &&
//     lower.includes('2025') &&
//     !lower.includes('2026')
//   );
// }

// function isTargetTerm(description) {
//   const lower = description.toLowerCase();
//   if (EXCLUDED_KEYWORDS.some(kw => lower.includes(kw))) return false;
//   if (isExcludedEarlyTerm(lower)) return false;
//   return TERM_YEAR_REGEX.test(description);
// }

// // ─── Supabase client ───────────────────────────────────────────────────────────
// const supabase = createClient(
//   process.env.SUPABASE_URL,
//   process.env.SUPABASE_ANON_KEY
// );

// // ─── Fetch target terms only ──────────────────────────────────────────────────
// async function getAllTerms(page) {
//   console.log('📅 Fetching terms from AUB...');

//   const terms = await page.evaluate(async () => {
//     const res = await fetch(
//       `/StudentRegistrationSsb/ssb/classSearch/getTerms?offset=1&max=50`,
//       { headers: { 'Accept': 'application/json' } }
//     );
//     return res.json();
//   });

//   if (!terms || terms.length === 0) throw new Error('Could not fetch terms');

//   const filtered = terms.filter(t => isTargetTerm(t.description));

//   if (filtered.length === 0) {
//     console.warn('⚠  No matching terms found. Available terms:');
//     terms.forEach(t => console.warn(`   • ${t.description} (${t.code})`));
//     throw new Error('No target terms found — check term name matching above');
//   }

//   console.log(`✅ Found ${filtered.length} target term(s):`);
//   filtered.forEach(t => console.log(`   • ${t.description} (${t.code})`));
//   console.log();
//   return filtered;
// }

// // ─── Save terms to DB (first term in list = most recent = current) ────────────
// async function saveTermsToDB(terms) {
//   console.log('💾 Saving terms to database...');

//   for (let i = 0; i < terms.length; i++) {
//     const term = terms[i];
//     const { error } = await supabase
//       .from('terms')
//       .upsert(
//         {
//           code: term.code,
//           description: term.description,
//           is_current: i === 0, // first = most recent
//         },
//         { onConflict: 'code' }
//       );

//     if (error) {
//       console.error(`  ⚠ Term save error (${term.description}):`, error.message);
//     } else {
//       console.log(`  ✅ Saved term: ${term.description}${i === 0 ? ' (current)' : ''}`);
//     }
//   }
//   console.log();
// }

// // ─── Navigate to the search page for a given term ────────────────────────────
// async function navigateToTerm(context, termCode) {
//   const page = await context.newPage();

//   await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
//   await page.waitForTimeout(2000);

//   await page.goto(
//     `${BASE_URL}/ssb/term/termSelection?mode=search`,
//     { waitUntil: 'domcontentloaded', timeout: 30000 }
//   );
//   await page.waitForTimeout(2000);

//   await page.evaluate((termValue) => {
//     const select = document.querySelector('#txt_term');
//     if (select) {
//       select.value = termValue;
//       select.dispatchEvent(new Event('change', { bubbles: true }));
//       const $s = window.$ ? window.$('#txt_term') : null;
//       if ($s && $s.select2) $s.select2('val', termValue);
//     }
//   }, termCode);

//   await page.waitForTimeout(1000);

//   const [popup] = await Promise.all([
//     new Promise((resolve) => {
//       context.once('page', resolve);
//       setTimeout(() => resolve(null), 2000);
//     }),
//     page.click('#term-go'),
//   ]);

//   let searchPage = page;
//   if (popup) {
//     searchPage = popup;
//     await searchPage.waitForLoadState('domcontentloaded');
//   } else {
//     try {
//       await page.waitForNavigation({ timeout: 3000 });
//     } catch (_) {}
//   }

//   await searchPage.waitForTimeout(2000);
//   return searchPage;
// }

// // ─── Fetch all subjects for a term ───────────────────────────────────────────
// async function getAllSubjects(page, termCode) {
//   const response = await page.evaluate(async (term) => {
//     const res = await fetch(
//       `/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${term}&offset=1&max=500`,
//       { headers: { 'Accept': 'application/json' } }
//     );
//     return res.json();
//   }, termCode);

//   if (!response || response.length === 0) return [];
//   return response;
// }

// // ─── Fetch all courses for one subject (with pagination) ─────────────────────
// async function fetchAllCoursesForSubject(searchPage, subjectCode, termCode) {
//   try {
//     const courseNumberVisible = await searchPage.isVisible('#txt_courseNumber');
//     if (!courseNumberVisible) {
//       await searchPage.click(
//         '#search-again-button, button:has-text("Search Again"), a:has-text("Search Again")',
//         { force: true, timeout: 10000 }
//       );
//       await searchPage.waitForTimeout(1000);
//     }

//     await searchPage.waitForSelector('#txt_courseNumber', {
//       state: 'visible',
//       timeout: 10000,
//     });

//     await searchPage.evaluate((code) => {
//       const input = document.querySelector('#txt_subject, input[name="txt_subject"]');
//       if (input) {
//         input.value = code;
//         input.dispatchEvent(new Event('input', { bubbles: true }));
//         input.dispatchEvent(new Event('change', { bubbles: true }));
//       }
//     }, subjectCode);

//     await searchPage.fill('#txt_courseNumber', '');
//     await searchPage.waitForTimeout(300);
//     await searchPage.keyboard.press('Escape');
//     await searchPage.waitForTimeout(200);
//     await searchPage.click('body');
//     await searchPage.waitForTimeout(200);

//     const [firstResponse] = await Promise.all([
//       searchPage.waitForResponse(
//         (resp) => resp.url().includes('searchResults') && resp.status() === 200,
//         { timeout: 20000 }
//       ),
//       searchPage.click('#search-go', { force: true }),
//     ]);

//     const firstData = await firstResponse.json();
//     const totalCount = firstData.totalCount || 0;
//     if (totalCount === 0) return [];

//     let allSections = [...(firstData.data || [])];

//     if (totalCount > allSections.length) {
//       const remainingData = await searchPage.evaluate(
//         async ({ term, subject, pageSize, totalCount, alreadyFetched }) => {
//           const results = [];
//           let offset = alreadyFetched + 1;
//           while (offset <= totalCount) {
//             const res = await fetch(
//               `/StudentRegistrationSsb/ssb/searchResults/searchResults?term=${term}&subject=${subject}&offset=${offset}&pageMaxSize=${pageSize}`,
//               { headers: { 'Accept': 'application/json' } }
//             );
//             const data = await res.json();
//             if (!data.data || data.data.length === 0) break;
//             results.push(...data.data);
//             offset += data.data.length;
//           }
//           return results;
//         },
//         {
//           term: termCode,
//           subject: subjectCode,
//           pageSize: PAGE_SIZE,
//           totalCount,
//           alreadyFetched: allSections.length,
//         }
//       );

//       allSections = [...allSections, ...remainingData];
//     }

//     // ── Parse sections ────────────────────────────────────────────────────────
//     const rawCourses = [];
//     for (const c of allSections) {
//       const instructors =
//         (c.faculty || []).map((f) => f.displayName).join(', ') || 'TBA';

//       // ── Credit fallback chain ──────────────────────────────────────────────
//       // creditHours can be null for variable-credit courses; fall back to
//       // creditHourLow then creditHourHigh before giving up.
//       const credits = c.creditHours ?? c.creditHourLow ?? c.creditHourHigh ?? null;

//       if (credits == null) {
//         console.warn(
//           `  ⚠ No credit info for CRN ${c.courseReferenceNumber} (${c.subject} ${c.courseNumber})`
//         );
//       }

//       for (const m of c.meetingsFaculty || []) {
//         const mt = m.meetingTime;
//         if (!mt) continue;
//         const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].filter(
//           (d) => mt[d]
//         );
//         rawCourses.push({
//           crn: c.courseReferenceNumber,
//           code: `${c.subject} ${c.courseNumber}`,
//           section: c.sequenceNumber,
//           title: c.courseTitle,
//           credits,
//           instructors,
//           days: days.join(', ') || 'TBA',
//           time:
//             mt.beginTime && mt.endTime
//               ? `${mt.beginTime} - ${mt.endTime}`
//               : 'TBA',
//           location: `${mt.building || ''} ${mt.room || ''}`.trim() || 'TBA',
//           seatsAvailable: c.seatsAvailable,
//           maxEnrollment: c.maximumEnrollment,
//           status: c.seatsAvailable > 0 ? 'Open' : 'Full',
//           scheduleType: c.scheduleTypeDescription || 'N/A',
//           subjectCode: c.subject,
//           termCode,
//         });
//       }
//     }

//     // ── Deduplicate by CRN, keeping the entry with the most complete data ────
//     // Some courses have multiple meeting entries (lab + lecture). We keep the
//     // one that has credits, falling back to whichever came first.
//     const seen = new Map();
//     for (const course of rawCourses) {
//       const existing = seen.get(course.crn);
//       if (!existing || (course.credits != null && existing.credits == null)) {
//         seen.set(course.crn, course);
//       }
//     }

//     return [...seen.values()];
//   } catch (err) {
//     console.error(`  ⚠ Error fetching ${subjectCode}:`, err.message);
//     return [];
//   }
// }

// // ─── Professor cache to avoid redundant DB calls ─────────────────────────────
// const professorCache = {};

// async function getOrCreateProfessor(fullName) {
//   if (fullName === 'TBA') return null;
//   if (professorCache[fullName] !== undefined) return professorCache[fullName];

//   const { data: existing } = await supabase
//     .from('professors')
//     .select('id')
//     .eq('full_name', fullName)
//     .single();

//   if (existing) {
//     professorCache[fullName] = existing.id;
//     return existing.id;
//   }

//   const { data: inserted, error } = await supabase
//     .from('professors')
//     .insert({ full_name: fullName })
//     .select('id')
//     .single();

//   if (error) {
//     console.error(`  ⚠ Professor error (${fullName}):`, error.message);
//     professorCache[fullName] = null;
//     return null;
//   }

//   professorCache[fullName] = inserted.id;
//   return inserted.id;
// }

// // ─── Save courses to Supabase ─────────────────────────────────────────────────
// async function saveCoursesToDB(courses) {
//   let saved = 0;

//   for (const course of courses) {
//     try {
//       const professorId = await getOrCreateProfessor(course.instructors);

//       const { error: courseError } = await supabase
//         .from('courses')
//         .upsert(
//           {
//             crn: course.crn,
//             title: course.title,
//             department: course.subjectCode,
//             credits: course.credits,
//             schedule: {
//               days: course.days,
//               time: course.time,
//               location: course.location,
//               section: course.section,
//               type: course.scheduleType,
//             },
//             professor_id: professorId,
//             semester: course.termCode,
//             capacity: course.maxEnrollment,
//             enrolled_count: course.maxEnrollment - course.seatsAvailable,
//           },
//           { onConflict: 'crn,semester' }
//         );

//       if (courseError) {
//         console.error(`  ⚠ Course error (CRN ${course.crn}):`, courseError.message);
//       } else {
//         saved++;
//       }
//     } catch (err) {
//       console.error(`  ⚠ Unexpected error for CRN ${course.crn}:`, err.message);
//     }
//   }

//   return saved;
// }

// // ─── Main ─────────────────────────────────────────────────────────────────────
// (async () => {
//   console.log(`\n${'='.repeat(90)}`);
//   console.log(`   AUB Course Fetcher — Fall 2025-2026 and beyond`);
//   console.log(`${'='.repeat(90)}\n`);

//   const browser = await chromium.launch({
//     headless: true,
//     args: [
//       '--disable-blink-features=AutomationControlled',
//       '--disable-dev-shm-usage',
//       '--no-sandbox',
//     ],
//   });

//   const context = await browser.newContext({
//     userAgent:
//       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
//     extraHTTPHeaders: {
//       'Accept-Language': 'en-US,en;q=0.9',
//       Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
//     },
//   });

//   await context.addInitScript(() => {
//     Object.defineProperty(navigator, 'webdriver', { get: () => false });
//     window.navigator.chrome = { runtime: {} };
//     Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
//   });

//   const tempPage = await context.newPage();
//   await tempPage.goto(`${BASE_URL}/`, {
//     waitUntil: 'domcontentloaded',
//     timeout: 30000,
//   });
//   await tempPage.waitForTimeout(2000);

//   let grandTotal = 0;
//   let grandSaved = 0;

//   try {
//     const terms = await getAllTerms(tempPage);
//     await tempPage.close();

//     await saveTermsToDB(terms);

//     for (const term of terms) {
//       console.log(`\n${'█'.repeat(90)}`);
//       console.log(`  TERM: ${term.description} (${term.code})`);
//       console.log(`${'█'.repeat(90)}\n`);

//       const searchPage = await navigateToTerm(context, term.code);
//       const subjects = await getAllSubjects(searchPage, term.code);
//       console.log(`📋 ${subjects.length} subjects found\n`);

//       let termTotal = 0;
//       let termSaved = 0;

//       for (let i = 0; i < subjects.length; i++) {
//         const { code, description } = subjects[i];
//         process.stdout.write(`  [${i + 1}/${subjects.length}] ${code} (${description})... `);

//         const courses = await fetchAllCoursesForSubject(searchPage, code, term.code);

//         if (courses.length === 0) {
//           console.log('no courses.');
//           continue;
//         }

//         const saved = await saveCoursesToDB(courses);
//         termTotal += courses.length;
//         termSaved += saved;
//         console.log(`${courses.length} fetched, ${saved} saved to DB.`);

//         await searchPage.waitForTimeout(400);
//       }

//       console.log(`\n  ✅ Term total: ${termTotal} fetched, ${termSaved} saved`);
//       grandTotal += termTotal;
//       grandSaved += termSaved;
//       await searchPage.close();
//     }

//     console.log(`\n${'='.repeat(90)}`);
//     console.log(`✅ ALL DONE! ${grandTotal} courses fetched, ${grandSaved} saved to Supabase`);
//     console.log(`${'='.repeat(90)}\n`);
//   } catch (error) {
//     console.error('\n❌ Fatal error:', error.message);
//   } finally {
//     await browser.close();
//   }
// })();

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const BASE_URL = 'https://sturegss.aub.edu.lb/StudentRegistrationSsb';
const PAGE_SIZE = 500;

// ─── Term filtering ───────────────────────────────────────────────────────────
// Usage:
//   node fetchCourses.js           → auto-detect best academic year
//   node fetchCourses.js 2025      → force 2025-2026
//   node fetchCourses.js 2026      → force 2026-2027

const EXCLUDED_KEYWORDS = ['club', 'online', 'executive', 'med', 'medicine', 'medical', 'winter', 'cec', 'progreen'];
const TARGET_SEASONS    = ['fall', 'spring', 'summer'];

function normalizeTerm(s) {
  return s
    .toLowerCase()
    .replace(/\(view only\)/g, '') // strip the "(View Only)" suffix before any other check
    .replace(/\s+/g, ' ')
    .trim();
}

// Maps a term description (already normalized, "(view only)" stripped) to the
// *start* year of its academic year, or null if unrecognised.
// "fall 2025-2026"   → 2025
// "spring 2025-2026" → 2025
// "summer 2025-2026" → 2025
// "summer 2026"      → 2025  (standalone summer belongs to previous AY)
// "fall 2025"        → 2025
// "spring 2026"      → 2025  (standalone spring belongs to previous AY)
function extractAcademicYear(normalized) {
  let m;

  // season YYYY-YYYY  (explicit range — most common)
  m = normalized.match(/^(?:fall|spring|summer)\s+(\d{4})-\d{4}$/);
  if (m) return Number(m[1]);

  // summer YYYY  (no range — belongs to AY that started the year before)
  m = normalized.match(/^summer\s+(\d{4})$/);
  if (m) return Number(m[1]) - 1;

  // fall YYYY  (standalone)
  m = normalized.match(/^fall\s+(\d{4})$/);
  if (m) return Number(m[1]);

  // spring YYYY  (standalone — belongs to AY that started the year before)
  m = normalized.match(/^spring\s+(\d{4})$/);
  if (m) return Number(m[1]) - 1;

  return null;
}

function isTargetSeason(normalized) {
  return TARGET_SEASONS.some(s => normalized.startsWith(s));
}

function isExcluded(normalized) {
  return EXCLUDED_KEYWORDS.some(kw => normalized.includes(kw));
}

// Groups candidate terms by academic year and returns the group for the
// requested year — or, if none specified, the group with the most terms
// (ties broken by highest year).
function filterTerms(allTerms, targetYear) {
  const candidates = allTerms.filter(t => {
    const n = normalizeTerm(t.description);
    return isTargetSeason(n) && !isExcluded(n);
  });

  if (candidates.length === 0) return [];

  // Build map: ayStartYear → [terms]
  const byYear = new Map();
  for (const t of candidates) {
    const yr = extractAcademicYear(normalizeTerm(t.description));
    if (yr == null) continue;
    if (!byYear.has(yr)) byYear.set(yr, []);
    byYear.get(yr).push(t);
  }

  if (byYear.size === 0) return [];

  if (targetYear) return byYear.get(targetYear) ?? [];

  // Pick the year whose group has the most terms; break ties by highest year.
  let bestYear  = null;
  let bestCount = -1;
  for (const [yr, terms] of byYear) {
    if (terms.length > bestCount || (terms.length === bestCount && yr > bestYear)) {
      bestYear  = yr;
      bestCount = terms.length;
    }
  }

  return byYear.get(bestYear);
}

// ─── Parse optional CLI year argument ────────────────────────────────────────
const cliYear = process.argv[2] ? Number(process.argv[2]) : null;
if (cliYear && (isNaN(cliYear) || cliYear < 2000 || cliYear > 2100)) {
  console.error(`❌  Invalid year argument: "${process.argv[2]}". Pass a 4-digit year like 2025.`);
  process.exit(1);
}

// ─── Supabase client ───────────────────────────────────────────────────────────
// Ingestion writes to courses/terms/professors -> service-role key (server-side
// only; never ship to the frontend or commit it).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ─── Fetch target terms only ──────────────────────────────────────────────────
async function getAllTerms(page) {
  console.log('📅 Fetching terms from AUB...');

  const terms = await page.evaluate(async () => {
    const res = await fetch(
      `/StudentRegistrationSsb/ssb/classSearch/getTerms?offset=1&max=50`,
      { headers: { Accept: 'application/json' } }
    );
    return res.json();
  });

  if (!terms || terms.length === 0) throw new Error('Could not fetch terms');

  console.log('   All terms returned by AUB:');
  terms.forEach(t => console.log(`   • "${t.description}" (${t.code})`));
  console.log();

  const filtered = filterTerms(terms, cliYear || null);

  if (filtered.length === 0) {
    throw new Error('No target terms found — check the term listing above');
  }

  const detectedYear = extractAcademicYear(normalizeTerm(filtered[0].description));
  console.log(`✅ Academic year: ${detectedYear}-${detectedYear + 1} — ${filtered.length} term(s) selected:`);
  filtered.forEach(t => console.log(`   • ${t.description} (${t.code})`));
  console.log();

  return filtered;
}

// ─── Save terms to DB ──────────────────────────────────────────────────────────
async function saveTermsToDB(terms) {
  console.log('💾 Saving terms to database...');

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];

    const { error } = await supabase
      .from('terms')
      .upsert(
        {
          code:        term.code,
          description: term.description,
          is_current:  i === 0,
        },
        { onConflict: 'code' }
      );

    if (error) {
      console.error(`  ⚠ Term save error (${term.description}):`, error.message);
    } else {
      console.log(`  ✅ Saved term: ${term.description}${i === 0 ? ' (current)' : ''}`);
    }
  }

  console.log();
}

// ─── Navigate to the search page for a given term ─────────────────────────────
async function navigateToTerm(context, termCode) {
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
      const $s = window.$ ? window.$('#txt_term') : null;
      if ($s && $s.select2) $s.select2('val', termValue);
    }
  }, termCode);

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
    try { await page.waitForNavigation({ timeout: 3000 }); } catch (_) {}
  }

  await searchPage.waitForTimeout(2000);
  return searchPage;
}

// ─── Fetch all subjects for a term ────────────────────────────────────────────
async function getAllSubjects(page, termCode) {
  const response = await page.evaluate(async (term) => {
    const res = await fetch(
      `/StudentRegistrationSsb/ssb/classSearch/get_subject?term=${term}&offset=1&max=500`,
      { headers: { Accept: 'application/json' } }
    );
    return res.json();
  }, termCode);

  if (!response || response.length === 0) return [];
  return response;
}

// ─── Fetch all courses for one subject (with pagination) ──────────────────────
async function fetchAllCoursesForSubject(searchPage, subjectCode, termCode) {
  try {
    const courseNumberVisible = await searchPage.isVisible('#txt_courseNumber');
    if (!courseNumberVisible) {
      await searchPage.click(
        '#search-again-button, button:has-text("Search Again"), a:has-text("Search Again")',
        { force: true, timeout: 10000 }
      );
      await searchPage.waitForTimeout(1000);
    }

    await searchPage.waitForSelector('#txt_courseNumber', { state: 'visible', timeout: 10000 });

    await searchPage.evaluate((code) => {
      const input = document.querySelector('#txt_subject, input[name="txt_subject"]');
      if (input) {
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, subjectCode);

    await searchPage.fill('#txt_courseNumber', '');
    await searchPage.waitForTimeout(300);
    await searchPage.keyboard.press('Escape');
    await searchPage.waitForTimeout(200);
    await searchPage.click('body');
    await searchPage.waitForTimeout(200);

    const [firstResponse] = await Promise.all([
      searchPage.waitForResponse(
        (resp) => resp.url().includes('searchResults') && resp.status() === 200,
        { timeout: 20000 }
      ),
      searchPage.click('#search-go', { force: true }),
    ]);

    const firstData = await firstResponse.json();
    const totalCount = firstData.totalCount || 0;
    if (totalCount === 0) return [];

    let allSections = [...(firstData.data || [])];

    if (totalCount > allSections.length) {
      const remainingData = await searchPage.evaluate(
        async ({ term, subject, pageSize, totalCount, alreadyFetched }) => {
          const results = [];
          let offset = alreadyFetched + 1;

          while (offset <= totalCount) {
            const res = await fetch(
              `/StudentRegistrationSsb/ssb/searchResults/searchResults?term=${term}&subject=${subject}&offset=${offset}&pageMaxSize=${pageSize}`,
              { headers: { Accept: 'application/json' } }
            );
            const data = await res.json();
            if (!data.data || data.data.length === 0) break;
            results.push(...data.data);
            offset += data.data.length;
          }

          return results;
        },
        {
          term:           termCode,
          subject:        subjectCode,
          pageSize:       PAGE_SIZE,
          totalCount,
          alreadyFetched: allSections.length,
        }
      );

      allSections = [...allSections, ...remainingData];
    }

    const courses = [];

    for (const c of allSections) {
      const instructors = (c.faculty || []).map((f) => f.displayName).join(', ') || 'TBA';
      const credits = c.creditHours ?? c.creditHourLow ?? c.creditHourHigh ?? null;

      if (credits == null) {
        console.warn(`  ⚠ No credit info for CRN ${c.courseReferenceNumber} (${c.subject} ${c.courseNumber})`);
      }

      let days     = 'TBA';
      let time     = 'TBA';
      let location = 'TBA';

      const firstMeetingWithTime = (c.meetingsFaculty || []).find((m) => m.meetingTime);
      if (firstMeetingWithTime?.meetingTime) {
        const mt = firstMeetingWithTime.meetingTime;
        const activeDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].filter((d) => mt[d]);
        days     = activeDays.join(', ') || 'TBA';
        time     = mt.beginTime && mt.endTime ? `${mt.beginTime} - ${mt.endTime}` : 'TBA';
        location = `${mt.building || ''} ${mt.room || ''}`.trim() || 'TBA';
      }

      courses.push({
        crn:            c.courseReferenceNumber,
        code:           `${c.subject} ${c.courseNumber}`,
        courseNumber:   c.courseNumber != null ? String(c.courseNumber).padStart(3, '0') : null,
        section:        c.sequenceNumber,
        title:          c.courseTitle,
        credits,
        instructors,
        days,
        time,
        location,
        seatsAvailable: c.seatsAvailable,
        maxEnrollment:  c.maximumEnrollment,
        status:         c.seatsAvailable > 0 ? 'Open' : 'Full',
        scheduleType:   c.scheduleTypeDescription || 'N/A',
        subjectCode:    c.subject,
        termCode,
        prerequisites:  c.prerequisiteDescription ?? null,
        attributes: Array.isArray(c.sectionAttributes)
          ? c.sectionAttributes.map(a => a.description ?? a.code ?? String(a)).filter(Boolean)
          : [],
        linkedCourses: c.isSectionLinked && c.linkedSection
          ? [String(c.linkedSection)]
          : [],
      });
    }

    // Deduplicate by CRN
    const seen = new Map();
    for (const course of courses) {
      if (!seen.has(course.crn)) seen.set(course.crn, course);
    }

    return [...seen.values()];
  } catch (err) {
    console.error(`  ⚠ Error fetching ${subjectCode}:`, err.message);
    return [];
  }
}

// ─── Professor cache ──────────────────────────────────────────────────────────
const professorCache = {};

async function getOrCreateProfessor(fullName) {
  if (fullName === 'TBA') return null;
  if (professorCache[fullName] !== undefined) return professorCache[fullName];

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
    console.error(`  ⚠ Professor error (${fullName}):`, error.message);
    professorCache[fullName] = null;
    return null;
  }

  professorCache[fullName] = inserted.id;
  return inserted.id;
}

// ─── Save courses to Supabase ─────────────────────────────────────────────────
async function saveCoursesToDB(courses) {
  let saved = 0;

  for (const course of courses) {
    try {
      const professorId = await getOrCreateProfessor(course.instructors);

      const { error: courseError } = await supabase
        .from('courses')
        .upsert(
          {
            crn:           course.crn,
            title:         course.title,
            department:    course.subjectCode,
            course_number: course.courseNumber,
            section:       course.section,
            credits:       course.credits,
            schedule: {
              days:     course.days,
              time:     course.time,
              location: course.location,
              section:  course.section,
              type:     course.scheduleType,
            },
            professor_id:   professorId,
            semester:       course.termCode,
            capacity:       course.maxEnrollment,
            enrolled_count: course.maxEnrollment - course.seatsAvailable,
            prerequisites:  course.prerequisites,
            attributes:     course.attributes,
            linked_courses: course.linkedCourses.map(String),
          },
          { onConflict: 'crn,semester' }
        );

      if (courseError) {
        console.error(`  ⚠ Course error (CRN ${course.crn}):`, courseError.message);
      } else {
        saved++;
      }
    } catch (err) {
      console.error(`  ⚠ Unexpected error for CRN ${course.crn}:`, err.message);
    }
  }

  return saved;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const yearNote = cliYear ? `${cliYear}-${cliYear + 1}` : 'auto-detecting best academic year';

  console.log(`\n${'='.repeat(90)}`);
  console.log(`   AUB Course Fetcher — Fall / Spring / Summer (${yearNote})`);
  console.log(`${'='.repeat(90)}\n`);

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

  const tempPage = await context.newPage();
  await tempPage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tempPage.waitForTimeout(2000);

  let grandTotal = 0;
  let grandSaved = 0;

  try {
    const terms = await getAllTerms(tempPage);
    await tempPage.close();

    await saveTermsToDB(terms);

    for (const term of terms) {
      console.log(`\n${'█'.repeat(90)}`);
      console.log(`  TERM: ${term.description} (${term.code})`);
      console.log(`${'█'.repeat(90)}\n`);

      const searchPage = await navigateToTerm(context, term.code);
      const subjects   = await getAllSubjects(searchPage, term.code);
      console.log(`📋 ${subjects.length} subjects found\n`);

      let termTotal = 0;
      let termSaved = 0;

      for (let i = 0; i < subjects.length; i++) {
        const { code, description } = subjects[i];
        process.stdout.write(`  [${i + 1}/${subjects.length}] ${code} (${description})... `);

        const courses = await fetchAllCoursesForSubject(searchPage, code, term.code);

        if (courses.length === 0) {
          console.log('no courses.');
          continue;
        }

        const saved = await saveCoursesToDB(courses);
        termTotal += courses.length;
        termSaved += saved;
        console.log(`${courses.length} fetched, ${saved} saved to DB.`);

        await searchPage.waitForTimeout(400);
      }

      console.log(`\n  ✅ Term total: ${termTotal} fetched, ${termSaved} saved`);
      grandTotal += termTotal;
      grandSaved += termSaved;
      await searchPage.close();
    }

    console.log(`\n${'='.repeat(90)}`);
    console.log(`✅ ALL DONE! ${grandTotal} courses fetched, ${grandSaved} saved to Supabase`);
    console.log(`${'='.repeat(90)}\n`);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
  } finally {
    await browser.close();
  }
})();