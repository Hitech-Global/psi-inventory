'use strict';
/**
 * WAC-TRIGGER-GUARD-01（Wave 1 / CI Reverse）
 * =========================================================================
 * 目的：消除 CI reverse 事务内的 `ALTER TABLE wac_history DISABLE/ENABLE TRIGGER`
 * （每次冲销在 wac_history 上拿表级 AccessExclusiveLock，且 ALTER 排队时与持有
 * inventory 行锁的事务存在死锁环风险）。
 *
 * 机制：把 `trg_block_wac_history_update()` 的函数体替换为 fail-secure 守卫版：
 *   - 默认（current_setting 缺失 / 值非 '1'）→ locked 行仍然拒绝 UPDATE（保护不降级）
 *   - 仅当本事务先执行 set_config('app.wac_unlock','1',true)（SET LOCAL 语义，
 *     COMMIT/ROLLBACK 自动消失，其他会话完全不受影响）→ 本事务允许受控解锁
 *   - 错误串 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN' 逐字符不变（对齐 P1-03-C 约定）
 *
 * 部署形态（红线）：
 *   - 仅 CREATE OR REPLACE FUNCTION（幂等）；【绝不】重建/DROP trigger 本体，
 *     不需要任何表级 DDL → 本 migration 自身不拿 wac_history 的 AccessExclusiveLock
 *   - trg_block_wac_history_delete() 保持无条件拒绝（比守卫更强，不动）
 *   - 生产事实：触发器当年为带外创建（db.js 生产迁移列表与 db-pg.js 死代码 initDatabase
 *     均不含它），且无任何 bootstrap 会在重启时回写函数体 → reverse 事务内
 *     "查 pg_proc → 缺守卫则补" 的自愈式确保是安全且必要的
 *
 * Rollback 兼容（Wave 1 gate 十五）：
 *   - 新函数 + 旧 server.js：旧 reverse 走 DISABLE TRIGGER（触发器整体禁用，函数体
 *     不参与）→ 旧路径照常工作；普通业务守卫不降级（旧事务从不设置 app.wac_unlock）
 *   - 旧函数 + 新 server.js：新 reverse 的 UPDATE 会撞旧函数无条件拒绝 → 整体回滚、
 *     reverse 功能暂时失败（fail-closed，数据保护不失效）；下一条 reverse 的自愈 ensure
 *     会自动补上守卫函数后恢复
 */

const GUARD_FN_NAME = 'trg_block_wac_history_update';

// fail-secure 守卫函数（仅替换 UPDATE 守卫函数体；幂等，无表级 DDL）
const GUARD_UPDATE_FN_SQL = `
CREATE OR REPLACE FUNCTION trg_block_wac_history_update() RETURNS trigger AS $wacguard$
DECLARE
  v_unlock text;
BEGIN
  IF OLD.is_locked = 1 THEN
    BEGIN
      v_unlock := current_setting('app.wac_unlock', true);
    EXCEPTION WHEN OTHERS THEN
      v_unlock := NULL;
    END;
    IF v_unlock IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN';
    END IF;
  END IF;
  RETURN NEW;
END;
$wacguard$ LANGUAGE plpgsql;
`;

// DELETE 守卫函数（生产现状语义：locked 行无条件禁止 DELETE，无解锁通道 —— 比 UPDATE 守卫更强）
const GUARD_DELETE_FN_SQL = `
CREATE OR REPLACE FUNCTION trg_block_wac_history_delete() RETURNS trigger AS $wacguard$
BEGIN
  IF OLD.is_locked = 1 THEN
    RAISE EXCEPTION 'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN';
  END IF;
  RETURN OLD;
END;
$wacguard$ LANGUAGE plpgsql;
`;

// 触发器 DDL 单一来源（SCHEMA-CONSOLIDATION-01）：boot 时仅对缺失的触发器执行
// drop+create（幂等）；生产已就位时 catalog 检查跳过，零 DDL 零锁。
const GUARD_TRIGGERS = [
  {
    name: 'trg_wac_history_block_update',
    drop: 'DROP TRIGGER IF EXISTS trg_wac_history_block_update ON wac_history',
    create: 'CREATE TRIGGER trg_wac_history_block_update BEFORE UPDATE ON wac_history FOR EACH ROW EXECUTE FUNCTION trg_block_wac_history_update()'
  },
  {
    name: 'trg_wac_history_block_delete',
    drop: 'DROP TRIGGER IF EXISTS trg_wac_history_block_delete ON wac_history',
    create: 'CREATE TRIGGER trg_wac_history_block_delete BEFORE DELETE ON wac_history FOR EACH ROW EXECUTE FUNCTION trg_block_wac_history_delete()'
  }
];

// reverse 事务开始时调用：查询 pg_proc 判断守卫是否已应用；缺失则幂等补齐。
// 正常热路径成本 = 1 次 catalog SELECT。
//   aq / run：withGenerateClient 提供的 async 执行器（SQL 经 _normalizeSql，兼容）
function ensureGuardInTx(aq, run) {
  return (async () => {
    const fnRows = await aq(`SELECT prosrc FROM pg_proc WHERE proname = '${GUARD_FN_NAME}'`);
    const guardOk = fnRows.length > 0 && fnRows.every((r) => String(r.prosrc || '').indexOf('app.wac_unlock') >= 0);
    if (!guardOk) {
      await run(GUARD_UPDATE_FN_SQL);
      return { applied: true };
    }
    return { applied: false };
  })();
}

module.exports = { GUARD_FN_NAME, GUARD_UPDATE_FN_SQL, GUARD_DELETE_FN_SQL, GUARD_TRIGGERS, ensureGuardInTx };
