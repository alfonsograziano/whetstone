import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInit } from "../commands/init.ts";
import {
  formatTraceJson,
  formatTraceText,
  runTraceGet,
} from "../commands/trace-get.ts";
import {
  formatFmJson,
  formatFmText,
  runFmGet,
} from "../commands/fm-get.ts";

async function makeTmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "whetstone-get-"));
}

function traceJsonl(id: string, fmIds: string[] = []): string {
  return `${JSON.stringify({
    id,
    input: "test input",
    output: "test output",
    feedback: [],
    originalTraceFile: "original/placeholder.json",
    failureModeIds: fmIds,
    analysis: { status: "analyzed" },
  })}\n`;
}

function fmsJson(fms: Array<{ id: string; status?: string }>): string {
  return `${JSON.stringify(
    {
      failureModes: fms.map((fm) => ({
        id: fm.id,
        title: `title for ${fm.id}`,
        description: `desc for ${fm.id}`,
        status: fm.status ?? "investigating",
        tags: [],
        affectedTraces: [],
      })),
    },
    null,
    2,
  )}\n`;
}

// ---------------------------------------------------------------------------
// trace get
// ---------------------------------------------------------------------------

test("trace get: finds a trace in a single file", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "traces", "a.jsonl"),
    traceJsonl("trc_abc") + traceJsonl("trc_def"),
    "utf8",
  );

  const result = await runTraceGet("trc_def", { cwd });

  assert.ok(result.trace);
  assert.equal(result.trace.id, "trc_def");
  assert.equal(result.file, "traces/a.jsonl");
  assert.equal(result.line, 2);
});

test("trace get: returns null when id is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "traces", "a.jsonl"),
    traceJsonl("trc_abc"),
    "utf8",
  );

  const result = await runTraceGet("trc_missing", { cwd });

  assert.equal(result.trace, null);
  assert.equal(result.file, null);
  assert.equal(result.line, null);
});

test("trace get: searches across multiple files in sorted order", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "traces", "a.jsonl"),
    traceJsonl("trc_in_a"),
    "utf8",
  );
  await writeFile(
    join(cwd, "whetstone", "traces", "b.jsonl"),
    traceJsonl("trc_in_b"),
    "utf8",
  );

  const resultA = await runTraceGet("trc_in_a", { cwd });
  assert.equal(resultA.file, "traces/a.jsonl");

  const resultB = await runTraceGet("trc_in_b", { cwd });
  assert.equal(resultB.file, "traces/b.jsonl");
});

test("trace get: skips malformed lines and keeps scanning", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "traces", "mixed.jsonl"),
    traceJsonl("trc_good_1") + "{ bad json\n" + traceJsonl("trc_good_2"),
    "utf8",
  );

  const result = await runTraceGet("trc_good_2", { cwd });

  assert.ok(result.trace);
  assert.equal(result.trace.id, "trc_good_2");
  assert.equal(result.line, 3);
});

test("trace get: empty traces/ returns null without error", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });

  const result = await runTraceGet("trc_any", { cwd });
  assert.equal(result.trace, null);
});

test("trace get: throws when cwd does not exist", async () => {
  const missing = join(tmpdir(), `whet-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => runTraceGet("trc_x", { cwd: missing }),
    /does not exist/,
  );
});

test("trace get: throws when whetstone/ is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => runTraceGet("trc_x", { cwd }),
    /whetstone\/ directory not found/,
  );
});

test("formatTraceText: not found", () => {
  const out = formatTraceText({ trace: null, file: null, line: null });
  assert.match(out, /not found/);
});

test("formatTraceText: found trace is pretty-printed JSON", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "traces", "t.jsonl"),
    traceJsonl("trc_1"),
    "utf8",
  );

  const result = await runTraceGet("trc_1", { cwd });
  const text = formatTraceText(result);
  const parsed = JSON.parse(text);
  assert.equal(parsed.id, "trc_1");
});

test("formatTraceJson: not found has found:false", () => {
  const out = JSON.parse(formatTraceJson({ trace: null, file: null, line: null }));
  assert.equal(out.found, false);
  assert.equal(out.trace, null);
});

test("formatTraceJson: found has found:true plus file and line", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "traces", "t.jsonl"),
    traceJsonl("trc_1"),
    "utf8",
  );

  const result = await runTraceGet("trc_1", { cwd });
  const out = JSON.parse(formatTraceJson(result));
  assert.equal(out.found, true);
  assert.equal(out.trace.id, "trc_1");
  assert.equal(out.file, "traces/t.jsonl");
  assert.equal(out.line, 1);
});

// ---------------------------------------------------------------------------
// fm get
// ---------------------------------------------------------------------------

test("fm get: finds a failure mode by id", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }, { id: "fm_beta" }]),
    "utf8",
  );

  const result = await runFmGet("fm_beta", { cwd });

  assert.ok(result.failureMode);
  assert.equal(result.failureMode.id, "fm_beta");
});

test("fm get: returns null when id is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }]),
    "utf8",
  );

  const result = await runFmGet("fm_missing", { cwd });
  assert.equal(result.failureMode, null);
});

test("fm get: empty catalogue returns null", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  // runInit writes an empty catalogue

  const result = await runFmGet("fm_any", { cwd });
  assert.equal(result.failureMode, null);
});

test("fm get: throws when failure_modes.json is malformed JSON", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    "{ not valid json",
    "utf8",
  );

  await assert.rejects(
    () => runFmGet("fm_x", { cwd }),
    /not valid JSON/,
  );
});

test("fm get: throws when failure_modes.json fails schema", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    JSON.stringify({ failureModes: [{ id: 123 }] }),
    "utf8",
  );

  await assert.rejects(
    () => runFmGet("123", { cwd }),
    /schema/,
  );
});

test("fm get: throws when cwd does not exist", async () => {
  const missing = join(tmpdir(), `whet-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => runFmGet("fm_x", { cwd: missing }),
    /does not exist/,
  );
});

test("fm get: throws when whetstone/ is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => runFmGet("fm_x", { cwd }),
    /whetstone\/ directory not found/,
  );
});

test("formatFmText: not found", () => {
  const out = formatFmText({ failureMode: null });
  assert.match(out, /not found/);
});

test("formatFmText: found prints id", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }]),
    "utf8",
  );

  const result = await runFmGet("fm_alpha", { cwd });
  const text = formatFmText(result);
  const parsed = JSON.parse(text);
  assert.equal(parsed.id, "fm_alpha");
});

test("formatFmJson: not found has found:false", () => {
  const out = JSON.parse(formatFmJson({ failureMode: null }));
  assert.equal(out.found, false);
  assert.equal(out.failureMode, null);
});

test("formatFmJson: found has found:true", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }]),
    "utf8",
  );

  const result = await runFmGet("fm_alpha", { cwd });
  const out = JSON.parse(formatFmJson(result));
  assert.equal(out.found, true);
  assert.equal(out.failureMode.id, "fm_alpha");
});
