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
import { ContinuityController } from './continuity';

export type RecoveryStep = 'resources' | 'sharding' | 'population' | 'scheduler' | 'ministries' | 'contracts' | 'audit';
export interface RecoveryStateSnapshot {
  readonly version: 1;
  readonly resources: ReturnType<ResourceRegistry['exportAll']>;
  readonly sharding: ReturnType<Sharding['exportAll']>;
  readonly population: ReturnType<PopulationRegistry['exportAll']>;
  readonly scheduler: ReturnType<FairScheduler['exportAll']>;
  readonly ministries: ReturnType<MinistryRegistry['exportAll']>;
  readonly contracts: ReturnType<ExternalContractRegistry['exportAll']>;
  readonly audit: string;
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
  constructor(
    private readonly audit: AppendOnlyLog, private readonly resources: ResourceRegistry,
    private readonly sharding: Sharding, private readonly population: PopulationRegistry,
    private readonly scheduler: FairScheduler, private readonly ministries: MinistryRegistry,
    private readonly contracts: ExternalContractRegistry, private readonly continuity: ContinuityController,
  ) {}
  injectFailure(step: RecoveryStep | null): void { this.failure = step; }
  exportAll(): RecoveryStateSnapshot {
    return { version: 1, resources: this.resources.exportAll(), sharding: this.sharding.exportAll(),
      population: this.population.exportAll(), scheduler: this.scheduler.exportAll(),
      ministries: this.ministries.exportAll(), contracts: this.contracts.exportAll(), audit: this.audit.export() };
  }
  prepareRestore(): void { this.continuity.beginRestore(); }
  importAll(raw: unknown, by: string): boolean {
    const snapshot = raw as RecoveryStateSnapshot;
    if (!snapshot || snapshot.version !== 1 || typeof snapshot.audit !== 'string') throw new Error('RECOVERY_PAYLOAD_INVALID');
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
    if (this.failure === 'audit') {
      this.failure = null;
      throw new Error('RECOVERY_INJECTED_audit');
    }
    this.audit.replaceFrom(snapshot.audit);
    return true;
  }
  verify(): boolean {
    const identities = [...this.population.records()];
    const resource = this.resources.exportAll().reservations.find(([name]) => name === 'identity_slots')?.[1] ?? [];
    return this.audit.verifyIntegrity().valid
      && identities.length === resource.length
      && identities.every((identity) => resource.includes(identity.agentId))
      && this.sharding.auditRecords(identities).length === 0;
  }
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
