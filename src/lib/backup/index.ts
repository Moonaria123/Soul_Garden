'use client';

export {
  BACKUP_FORMAT_VERSION,
  MIN_SUPPORTED_BACKUP_VERSION,
  BACKUP_FILE_EXTENSION,
  APP_VERSION,
  BackupVersionError,
  createBackupZip,
  readBackupZip,
  migrateBackupManifest,
  downloadBackupFile,
  generateBackupFilename,
  type BackupType,
  type BackupScope,
  type BackupManifest,
  type BackupStats,
  type BackupVersionErrorCode,
  type ChatBackupPayload,
  type EntityBackupPayload,
  type ConfigBackupPayload,
  type GlobalBackupPayload,
} from './backup-format';

export {
  encryptPayload,
  decryptPayload,
} from './backup-crypto';

export {
  serializeChatPayload,
  serializeEntityPayload,
  serializeConfigPayload,
  serializeFullPayload,
  serializeAllEntitiesPayload,
} from './backup-serializer';

export {
  validateBackup,
  parseBackupPayload,
  restoreChatPayload,
  restoreEntityPayload,
  restoreConfigPayload,
  restoreFullPayload,
  V1BackupPasswordRequiredError,
  V1BackupDeriveFailedError,
  type RestoreStrategy,
  type EntityRestoreStrategy,
  type ValidateResult,
  type ParseBackupOptions,
  type LegacyPasswordProvider,
  type LegacyPasswordProviderInput,
} from './backup-restore';

export {
  type BackupProgressCallback,
  type BackupProgressPhase,
  noopProgress,
} from './backup-progress';
