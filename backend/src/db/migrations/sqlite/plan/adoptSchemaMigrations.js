import { DbTables } from "../../../../constants/index.js";
import {
  computeAdoptPlan,
  deleteLegacySchemaKeysFromSystemSettings,
  getExistingAppTables,
  getExistingTableSet,
  getLegacySchemaVersionFromSystemSettings,
  looksLikeExistingDatabase,
  makeVersionMigrationId,
  markMigrationsApplied,
  REQUIRED_TABLES,
} from "./adoptUtils.js";
import { initDatabase } from "../engine/initDatabase.js";

const ADOPT_ID = "app-adopt-schema-migrations";


export default {
  id: ADOPT_ID,
  async up({ db }) {
    const existingTables = await getExistingTableSet(db);
    const existingAppTables = getExistingAppTables(existingTables);
    const hasSystemSettings = existingTables.has(DbTables.SYSTEM_SETTINGS);

    // 若已执行过 adopt，则直接退出
    try {
      const already = await db.prepare(`SELECT 1 AS ok FROM schema_migrations WHERE id = ?`).bind(ADOPT_ID).first();
      if (already) return false;
    } catch {
      // schema_migrations 不存在时会由 runner 先创建；这里忽略
    }

    // legacyVersion 仅用于“旧库接管”：若旧库有 schema_version，则按其版本上限预标记 app-v01..app-vN
    const legacyVersion = hasSystemSettings ? await getLegacySchemaVersionFromSystemSettings(db) : 0;

    // 新库/缺表库：直接建到最终态，然后 squash 标记 v01..vN
    let needsTablesCreation = false;
    for (const tableName of REQUIRED_TABLES) {
      if (!existingTables.has(tableName)) {
        needsTablesCreation = true;
        break;
      }
    }

    const isExistingDb = await looksLikeExistingDatabase(db, existingTables);

    // 运行时负责 schema + 默认设置/默认数据：
    // - 纯新库（无表） => needsTablesCreation=true
    // - 仅有 schema（例如用 schema.sql 手工创建了表，但无数据）=> isExistingDb=false
    // - 老库（有业务数据）=> isExistingDb=true 且通常 needsTablesCreation=false
    const { capVersion, shouldSquashToLatest } = computeAdoptPlan({
      legacyVersion,
      hasAppTables: existingAppTables.length > 0,
    });

    // 仅对“完全没有任何业务表”的真新库执行 bootstrap。
    // 旧库即使没有业务数据、或缺少部分新表，也必须交给 app-vXX 链逐步修复，
    // 否则 initDatabase() 内部的 IF NOT EXISTS + 建索引逻辑会把旧表误当成新表，
    // 在缺列时提前报错，导致真正的历史迁移根本没有机会执行。
    if (shouldSquashToLatest) {
      await initDatabase(db);
    }

    // adopt 标记范围：
    // - 旧库：按 legacy schema_version（上限为当前应用版本）
    // - 真新库：bootstrap 到最终态后直接 squash 到当前版本
    // - 旧 schema / 空数据旧库：不做 squash，保留历史迁移回放机会

    if (capVersion <= 0) {
      // 老库/旧 schema 在缺失 legacy schema_version 时，不做 squash 标记。
      // 后续由 app-vXX 链按顺序补齐真正缺失的历史迁移。
      return false;
    }
    const ids = [];
    for (let v = 1; v <= capVersion; v++) {
      ids.push(makeVersionMigrationId(v));
    }

    await markMigrationsApplied(db, ids);

    if (hasSystemSettings) {
      await deleteLegacySchemaKeysFromSystemSettings(db);
    }

    return true;
  },
};
