/**
 * tests/recovery/helpers.ts — مهاد اختبارات التعافي (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: تهيئة مؤقتة وأوامر ملكية | المخرجات: دولة ونسخ قابلة للفحص
 * التبعيات: bootstrapState وملفات مؤقتة داخل os.tmpdir | الصلاحيات: النجاح يمر ببوابة التاج
 * السجلات: تصدرها الوحدات المختبرة | حالات الفشل: ينظف المهاد مجلده ولا يكتب في المستودع
 * اختبارات الوحدة: tests/recovery/* | اختبار القبول: recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-32.md
 * ثوابت هذه الوحدة: 1) كل قرص اختبار داخل tmpdir؛ 2) كل استعادة بأمر archive_restore؛ 3) الزمن ثابت.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState, PopulationInput } from '../../src/index';
export const T0 = 1_700_000_000_000;
export function recoveryHarness(now = T0, backupIntervalSeconds = 30) {
  const root = mkdtempSync(join(tmpdir(), 'sool-recovery-'));
  const config = join(root, 'config'); const backups = join(root, 'backups');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), `policy:\n  rto_seconds: 30\n  rpo_seconds: 60\n  backup_interval_seconds: ${backupIntervalSeconds}\n  retention_count: 3\n  verify_after_restore: true\n  backup_directory: "${backups}"\n  continuity_mode: limited\n`);
  const s = bootstrapState({ configDir: config, now });
  return { s, root, config, backups, clean: () => rmSync(root, { recursive: true, force: true }) };
}
export function identities(n: number): PopulationInput[] {
  return Array.from({ length: n }, (_, i) => ({ agentId: `agent:recovery-${i + 1}`, owner: 'ministry:recovery', resourceQuota: 'identity_slots:1' }));
}
export function seed(h: ReturnType<typeof recoveryHarness>, now = T0): void {
  const memory = h.s.memory.write('agent:recovery-1', { content: 'جوهر محفوظ', provenance: { kind: 'tool_call', ref: 'recovery:1' }, retentionClass: 'official' });
  if (!memory.ok) throw new Error('SEED_MEMORY');
  h.s.knowledge.assert('ministry:data', { subject: 'recovery:state', predicate: 'جاهز', object: 'نعم', sourceRecordId: memory.record.recordId });
  h.s.population.registerBatch(h.s.king.issueCommand('create_agent', 'population:recovery', {}, now), identities(3), now);
  h.s.scheduler.enqueue('task:recovery-1', 'ministry:recovery');
  h.s.ministries.establish(h.s.king.issueCommand('amend_policy', 'ministry:recovery', {}, now), { ministryId: 'ministry:recovery', name: 'وزارة التعافي', mandate: ['recovery'], proposedBy: 'authority:royal_court' }, now);
}
export function take(h: ReturnType<typeof recoveryHarness>, now = T0) { return h.s.recoverySnapshots.take(now); }
