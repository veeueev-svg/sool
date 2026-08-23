/**
 * src/recovery/snapshot.ts — لقطة القرص الموثقة وحالة التعافي الملحقة بالأرشيف (المرحلة 32)
 * المالك: وزارة البنية
 * المدخلات: الأرشيف الملكي، السجل، السكان والشرائح والموارد والوزارات والعقود
 * المخرجات: ملف نسخة ببصمة أو تبديل حالة عبر الأرشيف الملكي فقط
 * التبعيات: fs وcrypto والأرشيف الملكي والسجل ووحدات الحالة المعلنة
 * الصلاحيات: لا أمر سيادي هنا ولا استعادة مباشرة؛ الأرشيف وحده يبدل الحالة
 * السجلات: recovery_snapshot_written / recovery_snapshot_pruned / *_restored
 * حالات الفشل: تحريف أو بنية ناقصة أو حصة مناقضة ⇒ رفض مغلق
 * اختبارات الوحدة: tests/recovery/snapshot.test.ts
 * اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0016-recovery.md
 * ثوابت هذه الوحدة:
 *   1) ملف القرص غلاف موثق لا مسار استعادة: يمر إلى RoyalArchive.install ثم restore فقط.
 *   2) السجل آخر ما يبدل: فتظل كتابات تجهيز الوحدات خارج الرأس المستعاد ولا تلوثه.
 *   3) السكان والحصص والشرائح والمهام يعادون معا: لا هوية بلا حجز أو تعيين.
 *   4) (المرحلة 39، البند T-29) نطاق اللقطة يشمل سجل الوكلاء والصلاحيات والنماذج وسجل
 *      المنتهين. لقطةٌ تعيد السكان وتنسى المنح تُعيد دولةً قادرةً بلا سلطة معلنة،
 *      ولقطةٌ تنسى سجل المنتهين تُحيي من أُنهي. وسجل المنتهين لا يُنقل في الحمولة:
 *      يُعاد بناؤه من السلسلة الأبدية بعد استبدالها (البند T-99) فيبقى المصدر واحدًا،
 *      وتحمل الحمولة العددَ المتوقع ليُقارن في التحقق لا ليُصدَّق بلا فحص.
 *   5) الغلاف صار الإصدار 2: حمولةٌ بالإصدار 1 تُرفض مغلقًا ولا تُستعاد جزئيًا.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { AppendOnlyLog } from '../audit/append_only_log';
import { RoyalArchive, ArchiveRecoveryParticipant, ArchiveSnapshot } from '../data/royal_archive';
import { ResourceRegistry } from '../kernel/resource_registry';
import { PopulationRegistry } from '../scale/population';
import { Sharding } from '../scale/sharding';
import { FairScheduler } from '../scale/scheduler';
import { MinistryRegistry } from '../governance/ministries';
import { ExternalContractRegistry } from '../external/contract_registry';
import { AgentRegistry } from '../agents/agent_registry';
import { PermissionRegistry } from '../agents/permissions';
import { ModelRegistry } from '../models/model_registry';
import { TerminationRoll } from '../kernel/termination_roll';
import { ContinuityController } from './continuity';

export type RecoveryStep = 'resources' | 'sharding' | 'population' | 'scheduler' | 'ministries'
  | 'contracts' | 'agents' | 'permissions' | 'models' | 'audit' | 'terminations';
export interface RecoveryStateSnapshot {
  readonly version: 2;
  readonly resources: ReturnType<ResourceRegistry['exportAll']>;
  readonly sharding: ReturnType<Sharding['exportAll']>;
  readonly population: ReturnType<PopulationRegistry['exportAll']>;
  readonly scheduler: ReturnType<FairScheduler['exportAll']>;
  readonly ministries: ReturnType<MinistryRegistry['exportAll']>;
  readonly contracts: ReturnType<ExternalContractRegistry['exportAll']>;
  readonly agents: ReturnType<AgentRegistry['exportAll']>;
  readonly permissions: ReturnType<PermissionRegistry['exportAll']>;
  readonly models: ReturnType<ModelRegistry['exportAll']>;
  /** العدد المتوقع لسجل المنتهين — يُقارن بعد إعادة بنائه من السلسلة، ولا يُنقل السجل نفسه */
  readonly terminations: number;
  readonly audit: string;
}

/** وحدات الحالة المشمولة بنطاق اللقطة — بديل قائمة وسائط طويلة يُنسى ترتيبها */
export interface RecoveryStateDeps {
  readonly audit: AppendOnlyLog;
  readonly resources: ResourceRegistry;
  readonly sharding: Sharding;
  readonly population: PopulationRegistry;
  readonly scheduler: FairScheduler;
  readonly ministries: MinistryRegistry;
  readonly contracts: ExternalContractRegistry;
  readonly agents: AgentRegistry;
  readonly permissions: PermissionRegistry;
  readonly models: ModelRegistry;
  readonly terminationRoll: TerminationRoll;
  readonly continuity: ContinuityController;
}
export interface RecoveryEnvelope {
  readonly version: 1;
  readonly createdAt: number;
  readonly archive: ArchiveSnapshot;
  readonly checksum: string;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

export class RecoveryStateParticipant implements ArchiveRecoveryParticipant {
  private failure: RecoveryStep | null = null;
  private readonly audit: AppendOnlyLog;
  private readonly resources: ResourceRegistry;
  private readonly sharding: Sharding;
  private readonly population: PopulationRegistry;
  private readonly scheduler: FairScheduler;
  private readonly ministries: MinistryRegistry;
  private readonly contracts: ExternalContractRegistry;
  private readonly agents: AgentRegistry;
  private readonly permissions: PermissionRegistry;
  private readonly models: ModelRegistry;
  private readonly terminationRoll: TerminationRoll;
  private readonly continuity: ContinuityController;
  constructor(deps: RecoveryStateDeps) {
    this.audit = deps.audit; this.resources = deps.resources; this.sharding = deps.sharding;
    this.population = deps.population; this.scheduler = deps.scheduler; this.ministries = deps.ministries;
    this.contracts = deps.contracts; this.agents = deps.agents; this.permissions = deps.permissions;
    this.models = deps.models; this.terminationRoll = deps.terminationRoll; this.continuity = deps.continuity;
  }
  injectFailure(step: RecoveryStep | null): void { this.failure = step; }
  exportAll(): RecoveryStateSnapshot {
    return { version: 2, resources: this.resources.exportAll(), sharding: this.sharding.exportAll(),
      population: this.population.exportAll(), scheduler: this.scheduler.exportAll(),
      ministries: this.ministries.exportAll(), contracts: this.contracts.exportAll(),
      agents: this.agents.exportAll(), permissions: this.permissions.exportAll(),
      models: this.models.exportAll(), terminations: this.terminationRoll.size, audit: this.audit.export() };
  }
  prepareRestore(): void { this.continuity.beginRestore(); }
  importAll(raw: unknown, by: string): boolean {
    const snapshot = raw as RecoveryStateSnapshot;
    if (!snapshot || snapshot.version !== 2 || typeof snapshot.audit !== 'string'
      || !snapshot.agents || !snapshot.permissions || !snapshot.models
      || typeof snapshot.terminations !== 'number') throw new Error('RECOVERY_PAYLOAD_INVALID');
    const apply = (step: RecoveryStep, fn: () => boolean): void => {
      if (this.failure === step) {
        this.failure = null; // الحقن اختبار أحادي؛ يلزم أن تستطيع عملية الرجوع نفسها العمل.
        throw new Error(`RECOVERY_INJECTED_${step}`);
      }
      if (!fn()) throw new Error(`RECOVERY_IMPORT_REFUSED_${step}`);
    };
    apply('resources', () => this.resources.importAll(snapshot.resources, by));
    apply('sharding', () => this.sharding.importAll(snapshot.sharding, by));
    apply('population', () => this.population.importAll(snapshot.population, by));
    apply('scheduler', () => this.scheduler.importAll(snapshot.scheduler, by));
    apply('ministries', () => this.ministries.importAll(snapshot.ministries, by));
    apply('contracts', () => this.contracts.importAll(snapshot.contracts, by));
    apply('agents', () => this.agents.importAll(snapshot.agents, by));
    apply('permissions', () => this.permissions.importAll(snapshot.permissions, by));
    apply('models', () => this.models.importAll(snapshot.models, by));
    if (this.failure === 'audit') {
      this.failure = null;
      throw new Error('RECOVERY_INJECTED_audit');
    }
    this.audit.replaceFrom(snapshot.audit);
    // سجل المنتهين آخر ما يُبنى: مصدره السلسلة، فلا يُبنى إلا بعد استبدالها (البند T-99).
    if (this.failure === 'terminations') {
      this.failure = null;
      throw new Error('RECOVERY_INJECTED_terminations');
    }
    this.expectedTerminations = snapshot.terminations;
    this.terminationRoll.rebuildFrom(this.audit, by);
    return true;
  }
  verify(): boolean {
    const identities = [...this.population.records()];
    const resource = this.resources.exportAll().reservations.find(([name]) => name === 'identity_slots')?.[1] ?? [];
    return this.audit.verifyIntegrity().valid
      && identities.length === resource.length
      && identities.every((identity) => resource.includes(identity.agentId))
      && (this.expectedTerminations === null || this.terminationRoll.size >= this.expectedTerminations)
      && this.sharding.auditRecords(identities).length === 0;
  }
  /** العدد المتوقع لسجل المنتهين من آخر حمولة مستعادة — `null` قبل أي استعادة */
  private expectedTerminations: number | null = null;
}

export class RecoverySnapshotStore {
  private sequence = 0;
  constructor(private readonly directory: string, private readonly retention: number, private readonly archive: RoyalArchive, private readonly audit: AppendOnlyLog) {}
  take(now = Date.now()): { readonly file: string; readonly bytes: number; readonly archive: ArchiveSnapshot } {
    if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true });
    const archive = this.archive.snapshot('ministry:infrastructure', now);
    this.sequence += 1;
    const unsigned = { version: 1 as const, createdAt: now, archive };
    const envelope: RecoveryEnvelope = { ...unsigned, checksum: hash(unsigned) };
    const file = join(this.directory, `recovery-${now}-${this.sequence}.json`);
    const encoded = JSON.stringify(envelope);
    writeFileSync(file, encoded, 'utf8');
    this.audit.append('ministry:infrastructure', 'recovery_snapshot_written', { file: basename(file), bytes: Buffer.byteLength(encoded), snapshotId: archive.snapshotId });
    this.prune();
    return { file, bytes: Buffer.byteLength(encoded), archive };
  }
  load(file: string): RecoveryEnvelope {
    const directory = resolve(this.directory);
    const safe = basename(file) === file ? join(directory, file) : resolve(file);
    if (dirname(safe) !== directory) throw new Error('RECOVERY_PATH_REFUSED');
    if (!existsSync(safe)) throw new Error('RECOVERY_SNAPSHOT_MISSING');
    const envelope = JSON.parse(readFileSync(safe, 'utf8')) as RecoveryEnvelope;
    const { checksum, ...unsigned } = envelope;
    if (!envelope || envelope.version !== 1 || typeof checksum !== 'string' || hash(unsigned) !== checksum) {
      throw new Error('RECOVERY_SNAPSHOT_TAMPERED');
    }
    if (!this.archive.install(envelope.archive)) throw new Error('RECOVERY_ARCHIVE_TAMPERED');
    return envelope;
  }
  list(): readonly string[] { return existsSync(this.directory) ? readdirSync(this.directory).filter((name) => name.startsWith('recovery-') && name.endsWith('.json')).sort() : []; }
  private prune(): void {
    const files = [...this.list()];
    while (files.length > this.retention) {
      const file = files.shift()!;
      unlinkSync(join(this.directory, file));
      this.audit.append('ministry:infrastructure', 'recovery_snapshot_pruned', { file });
    }
  }
}
