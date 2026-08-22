/**
 * tests/production/production_runbook_steps.test.ts — كتب التشغيل تُنفَّذ فعلًا (المرحلة 37)
 * المالك: ديوان التدقيق | المدخلات: إعلانات الكتب في deploy/production/runbooks + دولة مهيأة
 * المخرجات: خطوةٌ معلنة بلا ربط تُرفض، وربطٌ بلا إعلان يُرفض، والخطوات تُنفَّذ وتُتحقَّق
 * التبعيات: buildProductionRunbook, buildDeclaredProductionRunbooks, RunbookRunner
 * الصلاحيات: قياس فقط | حالات الفشل المقيسة: خطوة بلا ربط، ربط بلا إعلان،
 *   تنفيذ من غير مشغّل، كتاب غير معلن في السياسة، إقليم بلا حاكم عند التنفيذ
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/runbooks/federated-operation.md, docs/runbooks/king-absence.md
 * ثابت الاختبار: كتابٌ مكتوبٌ ولم يُنفَّذ كذبٌ موثَّق — فالقياس على المنفّذ لا على الملف
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildProductionRunbook, buildDeclaredProductionRunbooks, loadDeclaredRunbook,
  resolveProductionDeployDir, FEDERATED_ACTION, BYPASS_ACTION, SovereignViolation,
  ProductionStepDeps,
} from '../../src/index';
import { productionHarness, OPERATOR, OBSERVER, countEvent } from './helpers';

const DEPLOY = resolveProductionDeployDir();

/** نسخة من مجلد النشر يُعدَّل فيها إعلان كتاب واحد */
function withDeployCopy(run: (dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-prod-deploy-'));
  try {
    mkdirSync(join(root, 'runbooks'), { recursive: true });
    cpSync(DEPLOY, root, { recursive: true });
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function stepDeps(h: ReturnType<typeof productionHarness>): ProductionStepDeps {
  return {
    audit: h.state.audit, regions: h.state.regions, governors: h.state.governors,
    passage: h.passage, supervisor: h.supervisor, heartbeat: h.state.heartbeat,
    king: h.state.king, operator: OPERATOR, requiredRegions: h.policy.regions.required,
    modeAt: (at) => (h.state.killSwitch.status.engaged ? 'halted' : h.state.heartbeat.evaluate(at)),
  };
}

test('كل كتاب معلن في السياسة يُبنى من إعلانه وبعدد خطواته المعلنة', () => {
  const h = productionHarness();
  try {
    assert.equal(h.books.length, h.policy.runbooks.length);
    for (const book of h.books) {
      const declared = loadDeclaredRunbook(book.name, DEPLOY);
      assert.equal(book.steps.length, declared.steps.length, `خطوات ${book.name}`);
      assert.deepEqual(book.steps.map((s) => s.n), declared.steps.map((s) => s.n));
      for (const step of book.steps) {
        assert.equal(typeof step.act, 'function', 'لكل خطوة فعل');
        assert.equal(typeof step.verify, 'function', 'ولكل خطوة تحقّق');
      }
    }
  } finally { h.dispose(); }
});

test('خطوة معلنة بلا ربط تنفيذي تُرفض — «افعل» بلا فعل', () => {
  const h = productionHarness();
  try {
    withDeployCopy((dir) => {
      const path = join(dir, 'runbooks', 'king-absence.yaml');
      const yaml = `${readFileSync(path, 'utf8')}    - n: 4\n      title: خطوة معلنة بلا ربط تنفيذي\n      expect: أثرٌ معلن لخطوة لا ينفّذها أحد\n`;
      writeFileSync(path, yaml, 'utf8');
      assert.throws(
        () => buildProductionRunbook(loadDeclaredRunbook('king-absence', dir), stepDeps(h)),
        (error: unknown) => {
          assert.equal((error as SovereignViolation).code, 'PRODUCTION_RUNBOOK_STEP_UNBOUND');
          return true;
        },
      );
    });
  } finally { h.dispose(); }
});

test('ربطٌ تنفيذي بلا إعلان يُرفض — تنفيذٌ لا يعلمه الإعلان', () => {
  const h = productionHarness();
  try {
    withDeployCopy((dir) => {
      const path = join(dir, 'runbooks', 'king-absence.yaml');
      const yaml = readFileSync(path, 'utf8').replace(
        /    - n: 3\n(      .*\n)+/,
        '',
      );
      writeFileSync(path, yaml, 'utf8');
      assert.throws(
        () => buildProductionRunbook(loadDeclaredRunbook('king-absence', dir), stepDeps(h)),
        (error: unknown) => {
          assert.equal((error as SovereignViolation).code, 'PRODUCTION_RUNBOOK_STEP_UNDECLARED');
          return true;
        },
      );
    });
  } finally { h.dispose(); }
});

test('كتاب غياب الملك يُنفَّذ فعلًا: الكشف يُقاس قراءةً ولا يُدخل الوضع الوقائي', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const book = h.books.find((b) => b.name === 'king-absence');
    assert.ok(book, 'الكتاب مبنيّ');
    const result = h.runner.execute(OPERATOR, book, now);
    assert.equal(result.passed, true, `الخطوات: ${JSON.stringify(result.steps)}`);
    assert.equal(countEvent(h.state, 'protective_mode_entered'), 0, 'قياسٌ لا يغيّر الحال');
    assert.equal(h.state.heartbeat.isPresent(Date.now()), true);
  } finally { h.dispose(); }
});

test('كتاب التشغيل الاتحادي يُنفَّذ: تجاوزٌ مُنع، وكل إقليم استُؤذن له وعمل', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    h.supervisor.start(Date.now());
    h.passage.open(OPERATOR, 'تنفيذ كتاب التشغيل الاتحادي', Date.now());
    const book = h.books.find((b) => b.name === 'federated-operation');
    assert.ok(book);
    const result = h.runner.execute(OPERATOR, book, Date.now());
    assert.equal(result.passed, true, `الخطوات: ${JSON.stringify(result.steps)}`);
    // دليل الإنفاذ: محاولةٌ حقيقية مُنعت بفعلٍ يختلف عن المعتمد كي لا يستهلك إذنه
    const blocked = h.passage.blockedAttempts();
    assert.equal(blocked.length >= 1, true);
    assert.equal(blocked.some((b) => b.action === BYPASS_ACTION), true);
    assert.notEqual(BYPASS_ACTION, FEDERATED_ACTION);
    // ولكل إقليم مشترط فعلٌ نفُذ بإذن مطابق
    for (const regionId of h.policy.regions.required) {
      assert.equal(
        h.state.audit.find('region_action_passed')
          .some((e) => (e.detail as { regionId?: string }).regionId === regionId),
        true, `إذنٌ استُوفي في ${regionId}`,
      );
      assert.equal(
        h.state.audit.find('region_action_executed')
          .some((e) => (e.detail as { regionId?: string }).regionId === regionId),
        true, `وفعلٌ نفُذ في ${regionId}`,
      );
    }
  } finally { h.dispose(); }
});

test('التنفيذ مقيَّد بالجهة والإعلان: لا مراقبٌ ينفّذ، ولا كتابٌ خارج السياسة', () => {
  const now = Date.now();
  const h = productionHarness({ now });
  try {
    const book = h.books.find((b) => b.name === 'king-absence');
    assert.ok(book);
    const byObserver = h.runner.execute(OBSERVER, book, now);
    assert.equal(byObserver.passed, false, 'المراقب لا ينفّذ ما يشهد عليه (RULE-004)');
    const foreign = { name: 'moon-landing', purpose: 'كتاب غير معلن', steps: book.steps };
    const outside = h.runner.execute(OPERATOR, foreign, now);
    assert.equal(outside.passed, false, 'ولا كتابَ خارج السياسة الحاكمة');
  } finally { h.dispose(); }
});

test('خطوةٌ تعمل على إقليم بلا حاكم تُرفض برمز معلن لا تُطوى', () => {
  const now = Date.now();
  const h = productionHarness({ now, federate: false });
  try {
    const book = h.books.find((b) => b.name === 'federated-operation');
    assert.ok(book);
    h.passage.open(OPERATOR, 'تنفيذ بلا اتحاد قائم', now);
    const result = h.runner.execute(OPERATOR, book, now);
    assert.equal(result.passed, false, 'دولةٌ بلا أقاليم لا تُمرّر الكتاب');
    assert.equal(countEvent(h.state, 'runbook_step_failed') >= 1, true, 'والفشل يُقيَّد خطوةً خطوة');
    assert.ok(result.failures.length >= 1, 'ويُعلن سببًا');
  } finally { h.dispose(); }
});

test('بناء كل الكتب المعلنة يُرفض لو نقص ملف إعلان كتابٍ معلن', () => {
  const h = productionHarness();
  try {
    withDeployCopy((dir) => {
      rmSync(join(dir, 'runbooks', 'king-absence.yaml'), { force: true });
      assert.throws(
        () => buildDeclaredProductionRunbooks(h.policy.runbooks, stepDeps(h), dir),
        (error: unknown) => {
          assert.equal((error as SovereignViolation).code, 'MANIFEST_RUNBOOK_FILE_MISSING');
          return true;
        },
      );
    });
  } finally { h.dispose(); }
});
