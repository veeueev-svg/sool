/**
 * src/external/contract_recovery.ts — حارسُ الاستعادةِ لبابِ `importAll` الثالث (T-68)
 * المالك: وزارة الخارجية تحت التاج | المرحلة 27 — امتدادُ سجلِّ العقودِ الخارجيّةِ
 *
 * العلّةُ التي يُغلقُ عليها هذا الحارس: كان `importAll` يفحصُ **البنيةَ** وحدَها
 * (مصفوفةٌ، تسلسلٌ صحيحٌ، لا تكرارَ معرّفٍ، معرّفٌ يبدأُ بـ`extc:`، نوعٌ معلنٌ، قيمةٌ موجبةٌ،
 * نهايةٌ صحيحةٌ) — فيمرُّ منه ما يرفضُه بابا `sign`/`terminate`: قيمةٌ فوق سقفِ النوعِ،
 * وعقدٌ مُنهًى يُبعثُ قائمًا، وتفتيتٌ فوق سقفِ النظيرِ، ومدّةٌ فوق `maxTermMs`. والحارسُ
 * الموزَّعُ على بابٍ واحدٍ يُنسى عند إضافةِ بابٍ جديد — فجُمِّعَ هنا في موضعٍ واحدٍ يمرُّ
 * به كلُّ استعادة.
 *
 * والفحصُ **بالثلثابتِ نفسها** التي يفحصُها `sign` لا بفحصٍ مُخترَعٍ: سقفُ النوعِ (ثابت 3)
 * وسقفُ المدّةِ (ثابت 5) وسقفُ النظيرِ (ثابت 6) واتّساقُ حقولِ الإنهاءِ الثلاثةِ. ولا يُرفعُ
 * سقفُ وحدةٍ: هذا الملفُّ وحده يحملُ الحارس، فلا ينفخُ `contract_registry.ts` فوق سقفِه.
 */
import type {
  ContractRegistrySnapshot, ContractRegistryDeps, ExternalContract,
} from './contract_registry';

/** عقدٌ قائمٌ في السجلِّ قبل المسح — يُقرأُ منه حقلُ الإنهاءِ فقط لمنعِ النقضِ بالاستعادة. */
type ExistingContract = Pick<ExternalContract, 'contractId' | 'terminatedAt'>;

/**
 * يفحصُ لقطةَ الاستعادةِ بالثوابتِ نفسِها التي يفحصُها `sign`، فلا يدخلُ من بابِ
 * الاستعادةِ ما يُرفَضُ عند البابين. يُستدعى **قبلَ المسحِ** فيحفظُ السجلَّ بحاله إن رُفض.
 * يرمي `Error('RECOVERY_CONTRACT_INVALID')` عند أوّلِ مخالفة — بلا تمييزِ سببٍ يُساعدُ المعتدي.
 */
export function validateRecoverySnapshot(
  snapshot: ContractRegistrySnapshot,
  deps: ContractRegistryDeps,
  existing: ReadonlyMap<string, ExistingContract>,
): void {
  const fail = (): never => { throw new Error('RECOVERY_CONTRACT_INVALID'); };

  // البنيةُ أوّلًا — لا تُبنى الأحكامُ على لقطةٍ لا تحترمُ شكلَها.
  if (!Array.isArray(snapshot.contracts) || !Number.isSafeInteger(snapshot.sequence)
    || snapshot.sequence < 0) {
    fail();
  }
  const seen = new Set<string>();
  for (const c of snapshot.contracts) {
    if (!c || typeof c !== 'object') fail();
    if (seen.has(c.contractId)) fail();        // لا تكرارَ معرّفٍ
    seen.add(c.contractId);
    if (!c.contractId.startsWith('extc:')) fail();
    if (!Number.isSafeInteger(c.value) || c.value <= 0) fail();
    if (!Number.isSafeInteger(c.endsAt) || !Number.isSafeInteger(c.signedAt)) fail();
  }

  // الثوابتُ التي يفحصُها `sign` — على المستعادِ كما على الموقَّع.
  const activePerCounterparty = new Map<string, number>();
  for (const c of snapshot.contracts) {
    const kind = deps.risk.kind(c.kindId);
    if (kind === null) throw new Error('RECOVERY_CONTRACT_INVALID'); // نوعٌ معلنٌ فحسب (RULE-005)
    if (c.value > kind.maxValue) fail();         // ثابت 3 — سقفُ النوعِ
    // اتّساقُ حقولِ الإنهاءِ الثلاثةِ: كلُّها معدومةٌ (عقدٌ قائمٌ) أو كلُّها حاضرةٌ (عقدٌ مُنهًى).
    const nullCount = (c.terminatedAt === null ? 1 : 0)
      + (c.terminatedBy === null ? 1 : 0)
      + (c.terminationReason === null ? 1 : 0);
    if (nullCount !== 0 && nullCount !== 3) fail();
    // الإنهاءُ بابٌ واحدٌ — لا يُنقضُ بالاستعادة: من عُثرَ على معرّفِه في السجلِّ
    // مُنهًى فلا يُستعادُ قائمًا. (الاستعادةُ بعد إقلاعٍ لا تجدُ معرّفًا فلا حصرَ عليها هنا.)
    const prev = existing.get(c.contractId);
    if (prev !== undefined && prev.terminatedAt !== c.terminatedAt) fail();
    // ثابت 5 — سقفُ المدّةِ، وثابت 6 — سقفُ النظيرِ: على العقودِ القائمةِ وحدها.
    if (c.terminatedAt === null) {
      if (c.endsAt - c.signedAt > deps.maxTermMs) fail();
      activePerCounterparty.set(
        c.counterparty,
        (activePerCounterparty.get(c.counterparty) ?? 0) + 1,
      );
    }
  }
  for (const count of activePerCounterparty.values()) {
    if (count > deps.maxOpenPerCounterparty) fail();   // ثابت 6 — سقفُ النظيرِ
  }
}
