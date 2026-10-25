// Run in a separate process so each ranking profile uses its own configuration.
const assert = require('node:assert/strict');
const historical = require('./nearby-v2.13.3.json');
const { pool } = require('../../dist/utils/db');
const { buildNearbyCursorQuery, default: Location } = require('../../dist/models/location.model');

const mode = process.env.RANKING_MODE;
const reference = new Date();
const center = { lat: 35.6892, lng: 51.389 };
const cases = [
  { radius: 10000, exclude: undefined },
  { radius: 1000, exclude: 'fixture_1' },
  { radius: 1, exclude: undefined },
];

const nodes = (node) => [node, ...(node.Plans ?? []).flatMap(nodes)];
const mapped = (rows) => rows.map((r) => ({
  userId: r.user_id, coordinate: { lat: r.lat, lng: r.lng }, distance: r.distance,
  updatedAt: r.updated_at, score: r.score,
}));

(async () => {
  try {
    // now() and every score remain identical across old/new queries.
    await pool.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const { radius, exclude } of cases) {
      const firstQuery = buildNearbyCursorQuery(center.lat, center.lng, radius, 5, undefined, undefined, exclude, reference);
      const baseline = await pool.query(historical[mode].cursor, firstQuery.values);
      const optimized = await pool.query(firstQuery.query, firstQuery.values);
      assert.deepEqual(optimized.rows, baseline.rows, `${mode}: first-page values/order/count`);

      if (baseline.rows.length > 5) {
        const last = baseline.rows[4];
        const total = Number(last.total_count);
        const nextQuery = buildNearbyCursorQuery(center.lat, center.lng, radius, 5, last.score, last.user_id, exclude, reference, total);
        const oldNext = historical[mode].cursor.replace('(SELECT COUNT(*) FROM ranked)', '$14::bigint');
        assert.deepEqual((await pool.query(nextQuery.query, nextQuery.values)).rows,
          (await pool.query(oldNext, nextQuery.values)).rows, `${mode}: next-page values/order/count`);
        const plan = await pool.query(`EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) ${nextQuery.query}`, nextQuery.values);
        verifyPlan(plan.rows[0]['QUERY PLAN'][0].Plan, 6);
      }

      for (const skip of [0, 5, 1000]) {
        const values = [center.lng, center.lat, radius, skip, 5, 7, exclude ?? null,
          mode === 'decay' ? reference.toISOString() : null, 2000, 60, 0.65, 0.35];
        const oldPage = await pool.query(historical[mode].offset, values);
        const page = await Location.findNearby(center.lat, center.lng, radius, skip, 5, exclude, reference);
        assert.deepEqual(page.data, mapped(oldPage.rows), `${mode}: offset ${skip} values/order`);
        assert.equal(page.totalCount, Number(baseline.rows[0]?.total_count ?? 0), `${mode}: offset ${skip} total`);
      }

      const plan = await pool.query(`EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON) ${firstQuery.query}`, firstQuery.values);
      verifyPlan(plan.rows[0]['QUERY PLAN'][0].Plan, 6);
    }
    await pool.query('ROLLBACK');
  } finally { await pool.end(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

function verifyPlan(root, pageRows) {
  const planNodes = nodes(root);
  const distanceExpressions = planNodes.flatMap((n) => n.Output ?? [])
    .reduce((count, expression) => count + (expression.match(/st_distance\(/gi)?.length ?? 0), 0);
  assert.equal(distanceExpressions, 1, `${mode}: geodesic distance has one physical expression`);
  for (const node of planNodes) {
    if ((node.Output ?? []).some((expression) => /st_[xy]\(/i.test(expression))) {
      assert.ok(node['Actual Rows'] <= pageRows, `${mode}: coordinates are projected only for the page`);
    }
  }
}
