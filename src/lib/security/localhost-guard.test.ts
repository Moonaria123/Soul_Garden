import { describe, it, expect } from 'vitest';
import { isLoopbackHost } from './localhost-guard';

// SU-088 · P0-C — allow-list vs startsWith() regression tests.

describe('isLoopbackHost', () => {
  it('accepts plain loopback hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('accepts loopback hosts with ports', () => {
    expect(isLoopbackHost('localhost:3000')).toBe(true);
    expect(isLoopbackHost('127.0.0.1:8080')).toBe(true);
    expect(isLoopbackHost('[::1]:3000')).toBe(true);
  });

  it('is case-insensitive on the host portion', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('LocalHost:3000')).toBe(true);
  });

  it('rejects attacker-controlled prefix look-alikes', () => {
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.attacker.tld')).toBe(false);
    expect(isLoopbackHost('localhost-evil.com')).toBe(false);
    expect(isLoopbackHost('localhostx')).toBe(false);
    expect(isLoopbackHost('[::1]x')).toBe(false);
  });

  it('rejects remote hosts', () => {
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });

  it('rejects empty/null values', () => {
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });

  // SU-088 · P0-C · residual behaviour — documented as over-rejection.
  //
  // IPv4-mapped IPv6 forms (`::ffff:127.0.0.1`) are semantically loopback,
  // but no mainstream browser/server normalises a `Host` header to this
  // form for local traffic, and the guard's whitelist-only approach trades
  // off semantic exactness for proof-of-correctness simplicity.  We accept
  // the over-rejection (false) as safer than risking a bypass; the day
  // real traffic needs this form we would extend `LOOPBACK_HOSTS` instead
  // of broadening the parser.  Registered in threat model §6 alongside
  // reverse-proxy `x-forwarded-host` as a deployment-shape caveat.
  it('rejects IPv4-mapped IPv6 loopback forms (documented over-rejection)', () => {
    expect(isLoopbackHost('[::ffff:127.0.0.1]')).toBe(false);
    expect(isLoopbackHost('[::ffff:127.0.0.1]:3000')).toBe(false);
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(false);
  });
});
