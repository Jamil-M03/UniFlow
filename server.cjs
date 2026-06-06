console.log("File started");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const { InferenceClient } = require("@huggingface/inference");
const Groq = require("groq-sdk");
const { verifyToken } = require("@clerk/backend");

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "https://cmps-271.vercel.app",
  "https://uniflow-planner.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean));

function isAllowedOrigin(origin) {
  if (!origin) return true;

  return (
    allowedOrigins.has(origin) ||
    /^https:\/\/cmps-271-[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^https:\/\/uniflow-planner-[a-z0-9-]+\.vercel\.app$/i.test(origin)
  );
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json());

// The server is a trusted backend that authorizes writes itself (see
// resolveAppUserId below), so it uses the service-role key. This key MUST stay
// server-side only — never ship it to the browser. Falls back to the anon key
// with a warning so local read-only runs still work if the role key is unset.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key. " +
      "Writes will be subject to RLS and identity checks cannot be trusted.",
  );
}
const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

// Verify the caller's Clerk session token and resolve it to the Supabase app
// user id. Returns null if the token is missing/invalid or the user is unknown.
// Identity comes from the verified token, NEVER from the request body.
async function resolveAppUserId(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    const clerkUserId = payload?.sub;
    if (!clerkUserId) return null;

    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .single();

    if (error || !data) return null;
    return data.id;
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return null;
  }
}

const hf = new InferenceClient(process.env.HF_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SUMMARY_STOP_WORDS = new Set([
  "a", "an", "and", "about", "all", "any", "are", "as", "at", "be", "best",
  "can", "class", "classes", "could", "do", "doctor", "dr", "for", "from", "feedback",
  "give", "how", "i", "if", "in", "instructor", "is", "it", "me", "my",
  "of", "on", "opinion", "opinions", "or", "please", "prof", "professor",
  "rate", "rating", "ratings", "review", "reviews", "say", "should",
  "student", "students", "summarize", "summary", "take", "teach", "teacher",
  "tell", "that", "the", "this", "to", "what", "who", "would", "written",
  "x", "y", "you",
]);

const REVIEW_INTENT_KEYWORDS = [
  "professor",
  "prof",
  "instructor",
  "review",
  "reviews",
  "feedback",
  "summary",
  "summarize",
  "students say",
  "student feedback",
];

const POSITIVE_THEMES = [
  { label: "clear explanations", keywords: ["clear", "clarity", "explain", "explains", "explained", "understand", "understandable"] },
  { label: "helpful support", keywords: ["helpful", "supportive", "available", "responsive", "kind", "caring", "office hours"] },
  { label: "good organization", keywords: ["organized", "organization", "structured", "prepared", "well planned"] },
  { label: "fair grading", keywords: ["fair", "reasonable", "lenient", "transparent grading"] },
  { label: "engaging classes", keywords: ["engaging", "interesting", "interactive", "fun", "enjoyable"] },
  { label: "manageable workload", keywords: ["manageable", "light workload", "reasonable workload", "not too much work"] },
];

const CONCERN_THEMES = [
  { label: "a heavy workload", keywords: ["heavy workload", "too much work", "a lot of work", "lots of work", "many assignments", "homework", "project load"] },
  { label: "strict or tough grading", keywords: ["hard grader", "strict", "harsh", "unfair", "tough grading", "hard exams", "difficult exams", "tough exams"] },
  { label: "a fast pace", keywords: ["fast", "too fast", "rushed", "pace", "moves quickly"] },
  { label: "unclear explanations", keywords: ["confusing", "unclear", "hard to understand", "not clear", "disorganized"] },
  { label: "limited support", keywords: ["unavailable", "not helpful", "unresponsive", "doesn't care", "does not care"] },
];

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function joinList(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function extractMeaningfulTokens(text) {
  return normalizeText(text)
    .split(" ")
    .filter((token) => token.length > 1 && !SUMMARY_STOP_WORDS.has(token));
}

function extractProfessorQueryTokens(text) {
  return extractMeaningfulTokens(text)
    .filter((token) => /[a-z]/.test(token))
    .slice(0, 6);
}

function canonicalizeNameToken(token = "") {
  return String(token)
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/ou/g, "u")
    .replace(/([a-z])\1+/g, "$1");
}

function buildConsonantSkeleton(token = "") {
  const canonical = canonicalizeNameToken(token);
  if (!canonical) return "";
  return canonical[0] + canonical.slice(1).replace(/[aeiouy]/g, "");
}

function getProfessorNameTokens(fullName) {
  return normalizeText(fullName)
    .split(" ")
    .filter((token) => token.length > 1 && !SUMMARY_STOP_WORDS.has(token));
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }

    for (let j = 0; j < current.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - (distance / Math.max(a.length, b.length));
}

function tokenSimilarity(queryToken, nameToken) {
  const query = canonicalizeNameToken(queryToken);
  const candidate = canonicalizeNameToken(nameToken);

  if (!query || !candidate) return 0;
  if (query === candidate) return 1;

  const querySkeleton = buildConsonantSkeleton(query);
  const candidateSkeleton = buildConsonantSkeleton(candidate);

  if (querySkeleton && querySkeleton === candidateSkeleton && querySkeleton.length >= 3) {
    return 0.97;
  }

  if (
    Math.min(query.length, candidate.length) >= 4 &&
    (query.startsWith(candidate) || candidate.startsWith(query))
  ) {
    return 0.93;
  }

  const directSimilarity = stringSimilarity(query, candidate);
  const skeletonSimilarity = (
    querySkeleton.length >= 3 && candidateSkeleton.length >= 3
      ? stringSimilarity(querySkeleton, candidateSkeleton)
      : 0
  );

  return Math.max(directSimilarity, skeletonSimilarity * 0.98);
}

function buildQueryPairs(tokens) {
  if (tokens.length < 2) return [];

  const pairs = [];
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = i + 1; j < tokens.length; j += 1) {
      pairs.push([tokens[i], tokens[j]]);
    }
  }

  return pairs;
}

function pairCombinationSimilarity(queryLeft, queryRight, firstName, lastName) {
  const queryDirect = canonicalizeNameToken(`${queryLeft}${queryRight}`);
  const queryReversed = canonicalizeNameToken(`${queryRight}${queryLeft}`);
  const professorDirect = canonicalizeNameToken(`${firstName}${lastName}`);
  const professorReversed = canonicalizeNameToken(`${lastName}${firstName}`);

  const directScores = [
    stringSimilarity(queryDirect, professorDirect),
    stringSimilarity(queryDirect, professorReversed),
    stringSimilarity(queryReversed, professorDirect),
    stringSimilarity(queryReversed, professorReversed),
  ];

  const queryDirectSkeleton = buildConsonantSkeleton(queryDirect);
  const queryReversedSkeleton = buildConsonantSkeleton(queryReversed);
  const professorDirectSkeleton = buildConsonantSkeleton(professorDirect);
  const professorReversedSkeleton = buildConsonantSkeleton(professorReversed);

  const skeletonScores = [
    stringSimilarity(queryDirectSkeleton, professorDirectSkeleton),
    stringSimilarity(queryDirectSkeleton, professorReversedSkeleton),
    stringSimilarity(queryReversedSkeleton, professorDirectSkeleton),
    stringSimilarity(queryReversedSkeleton, professorReversedSkeleton),
  ];

  return Math.max(
    ...directScores,
    ...skeletonScores.map((score) => score * 0.99),
  );
}

async function fetchAllProfessors() {
  const allProfessors = [];
  const pageSize = 1000;

  for (let start = 0; start < 5000; start += pageSize) {
    const { data, error } = await supabase
      .from("professors")
      .select("id, full_name")
      .range(start, start + pageSize - 1);

    if (error) {
      return { data: null, error };
    }

    if (!data?.length) {
      break;
    }

    allProfessors.push(...data);

    if (data.length < pageSize) {
      break;
    }
  }

  return { data: allProfessors, error: null };
}

function scoreProfessorMatch(fullName, normalizedMessage, tokens) {
  const nameTokens = getProfessorNameTokens(fullName);
  if (!nameTokens.length) return 0;

  const normalizedName = nameTokens.join(" ");
  const firstName = nameTokens[0];
  const lastName = nameTokens[nameTokens.length - 1];
  const reversedName = `${lastName} ${firstName}`;
  let score = 0;

  if (normalizedMessage.includes(normalizedName)) {
    score += 24;
  }

  if (normalizedMessage.includes(reversedName)) {
    score += 18;
  }

  if (tokens.length >= 2) {
    const pairScores = buildQueryPairs(tokens)
      .map(([left, right]) => {
        const direct = (tokenSimilarity(left, firstName) + tokenSimilarity(right, lastName)) / 2;
        const reversed = (tokenSimilarity(left, lastName) + tokenSimilarity(right, firstName)) / 2;
        const combined = pairCombinationSimilarity(left, right, firstName, lastName);
        return Math.max(direct, reversed, combined);
      })
      .sort((a, b) => b - a);

    const bestPairScore = pairScores[0] ?? 0;
    score += bestPairScore * 28;

    if (bestPairScore >= 0.96) score += 8;
    else if (bestPairScore >= 0.88) score += 4;
  }

  const tokenScores = tokens
    .map((token) => Math.max(...nameTokens.map((nameToken) => tokenSimilarity(token, nameToken)), 0))
    .sort((a, b) => b - a);

  score += tokenScores
    .slice(0, Math.min(3, tokenScores.length))
    .reduce((total, value) => total + (value * 4), 0);

  if (tokens.length === 1 && tokenScores[0] >= 0.92) {
    score += 6;
  }

  return score;
}

async function findProfessorFromMessage(message) {
  const quotedMatch = String(message).match(/["']([^"']+)["']/);
  const tokenSource = quotedMatch?.[1] ?? message;
  const tokens = extractProfessorQueryTokens(tokenSource);

  if (!tokens.length) {
    return null;
  }

  const { data, error } = await fetchAllProfessors();

  if (error || !data?.length) {
    return null;
  }

  const normalizedMessage = normalizeText(message);
  const ranked = data
    .map((professor) => ({
      ...professor,
      score: scoreProfessorMatch(professor.full_name, normalizedMessage, tokens),
    }))
    .sort((a, b) => b.score - a.score || a.full_name.length - b.full_name.length);

  const best = ranked[0];
  const second = ranked[1];
  const minimumScore = tokens.length >= 2 ? 26 : 12;

  if (!best || best.score < minimumScore) {
    return null;
  }

  if (second && (best.score - second.score) < 2.5 && best.score < 40) {
    return null;
  }

  return { id: best.id, full_name: best.full_name };
}

function getTopThemeLabels(ratings, themes, limit = 2) {
  const normalizedReviews = ratings
    .map((rating) => normalizeText(rating.review || ""))
    .filter(Boolean);

  return themes
    .map((theme) => ({
      label: theme.label,
      count: normalizedReviews.reduce(
        (total, review) => total + (theme.keywords.some((keyword) => review.includes(keyword)) ? 1 : 0),
        0,
      ),
    }))
    .filter((theme) => theme.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((theme) => theme.label);
}

function getTopCourses(ratings, limit = 3) {
  const counts = new Map();

  ratings.forEach((rating) => {
    if (!rating.department || !rating.course_number) return;
    const code = `${rating.department} ${rating.course_number}`;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, count]) => count === 1 ? code : `${code} (${count} ${pluralize(count, "review")})`);
}

function buildProfessorSummary(professor, ratings) {
  const totalRatings = ratings.length;

  if (!totalRatings) {
    return `I couldn't find any submitted reviews for ${professor.full_name} yet.`;
  }

  const averageRating = (
    ratings.reduce((sum, rating) => sum + Number(rating.rating || 0), 0) / totalRatings
  ).toFixed(1);

  const writtenRatings = ratings.filter(
    (rating) => typeof rating.review === "string" && rating.review.trim().length > 0,
  );

  if (!writtenRatings.length) {
    return `${professor.full_name} has ${totalRatings} ${pluralize(totalRatings, "rating")} averaging ${averageRating}/5, but none of those submissions include written comments yet, so I can only report the score.`;
  }

  const positiveCount = ratings.filter((rating) => Number(rating.rating) >= 4).length;
  const negativeCount = ratings.filter((rating) => Number(rating.rating) <= 2).length;

  let overallTone = "mixed";
  if (positiveCount >= negativeCount + 2) overallTone = "mostly positive";
  if (negativeCount >= positiveCount + 2) overallTone = "mostly critical";

  const positiveThemes = getTopThemeLabels(
    writtenRatings.filter((rating) => Number(rating.rating) >= 4),
    POSITIVE_THEMES,
  );

  const concernThemes = getTopThemeLabels(
    writtenRatings.filter((rating) => Number(rating.rating) <= 3),
    CONCERN_THEMES,
  );

  const topCourses = getTopCourses(ratings);
  const summary = [
    `Based on ${writtenRatings.length} written ${pluralize(writtenRatings.length, "review")} and ${totalRatings} total ${pluralize(totalRatings, "rating")} for ${professor.full_name}, the overall feedback is ${overallTone} with an average rating of ${averageRating}/5.`,
  ];

  if (positiveThemes.length) {
    summary.push(`Students most often praise ${joinList(positiveThemes)}.`);
  } else if (positiveCount > negativeCount) {
    summary.push("The written comments lean positive overall, even though one compliment does not dominate.");
  }

  if (concernThemes.length) {
    summary.push(`The recurring concerns are ${joinList(concernThemes)}.`);
  } else if (negativeCount > 0) {
    summary.push("Some reviews mention downsides, but they do not cluster around one repeated complaint.");
  }

  if (topCourses.length) {
    summary.push(`Most of the submitted feedback references ${joinList(topCourses)}.`);
  }

  summary.push("This summary only reflects reviews that students submitted in the app.");
  return summary.join(" ");
}

async function moderateText(text) {
  if (!text || text.trim().length === 0) return { allowed: true };

  if (!process.env.HF_TOKEN) {
    console.error("Moderation error: HF_TOKEN is not set.");
    return { allowed: false, unavailable: true };
  }

  try {
    const result = await hf.textClassification({
      model: "unitary/toxic-bert",
      inputs: text,
    });

    const classifications = Array.isArray(result?.[0]) ? result[0] : result;
    const unsafeLabels = new Set([
      "toxic",
      "severe_toxic",
      "obscene",
      "threat",
      "insult",
      "identity_hate",
    ]);

    const flagged = (classifications || []).some((item) =>
      unsafeLabels.has(String(item.label || "").toLowerCase()) &&
      Number(item.score || 0) > 0.7
    );

    return { allowed: !flagged };
  } catch (err) {
    console.error("Moderation error:", err);
    return { allowed: false, unavailable: true };
  }
}

function sendModerationRejection(res, moderation) {
  if (moderation?.unavailable) {
    return res.status(503).json({
      error: "Review moderation is temporarily unavailable. Please try again later.",
    });
  }

  return res.status(400).json({
    error: "Review contains inappropriate content and was not submitted.",
  });
}

app.get("/api/terms", async (req, res) => {
  const { data, error } = await supabase
    .from("terms")
    .select("*")
    .order("code", { ascending: false });

  if (error) return res.status(500).json(error);

  const cleaned = data.map(t => ({
    ...t,
    description: t.description.replace(" (View Only)", "").trim()
  }));

  res.json(cleaned);
});

app.get("/api/courses", async (req, res) => {
  const { term, search } = req.query;

  let query = supabase
    .from("courses")
    .select("*, professors(full_name)")
    .eq("semester", term);

  if (search) {
    query = query.or(
      `title.ilike.%${search}%,department.ilike.%${search}%,crn.eq.${search},course_number.ilike.%${search}%`
    );
  }

  const { data, error } = await query.range(0, 5000);
  if (error) return res.status(500).json(error);
  res.json(data);
});

app.get("/api/ratings/course/:department/:courseNumber", async (req, res) => {
  const { department, courseNumber } = req.params;

  const { data, error } = await supabase
    .from("course_ratings")
    .select("*")
    .eq("department", department)
    .eq("course_number", courseNumber)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  const avg = data.length ? {
    rating: (data.reduce((a, r) => a + r.rating, 0) / data.length).toFixed(1),
    difficulty: (data.reduce((a, r) => a + r.difficulty, 0) / data.length).toFixed(1),
    count: data.length
  } : { rating: 0, difficulty: 0, count: 0 };

  res.json({ ratings: data, averages: avg });
});

app.post("/api/ratings/course", async (req, res) => {
  const user_id = await resolveAppUserId(req);
  if (!user_id) return res.status(401).json({ error: "Authentication required." });

  const { department, course_number, rating, difficulty, review } = req.body;

  const moderation = await moderateText(review);
  if (!moderation.allowed) {
    return sendModerationRejection(res, moderation);
  }

  const { data, error } = await supabase
    .from("course_ratings")
    .upsert({ user_id, department, course_number, rating, difficulty, review },
      { onConflict: 'user_id,department,course_number' });

  if (error) return res.status(500).json(error);
  res.json({ success: true });
});

app.get("/api/ratings/professor/:professorId", async (req, res) => {
  const { professorId } = req.params;

  const { data, error } = await supabase
    .from("professor_ratings")
    .select("*")
    .eq("professor_id", professorId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  const avg = data.length ? {
    rating: (data.reduce((a, r) => a + r.rating, 0) / data.length).toFixed(1),
    count: data.length
  } : { rating: 0, count: 0 };

  res.json({ ratings: data, averages: avg });
});

app.post("/api/ratings/professor", async (req, res) => {
  const user_id = await resolveAppUserId(req);
  if (!user_id) return res.status(401).json({ error: "Authentication required." });

  const { professor_id, department, course_number, rating, review } = req.body;

  const moderation = await moderateText(review);
  if (!moderation.allowed) {
    return sendModerationRejection(res, moderation);
  }

  const { data, error } = await supabase
    .from("professor_ratings")
    .upsert({ user_id, professor_id, department, course_number, rating, review },
      { onConflict: 'user_id,professor_id,department,course_number' });

  if (error) return res.status(500).json(error);
  res.json({ success: true });
});

app.get("/api/professors", async (req, res) => {
  const { search } = req.query;

  let query = supabase.from("professors").select("id, full_name");

  if (search) {
    const parts = search.trim().split(/\s+/);

    if (parts.length >= 2) {
      // Generate all possible "Last, First" combinations
      // e.g. "mohamad talal farran" → try "talal farran, mohamad" and "farran, mohamad talal"
      const filters = [`full_name.ilike.%${search}%`];
      for (let i = 1; i < parts.length; i++) {
        const first = parts.slice(0, i).join(' ');
        const last = parts.slice(i).join(' ');
        filters.push(`full_name.ilike.%${last}, ${first}%`);
      }
      query = query.or(filters.join(','));
    } else {
      query = query.ilike("full_name", `%${search}%`);
    }
  }

  const { data, error } = await query.limit(20);
  if (error) return res.status(500).json(error);
  res.json(data);
});

app.get("/api/professors/:professorId/courses", async (req, res) => {
  const { professorId } = req.params;

  const { data, error } = await supabase
    .from("courses")
    .select("department, course_number, title")
    .eq("professor_id", professorId)
    .order("department", { ascending: true })
    .order("course_number", { ascending: true });

  if (error) return res.status(500).json(error);

  const seen = new Set();
  const unique = (data || []).filter((course) => {
    const key = `${course.department}-${course.course_number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json(unique);
});

app.get("/api/courses/search", async (req, res) => {
  const { search } = req.query;

  let query = supabase
    .from("courses")
    .select("department, course_number, title")
    .ilike("department", `${search}%`);

  const { data, error } = await query.range(0, 200);
  if (error) return res.status(500).json(error);

  const seen = new Set();
  const unique = data.filter(c => {
    const key = `${c.department}-${c.course_number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json(unique);
});

// ── AI Schedule endpoint ───────────────────────────────────────────────────────
app.post("/api/ai-schedule", async (req, res) => {
  const {
    message,
    requestText,
    sections: rawSections = [],
    existingSections: rawExisting = [],
    difficulties = {},
    suggestionLimit,
    matchedAttributes = [],
    matchedDepartments = [],
    matchedInstructors = [],
    capacityRule,
    history = [],
  } = req.body ?? {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message is required." });
  }

  const sections = Array.isArray(rawSections) ? rawSections : [];
  const existing = Array.isArray(rawExisting) ? rawExisting : [];
  const normalizedMessage = normalizeText(message);
  const reviewIntent = REVIEW_INTENT_KEYWORDS.some((keyword) =>
    normalizedMessage.includes(keyword),
  );
  const professor = await findProfessorFromMessage(message);

  if (professor && (reviewIntent || sections.length === 0)) {
    const { data, error } = await supabase
      .from("professor_ratings")
      .select("*")
      .eq("professor_id", professor.id)
      .order("created_at", { ascending: false });

    if (error) {
      return res
        .status(500)
        .json({ error: "Couldn't load professor reviews right now." });
    }

    return res.json({
      mode: "professor-summary",
      schedule: [],
      summary: buildProfessorSummary(professor, data || []),
      avgDifficulty: null,
    });
  }

  if (reviewIntent && !professor) {
    return res.json({
      mode: "professor-summary",
      schedule: [],
      summary:
        'I could not confidently match that professor name. Try the full name exactly as it appears in Reviews, for example: "Summarize the reviews for Professor Jane Doe."',
      avgDifficulty: null,
    });
  }

  // Build sections context — only relevant sections passed from frontend
  const formatMeetings = (meetings) => {
    const text = (meetings ?? [])
      .map((m) => `${(m.days ?? []).join("/")} ${m.start}–${m.end}`)
      .join(", ");
    return text || "No fixed meeting time (online/async)";
  };

  const sectionsText = sections.map((s) => {
    const diff = difficulties[s.code] ? `difficulty ${difficulties[s.code]}/5` : "no reviews";
    const seats = s.capacityNote || `Seats: ${s.capacity?.enrolled ?? "?"}/${s.capacity?.limit ?? "?"}`;
    const linked = s.isSectionLinked
      ? ` | LINKED group ${s.linkIdentifier ?? "?"} (must be taken with its paired lecture/lab/recitation)`
      : "";
    const kind = s.scheduleType ? ` | ${s.scheduleType}` : "";
    return `[${s.id}] ${s.code} | ${s.title} | Section ${s.section} | ${s.instructor} | ${formatMeetings(s.meetings)}${kind} | ${diff} | ${seats}${linked}`;
  }).join("\n");

  // Already-scheduled courses the model must NOT conflict with or duplicate.
  const existingText = existing.length
    ? existing.map((s) => `${s.code} (Section ${s.section}) ${formatMeetings(s.meetings)}`).join("\n")
    : "(none)";

  const hints = [
    matchedAttributes.length ? `Matched attributes: ${matchedAttributes.join(", ")}.` : "",
    matchedDepartments.length ? `Restricted to departments: ${matchedDepartments.join(", ")}.` : "",
    matchedInstructors.length ? `Restricted to instructors: ${matchedInstructors.join(", ")}.` : "",
    Number.isFinite(suggestionLimit) ? `Suggest at most ${suggestionLimit} course(s).` : "",
  ].filter(Boolean).join(" ");

  const systemPrompt = `You are an AI academic advisor at the American University of Beirut (AUB).
Your job is to help students build their semester schedule from the sections provided.

Hard rules:
1. Pick sections ONLY from the [section_id] values in "Available sections". Never invent an id or a course that is not listed.
2. Pick ONE section per requested course.
3. No two picked sections may have overlapping meeting times on the same day.
4. Picked sections must NOT conflict (same-day time overlap) with any course in "Already scheduled", and must not duplicate a course the student already has.
5. If a picked section is part of a LINKED group, you must also pick its paired sections from the same linked group when they are present in the list.
6. Respect preferences: "no Fridays" (exclude F), "prefer mornings" (08:00–12:00), "prefer afternoons" (12:00–17:00), "prefer evenings" (after 17:00).
7. Prefer sections with open seats. Capacity meaning: ${capacityRule || "isFull=true means full; isFull=false means seats are open; enrolled=0 means the class is EMPTY, never treat it as full."}
8. Prefer lower-difficulty sections when the student signals workload concern. If a requested course has no non-conflicting open section, leave it out and say why in the summary.
${hints ? `\nRequest hints: ${hints}` : ""}

When building a schedule, respond ONLY with JSON in this exact shape:
{
  "schedule": ["section_id_1", "section_id_2"],
  "summary": "A friendly 2-3 sentence explanation of the picks, the average difficulty, and any course you had to skip and why.",
  "avgDifficulty": 3.2
}

If the student is just chatting (not asking for a schedule), respond ONLY with JSON:
{ "schedule": null, "summary": "your friendly response", "avgDifficulty": null }`;

  const studentRequest = (typeof requestText === "string" && requestText.trim()) ? requestText.trim() : message;

  const userMessage = sections.length > 0
    ? `Available sections:\n${sectionsText}\n\nAlready scheduled (avoid conflicts/duplicates):\n${existingText}\n\nStudent request: ${studentRequest}`
    : message;

  try {
    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      })),
      { role: 'user', content: userMessage }
    ];

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: chatMessages,
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? '';

    // response_format guarantees JSON, but parse defensively and fall back to
    // extracting the first JSON object if anything unexpected comes back.
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({ schedule: null, summary: text, avgDifficulty: null });
      }
      parsed = JSON.parse(jsonMatch[0]);
    }

    // Drop any hallucinated ids that aren't in the sections we sent.
    if (Array.isArray(parsed.schedule)) {
      const validIds = new Set(sections.map((s) => s.id));
      parsed.schedule = parsed.schedule.filter((id) => validIds.has(id));
    }

    res.json(parsed);
  } catch (err) {
    console.error("Groq error:", err);
    res.status(500).json({ error: "AI request failed.", details: err.message });
  }
});

console.log("About to listen...");
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.stdin.resume();
