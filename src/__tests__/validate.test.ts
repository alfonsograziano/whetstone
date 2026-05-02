import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInit } from "../commands/init.ts";
import {
  reportJson,
  reportText,
  runValidate,
  type ValidationIssue,
} from "../commands/validate.ts";

async function makeTmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "whetstone-validate-"));
}

const AGENT = "test-agent";

interface TraceShape {
  id: string;
  input?: string;
  output?: string;
  feedback?: Array<{
    sentiment: "positive" | "negative";
    source: "user" | "sme" | "other";
    comment: string;
  }>;
  failureModeIds?: string[];
  analysis?: { status: "pending" | "analyzed" | "skipped" | "error" };
}

function traceLine(t: TraceShape): string {
  return `${JSON.stringify({
    id: t.id,
    input: t.input ?? "test input",
    output: t.output ?? "test output",
    feedback: t.feedback ?? [],
    originalTraceFile: "original/placeholder.json",
    failureModeIds: t.failureModeIds ?? [],
    analysis: t.analysis ?? { status: "analyzed" },
  })}\n`;
}

interface FmShape {
  id: string;
  status?: string;
  affectedTraces?: Array<{ filename: string; traceId: string }>;
}

function fmsFile(fms: FmShape[]): string {
  return `${JSON.stringify(
    {
      failureModes: fms.map((fm) => ({
        id: fm.id,
        title: `title for ${fm.id}`,
        description: `description for ${fm.id}`,
        status: fm.status ?? "investigating",
        tags: [],
        affectedTraces: fm.affectedTraces ?? [],
      })),
    },
    null,
    2,
  )}\n`;
}

function findCodes(issues: ValidationIssue[], code: string): ValidationIssue[] {
  return issues.filter((i) => i.code === code);
}

function agentRoot(cwd: string): string {
  return join(cwd, "whetstone", AGENT);
}

test("clean tree from runInit passes validation", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  const report = await runValidate({ cwd, agent: AGENT });

  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
  assert.equal(report.summary.issueCount, 0);
});

test("missing agent directory rejects with 'no such agent'", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => runValidate({ cwd, agent: AGENT }),
    /no such agent/,
  );
});

test("missing --agent rejects with the list of available agents", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await runInit({ cwd, agent: "beta" });

  await assert.rejects(
    () => runValidate({ cwd }),
    /--agent <name> is required.*alpha.*beta/s,
  );
});

test("missing required file reports WHET_STRUCT_MISSING per file", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await rm(join(agentRoot(cwd), "whetstone.config.md"));

  const report = await runValidate({ cwd, agent: AGENT });
  const missing = findCodes(report.issues, "WHET_STRUCT_MISSING");

  assert.equal(report.ok, false);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.file, "whetstone.config.md");
});

test("missing subdir reports WHET_STRUCT_MISSING", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await rm(join(agentRoot(cwd), "adapters"), {
    recursive: true,
    force: true,
  });

  const report = await runValidate({ cwd, agent: AGENT });
  const missing = findCodes(report.issues, "WHET_STRUCT_MISSING");

  assert.equal(missing.length, 1);
  assert.equal(missing[0]!.file, "adapters/");
});

test("malformed failure_modes.json reports WHET_PARSE_FAILURE_MODES", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    "{ this is not json",
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(report.issues, "WHET_PARSE_FAILURE_MODES");

  assert.equal(issues.length, 1);
  assert.match(issues[0]!.hint, /jq/);
});

test("schema error in failure_modes.json reports WHET_SCHEMA_FAILURE_MODES", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    JSON.stringify({
      failureModes: [
        {
          id: "fm_x",
          title: "t",
          description: "d",
          status: "not_a_real_status",
        },
      ],
    }),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(report.issues, "WHET_SCHEMA_FAILURE_MODES");

  assert.ok(issues.length >= 1);
  assert.equal(issues[0]!.file, "failure_modes.json");
  assert.match(issues[0]!.hint, /failure-mode\.ts/);
});

test("malformed trace line reports WHET_PARSE_TRACE with line number, doesn't abort the file", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  const path = join(agentRoot(cwd), "traces", "test.jsonl");
  const contents =
    traceLine({ id: "trc_ok_1" }) +
    "{ this is broken\n" +
    traceLine({ id: "trc_ok_2" });
  await writeFile(path, contents, "utf8");

  const report = await runValidate({ cwd, agent: AGENT });
  const parseIssues = findCodes(report.issues, "WHET_PARSE_TRACE");

  assert.equal(parseIssues.length, 1);
  assert.equal(parseIssues[0]!.line, 2);
  assert.equal(parseIssues[0]!.file, "traces/test.jsonl");
});

test("schema error in trace reports WHET_SCHEMA_TRACE with line number", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  const path = join(agentRoot(cwd), "traces", "bad.jsonl");
  await writeFile(
    path,
    `${JSON.stringify({
      id: "trc_1",
      input: "i",
      output: "o",
      feedback: [],
      originalTrace: {},
      failureModeIds: [],
      analysis: { status: "wat" },
    })}\n`,
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(report.issues, "WHET_SCHEMA_TRACE");

  assert.ok(issues.length >= 1);
  assert.equal(issues[0]!.line, 1);
  assert.equal(issues[0]!.file, "traces/bad.jsonl");
});

test("duplicate failure-mode ids report WHET_FM_DUPLICATE_ID", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([{ id: "fm_dup" }, { id: "fm_dup" }]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const dups = findCodes(report.issues, "WHET_FM_DUPLICATE_ID");

  assert.equal(dups.length, 1);
  assert.match(dups[0]!.message, /fm_dup/);
});

test("missing trace file referenced by FM reports WHET_FM_MISSING_TRACE_FILE", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([
      {
        id: "fm_a",
        affectedTraces: [{ filename: "ghost.jsonl", traceId: "trc_x" }],
      },
    ]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(report.issues, "WHET_FM_MISSING_TRACE_FILE");

  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /ghost\.jsonl/);
});

test("missing trace id in existing file reports WHET_FM_MISSING_TRACE_ID", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "real.jsonl"),
    traceLine({ id: "trc_present", failureModeIds: ["fm_a"] }),
    "utf8",
  );
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([
      {
        id: "fm_a",
        affectedTraces: [
          { filename: "real.jsonl", traceId: "trc_typo" },
          { filename: "real.jsonl", traceId: "trc_present" },
        ],
      },
    ]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(report.issues, "WHET_FM_MISSING_TRACE_ID");

  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /trc_typo/);
});

test("missing backlink reports WHET_FM_BACKLINK_MISSING", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "t.jsonl"),
    traceLine({ id: "trc_1", failureModeIds: [] }),
    "utf8",
  );
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([
      {
        id: "fm_a",
        affectedTraces: [{ filename: "t.jsonl", traceId: "trc_1" }],
      },
    ]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(report.issues, "WHET_FM_BACKLINK_MISSING");

  assert.equal(issues.length, 1);
  assert.match(issues[0]!.hint, /failureModeIds/);
});

test("duplicate (filename, traceId) on a FM reports WHET_FM_DUPLICATE_AFFECTED_TRACE", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "t.jsonl"),
    traceLine({ id: "trc_1", failureModeIds: ["fm_a"] }),
    "utf8",
  );
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([
      {
        id: "fm_a",
        affectedTraces: [
          { filename: "t.jsonl", traceId: "trc_1" },
          { filename: "t.jsonl", traceId: "trc_1" },
        ],
      },
    ]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(
    report.issues,
    "WHET_FM_DUPLICATE_AFFECTED_TRACE",
  );

  assert.equal(issues.length, 1);
});

test("dangling failureModeIds[] on a trace reports WHET_TRACE_DANGLING_FM_REF", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "t.jsonl"),
    traceLine({ id: "trc_1", failureModeIds: ["fm_ghost"] }),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const issues = findCodes(report.issues, "WHET_TRACE_DANGLING_FM_REF");

  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /fm_ghost/);
});

test("clean bidirectional FM ↔ trace pair passes", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "t.jsonl"),
    traceLine({ id: "trc_1", failureModeIds: ["fm_a"] }),
    "utf8",
  );
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([
      {
        id: "fm_a",
        affectedTraces: [{ filename: "t.jsonl", traceId: "trc_1" }],
      },
    ]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
});

test("unparseable trace file does not produce noisy invariant errors against itself", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "traces", "broken.jsonl"),
    "{ totally bad\n",
    "utf8",
  );
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([
      {
        id: "fm_a",
        affectedTraces: [
          { filename: "broken.jsonl", traceId: "trc_anything" },
        ],
      },
    ]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  assert.ok(findCodes(report.issues, "WHET_PARSE_TRACE").length === 1);
  assert.equal(findCodes(report.issues, "WHET_FM_MISSING_TRACE_ID").length, 0);
  assert.equal(findCodes(report.issues, "WHET_FM_BACKLINK_MISSING").length, 0);
});

test("reportJson emits stable parsable shape", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([{ id: "fm_dup" }, { id: "fm_dup" }]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const parsed = JSON.parse(reportJson(report));

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.summary.issueCount, "number");
  assert.equal(typeof parsed.summary.fileCount, "number");
  assert.ok(Array.isArray(parsed.issues));
  assert.equal(parsed.issues[0].code, "WHET_FM_DUPLICATE_ID");
});

test("reportText surfaces the code and hint for every issue", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  await writeFile(
    join(agentRoot(cwd), "failure_modes.json"),
    fmsFile([{ id: "fm_dup" }, { id: "fm_dup" }]),
    "utf8",
  );

  const report = await runValidate({ cwd, agent: AGENT });
  const stripped = reportText(report).replace(
    // eslint-disable-next-line no-control-regex
    /\[[0-9;]*m/g,
    "",
  );

  assert.match(stripped, /WHET_FM_DUPLICATE_ID/);
  assert.match(stripped, /Hint: /);
  assert.match(stripped, /Validation failed/);
});

test("runValidate rejects --cwd that does not exist", async () => {
  const missing = join(tmpdir(), `whet-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => runValidate({ cwd: missing, agent: AGENT }),
    /does not exist/,
  );
});

test("two agents validated independently — issues in one don't surface in the other", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await runInit({ cwd, agent: "beta" });

  // Corrupt only beta's failure_modes.json.
  await writeFile(
    join(cwd, "whetstone", "beta", "failure_modes.json"),
    "{ broken json",
    "utf8",
  );

  const alphaReport = await runValidate({ cwd, agent: "alpha" });
  assert.equal(alphaReport.ok, true);

  const betaReport = await runValidate({ cwd, agent: "beta" });
  assert.equal(betaReport.ok, false);
  assert.ok(findCodes(betaReport.issues, "WHET_PARSE_FAILURE_MODES").length === 1);
});
