import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, redactToken } from './logger.js';

describe('logger', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: ReturnType<typeof vi.spyOn<any, any>>;
  const originalEnv = process.env['CRMD1_LOG'];

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env['CRMD1_LOG'];
    } else {
      process.env['CRMD1_LOG'] = originalEnv;
    }
  });

  it('writes to stderr, never stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env['CRMD1_LOG'] = 'debug';
    logger.info('hello');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('formats output with [crmd1] prefix and level label', () => {
    process.env['CRMD1_LOG'] = 'info';
    logger.info('test message');
    const output = String((stderrSpy.mock.calls[0] as unknown[])[0]);
    expect(output).toMatch(/^\[crmd1\] INFO/);
    expect(output).toContain('test message');
  });

  it('includes JSON-serialized extra when provided', () => {
    process.env['CRMD1_LOG'] = 'debug';
    logger.debug('context', { key: 'value' });
    const output = String((stderrSpy.mock.calls[0] as unknown[])[0]);
    expect(output).toContain('{"key":"value"}');
  });

  it('filters out messages below active level', () => {
    process.env['CRMD1_LOG'] = 'error';
    logger.debug('should be hidden');
    logger.info('also hidden');
    logger.warn('also hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('emits messages at or above active level', () => {
    process.env['CRMD1_LOG'] = 'warn';
    logger.warn('visible warn');
    logger.error('visible error');
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it('defaults to warn level when CRMD1_LOG is unset', () => {
    delete process.env['CRMD1_LOG'];
    logger.debug('should be hidden');
    logger.info('should be hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
    logger.warn('should appear');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('handles unknown CRMD1_LOG value by defaulting to warn', () => {
    process.env['CRMD1_LOG'] = 'verbose';
    logger.info('hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
    logger.warn('visible');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });
});

describe('redactToken', () => {
  it('shows only last 4 chars', () => {
    expect(redactToken('abcdefgh')).toBe('****efgh');
  });

  it('handles tokens shorter than 4 chars', () => {
    expect(redactToken('ab')).toBe('****');
  });

  it('handles exactly 4 chars', () => {
    expect(redactToken('1234')).toBe('****');
  });
});
