#!/usr/bin/env node
// ============================================================
// Firebase attempt_history -> D1 CSV exporter (exam-wise, automated)
//
// Ports the exact classification + reshaping logic from
// firebase-to-d1-csv.html (the manual browser tool) so both stay in
// sync, but runs it unattended across every distinct Firebase project
// found in firebase-config.js instead of one project per browser
// session.
//
// Key difference from the manual tool: a quiz ID is only accepted
// into an exam's CSV if that exam key is ALSO one of the keys that
// firebase-config.js officially assigns to the project currently
// being read. If a quiz ID under project X classifies as an exam
// that's actually assigned to a DIFFERENT project, it's skipped and
// logged as a warning instead of silently included — this is what
// keeps data from a shared/misconfigured project from leaking into
// the wrong exam's CSV.
//
// Run: node scripts/export-attempts-csv.js
// Requires: Node 18+ (global fetch), firebase-config.js at repo root
// ============================================================

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "csv-output");

// ------------------------------------------------------------
// Load FIREBASE_PROJECTS from firebase-config.js at repo root.
// The file just does `const FIREBASE_PROJECTS = {...};` with no
// module.exports, so we read it as text and evaluate it in an
// isolated function scope to pull the variable out — this is your
// own trusted config file in your own repo, not external input.
// ------------------------------------------------------------
function loadFirebaseProjects() {
  const configPath = path.join(REPO_ROOT, "firebase-config.js");
  if (!fs.existsSync(configPath)) {
    throw new Error("firebase-config.js not found at repo root: " + configPath);
  }
  const src = fs.readFileSync(configPath, "utf8");
  const wrapped = new Function(src + "\nreturn FIREBASE_PROJECTS;");
  return wrapped();
}

// ------------------------------------------------------------
// Exam classification — mirrors firebase-to-d1-csv.html exactly
// (same order, same substrings, first match wins, case-insensitive).
// Keep in sync with the template's Firebase-project selector if that
// ever changes.
// ------------------------------------------------------------
const EXAM_RULES = [
  { key: "cgl",           match: (id) => id.includes("cgl") },
  { key: "chsl",          match: (id) => id.includes("chsl") },
  { key: "mts",           match: (id) => id.includes("mts") },
  { key: "phase",         match: (id) => id.includes("selection-post") },
  { key: "gd",            match: (id) => id.includes("gd") },
  { key: "cpo",           match: (id) => id.includes("cpo") },
  { key: "steno",         match: (id) => id.includes("steno") },
  { key: "ssc-sub",       match: (id) => id.includes("ssc-sub-25") },
  { key: "ntpc",          match: (id) => id.includes("ntpcg") },
  { key: "ntpc-ug",       match: (id) => id.includes("ntpc-ug") },
  { key: "imps",          match: (id) => id.includes("imps") },
];

function classifyQuizId(quizId) {
  const lower = quizId.toLowerCase();
  for (const rule of EXAM_RULES) {
    if (rule.match(lower)) return rule.key;
  }
  return null;
}

// ------------------------------------------------------------
// D1 sections shape: only score/correct/wrong/timeTaken per section
// (Firebase's sectionalData also carries total/unattempted — dropped
// here to match the D1 schema exactly, same as the manual tool).
// ------------------------------------------------------------
function trimSectionsToD1Shape(sections) {
  const out = {};
  Object.keys(sections || {}).forEach((sName) => {
    const s = sections[sName] || {};
    out[sName] = {
      score: s.score,
      correct: s.correct,
      wrong: s.wrong,
      timeTaken: s.timeTaken,
    };
  });
  return out;
}

// ------------------------------------------------------------
// Reshape one exam's merged attempt_history snapshots (one snapshot
// per quiz ID belonging to that exam) into D1-schema rows. At_no is
// assigned per user ACROSS all quiz IDs in the exam, sorted by
// submittedAt (the Firebase key under each user) ascending.
// ------------------------------------------------------------
function reshapeExamSnapshots(quizSnapshotPairs) {
  const byUser = {};
  let skipped = 0;

  quizSnapshotPairs.forEach(({ quizId, snapVal }) => {
    Object.keys(snapVal || {}).forEach((emailKey) => {
      const userNode = snapVal[emailKey] || {};
      Object.keys(userNode).forEach((ts) => {
        const payload = userNode[ts];
        if (!payload || typeof payload !== "object") { skipped++; return; }
        if (!byUser[emailKey]) byUser[emailKey] = [];
        byUser[emailKey].push({ ts: Number(ts), payload, quizId });
      });
    });
  });

  const rows = [];
  const userCount = Object.keys(byUser).length;

  Object.keys(byUser).forEach((emailKey) => {
    const entries = byUser[emailKey].sort((a, b) => a.ts - b.ts);
    let atNo = 0;
    entries.forEach((entry) => {
      const p = entry.payload;
      if (p.score == null || p.timeTaken == null || !p.responseStream) {
        skipped++;
        return;
      }
      atNo++;
      rows.push({
        quiz_id: p.quizId || entry.quizId,
        email_key: p.emailKey || emailKey,
        At_no: atNo,
        score: p.score,
        correct: p.correct || 0,
        wrong: p.wrong || 0,
        time_taken: p.timeTaken,
        response_stream: p.responseStream,
        sections: JSON.stringify(trimSectionsToD1Shape(p.sections)),
      });
    });
  });

  return { rows, userCount, skipped };
}

// ------------------------------------------------------------
// CSV building
// ------------------------------------------------------------
const CSV_HEADERS = ["quiz_id", "email_key", "At_no", "score", "correct", "wrong", "time_taken", "response_stream", "sections"];

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function rowsToCsv(rows) {
  const lines = [CSV_HEADERS.join(",")];
  rows.forEach((r) => {
    lines.push(CSV_HEADERS.map((h) => csvEscape(r[h])).join(","));
  });
  return lines.join("\r\n");
}

// ------------------------------------------------------------
// Firebase REST reads (no SDK needed server-side — same public REST
// endpoints the browser tool uses, assuming the same open read rules
// the live app already relies on client-side).
// ------------------------------------------------------------
async function fetchShallowQuizIds(databaseURL) {
  const url = databaseURL.replace(/\/+$/, "") + "/attempt_history.json?shallow=true";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Shallow read failed: HTTP " + res.status + " for " + url);
  const data = await res.json();
  return data ? Object.keys(data) : [];
}

async function fetchQuizAttempts(databaseURL, quizId) {
  const url = databaseURL.replace(/\/+$/, "") + "/attempt_history/" + encodeURIComponent(quizId) + ".json";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Read failed: HTTP " + res.status + " for " + url);
  const data = await res.json();
  return data || {};
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
async function main() {
  const FIREBASE_PROJECTS = loadFirebaseProjects();

  // Group exam keys by their actual distinct databaseURL — "common"
  // is intentionally excluded (Saved Questions, unrelated to results).
  const projectsByUrl = {};
  Object.keys(FIREBASE_PROJECTS).forEach((examKey) => {
    if (examKey === "common") return;
    const url = FIREBASE_PROJECTS[examKey].databaseURL;
    if (!url) {
      console.warn(`⚠️  ${examKey}: no databaseURL in config, skipping`);
      return;
    }
    if (!projectsByUrl[url]) projectsByUrl[url] = [];
    projectsByUrl[url].push(examKey);
  });

  const distinctUrls = Object.keys(projectsByUrl);
  console.log(`Found ${distinctUrls.length} distinct Firebase project(s) across ${Object.keys(FIREBASE_PROJECTS).length - 1} exam key(s) (excluding common).\n`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // examKey -> accumulated { quizId, snapVal } pairs, in case the same
  // exam key ever appeared in more than one project (shouldn't happen
  // given firebase-config.js assigns one project per key, but keeps
  // this correct if it ever does).
  const examSnapshots = {};
  let totalWarnings = 0;

  for (const url of distinctUrls) {
    const officialKeys = projectsByUrl[url]; // exam keys this project is meant to serve
    console.log(`=== Project: ${url}`);
    console.log(`    Officially serves: ${officialKeys.join(", ")}`);

    let quizIds;
    try {
      quizIds = await fetchShallowQuizIds(url);
    } catch (e) {
      console.error(`    ❌ Could not list quiz IDs: ${e.message}`);
      totalWarnings++;
      continue;
    }
    console.log(`    Found ${quizIds.length} quiz ID(s) under attempt_history`);

    // Classify every quiz ID found in THIS project.
    const matchedByExam = {};
    quizIds.forEach((quizId) => {
      const examKey = classifyQuizId(quizId);
      if (!examKey) {
        console.warn(`    ⚠️  Unclassified quiz ID (no pattern matched): ${quizId}`);
        totalWarnings++;
        return;
      }
      if (!officialKeys.includes(examKey)) {
        // This is the cross-project contamination guard: the quiz ID
        // LOOKS like it belongs to `examKey`, but firebase-config.js
        // assigns `examKey` to a DIFFERENT project than this one —
        // skip it rather than trust it.
        console.warn(`    ⚠️  SKIPPED (wrong project): "${quizId}" classifies as "${examKey}", but "${examKey}" is assigned to a different project in firebase-config.js`);
        totalWarnings++;
        return;
      }
      if (!matchedByExam[examKey]) matchedByExam[examKey] = [];
      matchedByExam[examKey].push(quizId);
    });

    // Fetch full attempt data for every validated quiz ID, per exam.
    for (const examKey of Object.keys(matchedByExam)) {
      const ids = matchedByExam[examKey];
      console.log(`    -> ${examKey}: ${ids.length} quiz ID(s) matched — fetching...`);
      const pairs = await Promise.all(
        ids.map((quizId) =>
          fetchQuizAttempts(url, quizId).then((snapVal) => ({ quizId, snapVal }))
        )
      );
      if (!examSnapshots[examKey]) examSnapshots[examKey] = [];
      examSnapshots[examKey].push(...pairs);
    }
    console.log("");
  }

  // Reshape + write one CSV per exam key that produced any rows.
  console.log("=== Generating CSVs ===");
  let totalRows = 0;
  const examKeys = Object.keys(examSnapshots);
  if (!examKeys.length) {
    console.log("No exam data found across any project.");
  }
  for (const examKey of examKeys) {
    const { rows, userCount, skipped } = reshapeExamSnapshots(examSnapshots[examKey]);
    if (!rows.length) {
      console.log(`  ${examKey}: 0 rows — no CSV written`);
      continue;
    }
    const csv = rowsToCsv(rows);
    const outPath = path.join(OUTPUT_DIR, `${examKey}.csv`);
    fs.writeFileSync(outPath, csv, "utf8");
    console.log(`  ✅ ${examKey}.csv — ${rows.length} row(s), ${userCount} user(s)${skipped ? `, ${skipped} skipped` : ""}`);
    totalRows += rows.length;
  }

  console.log(`\nDone. ${totalRows} total attempt row(s) written across ${OUTPUT_DIR}.`);
  if (totalWarnings) {
    console.log(`⚠️  ${totalWarnings} warning(s) — see log above (unclassified or cross-project-skipped quiz IDs).`);
  }
}

main().catch((e) => {
  console.error("Export failed:", e);
  process.exit(1);
});
