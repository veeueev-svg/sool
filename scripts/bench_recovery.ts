/**
 * scripts/bench_recovery.ts — قياس عملي لزمن وحجم الاستعادة (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: تهيئة مؤقتة وسكان عينة | المخرجات: أرقام عربية من تنفيذ فعلي
 * التبعيات: node:fs وnode:os وnode:path وbootstrapState | الصلاحيات: قياس محلي لا يغيّر مستودع الإنتاج
 * السجلات: النسخ والاستعادة تسجلان في سجل الحالة المقاسة | حالات الفشل: يرمي القياس وينظف مجلده
 * اختبارات الوحدة: tests/recovery/* | اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-32.md
 * ثوابت هذا القياس: 1) الاستعادة في دولة جديدة؛ 2) النسخة تقرأ من القرص؛ 3) RTO يقاس من بداية التبديل.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../src/index';

const root = mkdtempSync(join(tmpdir(), 'sool-recovery-bench-'));
const configDir = join(root, 'config');
const backups = join(root, 'backups');
const now = Date.now();
try {
  cpSync(join(process.cwd(), 'config'), configDir, { recursive: true });
  writeFileSync(join(configDir, 'recovery.yaml'), `policy:\n  rto_seconds: 30\n  rpo_seconds: 60\n  backup_interval_seconds: 30\n  retention_count: 3\n  verify_after_restore: true\n  backup_directory: "${backups}"\n  continuity_mode: limited\n`, 'utf8');
  const state = bootstrapState({ configDir, now });
  const identities = Array.from({ length: 300 }, (_, index) => ({
    agentId: `agent:recovery-bench-${index + 1}`,
    owner: 'ministry:recovery-bench',
    resourceQuota: 'identity_slots:1',
  }));
  const population = state.population.registerBatch(
    state.king.issueCommand('create_agent', 'population:recovery-bench', {}, now), identities, now,
  );
  if (!population.ok) throw new Error(`BENCH_POPULATION_${population.code}`);
  state.scheduler.enqueue('task:recovery-bench', 'ministry:recovery-bench');
  state.ministries.establish(
    state.king.issueCommand('amend_policy', 'ministry:recovery-bench', {}, now),
    { ministryId: 'ministry:recovery-bench', name: 'وزارة قياس التعافي', mandate: ['قياس'], proposedBy: 'authority:royal_court' }, now,
  );
  const snapshotBegan = process.hrtime.bigint();
  const snapshot = state.recoverySnapshots.take(now);
  const snapshotMs = Number(process.hrtime.bigint() - snapshotBegan) / 1_000_000;

  // دولة جديدة تماما تقرأ النسخة ذاتها من القرص؛ لا يعاد استعمال الذاكرة أو خريطة الأرشيف السابقة.
  const fresh = bootstrapState({ configDir, now: now + 1 });
  const restoreBegan = process.hrtime.bigint();
  const command = fresh.king.issueCommand('archive_restore', snapshot.archive.snapshotId, {}, now + 2);
  const restored = fresh.restoreRunner.restore(command, snapshot.file, now + 2);
  const restoreMs = Number(process.hrtime.bigint() - restoreBegan) / 1_000_000;
  if (!restored.allowed || fresh.population.population !== identities.length || !fresh.recoveryConfig) {
    throw new Error('BENCH_RESTORE_REJECTED');
  }
  const integrity = fresh.audit.verifyIntegrity();
  if (!integrity.valid) throw new Error('BENCH_AUDIT_INVALID');
  console.log(`بيئة القياس: Node ${process.version}؛ ${availableParallelism()} vCPU؛ ذاكرة ${(totalmem() / 1073741824).toFixed(0)}GB`);
  console.log(`حجم النسخة: ${snapshot.bytes} بايت`);
  console.log(`زمن أخذ النسخة: ${snapshotMs.toFixed(3)} مللي ثانية`);
  console.log(`زمن الاستعادة من دولة فارغة: ${restoreMs.toFixed(3)} مللي ثانية`);
  console.log(`الحالة المستعادة: سكان=${fresh.population.population}؛ مهام=${fresh.scheduler.queued()}؛ وزارات=${fresh.ministries.report().total}؛ سجل=${integrity.length}`);
  console.log(`الأهداف المعلنة: RTO=${fresh.recoveryConfig.policy.rto_seconds} ثانية؛ RPO=${fresh.recoveryConfig.policy.rpo_seconds} ثانية؛ الفاصل=${fresh.recoveryConfig.policy.backup_interval_seconds} ثانية`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
