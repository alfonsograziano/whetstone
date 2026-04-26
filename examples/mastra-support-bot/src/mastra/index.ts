import { Mastra } from "@mastra/core";
import { MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { Observability, DefaultExporter } from "@mastra/observability";
import { supportAgent } from "./agents/support-agent";

// LibSQL covers everything except observability. DuckDB owns the
// observability domain because it's the only embedded store that
// implements feedback persistence (LibSQL throws on createFeedback).
const storage = new MastraCompositeStore({
  id: "support-bot-storage",
  default: new LibSQLStore({
    id: "libsql-storage",
    url: "file:./mastra.db",
  }),
  domains: {
    observability: new DuckDBStore({ path: "./mastra-observability.duckdb" })
      .observability,
  },
});

export const mastra = new Mastra({
  agents: { supportAgent },
  storage,
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra-support-bot",
        exporters: [new DefaultExporter()],
      },
    },
  }),
});
