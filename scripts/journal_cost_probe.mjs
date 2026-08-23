/**
 * scripts/journal_cost_probe.mjs — كلفةُ القيد الواحد في اليوميّة (المرحلة 39، البندان T-122 وT-123)
 * المالك: وزارة البيانات | المدخلات: لا شيء — الأعدادُ مُعلنةٌ في الملف
 * المخرجات: سطرٌ لكل حجم: الزمنُ الكلّي وزمنُ القيد وp50/p99/الأقصى والحجمُ وزمنُ التحقّق
 * التبعيات: dist/src/data/persistence.js — فلتُبنَ الحزمةُ قبله
 * الصلاحيات: لا يكتب في المستودع؛ كل مساره في tmpdir
 * حالات الفشل: أي خطأٍ يُرمى كما هو — لا يُبتلع (RULE-007)
 * الوثيقة المرتبطة: docs/decisions/ADR-0030-durability-scope-and-retention.md
 * ثوابت هذا الملف:
 *   1) **fsync عند كل قيد**: يُقاس أسوأُ الحالات المعلنة في التهيئة لا أسرعُها.
 *   2) **ثلاثةُ أحجام**: ألفٌ وعشرةُ آلافٍ وخمسون ألفًا — لتُرى الخطّيّةُ أو غيابُها.
 *   3) **الحمولةُ نموذجيّة**: قيدُ ذاكرةٍ بحجمٍ يشبه ما تكتبه الوحداتُ فعلًا.
 *   4) **الخرجُ خامّ**: لا حكمَ فيه ولا تصنيف — الحكمُ في التقرير، والرقمُ هنا.
 *   هذا **قياسُ منفّذٍ** حتى يعيده ديوانُ التدقيق (RULE-004).
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateJournal } from '../dist/src/data/persistence.js';

const cfg = {
  policy: {
    journal_directory: '/tmp/unused',
    journal_file: 'state.jsonl',
    fsync_every_record: true,
    verify_chain_on_boot: true,
    rebuild_termination_roll: true,
    max_journal_records: 5000000,
    scope: ['audit_entry', 'memory_record', 'memory_share', 'knowledge_fact', 'archive_snapshot', 'journal_compacted'],
  },
};

function pct(sorted, p) {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i] ?? 0;
}

for (const n of [1000, 10000, 50000]) {
  const dir = mkdtempSync(join(tmpdir(), 'cost-'));
  const j = StateJournal.fromConfig(cfg, dir);
  const lat = [];
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    const a = process.hrtime.bigint();
    j.record('memory_record', { recordId: `r${i}`, owner: 'agent:x', content: 'حمولةٌ نموذجيّة لقياس الكلفة', seq: i }, 1700000000000 + i);
    lat.push(Number(process.hrtime.bigint() - a) / 1e6);
  }
  const total = Number(process.hrtime.bigint() - t0) / 1e6;
  lat.sort((x, y) => x - y);
  const size = statSync(j.file).size;
  console.log(`n=${n} total=${total.toFixed(1)}ms per=${(total / n).toFixed(4)}ms p50=${pct(lat, 50).toFixed(4)} p99=${pct(lat, 99).toFixed(4)} max=${lat[lat.length - 1].toFixed(3)} size=${size}B perRec=${(size / n).toFixed(0)}B`);
  // كلفة القراءة والتحقق عند الإقلاع
  const r0 = process.hrtime.bigint();
  const v = j.verify();
  const rd = Number(process.hrtime.bigint() - r0) / 1e6;
  console.log(`   تحقُّقُ السلسلة عند الإقلاع: ${rd.toFixed(1)}ms صحيحة=${v.valid} طول=${v.length}`);
  j.close();
  rmSync(dir, { recursive: true, force: true });
}
