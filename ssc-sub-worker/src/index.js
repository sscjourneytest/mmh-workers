// ============================================================
// Mock Matrix Hub — Attempts Worker (D1-backed)
// Single source of truth for rank AND toppers (quiz_results on
// Firebase is no longer used).
// Routes:
//   POST /save-attempt      { quizId, emailKey, score, correct, wrong, timeTaken, responseStream, sections } -- sections: {name:{score,correct,wrong,timeTaken}}
//                            -> returns { success, atNo, rank, total, percentile, toppers }
//   POST /update-attempt    { quizId, emailKey, atNo, score, correct, wrong, sections }
//                            -> returns { success, rank, total, percentile, toppers }
//   GET  /rank               ?quizId=&score=&timeTaken=
//   GET  /toppers            ?quizId=&limit=10
//   GET  /rank-and-toppers   ?quizId=&score=&timeTaken=&limit=10   (read-only combined, used by silent restore)
//   GET  /attempt             ?quizId=&emailKey=              (latest attempt only — cross-device resume)
//   GET  /attempts            ?quizId=&emailKey=              (ALL attempts for this user — history browser)
//   GET  /attempt-by-no       ?quizId=&emailKey=&atNo=         (one specific attempt, full data — viewing a past attempt)
// ============================================================

function corsHeaders(request, env) {
  const allowList = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const requestOrigin = request.headers.get("Origin") || "";
  const allowOrigin = allowList.includes(requestOrigin) ? requestOrigin : allowList[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin",
  };
}

function json(data, request, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/save-attempt" && request.method === "POST") {
        return await saveAttempt(request, url, env);
      }
      if (url.pathname === "/update-attempt" && request.method === "POST") {
        return await updateAttempt(request, url, env);
      }
      if (url.pathname === "/rank" && request.method === "GET") {
        return await getRank(request, url, env);
      }
      if (url.pathname === "/toppers" && request.method === "GET") {
        return await getToppers(request, url, env);
      }
      if (url.pathname === "/attempt" && request.method === "GET") {
        return await getLatestAttempt(request, url, env);
      }
      if (url.pathname === "/attempts" && request.method === "GET") {
        return await getAllAttempts(request, url, env);
      }
      if (url.pathname === "/attempt-by-no" && request.method === "GET") {
        return await getAttemptByNo(request, url, env);
      }
      if (url.pathname === "/rank-and-toppers" && request.method === "GET") {
        return await getRankAndToppersRoute(request, url, env);
      }
      return json({ error: "Not found" }, request, env, 404);
    } catch (err) {
      return json({ error: err.message || "Internal error" }, request, env, 500);
    }
  },
};

// ------------------------------------------------------------
// Shared: rank + percentile + toppers for a given score/time.
// Used by /save-attempt and /update-attempt (so both return live
// rank+toppers in the same response — no extra round trip needed)
// and by /rank-and-toppers (read-only, for the silent restore path).
// ------------------------------------------------------------
async function computeRankAndToppers(env, quizId, score, timeTaken, limit = 10) {
  const [totalRow, rankRow, toppersResult] = await Promise.all([
    env.DB.prepare(`SELECT total_attempts FROM quiz_stats WHERE quiz_id = ?`)
      .bind(quizId)
      .first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS aheadCount FROM attempts
       WHERE quiz_id = ?
         AND (score > ? OR (score = ? AND time_taken < ?))`
    )
      .bind(quizId, score, score, timeTaken)
      .first(),
    env.DB.prepare(
      `SELECT email_key, score, correct, wrong, time_taken, sections
       FROM attempts
       WHERE quiz_id = ?
       ORDER BY score DESC, time_taken ASC
       LIMIT ?`
    )
      .bind(quizId, limit)
      .all(),
  ]);

  const total = totalRow ? totalRow.total_attempts : 0;
  const rank = (rankRow ? rankRow.aheadCount : 0) + 1;
  const below = total - rank;
  const percentile = total > 0 ? ((below / total) * 100).toFixed(2) : "0.00";

  const toppers = toppersResult.results.map((r) => ({
    name: r.email_key,
    score: r.score,
    correct: r.correct,
    wrong: r.wrong,
    timeTaken: r.time_taken,
    sections: JSON.parse(r.sections || "{}"),
  }));

  return { rank, total, percentile, toppers };
}

// ------------------------------------------------------------
// POST /save-attempt
// Every submit (fresh or reattempt) inserts a NEW row with the
// next At_no for that (quiz_id, email_key) — atomic via the
// SELECT-subquery INSERT below, no read-then-write race.
// Every insert fires trg_attempt_count_up, so total_attempts
// grows with each reattempt (counts toward rank competition).
// Returns rank+toppers in the same response as the write.
// ------------------------------------------------------------
async function saveAttempt(request, url, env) {
  const body = await request.json();
  const { quizId, emailKey, score, correct, wrong, timeTaken, responseStream, sections } = body;

  if (!quizId || !emailKey || score == null || timeTaken == null || !responseStream) {
    return json({ error: "Missing required fields" }, request, env, 400);
  }

  const sectionsJson = JSON.stringify(sections || {});

  const result = await env.DB.prepare(
    `INSERT INTO attempts (quiz_id, email_key, At_no, score, correct, wrong, time_taken, response_stream, sections)
     SELECT ?, ?, COALESCE(MAX(At_no), 0) + 1, ?, ?, ?, ?, ?, ?
     FROM attempts WHERE quiz_id = ? AND email_key = ?
     RETURNING At_no`
  )
    .bind(quizId, emailKey, score, correct || 0, wrong || 0, timeTaken, responseStream, sectionsJson, quizId, emailKey)
    .first();

  const { rank, total, percentile, toppers } = await computeRankAndToppers(env, quizId, score, timeTaken);

  return json({ success: true, atNo: result.At_no, rank, total, percentile, toppers }, request, env);
}

// ------------------------------------------------------------
// POST /update-attempt
// In-place correction of an EXISTING row (e.g. an admin fixes an
// answer key after submissions came in). Updates score/correct/
// wrong/sections only — never response_stream, never At_no — and
// is a plain UPDATE, so trg_attempt_count_up does NOT fire and
// total_attempts is unaffected. Returns rank+toppers in the same
// response as the write.
// ------------------------------------------------------------
async function updateAttempt(request, url, env) {
  const body = await request.json();
  const { quizId, emailKey, atNo, score, correct, wrong, sections } = body;

  if (!quizId || !emailKey || atNo == null || score == null) {
    return json({ error: "Missing required fields" }, request, env, 400);
  }

  const sectionsJson = JSON.stringify(sections || {});

  // RETURNING time_taken because rank needs it and this route never
  // changes it — cheaper than a separate SELECT after the UPDATE.
  const updated = await env.DB.prepare(
    `UPDATE attempts
     SET score = ?, correct = ?, wrong = ?, sections = ?
     WHERE quiz_id = ? AND email_key = ? AND At_no = ?
     RETURNING time_taken`
  )
    .bind(score, correct || 0, wrong || 0, sectionsJson, quizId, emailKey, atNo)
    .first();

  if (!updated) {
    return json({ error: "Attempt not found" }, request, env, 404);
  }

  const { rank, total, percentile, toppers } = await computeRankAndToppers(env, quizId, score, updated.time_taken);

  return json({ success: true, rank, total, percentile, toppers }, request, env);
}

// ------------------------------------------------------------
// GET /rank?quizId=&score=&timeTaken=
// total  -> O(1) lookup from quiz_stats (no row scan)
// rank   -> index walk over only the rows ranked above this score/time
// Every attempt (including reattempts) is its own row here, so
// this ranks against ALL attempts, not just best-per-user.
// Kept for backward compatibility — /save-attempt, /update-attempt,
// and /rank-and-toppers no longer need this as a separate call.
// ------------------------------------------------------------
async function getRank(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const score = Number(url.searchParams.get("score"));
  const timeTaken = Number(url.searchParams.get("timeTaken"));

  if (!quizId || Number.isNaN(score) || Number.isNaN(timeTaken)) {
    return json({ error: "Missing or invalid quizId/score/timeTaken" }, request, env, 400);
  }

  const [totalRow, rankRow] = await Promise.all([
    env.DB.prepare(`SELECT total_attempts FROM quiz_stats WHERE quiz_id = ?`)
      .bind(quizId)
      .first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS aheadCount FROM attempts
       WHERE quiz_id = ?
         AND (score > ? OR (score = ? AND time_taken < ?))`
    )
      .bind(quizId, score, score, timeTaken)
      .first(),
  ]);

  const total = totalRow ? totalRow.total_attempts : 0;
  const rank = (rankRow ? rankRow.aheadCount : 0) + 1;
  const below = total - rank;
  const percentile = total > 0 ? ((below / total) * 100).toFixed(2) : "0.00";

  return json({ rank, total, percentile }, request, env);
}

// ------------------------------------------------------------
// GET /toppers?quizId=&limit=10
// Uses idx_rank directly — no full-table sort needed. Now the
// single source for toppers (replaces Firebase quiz_results).
// Kept for backward compatibility — see note on /rank above.
// ------------------------------------------------------------
async function getToppers(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 50);

  if (!quizId) {
    return json({ error: "Missing quizId" }, request, env, 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT email_key, score, correct, wrong, time_taken, sections
     FROM attempts
     WHERE quiz_id = ?
     ORDER BY score DESC, time_taken ASC
     LIMIT ?`
  )
    .bind(quizId, limit)
    .all();

  const toppers = results.map((r) => ({
    name: r.email_key, // email_key holds the username, used directly for display
    score: r.score,
    correct: r.correct,
    wrong: r.wrong,
    timeTaken: r.time_taken,
    sections: JSON.parse(r.sections || "{}"),
  }));

  return json({ toppers }, request, env);
}

// ------------------------------------------------------------
// GET /rank-and-toppers?quizId=&score=&timeTaken=&limit=10
// Read-only combined rank+toppers — used by the silent restore
// path (viewing an already-submitted attempt), which never writes,
// so one round trip instead of two.
// ------------------------------------------------------------
async function getRankAndToppersRoute(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const score = Number(url.searchParams.get("score"));
  const timeTaken = Number(url.searchParams.get("timeTaken"));
  const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 50);

  if (!quizId || Number.isNaN(score) || Number.isNaN(timeTaken)) {
    return json({ error: "Missing or invalid quizId/score/timeTaken" }, request, env, 400);
  }

  const { rank, total, percentile, toppers } = await computeRankAndToppers(env, quizId, score, timeTaken, limit);

  return json({ rank, total, percentile, toppers }, request, env);
}

// ------------------------------------------------------------
// GET /attempt?quizId=&emailKey=
// Returns this user's LATEST attempt (highest At_no) for this
// quiz. Used by checkPreviousSubmission() for cross-device
// resume/recovery. PRIMARY KEY (quiz_id, email_key, At_no) makes
// this a direct clustered-index lookup, no extra index needed.
// ------------------------------------------------------------
async function getLatestAttempt(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const emailKey = url.searchParams.get("emailKey");

  if (!quizId || !emailKey) {
    return json({ error: "Missing quizId/emailKey" }, request, env, 400);
  }

  const row = await env.DB.prepare(
    `SELECT At_no, score, correct, wrong, time_taken, response_stream, sections
     FROM attempts
     WHERE quiz_id = ? AND email_key = ?
     ORDER BY At_no DESC
     LIMIT 1`
  )
    .bind(quizId, emailKey)
    .first();

  if (!row) {
    return json({ found: false }, request, env);
  }

  return json({
    found: true,
    atNo: row.At_no,
    score: row.score,
    correct: row.correct,
    wrong: row.wrong,
    timeTaken: row.time_taken,
    responseStream: row.response_stream,
    sections: JSON.parse(row.sections || "{}"),
  }, request, env);
}

// ------------------------------------------------------------
// GET /attempts?quizId=&emailKey=
// Returns ALL of this user's attempts for this quiz, newest
// first (by At_no) — powers the Attempt History browser. No
// date field — At_no is the only ordering/display identifier
// (dates were deliberately dropped to save row size).
// ------------------------------------------------------------
async function getAllAttempts(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const emailKey = url.searchParams.get("emailKey");

  if (!quizId || !emailKey) {
    return json({ error: "Missing quizId/emailKey" }, request, env, 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT At_no, score, correct, wrong, time_taken, sections
     FROM attempts
     WHERE quiz_id = ? AND email_key = ?
     ORDER BY At_no DESC`
  )
    .bind(quizId, emailKey)
    .all();

  const attempts = results.map((r) => ({
    atNo: r.At_no,
    score: r.score,
    correct: r.correct,
    wrong: r.wrong,
    timeTaken: r.time_taken,
    sections: JSON.parse(r.sections || "{}"),
  }));

  return json({ attempts }, request, env);
}

// ------------------------------------------------------------
// GET /attempt-by-no?quizId=&emailKey=&atNo=
// Returns ONE specific attempt with full data (including
// response_stream) — used when a user picks a specific past
// attempt from the Attempt History list to view it in full via
// the normal results dashboard (not the plain summary list).
// ------------------------------------------------------------
async function getAttemptByNo(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const emailKey = url.searchParams.get("emailKey");
  const atNo = Number(url.searchParams.get("atNo"));

  if (!quizId || !emailKey || !atNo) {
    return json({ error: "Missing quizId/emailKey/atNo" }, request, env, 400);
  }

  const row = await env.DB.prepare(
    `SELECT At_no, score, correct, wrong, time_taken, response_stream, sections
     FROM attempts
     WHERE quiz_id = ? AND email_key = ? AND At_no = ?`
  )
    .bind(quizId, emailKey, atNo)
    .first();

  if (!row) {
    return json({ found: false }, request, env);
  }

  return json({
    found: true,
    atNo: row.At_no,
    score: row.score,
    correct: row.correct,
    wrong: row.wrong,
    timeTaken: row.time_taken,
    responseStream: row.response_stream,
    sections: JSON.parse(row.sections || "{}"),
  }, request, env);
}

