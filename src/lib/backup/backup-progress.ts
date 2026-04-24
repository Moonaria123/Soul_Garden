'use client';

// ============================================================
// Backup Progress Tracking
// Provides a callback-based progress reporting mechanism
// for large backup/restore operations.
// ============================================================

export type BackupProgressPhase =
  | 'preparing'
  | 'serializing-entities'
  | 'serializing-chat'
  | 'serializing-config'
  | 'encrypting'
  | 'compressing'
  | 'validating'
  | 'restoring-entities'
  | 'restoring-chat'
  | 'restoring-config'
  | 'complete';

export type BackupProgressCallback = (
  phase: BackupProgressPhase,
  current: number,
  total: number,
) => void;

export function noopProgress(): BackupProgressCallback {
  return () => {};
}
