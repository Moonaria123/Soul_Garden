import { describe, it, expect, beforeEach } from 'vitest';
import { DbClientError } from '@/lib/db/db-client';
import { useLocaleStore } from '@/lib/i18n';
import { mapLoginFlowError, mapOpenSessionError } from './login-error-map';

describe('mapOpenSessionError', () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: 'zh-CN' });
  });

  it('maps invalid_credentials with remaining', () => {
    const err = new DbClientError('invalid_credentials', 401, {
      error: 'invalid_credentials',
      remaining: 2,
    });
    expect(mapOpenSessionError(err)).toContain('2');
  });

  it('maps rate_limited with retryAfterSec', () => {
    const err = new DbClientError('rate_limited', 429, {
      error: 'rate_limited',
      retryAfterSec: 30,
    });
    expect(mapOpenSessionError(err)).toContain('30');
  });

  it('maps verify_failed', () => {
    const err = new DbClientError('verify_failed', 500, { error: 'verify_failed' });
    expect(mapOpenSessionError(err)).toContain('无法校验');
  });

  it('maps Failed to open database', () => {
    const err = new DbClientError('Failed to open database', 500, {
      error: 'Failed to open database',
    });
    expect(mapOpenSessionError(err)).toContain('数据库');
  });

  it('maps database_locked', () => {
    const err = new DbClientError('database_locked', 503, { error: 'database_locked' });
    expect(mapOpenSessionError(err)).toContain('占用');
  });

  it('maps accounts_write_failed', () => {
    const err = new DbClientError('accounts_write_failed', 500, { error: 'accounts_write_failed' });
    expect(mapOpenSessionError(err)).toContain('accounts.json');
  });

  it('maps http_* via status', () => {
    const err = new DbClientError('http_502', 502, { error: 'Bad gateway' });
    expect(mapOpenSessionError(err)).toContain('502');
  });
});

describe('mapLoginFlowError', () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: 'en' });
  });

  it('delegates DbClientError to mapOpenSessionError', () => {
    const err = new DbClientError('derive_failed', 500, { error: 'derive_failed' });
    expect(mapLoginFlowError(err)).toContain('encryption key');
  });

  it('maps AbortError to timeout message', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(mapLoginFlowError(err)).toContain('timed out');
  });

  it('maps TypeError fetch failures', () => {
    const err = new TypeError('Failed to fetch');
    expect(mapLoginFlowError(err)).toContain('reach');
  });

  it('maps invalid salt hex from client crypto', () => {
    const err = new Error('Invalid salt hex (expected even-length hex string)');
    expect(mapLoginFlowError(err)).toContain('encryption');
  });

  it('falls back for unknown errors', () => {
    expect(mapLoginFlowError(new Error('mystery'))).toContain('Something went wrong');
  });
});
