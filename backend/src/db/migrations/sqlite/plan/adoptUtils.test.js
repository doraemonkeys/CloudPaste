import test from "node:test";
import assert from "node:assert/strict";

import { APP_SCHEMA_VERSION, computeAdoptPlan, getExistingAppTables } from "./adoptUtils.js";

test("computeAdoptPlan squashes only truly fresh databases", () => {
  const plan = computeAdoptPlan({
    legacyVersion: 0,
    hasAppTables: false,
    appSchemaVersion: APP_SCHEMA_VERSION,
  });

  assert.equal(plan.shouldSquashToLatest, true);
  assert.equal(plan.capVersion, APP_SCHEMA_VERSION);
});

test("computeAdoptPlan preserves migration replay when app tables already exist", () => {
  const plan = computeAdoptPlan({
    legacyVersion: 0,
    hasAppTables: true,
    appSchemaVersion: APP_SCHEMA_VERSION,
  });

  assert.equal(plan.shouldSquashToLatest, false);
  assert.equal(plan.capVersion, 0);
});

test("computeAdoptPlan respects imported legacy schema version", () => {
  const plan = computeAdoptPlan({
    legacyVersion: 21,
    hasAppTables: true,
    appSchemaVersion: APP_SCHEMA_VERSION,
  });

  assert.equal(plan.shouldSquashToLatest, false);
  assert.equal(plan.capVersion, 21);
});

test("getExistingAppTables excludes schema_migrations from app table detection", () => {
  const tables = new Set(["schema_migrations", "pastes", "admins"]);
  const existingAppTables = getExistingAppTables(tables);

  assert.deepEqual(existingAppTables.sort(), ["admins", "pastes"]);
});
