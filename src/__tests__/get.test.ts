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
  return await mkdtemp(join(tmpdir(), "tracebound-get-"));
}

const AGENT = "test-agent";

function agentRoot(cwd: string, agent: string = AGENT): string {
  return join(cwd, "tracebound", agent);
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

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "a.jsonl"),
    traceJsonl("trc_abc") + traceJsonl("trc_def"),
    "utf8",
  );

  const result = await runTraceGet("trc_def", { cwd, agent: AGENT });

  assert.ok(result.trace);
  assert.equal(result.trace.id, "trc_def");
  assert.equal(result.file, "traces/a.jsonl");
  assert.equal(result.line, 2);
});

test("trace get: returns null when id is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "a.jsonl"),
    traceJsonl("trc_abc"),
    "utf8",
  );

  const result = await runTraceGet("trc_missing", { cwd, agent: AGENT });

  assert.equal(result.trace, null);
  assert.equal(result.file, null);
  assert.equal(result.line, null);
});

test("trace get: searches across multiple files in sorted order", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "a.jsonl"),
    traceJsonl("trc_in_a"),
    "utf8",
  );
  await writeFile(
    join(agentRoot(cwd), "traces", "b.jsonl"),
    traceJsonl("trc_in_b"),
    "utf8",
  );

  const resultA = await runTraceGet("trc_in_a", { cwd, agent: AGENT });
  assert.equal(resultA.file, "traces/a.jsonl");

  const resultB = await runTraceGet("trc_in_b", { cwd, agent: AGENT });
  assert.equal(resultB.file, "traces/b.jsonl");
});

test("trace get: skips malformed lines and keeps scanning", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "mixed.jsonl"),
    traceJsonl("trc_good_1") + "{ bad json\n" + traceJsonl("trc_good_2"),
    "utf8",
  );

  const result = await runTraceGet("trc_good_2", { cwd, agent: AGENT });

  assert.ok(result.trace);
  assert.equal(result.trace.id, "trc_good_2");
  assert.equal(result.line, 3);
});

test("trace get: empty traces/ returns null without error", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });

  const result = await runTraceGet("trc_any", { cwd, agent: AGENT });
  assert.equal(result.trace, null);
});

test("trace get: throws when cwd does not exist", async () => {
  const missing = join(tmpdir(), `whet-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => runTraceGet("trc_x", { cwd: missing, agent: AGENT }),
    /does not exist/,
  );
});

test("trace get: throws when agent is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => runTraceGet("trc_x", { cwd, agent: AGENT }),
    /no such agent/,
  );
});

test("trace get: throws when --agent is missing", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await assert.rejects(
    () => runTraceGet("trc_x", { cwd }),
    /--agent <name> is required.*alpha/s,
  );
});

test("trace get: traces in another agent are not visible", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await runInit({ cwd, agent: "beta" });

  await writeFile(
    join(agentRoot(cwd, "alpha"), "traces", "x.jsonl"),
    traceJsonl("trc_only_alpha"),
    "utf8",
  );

  const inAlpha = await runTraceGet("trc_only_alpha", { cwd, agent: "alpha" });
  assert.ok(inAlpha.trace);

  const inBeta = await runTraceGet("trc_only_alpha", { cwd, agent: "beta" });
  assert.equal(inBeta.trace, null);
});

test("formatTraceText: not found", () => {
  const out = formatTraceText({ trace: null, file: null, line: null });
  assert.match(out, /not found/);
});

test("formatTraceText: found trace is pretty-printed JSON", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "t.jsonl"),
    traceJsonl("trc_1"),
    "utf8",
  );

  const result = await runTraceGet("trc_1", { cwd, agent: AGENT });
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

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "t.jsonl"),
    traceJsonl("trc_1"),
    "utf8",
  );

  const result = await runTraceGet("trc_1", { cwd, agent: AGENT });
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

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }, { id: "fm_beta" }]),
    "utf8",
  );

  const result = await runFmGet("fm_beta", { cwd, agent: AGENT });

  assert.ok(result.failureMode);
  assert.equal(result.failureMode.id, "fm_beta");
});

test("fm get: returns null when id is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }]),
    "utf8",
  );

  const result = await runFmGet("fm_missing", { cwd, agent: AGENT });
  assert.equal(result.failureMode, null);
});

test("fm get: empty catalogue returns null", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });

  const result = await runFmGet("fm_any", { cwd, agent: AGENT });
  assert.equal(result.failureMode, null);
});

test("fm get: throws when failure_modes.json is malformed JSON", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    "{ not valid json",
    "utf8",
  );

  await assert.rejects(
    () => runFmGet("fm_x", { cwd, agent: AGENT }),
    /not valid JSON/,
  );
});

test("fm get: throws when failure_modes.json fails schema", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    JSON.stringify({ failureModes: [{ id: 123 }] }),
    "utf8",
  );

  await assert.rejects(
    () => runFmGet("123", { cwd, agent: AGENT }),
    /schema/,
  );
});

test("fm get: throws when cwd does not exist", async () => {
  const missing = join(tmpdir(), `whet-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => runFmGet("fm_x", { cwd: missing, agent: AGENT }),
    /does not exist/,
  );
});

test("fm get: throws when agent is absent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => runFmGet("fm_x", { cwd, agent: AGENT }),
    /no such agent/,
  );
});

test("fm get: throws when --agent is missing", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await assert.rejects(
    () => runFmGet("fm_x", { cwd }),
    /--agent <name> is required.*alpha/s,
  );
});

test("fm get: failure modes in one agent are not visible to another", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await runInit({ cwd, agent: "beta" });

  await writeFile(
    join(agentRoot(cwd, "alpha"), "failure_modes.json"),
    fmsJson([{ id: "fm_only_alpha" }]),
    "utf8",
  );

  const inAlpha = await runFmGet("fm_only_alpha", { cwd, agent: "alpha" });
  assert.ok(inAlpha.failureMode);

  const inBeta = await runFmGet("fm_only_alpha", { cwd, agent: "beta" });
  assert.equal(inBeta.failureMode, null);
});

test("formatFmText: not found", () => {
  const out = formatFmText({ failureMode: null });
  assert.match(out, /not found/);
});

test("formatFmText: found prints id", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }]),
    "utf8",
  );

  const result = await runFmGet("fm_alpha", { cwd, agent: AGENT });
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

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsJson([{ id: "fm_alpha" }]),
    "utf8",
  );

  const result = await runFmGet("fm_alpha", { cwd, agent: AGENT });
  const out = JSON.parse(formatFmJson(result));
  assert.equal(out.found, true);
  assert.equal(out.failureMode.id, "fm_alpha");
});
