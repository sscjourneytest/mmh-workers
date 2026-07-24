// ============================================================
// Mock Matrix Hub — Attempts Worker (D1-backed)
// Routes:
//   POST /save-attempt   { quizId, emailKey, score, timeTaken, responseStream, sections }
//   GET  /rank            ?quizId=&score=&timeTaken=
//   GET  /toppers         ?quizId=&limit=10
//   GET  /attempt         ?quizId=&emailKey=   (latest attempt — for cross-device resume)
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
      if (url.pathname === "/rank" && request.method === "GET") {
        return await getRank(request, url, env);
      }
      if (url.pathname === "/toppers" && request.method === "GET") {
        return await getToppers(request, url, env);
      }
      if (url.pathname === "/attempt" && request.method === "GET") {
        return await getLatestAttempt(request, url, env);
      }
      return json({ error: "Not found" }, request, env, 404);
    } catch (err) {
      return json({ error: err.message || "Internal error" }, request, env, 500);
    }
  },
};

// ------------------------------------------------------------
// POST /save-attempt
// Every submit (fresh or reattempt) inserts a NEW row with the
// next At_no for that (quiz_id, email_key) — atomic via the
// SELECT-subquery INSERT below, no read-then-write race.
// Every insert fires trg_attempt_count_up, so total_attempts
// grows with each reattempt (counts toward rank competition).
// ------------------------------------------------------------
async function saveAttempt(request, url, env) {
  const body = await request.json();
  const { quizId, emailKey, score, timeTaken, responseStream, sections } = body;

  if (!quizId || !emailKey || score == null || timeTaken == null || !responseStream) {
    return json({ error: "Missing required fields" }, request, env, 400);
  }

  const sectionsJson = JSON.stringify(sections || {});

  const result = await env.DB.prepare(
    `INSERT INTO attempts (quiz_id, email_key, At_no, score, time_taken, response_stream, sections)
     SELECT ?, ?, COALESCE(MAX(At_no), 0) + 1, ?, ?, ?, ?
     FROM attempts WHERE quiz_id = ? AND email_key = ?
     RETURNING At_no`
  )
    .bind(quizId, emailKey, score, timeTaken, responseStream, sectionsJson, quizId, emailKey)
    .first();

  return json({ success: true, atNo: result.At_no }, request, env);
}

// ------------------------------------------------------------
// GET /rank?quizId=&score=&timeTaken=
// total  -> O(1) lookup from quiz_stats (no row scan)
// rank   -> index walk over only the rows ranked above this score/time
// Every attempt (including reattempts) is its own row here, so
// this ranks against ALL attempts, not just best-per-user.
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
// Uses idx_rank directly — no full-table sort needed.
// ------------------------------------------------------------
async function getToppers(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 50);

  if (!quizId) {
    return json({ error: "Missing quizId" }, request, env, 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT email_key, score, time_taken, sections
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
    timeTaken: r.time_taken,
    sections: JSON.parse(r.sections || "{}"),
  }));

  return json({ toppers }, request, env);
}

// ------------------------------------------------------------
// GET /attempt?quizId=&emailKey=
// Returns this user's LATEST attempt (highest At_no) for this
// quiz. Used by checkPreviousSubmission() for cross-device
// resume/recovery — the D1 equivalent of the old
// db.ref("attempt_history/...").limitToLast(1) call.
// PRIMARY KEY (quiz_id, email_key, At_no) makes this a direct
// clustered-index lookup, no extra index needed.
// ------------------------------------------------------------
async function getLatestAttempt(request, url, env) {
  const quizId = url.searchParams.get("quizId");
  const emailKey = url.searchParams.get("emailKey");

  if (!quizId || !emailKey) {
    return json({ error: "Missing quizId/emailKey" }, request, env, 400);
  }

  const row = await env.DB.prepare(
    `SELECT At_no, score, time_taken, response_stream, sections
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
    timeTaken: row.time_taken,
    responseStream: row.response_stream,
    sections: JSON.parse(row.sections || "{}"),
  }, request, env);
}
