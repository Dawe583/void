
import SqlParser from "node-sql-parser";

const { Parser } = SqlParser;

export type StatementKind = "update" | "delete" | "insert" | "truncate" | "drop" | "other";

export type ParsedStatement = {
  readonly sql: string;
  readonly type: StatementKind;
  readonly tables: readonly string[];
  readonly predicate: string | null;
  readonly returning: boolean;
  readonly updatedValues: Readonly<Record<string, unknown>>;
};

export class ParseError extends Error {
  readonly kind = "ParseFailed" as const;
  readonly connector = "postgres" as const;
  readonly call = undefined;
  readonly retryable = false;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(sql: string, cause: unknown) {
    super("Postgres SQL parse failed");
    this.name = "ParseError";
    this.details = { sql, cause: cause instanceof Error ? cause.message : String(cause) };
  }
}

const parser = new Parser();

export function parseStatement(sql: string): ParsedStatement {
  let ast: unknown;
  try {
    ast = parser.astify(sql, { database: "Postgresql" });
  } catch (error) {
    throw new ParseError(sql, error);
  }

  const node = Array.isArray(ast) ? ast[0] : ast;
  if (!isRecord(node)) return { sql, type: "other", tables: [], predicate: null, returning: false, updatedValues: {} };

  const rawType = typeof node.type === "string" ? node.type.toLowerCase() : "other";
  const type = statementKind(rawType);
  return {
    sql,
    type,
    tables: extractTables(sql, type, node),
    predicate: expressionSql(node.where),
    returning: node.returning !== undefined && node.returning !== null,
    updatedValues: extractUpdatedValues(node),
  };
}

function statementKind(type: string): StatementKind {
  if (type === "update" || type === "delete" || type === "insert" || type === "truncate" || type === "drop") return type;
  return "other";
}

function extractTables(sql: string, type: StatementKind, node: Record<string, unknown>): string[] {
  const names = parser.tableList(sql, { database: "Postgresql" })
    .map((entry: string) => parseTableListEntry(entry))
    .filter((entry: TableListEntry): boolean => type === "other" || entry.action.toLowerCase() === type || entry.action.toLowerCase() === "drop")
    .map((entry: TableListEntry): string => entry.schema === null ? entry.table : `${entry.schema}.${entry.table}`);
  if (names.length > 0) return [...new Set(names)];

  const fallback = node.name ?? node.table;
  const extracted = tablesFromAstValue(fallback);
  return [...new Set(extracted)];
}

type TableListEntry = { readonly action: string; readonly schema: string | null; readonly table: string };

function parseTableListEntry(entry: string): TableListEntry {
  const [action, schema, table] = entry.split("::");
  return { action: action ?? "", schema: schema === undefined || schema === "null" ? null : schema, table: table ?? entry };
}

function tablesFromAstValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(tablesFromAstValue);
  if (!isRecord(value)) return [];
  if (typeof value.table !== "string") return [];
  const schema = typeof value.db === "string" ? value.db : typeof value.schema === "string" ? value.schema : null;
  return [schema === null ? value.table : `${schema}.${value.table}`];
}

function expressionSql(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return normalizePredicate(parser.exprToSQL(value, { database: "Postgresql" }));
  } catch {
    return JSON.stringify(value);
  }
}

function normalizePredicate(value: string): string {
  return value.replaceAll('"', "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}


function extractUpdatedValues(node: Record<string, unknown>): Readonly<Record<string, unknown>> {
  if (!Array.isArray(node.set)) return {};
  const values: Record<string, unknown> = {};
  for (const item of node.set) {
    if (!isRecord(item) || !isRecord(item.column) || !isRecord(item.value)) continue;
    const column = columnValue(item.column);
    if (column !== null) values[column] = literalValue(item.value);
  }
  return values;
}

function columnValue(value: Record<string, unknown>): string | null {
  if (typeof value.value === "string") return value.value;
  if (isRecord(value.expr) && typeof value.expr.value === "string") return value.expr.value;
  return null;
}

function literalValue(value: Record<string, unknown>): unknown {
  if ("value" in value) return value.value;
  return null;
}
