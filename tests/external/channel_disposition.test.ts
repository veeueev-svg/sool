/**
 * tests/external/channel_disposition.test.ts — لا قناةَ معلَّقةً إلى الأبد بعد الإنهاء (T-65 · W-2026-050)
 * المالك: وزارة الخارجية + وزارة المالية | يوثّق في: docs/test-reports/phase-40-W-2026-050.md
 * يثبت: بعد التسوية ومهلةِ الحسم المعلنة، حسابُ النظيرِ المعلَّقُ الذي لم يُغلق ولم يُستأنف يُرفع
 *       `contract_channel_undisposed` مرّةً واحدة؛ وقبل المهلة أو بلا تسويةٍ لا يُرفع؛ وماسحُ المواعيد
 *       يحوّله حادثًا جسيمًا `channel_undisposed`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlinesProbe } from '../../src/index';
import { COMPUTE, CROWN_GUARD, FINANCE, HOUR, KIND_COMPUTE, assessRisk, beat, contractState, signContract, terminateContract } from './helpers';
import { quietDeadlines, repoPolicy } from '../production/helpers';

function settledScene() {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  const signed = signContract(h, KIND_COMPUTE, { value: 5_000_000, days: 30 });
  assert.equal(signed.ok, true);
  if (!signed.ok) throw new Error('تعذّر التوقيع');
  const id = signed.contract.contractId;
  assert.equal(terminateContract(h, id, CROWN_GUARD).ok, true);
  assert.equal(h.s.externalAccounts.get(COMPUTE)?.suspended, true, 'القناةُ معلَّقةٌ مع الإنهاء');
  return { h, id };
}

test('T-65: قناةٌ معلَّقةٌ بعد التسويةِ ومهلةِ الحسم تُرفع مرّةً — وقبلها لا', () => {
  const { h, id } = settledScene();
  const hours = h.s.contractsConfig.policy.channel_disposition_hours;
  assert.equal(h.s.contractTermination.raiseUndisposed(h.now + 1000 * HOUR).length, 0, 'بلا تسويةٍ لا حسم');
  assert.equal(h.s.contractTermination.settle(id, FINANCE, 'مرجع-تسوية-نهائية', h.now).ok, true);
  assert.equal(h.s.contractTermination.raiseUndisposed(h.now + hours * HOUR).length, 0, 'عند المهلة لا بعدها');
  const late = h.now + hours * HOUR + 1;
  beat(h, late);
  const raised = h.s.contractTermination.raiseUndisposed(late);
  assert.deepEqual(raised.map((r) => r.contractId), [id]);
  assert.equal(h.s.audit.find('contract_channel_undisposed').length, 1);
  assert.equal(h.s.contractTermination.raiseUndisposed(late + 1).length, 0, 'مرّةً واحدة');
});

test('T-65: ماسحُ المواعيد يرفع القناةَ غيرَ المحسومة حادثًا جسيمًا', () => {
  const probe = deadlinesProbe({
    ...quietDeadlines(),
    settlements: { raiseUnsettled: () => [], raiseUndisposed: () => [{ contractId: 'c-9', counterparty: 'acct:x' }] },
  });
  const found = probe(Date.now());
  assert.deepEqual(found.map((f) => f.kind), ['channel_undisposed']);
  assert.equal((repoPolicy().severity.high as readonly string[]).includes('channel_undisposed'), true);
});
