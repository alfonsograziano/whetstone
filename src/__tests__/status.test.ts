import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInit } from "../commands/init.ts";
import {
  reportJson,
  reportText,
  runStatus,
} from "../commands/status.ts";

async function makeTmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "whetstone-status-"));
}

interface FmShape {
  id: string;
  status?: string;
  title?: string;
  lastUpdated?: string | null;
  affectedTraces?: Array<{ filename: string; traceId: string }>;
}

async function writeFms(cwd: string, fms: FmShape[]): Promise<void> {
  const body = JSON.stringify(
    {
      failureModes: fms.map((fm) => ({
        id: fm.id,
        title: fm.title ?? `title for ${fm.id}`,
        description: `description for ${fm.id}`,
        status: fm.status ?? "investigating",
        tags: [],
        lastUpdated: fm.lastUpdated ?? null,
        affectedTraces: fm.affectedTraces ?? [],
      })),
    },
    null,
    2,
  );
  await writeFile(join(cwd, "whetstone", "failure_modes.json"), body, "utf8");
}

interface TraceShape {
  id: string;
  pending?: boolean;
}

async function writeTraces(
  cwd: string,
  filename: string,
  traces: TraceShape[],
): Promise<void> {
  const body = traces
    .map((t) =>
      JSON.stringify({
        id: t.id,
        input: "in",
        output: "out",
        feedback: [],
        originalTrace: {},
        failureModeIds: [],
        analysis: { status: t.pending ? "pending" : "analyzed" },
      }),
    )
    .join("\n");
  await writeFile(join(cwd, "whetstone", "traces", filename), `${body}\n`, "utf8");
}

test("empty catalogue from runInit reports zero failure modes", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  const report = await runStatus({ cwd });

  assert.equal(report.catalogue.totalFailureModes, 0);
  assert.deepEqual(report.catalogue.byStatus, {});
  assert.deepEqual(report.catalogue.recentlyUpdated, []);
  assert.deepEqual(report.catalogue.specsAwaitingApproval, []);
  assert.equal(report.traces.fileCount, 0);
  assert.equal(report.traces.pendingCount, 0);
});

test("counts failure modes by status, ordered by lifecycle", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFms(cwd, [
    { id: "fm_a", status: "investigating" },
    { id: "fm_b", status: "investigating" },
    { id: "fm_c", status: "verified" },
    { id: "fm_d", status: "discovered" },
    { id: "fm_e", status: "spec_drafted" },
    { id: "fm_f", status: "duplicate_of:fm_a" },
  ]);

  const report = await runStatus({ cwd });

  assert.equal(report.catalogue.totalFailureModes, 6);
  assert.deepEqual(report.catalogue.byStatus, {
    discovered: 1,
    investigating: 2,
    spec_drafted: 1,
    verified: 1,
    duplicate_of: 1,
  });

  // Lifecycle order: discovered before investigating before spec_drafted before
  // verified before duplicate_of.
  assert.deepEqual(Object.keys(report.catalogue.byStatus), [
    "discovered",
    "investigating",
    "spec_drafted",
    "verified",
    "duplicate_of",
  ]);
});

test("recentlyUpdated is sorted by lastUpdated desc, capped at 5", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFms(cwd, [
    { id: "fm_old", lastUpdated: "2026-01-01T00:00:00Z" },
    { id: "fm_mid", lastUpdated: "2026-03-01T00:00:00Z" },
    { id: "fm_new", lastUpdated: "2026-04-01T00:00:00Z" },
    { id: "fm_a", lastUpdated: "2026-04-26T10:00:00Z" },
    { id: "fm_b", lastUpdated: "2026-04-26T11:00:00Z" },
    { id: "fm_c", lastUpdated: "2026-04-26T12:00:00Z" },
    { id: "fm_null", lastUpdated: null },
  ]);

  const report = await runStatus({ cwd });

  const ids = report.catalogue.recentlyUpdated.map((s) => s.id);
  assert.deepEqual(ids, ["fm_c", "fm_b", "fm_a", "fm_new", "fm_mid"]);
});

test("specsAwaitingApproval contains every spec_drafted FM", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFms(cwd, [
    { id: "fm_x", status: "spec_drafted", lastUpdated: "2026-04-20T00:00:00Z" },
    { id: "fm_y", status: "investigating" },
    { id: "fm_z", status: "spec_drafted", lastUpdated: "2026-04-25T00:00:00Z" },
  ]);

  const report = await runStatus({ cwd });

  assert.equal(report.catalogue.specsAwaitingApproval.length, 2);
  // Sorted by recency too — fm_z is newer.
  assert.equal(report.catalogue.specsAwaitingApproval[0]!.id, "fm_z");
  assert.equal(report.catalogue.specsAwaitingApproval[1]!.id, "fm_x");
});

test("trace files report total + pending counts; malformed lines are ignored", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeTraces(cwd, "a.jsonl", [
    { id: "t1", pending: true },
    { id: "t2", pending: false },
    { id: "t3", pending: true },
  ]);
  await writeTraces(cwd, "b.jsonl", [{ id: "t4", pending: false }]);
  // Add a malformed line to confirm it doesn't blow up.
  await writeFile(
    join(cwd, "whetstone", "traces", "c.jsonl"),
    `{"id":"ok","input":"","output":"","feedback":[],"originalTrace":{},"failureModeIds":[],"analysis":{"status":"pending"}}\n{ this is broken\n`,
    "utf8",
  );

  const report = await runStatus({ cwd });

  assert.equal(report.traces.fileCount, 3);
  assert.equal(report.traces.pendingCount, 3);
  const a = report.traces.perFile.find((f) => f.filename === "a.jsonl")!;
  assert.equal(a.totalTraces, 3);
  assert.equal(a.pendingTraces, 2);
  const b = report.traces.perFile.find((f) => f.filename === "b.jsonl")!;
  assert.equal(b.totalTraces, 1);
  assert.equal(b.pendingTraces, 0);
  const c = report.traces.perFile.find((f) => f.filename === "c.jsonl")!;
  assert.equal(c.totalTraces, 1);
  assert.equal(c.pendingTraces, 1);
});

test("missing whetstone/ throws", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(runStatus({ cwd }), /whetstone\/ directory not found/);
});

test("malformed failure_modes.json throws with hint to validate", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    "{ this is not json",
    "utf8",
  );

  await assert.rejects(runStatus({ cwd }), /whetstone validate/);
});

test("schema-invalid failure_modes.json throws with hint to validate", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFile(
    join(cwd, "whetstone", "failure_modes.json"),
    JSON.stringify({
      failureModes: [
        { id: "fm_x", title: "t", description: "d", status: "not_a_status" },
      ],
    }),
    "utf8",
  );

  await assert.rejects(runStatus({ cwd }), /whetstone validate/);
});

test("text report mentions total, pending, and SPEC count", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFms(cwd, [
    { id: "fm_x", status: "spec_drafted", lastUpdated: "2026-04-20T00:00:00Z" },
    { id: "fm_y", status: "investigating", lastUpdated: "2026-04-21T00:00:00Z" },
  ]);
  await writeTraces(cwd, "a.jsonl", [{ id: "t1", pending: true }]);

  const report = await runStatus({ cwd });
  // strip ANSI to make assertions reliable
  // eslint-disable-next-line no-control-regex
  const text = reportText(report).replace(/\[[0-9;]*m/g, "");

  assert.match(text, /Catalogue: 2 failure modes/);
  assert.match(text, /spec_drafted/);
  assert.match(text, /awaiting approval/);
  assert.match(text, /Traces: 1 file, 1 pending/);
  assert.match(text, /a\.jsonl/);
  assert.match(text, /SPECs awaiting approval: 1/);
});

test("json report is valid JSON with the expected shape", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  await writeFms(cwd, [{ id: "fm_x", lastUpdated: "2026-04-20T00:00:00Z" }]);

  const report = await runStatus({ cwd });
  const json = JSON.parse(reportJson(report)) as {
    catalogue: { totalFailureModes: number };
    traces: { fileCount: number };
  };

  assert.equal(json.catalogue.totalFailureModes, 1);
  assert.equal(json.traces.fileCount, 0);
});
