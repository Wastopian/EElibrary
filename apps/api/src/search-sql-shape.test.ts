/**
 * File header: Structural tests that lock in the index-friendly shape of the catalog search SQL.
 *
 * pg-mem cannot exercise pg_trgm GIN indexes, so EXPLAIN-based plan tests aren't feasible in
 * the unit suite. Instead these tests assert that the generated WHERE clauses keep the patterns
 * that are required for the migrations 019/021 indexes to be picked up by PostgreSQL:
 *
 *   - Every LIKE expression wraps the column in `lower(...)` so the functional GIN trigram
 *     indexes (lower(mpn), lower(category), lower(name), lower(provider_part_key), etc.) match.
 *   - The source_records and assets/datasheet branches use non-correlated IN-subqueries so the
 *     planner can pre-filter on the trigram index once instead of running per-candidate-part
 *     correlated EXISTS lookups.
 *   - Filter parameters (providerPartId, providerUrl, datasheetUrl) use the same IN form.
 *
 * If a future refactor regresses any of these shapes, the indexes silently stop being chosen
 * and search latency falls off a cliff at scale. Asserting the shape catches that immediately.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchSqlFilterForTests } from "./catalog-store";

test("free-text search wraps every LIKE expression in lower() so trigram indexes are usable", () => {
  const filter = buildSearchSqlFilterForTests({ query: "LM358" }, "any");

  // Every LIKE in the WHERE must be preceded by a `lower(...)` expression on the same line —
  // otherwise the functional GIN trigram indexes from migration 019 are not eligible.
  const lines = filter.whereSql.split("\n");
  const likeLines = lines.filter((line) => /\bLIKE\b/u.test(line));

  assert.ok(likeLines.length > 0, "expected the free-text branch to emit LIKE expressions");

  for (const line of likeLines) {
    assert.match(
      line,
      /\blower\b/u,
      `every LIKE expression must wrap its column in lower(...) for trigram-index coverage. Offending line: ${line.trim()}`
    );
  }
});

test("free-text search covers MPN, description, category, manufacturer, package, connector family, source records, and datasheet asset URLs", () => {
  const filter = buildSearchSqlFilterForTests({ query: "LM358" }, "any");

  // These are the columns each migration 019 index protects. Losing any one of them silently
  // narrows search recall, so the SQL must continue to include each lowered LIKE expression.
  for (const expression of [
    "lower(p.mpn)",
    "lower(p.description)",
    "lower(p.category)",
    "lower(m.name)",
    "lower(pk.package_name)",
    "lower(COALESCE(cf.name, ''))",
    "lower(sr.provider_part_key)",
    "lower(COALESCE(sr.source_url, ''))",
    "lower(COALESCE(datasheet_asset.source_url, ''))"
  ]) {
    assert.ok(
      filter.whereSql.includes(expression),
      `expected free-text search WHERE to query ${expression}`
    );
  }
});

test("free-text search keeps phrase matching and adds ANDed token matching for natural engineering queries", () => {
  const filter = buildSearchSqlFilterForTests({ query: "TPS7A02 DBVR" }, "any");

  assert.deepEqual(filter.params.slice(0, 3), ["%tps7a02 dbvr%", "%tps7a02%", "%dbvr%"]);
  assert.match(filter.whereSql, /lower\(p\.mpn\) LIKE \$1/u);
  assert.match(filter.whereSql, /lower\(p\.mpn\) LIKE \$2/u);
  assert.match(filter.whereSql, /lower\(p\.mpn\) LIKE \$3/u);
  assert.match(filter.whereSql, /\$2[\s\S]+AND[\s\S]+\$3/u);
});

test("free-text search adds compact package matching and LDO shorthand alternatives", () => {
  const filter = buildSearchSqlFilterForTests({ query: "SOT23 LDO" }, "any");

  assert.deepEqual(filter.params.slice(0, 4), ["%sot23 ldo%", "%sot23%", "%ldo%", "%linear regulator%"]);
  assert.match(filter.whereSql, /replace\(replace\(replace\(replace\(replace\(lower\(pk\.package_name\)/u);
  assert.match(filter.whereSql, /\$2[\s\S]+AND[\s\S]+\(\([\s\S]+\$3[\s\S]+OR[\s\S]+\$4[\s\S]+\)\)/u);
});

test("source_records and datasheet asset branches use non-correlated IN-subqueries instead of correlated EXISTS", () => {
  const filter = buildSearchSqlFilterForTests({ query: "LM358" }, "any");

  // Correlated EXISTS clauses force the inner LIKE to re-run per candidate part row. The
  // refactor to IN (SELECT part_id FROM ... WHERE part_id IS NOT NULL AND lower(...) LIKE ...)
  // lets the planner compute the inner result once via the trigram GIN index and hash-join
  // back to parts. Asserting on the structural shape pins this so future edits cannot
  // accidentally reintroduce the correlated form.
  assert.match(
    filter.whereSql,
    /p\.id IN \(\s*SELECT sr\.part_id\s+FROM source_records sr\s+WHERE sr\.part_id IS NOT NULL/u,
    "source_records branch must use non-correlated IN-subquery"
  );
  assert.match(
    filter.whereSql,
    /p\.id IN \(\s*SELECT datasheet_asset\.part_id\s+FROM assets datasheet_asset\s+WHERE datasheet_asset\.part_id IS NOT NULL/u,
    "datasheet_asset branch must use non-correlated IN-subquery"
  );
  assert.doesNotMatch(filter.whereSql, /EXISTS \(\s*SELECT 1\s+FROM source_records/u);
  assert.doesNotMatch(filter.whereSql, /EXISTS \(\s*SELECT 1\s+FROM assets datasheet_asset/u);
});

test("provider-part, provider-url, and datasheet-url filters all use non-correlated IN-subqueries", () => {
  const filter = buildSearchSqlFilterForTests(
    { providerPartId: "C1091", providerUrl: "lcsc.com", datasheetUrl: "lcsc_datasheet" },
    "any"
  );

  // Three separate LIKE filters must each appear as p.id IN (SELECT part_id FROM ...).
  const inSubqueryOccurrences = filter.whereSql.match(/p\.id IN \(\s*SELECT/gu) ?? [];
  assert.equal(inSubqueryOccurrences.length, 3, "expected one IN-subquery per part-id LIKE filter");

  assert.match(filter.whereSql, /lower\(sr\.provider_part_key\) LIKE \$/u);
  assert.match(filter.whereSql, /lower\(COALESCE\(sr\.source_url, ''\)\) LIKE \$/u);
  assert.match(filter.whereSql, /lower\(COALESCE\(datasheet_asset\.source_url, ''\)\) LIKE \$/u);
});

test("non-free-text filter clauses use exact equality so b-tree indexes apply", () => {
  const filter = buildSearchSqlFilterForTests(
    {
      manufacturerId: "mfr-search-alpha",
      category: "Connector",
      packageId: "pkg-search-sot23",
      lifecycleStatus: "active"
    },
    "any"
  );

  // These columns are exact-match so they ride b-tree indexes, not trigram.
  // Asserting the equality shape prevents accidental switches to LIKE, which would skip the
  // b-tree index on filtered queries and force the planner into a broader scan.
  assert.match(filter.whereSql, /p\.manufacturer_id = \$\d+/u);
  assert.match(filter.whereSql, /p\.category = \$\d+/u);
  assert.match(filter.whereSql, /p\.package_id = \$\d+/u);
  assert.match(filter.whereSql, /p\.lifecycle_status = \$\d+/u);
});
