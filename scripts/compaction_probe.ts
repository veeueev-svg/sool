/**
 * scripts/compaction_probe.ts — مسبارُ ضغط اليوميّة (المرحلة 39، البند T-121)
 * المالك: وزارة البيانات | المدخلات: عددُ السجلات المزروعة ومجلدُ يوميّة يُمرَّر إليه
 * المخرجات: أسطرٌ مقروءة تُحفظ خامًا في docs/audit/measurements/phase-39-T121.txt
 * التبعيات: dist/src/index | الصلاحيات: لا يكتب في المستودع؛ كل مسار من مناديه
 * السجلات: يعتمد على سجلات الوحدات — والمسبار لا يخترع قيدًا لنفسه
 * حالات الفشل: أي رفض سيادي يخرج بشفرة 1 برمزه — لا يُبتلع خطأ (RULE-007)
 * اختبارات الوحدة: tests/data/journal_compaction.test.ts
 * اختبار القبول: tests/data/durable_rehydrate.test.ts (الإقلاع من يوميّةٍ مضغوطة)
 * الوثيقة المرتبطة: docs/decisions/ADR-0025-journal-compaction.md
 * ثوابت هذا الملف:
 *   1) **المكسب يُقاس لا يُدَّعى**: يُطبع عددُ القيود وحجمُ الملف قبل الضغط وبعده.
 *   2) **الأصل يُفتَّش**: يُطبع حجمُ الأرشيف — دعوى «لا حذف» تُقاس.
 *   3) **الإقلاع بعده يُقاس في هذه العملية نفسها**: يوميّةٌ مضغوطة لا تُقرأ عيبٌ لا كسب.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../src/index';
import { compactJournal } from '../src/data/journal_compaction';

const OWNER = 'agent:probe-1';
const T0 = 1_700_000_000_000;

function main(): void {
  const seedCount = Number(process.argv[2] ?? 200);
  if (!Number.isSafeInteger(seedCount) || seedCount <= 0) throw new Error('PROBE_ARGS_INVALID');
  const dir = mkdtempSync(join(tmpdir(), 'sool-compaction-probe-'));
  try {
    const first = bootstrapState({ now: T0, persistenceDir: dir });
    const ids: string[] = [];
    for (let i = 0; i < seedCount; i++) {
      const written = first.memory.write(OWNER, {
        content: `محتوى ${i}`,
        provenance: { kind: 'tool_call', ref: `probe:${i}` },
        retentionClass: 'official',
      }, T0 + i);
      if (!written.ok) throw new Error('PROBE_SEED_FAILED');
      ids.push(written.record.recordId);
    }
    // الشطبُ يُدوَّن قيدًا لاحقًا بالهويّة نفسها — وهو المنسوخُ الذي يُسقطه الضغط.
    for (const id of ids) first.memory.tombstone(id, 'authority:audit_bureau', 'قياس', T0 + seedCount);
    const journal = first.journal;
    if (!journal) throw new Error('PROBE_NO_JOURNAL');
    const before = journal.read().length;
    const sizeBefore = statSync(journal.file).size;
    const startedAt = Date.now();
    const report = compactJournal(journal, T0 + seedCount + 1);
    const elapsed = Date.now() - startedAt;
    const sizeAfter = statSync(journal.file).size;
    const kept = journal.read();
    const auditKept = kept.filter((entry) => entry.kind === 'audit_entry').length;
    console.log(`سجلاتٌ مزروعة: ${seedCount} ثم شُطبت كلها (قيدان بالهويّة نفسها لكل سجل)`);
    console.log(`قيودٌ قبل الضغط: ${before} · بعده: ${report.after} · أُسقط منسوخًا: ${report.droppedSupersededRecords}`);
    console.log(`حجمُ الملف: ${sizeBefore}B ⇒ ${sizeAfter}B (${((1 - sizeAfter / sizeBefore) * 100).toFixed(1)}% أقل)`);
    console.log(`زمنُ الضغط: ${elapsed}ms · السلسلةُ بعده صحيحة: ${journal.verify().valid}`);
    console.log(`قيودُ التدقيق الباقية: ${auditKept} من ${kept.length} — لا يُحذف منها شيء (RULE-006)`);
    console.log(`الأرشيفُ باقٍ بحجمه الأصلي: ${statSync(report.archive).size}B`);
    journal.close();

    const second = bootstrapState({ now: T0 + 100_000, persistenceDir: dir });
    console.log(
      `إقلاعٌ من يوميّةٍ مضغوطة: استُعيد=${second.rehydrated?.restored} قيود=${second.rehydrated?.records}`
      + ` ذاكرة=${second.rehydrated?.memoryRecords} سلسلةُ السجل سليمة=${second.audit.verifyIntegrity().valid}`,
    );
    second.journal?.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
