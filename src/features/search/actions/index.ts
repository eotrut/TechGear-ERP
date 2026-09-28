"use server";

import { authorizeAction } from "@/lib/rbac/guard";

import { paletteSearch } from "../queries";
import { paletteSearchSchema, type PaletteRecord } from "../schemas";
import { MIN_RECORD_QUERY } from "../services/palette-rules";

/**
 * The palette's record search. Every role can open the palette, so the gate is
 * the dashboard permission every role holds; each group of results is then
 * filtered by the role's own permissions inside the query.
 */
export async function paletteSearchAction(input: unknown): Promise<PaletteRecord[]> {
  const { user } = await authorizeAction("dashboard.view");
  const parsed = paletteSearchSchema.safeParse(input);
  if (!parsed.success || parsed.data.query.length < MIN_RECORD_QUERY) return [];
  return paletteSearch(parsed.data.query, user.role);
}
