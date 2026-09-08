
import type { BeforeImage } from "./capture.ts";
import type { ParsedStatement } from "./parse.ts";

export function connectorFacts(statement: ParsedStatement, capture: BeforeImage): Record<string, string> {
  return {
    "pg.capture.before_image": capture.rows.length > 0 || (statement.type !== "update" && statement.type !== "delete") ? "true" : "false",
    "pg.cascade.traversed": capture.cascadeTables.length > 0 ? "true" : "false",
  };
}
