/**
 * scripts/durability_probe.ts — مسبار نجاة الحالة عبر عمليتين حقيقيتين (المرحلة 39، البند T-27)
 * المالك: وزارة البيانات | المدخلات: طور (write|read) ومجلد تهيئة ومجلد يوميّة | المخرجات: سطر JSON واحد
 * التبعيات: dist/src/index | الصلاحيات: لا يكتب في المستودع؛ كل مسار يُمرَّر إليه من مناديه
 * السجلات: يعتمد على سجلات الوحدات؛ ولا يكتب هذا المسبار قيدًا خاصًا به
 * حالات الفشل: أي رفض سيادي يخرج بشفرة 1 مع سطر JSON يحمل الرمز — لا يُبتلع خطأ
 * اختبارات الوحدة: لا ينفرد بها | اختبار القبول: tests/recovery/restart_durability.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0024-durable-persistence.md
 * ثوابت هذا الملف:
 *   1) عمليتان مستقلتان: الطور الأول يكتب ويخرج، والثاني يقرأ في عملية جديدة تمامًا.
 *   2) لا حالة مشتركة في الذاكرة بين الطورين — المشترك هو ملف اليوميّة وحده.
 *   3) الخرج سطر JSON واحد ليُقاس آليًا ويُحفظ خامًا في docs/audit/measurements.
 */
import { bootstrapState } from '../src/index';

const OWNER = 'agent:probe-1';
const T0 = 1_700_000_000_000;

function main(): void {
  const [phase, configDir, persistenceDir] = process.argv.slice(2);
  if (phase !== 'write' && phase !== 'read') throw new Error('PROBE_PHASE_INVALID');
  if (!configDir || !persistenceDir) throw new Error('PROBE_ARGS_MISSING');
  const state = bootstrapState({
    configDir, persistenceDir, now: phase === 'write' ? T0 : T0 + 1000,
  });
  if (phase === 'write') {
    const written = state.memory.write(OWNER, {
      content: 'جوهر يعبر حدود العملية',
      provenance: { kind: 'tool_call', ref: 'probe:1' },
      retentionClass: 'official',
    }, T0);
    if (!written.ok) throw new Error('PROBE_MEMORY_REFUSED');
    const fact = state.knowledge.assert('ministry:data', {
      subject: 'probe:state', predicate: 'يعبر', object: 'نعم',
      sourceRecordId: written.record.recordId,
    }, T0);
    if (!fact.ok) throw new Error('PROBE_FACT_REFUSED');
    state.terminationRoll.record('agent:probe-terminated', 'authority:crown_guard', 'إنهاء معلن', T0);
    process.stdout.write(`${JSON.stringify({
      phase, restored: state.rehydrated?.restored ?? null,
      recordId: written.record.recordId, factId: fact.fact.factId,
      journalRecords: state.journal?.length ?? 0,
    })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    phase,
    restored: state.rehydrated?.restored ?? null,
    memoryRecords: state.memory.report().total,
    facts: state.knowledge.report().total,
    terminated: state.terminationRoll.isTerminated('agent:probe-terminated'),
    auditValid: state.audit.verifyIntegrity().valid,
    journalValid: state.journal?.verify().valid ?? null,
    content: state.memory.all()[0]?.content ?? null,
    rehydratedLogs: state.audit.find('state_rehydrated').length,
  })}\n`);
}

try {
  main();
} catch (error) {
  const violation = error as { code?: string; message?: string };
  process.stdout.write(`${JSON.stringify({ failed: true, code: violation.code ?? violation.message })}\n`);
  process.exit(1);
}
