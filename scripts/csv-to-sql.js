#!/usr/bin/env node
// ============================================================
// CSV -> batched SQL INSERT converter for the D1 `attempts` table.
// Usage: node scripts/csv-to-sql.js <input.csv> <output.sql>
//
// Hand-written CSV parser (no npm dependency) — needed because the
// `sections` column is a JSON string, so it contains commas, quotes,
// and braces inside quoted CSV fields; a naive split(",") would
// corrupt it. This correctly handles RFC4180-style quoting: fields
// wrapped in "...", embedded commas/newlines inside quotes, and
// escaped quotes written as "".
// ============================================================

const fs = require("fs");

const BATCH_SIZE = 50; // rows per INSERT statement — conservative, keeps each statement well under D1's size limits

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; } // normalize CRLF -> LF, handled by \n below
    if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
      i++; continue;
    }
    field += c; i++;
  }
  // last field/row if file doesn't end with a newline
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // drop a trailing fully-empty row (common after a final newline)
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();

  return rows;
}

function sqlEscape(val) {
  if (val === null || val === undefined) return "NULL";
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/csv-to-sql.js <input.csv> <output.sql>");
    process.exit(1);
  }

  const text = fs.readFileSync(inputPath, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.log(`${inputPath}: no data rows — skipping`);
    fs.writeFileSync(outputPath, "-- no rows\n", "utf8");
    return;
  }

  const header = rows[0];
  const expected = ["quiz_id", "email_key", "At_no", "score", "correct", "wrong", "time_taken", "response_stream", "sections"];
  if (header.join(",") !== expected.join(",")) {
    console.error(`${inputPath}: header mismatch.\n  expected: ${expected.join(",")}\n  found:    ${header.join(",")}`);
    process.exit(1);
  }

  const dataRows = rows.slice(1);
  const statements = [];

  // Full-replace guard: the exporter always emits the COMPLETE current
  // attempt set for every quiz_id it includes (it re-derives At_no from
  // scratch from Firebase each run). So before inserting, delete any
  // existing rows for these quiz_ids — otherwise stale rows left over
  // from an older/buggy export run (e.g. a leftover At_no that no longer
  // exists in the corrected data) never get cleaned up by the
  // upsert-only INSERT ... ON CONFLICT below.
  const quizIds = [...new Set(dataRows.map((r) => r[0]))];
  if (quizIds.length) {
    statements.push(
      "DELETE FROM attempts WHERE quiz_id IN (" +
      quizIds.map(sqlEscape).join(", ") +
      ");"
    );
  }

  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batch = dataRows.slice(i, i + BATCH_SIZE);
    const valuesList = batch.map((r) => {
      const [quiz_id, email_key, At_no, score, correct, wrong, time_taken, response_stream, sections] = r;
      return "(" + [
        sqlEscape(quiz_id),
        sqlEscape(email_key),
        Number(At_no),
        Number(score),
        Number(correct),
        Number(wrong),
        Number(time_taken),
        sqlEscape(response_stream),
        sqlEscape(sections),
      ].join(", ") + ")";
    });

    statements.push(
      "INSERT INTO attempts (quiz_id, email_key, At_no, score, correct, wrong, time_taken, response_stream, sections)\n" +
      "VALUES\n" + valuesList.join(",\n") + "\n" +
      "ON CONFLICT(quiz_id, email_key, At_no) DO UPDATE SET\n" +
      "  score = excluded.score,\n" +
      "  correct = excluded.correct,\n" +
      "  wrong = excluded.wrong,\n" +
      "  time_taken = excluded.time_taken,\n" +
      "  response_stream = excluded.response_stream,\n" +
      "  sections = excluded.sections;"
    );
  }

  fs.writeFileSync(outputPath, statements.join("\n\n") + "\n", "utf8");
  console.log(`${inputPath}: ${dataRows.length} row(s) -> ${statements.length} batched statement(s) -> ${outputPath}`);
}

main();

