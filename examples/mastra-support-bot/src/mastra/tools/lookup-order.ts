import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const FAKE_ORDERS: Record<
  string,
  { orderDate: string; status: string; total: number }
> = {
  "4421": { orderDate: "2026-04-10", status: "in_transit", total: 42.0 },
  "5510": { orderDate: "2025-12-10", status: "delivered", total: 89.5 },
  "6730": { orderDate: "2026-04-22", status: "delivered", total: 31.99 },
};

export const lookupOrderTool = createTool({
  id: "lookup_order",
  description: "Look up an order's date, status, and total by order ID.",
  inputSchema: z.object({
    orderId: z.string().describe("The order ID, e.g. '4421'"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    orderDate: z.string().optional(),
    status: z.string().optional(),
    total: z.number().optional(),
  }),
  execute: async ({ context }) => {
    const order = FAKE_ORDERS[context.orderId];
    if (!order) return { found: false };
    return { found: true, ...order };
  },
});
