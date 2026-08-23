/**
 * src/data/rehydrate_state.ts — إرجاعُ الاقتصاد والعقود والسكان من اليوميّة (المرحلة 39 — T-122)
 * المالك: وزارة البيانات | القاعدة الحاكمة RULE-000: كل تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: قيودُ يوميّةٍ متحقَّقةُ السلسلة + الأنظمةُ المستهدفة (دفتر، عقود، سكان)
 * المخرجات: تقريرُ إرجاعٍ معدود لكل نظام
 * التبعيات: `persistence.ts` — والأنظمةُ تُستدعى عبر أبوابها المعلنة لا عبر حقولها
 * الصلاحيات: الاستعادةُ فقط. لا تُنشئ حالةً من عندها ولا تُصلح نقصًا بالتخمين
 * السجلات: كلُّ نظامٍ يُقيّد استعادتَه بنفسه في السجل الأبدي (RULE-006)
 *
 * ثوابت هذه الوحدة:
 *   1) **الإرجاعُ إعادةُ بناءِ حالةٍ لا إعادةُ تنفيذِ أفعال**: تُبنى لقطةٌ من القيود ثم
 *      تُسلَّم للباب الذرّيّ في كل نظام. فلا تُنادى `write` ولا `sign` ولا `registerBatch`
 *      ثانيةً — إعادةُ ندائها تُنشئ قيودَ تدقيقٍ جديدةً لأفعالٍ قديمة، وذلك تزييفُ تاريخ.
 *   2) **آخرُ قيدٍ للهويّة هو الحقّ**: العقدُ حالةٌ تُحدَّث، فأحدثُ `contract_record`
 *      للعقد نفسه يُغني عمّا قبله — وهو عينُ ما يفعله الضغط (`durableIdentity`).
 *   3) **الإنهاءُ يُطبَّق بترتيبه لا بعده**: قيدُ `population_terminated` يُسقط الهويّة
 *      المسجّلة قبله، ودفعةٌ بعد إنهاءٍ لهويّةٍ بالاسم نفسه تُعيدها — فالترتيبُ حقّ.
 *   4) **الصامتُ لا يُعوَّض بالتخمين**: صنفٌ خارجُ نطاق التدوين لا يُرجَع أصلًا، ولا
 *      تُختلق له قيمةٌ افتراضيّة. من أراد إرجاعَه فليضعه في `scope` (RULE-005/008).
 *   5) **العددُ يُرجَع لا يُدَّعى**: التقريرُ يعدّ ما أُرجع فعلًا لكلِّ نظام، فمن قرأه
 *      قابَله بالقيود ولم يثق بدعوى «تمّ» (RULE-001).
 *
 * حالات الفشل (كلها مغلقة): دفترٌ غير متوازن ⇒ RECOVERY_LEDGER_UNBALANCED (من الدفتر) ·
 *   سكانٌ بلا حصّةٍ قابلةٍ للحجز ⇒ RECOVERY_POPULATION_QUOTA (من سجل السكان) ·
 *   لقطةُ عقودٍ فاسدةُ البنية ⇒ `contracts:false` في التقرير بلا رمي
 * اختبار القبول: tests/data/rehydrate_state.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0030-durability-scope-and-retention.md
 */
import type { EntityId } from '../kernel/types';
import type { DurableRecord } from './persistence';
import type { Account, Ledger, LedgerEntry } from '../economy/ledger';
import type { ExternalContract, ExternalContractRegistry } from '../external/contract_registry';
import type { PopulationIdentity, PopulationRegistry } from '../scale/population';

/** الأنظمةُ التي تُرجَع؛ غيابُ أيِّها يعني «لا إرجاع له» لا «إرجاعٌ فارغ» */
export interface RehydrateTargets {
  readonly ledger?: Ledger;
  readonly contracts?: ExternalContractRegistry;
  readonly population?: PopulationRegistry;
}

export interface RehydrateStateReport {
  readonly ledgerAccounts: number;
  readonly ledgerEntries: number;
  readonly ledgerClosedThrough: number | null;
  readonly contracts: number;
  readonly contractSequence: number;
  readonly population: number;
  readonly populationTerminated: number;
  /** أنظمةٌ رُبطت لكنّ اليوميّة لم تشهد لها بقيدٍ واحد — تُعلن ولا تُخفى */
  readonly silent: readonly string[];
}

interface Collected {
  accounts: Map<string, Account>;
  entries: LedgerEntry[];
  closedThrough: number | null;
  ledgerSeen: boolean;
  contracts: Map<string, ExternalContract>;
  contractSequence: number;
  contractsSeen: boolean;
  identities: Map<string, PopulationIdentity>;
  spawned: { at: number; count: number }[];
  terminated: number;
  populationSeen: boolean;
}

function empty(): Collected {
  return {
    accounts: new Map(), entries: [], closedThrough: null, ledgerSeen: false,
    contracts: new Map(), contractSequence: 0, contractsSeen: false,
    identities: new Map(), spawned: [], terminated: 0, populationSeen: false,
  };
}

function collectLedger(state: Collected, payload: Record<string, unknown>): void {
  state.ledgerSeen = true;
  const op = payload.op;
  if (op === 'account_opened' && payload.account) {
    const account = payload.account as Account;
    state.accounts.set(account.accountId, { ...account });
  } else if (op === 'entry' && payload.entry) {
    const entry = payload.entry as LedgerEntry;
    // ثابت 2 لا يشمل قيدَ الدفتر: القيدُ لا يُعدَّل ولا يُمحى (ثابت 3 في ledger.ts)،
    // فتكرارُ معرّفٍ يعني يوميّةً مشكوكة — نُبقي الأوّل ولا نستبدله صامتين.
    if (!state.entries.some((existing) => existing.entryId === entry.entryId)) {
      state.entries.push({ ...entry, lines: [...entry.lines] });
    }
  } else if (op === 'period_closed' && typeof payload.upTo === 'number') {
    state.closedThrough = state.closedThrough === null
      ? payload.upTo : Math.max(state.closedThrough, payload.upTo);
  }
}

function collectPopulation(state: Collected, entry: DurableRecord): void {
  const payload = entry.payload as Record<string, unknown>;
  state.populationSeen = true;
  if (entry.kind === 'population_terminated') {
    const agentId = payload.agentId;
    // ثابت 3: الإنهاءُ يُسقط ما سُجّل قبله؛ ودفعةٌ بعده تُعيد الهويّة.
    if (typeof agentId === 'string' && state.identities.delete(agentId)) state.terminated += 1;
    return;
  }
  const identities = Array.isArray(payload.identities) ? payload.identities : [];
  for (const raw of identities) {
    const identity = raw as PopulationIdentity;
    if (typeof identity?.agentId === 'string') state.identities.set(identity.agentId, { ...identity });
  }
  if (typeof payload.at === 'number' && typeof payload.count === 'number') {
    state.spawned.push({ at: payload.at, count: payload.count });
  }
}

/**
 * يُرجع الأنظمةَ المذكورةَ من قيودِ يوميّةٍ **متحقَّقةِ السلسلة سابقًا**.
 * لا تتحقّق هذه الوحدة من السلسلة: التحقّقُ بابُه `StateJournal.verify()` ومن أهمله
 * فقد أهمل حرسَه — وتكرارُ التحقّق هنا يُغري بإسقاطه هناك.
 */
export function rehydrateStateFromJournal(
  entries: readonly DurableRecord[],
  targets: RehydrateTargets,
  by: EntityId,
): RehydrateStateReport {
  const state = empty();
  for (const entry of entries) {
    const payload = entry.payload as Record<string, unknown> | null;
    if (payload === null || typeof payload !== 'object') continue;
    if (entry.kind === 'ledger_entry') collectLedger(state, payload);
    else if (entry.kind === 'contract_record') {
      state.contractsSeen = true;
      const contract = payload.contract as ExternalContract | undefined;
      // ثابت 2: الأحدثُ يُغني عمّا قبله للعقد نفسه (الإنهاء تحديثُ حقول).
      if (contract && typeof contract.contractId === 'string') {
        state.contracts.set(contract.contractId, { ...contract });
      }
      if (typeof payload.sequence === 'number') {
        state.contractSequence = Math.max(state.contractSequence, payload.sequence);
      }
    } else if (entry.kind === 'population_batch' || entry.kind === 'population_terminated') {
      collectPopulation(state, entry);
    }
  }

  const silent: string[] = [];
  if (targets.ledger && state.ledgerSeen) {
    targets.ledger.restore({
      accounts: [...state.accounts.values()],
      entries: state.entries,
      closedThrough: state.closedThrough,
    }, by);
  } else if (targets.ledger) silent.push('ledger');

  let contractsRestored = 0;
  if (targets.contracts && state.contractsSeen) {
    const ok = targets.contracts.importAll({
      contracts: [...state.contracts.values()], sequence: state.contractSequence,
    }, by);
    contractsRestored = ok ? state.contracts.size : 0;
    if (!ok) silent.push('contracts:rejected');
  } else if (targets.contracts) silent.push('contracts');

  let populationRestored = 0;
  if (targets.population && state.populationSeen) {
    targets.population.restoreFromJournal({
      identities: [...state.identities.values()], spawned: state.spawned,
    }, by);
    populationRestored = state.identities.size;
  } else if (targets.population) silent.push('population');

  return {
    ledgerAccounts: state.accounts.size,
    ledgerEntries: state.entries.length,
    ledgerClosedThrough: state.closedThrough,
    contracts: contractsRestored,
    contractSequence: state.contractSequence,
    population: populationRestored,
    populationTerminated: state.terminated,
    silent,
  };
}
