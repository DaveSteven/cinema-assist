import type { DatabaseSync } from "node:sqlite";
import type { WatchRule, WatchRuleInput } from "../domain/watch-rule.js";

type WatchRuleRow = {
  id: string;
  enabled: number;
  theater_code: string;
  movie_title_pattern: string;
  target_date: string;
  format_includes: string;
  format_excludes: string;
  start_time_from: string | null;
  start_time_to: string | null;
  ticket_count: number;
  require_adjacent: number;
  preferred_rows: string | null;
  excluded_rows: string | null;
  preferred_seat_numbers: string | null;
  allowed_seat_types: string;
  excluded_seat_types: string;
  max_surcharge_yen: number;
  aisle_preference: string;
  mode: string;
  member_tier: string;
  sale_opens_at_override: string | null;
  last_state: string | null;
  last_notification_key: string | null;
  created_at: string;
  updated_at: string;
};

export type WatchRuntimeState = {
  lastState?: string;
  lastNotificationKey?: string;
};

export type WatchEvent = {
  ruleId: string;
  state: string;
  performanceId?: string;
  detail?: string;
};

function parseJsonArray<T>(value: string | null): T[] | undefined {
  if (value === null) return undefined;
  return JSON.parse(value) as T[];
}

function rowToRule(row: WatchRuleRow): WatchRule {
  const preferredRows = parseJsonArray<string>(row.preferred_rows);
  const excludedRows = parseJsonArray<string>(row.excluded_rows);
  const preferredSeatNumbers = parseJsonArray<number>(row.preferred_seat_numbers);

  return {
    id: row.id,
    enabled: row.enabled === 1,
    theaterCode: row.theater_code as WatchRule["theaterCode"],
    movieTitlePattern: row.movie_title_pattern,
    targetDate: row.target_date,
    formatIncludes: parseJsonArray<string>(row.format_includes) ?? [],
    formatExcludes: parseJsonArray<string>(row.format_excludes) ?? [],
    ...(row.start_time_from !== null ? { startTimeFrom: row.start_time_from } : {}),
    ...(row.start_time_to !== null ? { startTimeTo: row.start_time_to } : {}),
    ticketCount: row.ticket_count,
    requireAdjacent: row.require_adjacent === 1,
    ...(preferredRows !== undefined ? { preferredRows } : {}),
    ...(excludedRows !== undefined ? { excludedRows } : {}),
    ...(preferredSeatNumbers !== undefined ? { preferredSeatNumbers } : {}),
    allowedSeatTypes: parseJsonArray<string>(row.allowed_seat_types) ?? ["standard"],
    excludedSeatTypes: parseJsonArray<string>(row.excluded_seat_types) ?? [],
    maxSurchargeYen: row.max_surcharge_yen,
    aislePreference: row.aisle_preference as WatchRule["aislePreference"],
    mode: row.mode as WatchRule["mode"],
    memberTier: row.member_tier as WatchRule["memberTier"],
    ...(row.sale_opens_at_override !== null
      ? { saleOpensAtOverride: row.sale_opens_at_override }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WatchRuleRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: WatchRuleInput & { id: string }, now: Date = new Date()): WatchRule {
    const timestamp = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO watch_rules (
          id, enabled, theater_code, movie_title_pattern, target_date,
          format_includes, format_excludes, start_time_from, start_time_to,
          ticket_count, require_adjacent, preferred_rows, excluded_rows,
          preferred_seat_numbers, allowed_seat_types, excluded_seat_types,
          max_surcharge_yen, aisle_preference, mode, member_tier,
          sale_opens_at_override, created_at, updated_at
        ) VALUES (
          @id, 1, @theaterCode, @movieTitlePattern, @targetDate,
          @formatIncludes, @formatExcludes, @startTimeFrom, @startTimeTo,
          @ticketCount, @requireAdjacent, @preferredRows, @excludedRows,
          @preferredSeatNumbers, @allowedSeatTypes, @excludedSeatTypes,
          @maxSurchargeYen, @aislePreference, @mode, @memberTier,
          @saleOpensAtOverride, @createdAt, @updatedAt
        )`,
      )
      .run({
        id: input.id,
        theaterCode: input.theaterCode,
        movieTitlePattern: input.movieTitlePattern,
        targetDate: input.targetDate,
        formatIncludes: JSON.stringify(input.formatIncludes),
        formatExcludes: JSON.stringify(input.formatExcludes),
        startTimeFrom: input.startTimeFrom ?? null,
        startTimeTo: input.startTimeTo ?? null,
        ticketCount: input.ticketCount,
        requireAdjacent: input.requireAdjacent ? 1 : 0,
        preferredRows:
          input.preferredRows !== undefined ? JSON.stringify(input.preferredRows) : null,
        excludedRows: input.excludedRows !== undefined ? JSON.stringify(input.excludedRows) : null,
        preferredSeatNumbers:
          input.preferredSeatNumbers !== undefined
            ? JSON.stringify(input.preferredSeatNumbers)
            : null,
        allowedSeatTypes: JSON.stringify(input.allowedSeatTypes),
        excludedSeatTypes: JSON.stringify(input.excludedSeatTypes),
        maxSurchargeYen: input.maxSurchargeYen,
        aislePreference: input.aislePreference,
        mode: input.mode,
        memberTier: input.memberTier,
        saleOpensAtOverride: input.saleOpensAtOverride ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const created = this.get(input.id);
    if (created === undefined) {
      throw new Error(`Failed to read back created watch rule ${input.id}`);
    }
    return created;
  }

  get(id: string): WatchRule | undefined {
    const row = this.db.prepare("SELECT * FROM watch_rules WHERE id = ?").get(id) as
      | WatchRuleRow
      | undefined;
    return row === undefined ? undefined : rowToRule(row);
  }

  list(): WatchRule[] {
    const rows = this.db
      .prepare("SELECT * FROM watch_rules ORDER BY created_at ASC")
      .all() as WatchRuleRow[];
    return rows.map(rowToRule);
  }

  setEnabled(id: string, enabled: boolean, now: Date = new Date()): boolean {
    const result = this.db
      .prepare("UPDATE watch_rules SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, now.toISOString(), id);
    return result.changes > 0;
  }

  remove(id: string): boolean {
    const result = this.db.prepare("DELETE FROM watch_rules WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getRuntimeState(
    id: string,
  ): { lastState: string | null; lastNotificationKey: string | null } | undefined {
    return this.db
      .prepare(
        "SELECT last_state AS lastState, last_notification_key AS lastNotificationKey FROM watch_rules WHERE id = ?",
      )
      .get(id) as { lastState: string | null; lastNotificationKey: string | null } | undefined;
  }

  setRuntimeState(id: string, state: WatchRuntimeState): void {
    const assignments: string[] = [];
    const params: Record<string, string> = { id };
    if (state.lastState !== undefined) {
      assignments.push("last_state = @lastState");
      params.lastState = state.lastState;
    }
    if (state.lastNotificationKey !== undefined) {
      assignments.push("last_notification_key = @lastNotificationKey");
      params.lastNotificationKey = state.lastNotificationKey;
    }
    if (assignments.length === 0) return;
    this.db.prepare(`UPDATE watch_rules SET ${assignments.join(", ")} WHERE id = @id`).run(params);
  }

  appendEvent(event: WatchEvent, now: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO watch_events (rule_id, at, state, performance_id, detail)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        event.ruleId,
        now.toISOString(),
        event.state,
        event.performanceId ?? null,
        event.detail ?? null,
      );
  }

  listEvents(
    ruleId: string,
  ): { state: string; performanceId: string | null; detail: string | null }[] {
    const rows = this.db
      .prepare(
        "SELECT state, performance_id AS performanceId, detail FROM watch_events WHERE rule_id = ? ORDER BY id ASC",
      )
      .all(ruleId) as { state: string; performanceId: string | null; detail: string | null }[];
    return rows.map((row) => ({
      state: row.state,
      performanceId: row.performanceId,
      detail: row.detail,
    }));
  }
}
