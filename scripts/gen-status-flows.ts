import { writeFileSync } from "node:fs";

import { FLOWS, renderStatusFlows } from "./lib/status-flows";

/**
 * Generates docs/status-flows.md from the transition maps in code, the same
 * way docs/permissions.md is generated from the permission matrix. Run
 * `npm run gen:status-flows` after changing any `*_TRANSITIONS` map.
 */
writeFileSync("docs/status-flows.md", renderStatusFlows(), "utf8");
console.log(`docs/status-flows.md written: ${FLOWS.length} status machines.`);
