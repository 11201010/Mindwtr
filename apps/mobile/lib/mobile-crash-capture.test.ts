import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_FATAL_CRASH_MAX_BYTES,
  createLocalFatalCrashCapture,
  type LocalFatalCrashStorage,
} from './mobile-crash-capture';

const createMemoryStorage = () => {
  let value: string | null = null;
  const storage: LocalFatalCrashStorage = {
    clearTextSync: vi.fn(() => {
      value = null;
    }),
    getPath: () => value ? 'file://document/logs/mindwtr-fatal-js-crash.json' : null,
    readTextSync: () => value,
    writeTextSync: vi.fn((next: string) => {
      value = next;
    }),
  };
  return { storage, value: () => value };
};

describe('local fatal JavaScript crash capture', () => {
  it('overwrites one bounded slot with privacy-safe technical evidence', () => {
    const memory = createMemoryStorage();
    const capture = createLocalFatalCrashCapture(memory.storage, {
      platform: 'android',
      appVersion: '1.3.1',
      buildVersion: '144',
    }, {
      now: () => new Date('2026-09-14T12:34:56.000Z'),
    });
    const error = new TypeError("Cannot read properties of undefined (reading 'Buy milk for Alice')");
    error.stack = [
      `TypeError: ${error.message} token=private-token`,
      '    at renderTask (address at https://name:secret@example.com/private/index.android.bundle?token=private-token:123:45)',
      '    at Object.open (/home/alice/private-project/screen.tsx:56:78)',
      `    at ${'validIdentifier'.repeat(40)} (/home/alice/private-project/long-frame.tsx:79:80)`,
      `    at ${'x'.repeat(50_000)} (/home/alice/private.tsx:1:2)`,
    ].join('\n');

    capture.capture(error);

    const raw = memory.value();
    expect(raw).not.toBeNull();
    expect(new TextEncoder().encode(raw ?? '').byteLength).toBeLessThanOrEqual(LOCAL_FATAL_CRASH_MAX_BYTES);
    expect(raw).not.toContain('v1.3.1/local-crash-capture');
    expect(raw).toContain('Cannot read properties of undefined (property omitted)');
    expect(raw).toContain('renderTask');
    expect(raw).toContain('index.android.bundle:123:45');
    expect(raw).toContain('screen.tsx:56:78');
    expect(raw).toContain('at <anonymous> (long-frame.tsx:79:80)');
    expect(raw).not.toContain('Buy milk');
    expect(raw).not.toContain('Alice');
    expect(raw).not.toContain('private-token');
    expect(raw).not.toContain('example.com');
    expect(raw).not.toContain('/home/');
    expect(capture.read()).toMatchObject({
      ts: '2026-09-14T12:34:56.000Z',
      level: 'error',
      scope: 'fatal-recovery',
      context: {
        platform: 'android',
        appVersion: '1.3.1',
        buildVersion: '144',
        exceptionType: 'TypeError',
      },
    });

    capture.capture(new RangeError('Maximum call stack size exceeded'));

    expect(memory.storage.writeTextSync).toHaveBeenCalledTimes(2);
    expect(memory.value()).toContain('Maximum call stack size exceeded');
    expect(memory.value()).not.toContain('Cannot read properties');
  });

  it('omits arbitrary exception text instead of relying on generic string redaction', () => {
    const memory = createMemoryStorage();
    const capture = createLocalFatalCrashCapture(memory.storage);
    const error = new Error('Finish the private launch plan for Project Falcon');
    error.stack = 'Error: Finish the private launch plan for Project Falcon\n    at saveTask (/Users/alice/Mindwtr/task.ts:1:2)';

    capture.capture(error);

    expect(memory.value()).toContain('Fatal JavaScript error (message omitted for privacy)');
    expect(memory.value()).toContain('task.ts:1:2');
    expect(memory.value()).not.toContain('private launch plan');
    expect(memory.value()).not.toContain('Project Falcon');
    expect(memory.value()).not.toContain('/Users/alice');
  });

  it('handles hostile getters, cycles, invalid Unicode, huge strings, and sanitizer failure', () => {
    const memory = createMemoryStorage();
    const hostile: Record<string, unknown> = {};
    hostile.self = hostile;
    Object.defineProperties(hostile, {
      message: { get: () => { throw new Error('message getter'); } },
      name: { get: () => { throw new Error('name getter'); } },
      stack: { get: () => { throw new Error('stack getter'); } },
    });
    const capture = createLocalFatalCrashCapture(memory.storage, {
      platform: `android\ud800${'x'.repeat(100_000)}`,
    }, {
      sanitize: () => { throw new Error('sanitizer unavailable'); },
    });

    expect(() => capture.capture(hostile)).not.toThrow();
    expect(memory.value()).toContain('message omitted for privacy');
    expect(memory.value()).toContain('UnknownException');
    expect(memory.value()).toContain('"platform":"unknown"');
    expect(new TextEncoder().encode(memory.value() ?? '').byteLength).toBeLessThanOrEqual(LOCAL_FATAL_CRASH_MAX_BYTES);
  });

  it('retains invalid-Unicode technical failures without emitting the raw property payload', () => {
    const memory = createMemoryStorage();
    const capture = createLocalFatalCrashCapture(memory.storage);
    const error = new TypeError(`Cannot read properties of undefined (reading 'private\ud800${'x'.repeat(100_000)}')`);

    capture.capture(error);

    expect(capture.read()?.message).toBe('Cannot read properties of undefined (property omitted)');
    expect(memory.value()).not.toContain('private');
    expect(new TextEncoder().encode(memory.value() ?? '').byteLength).toBeLessThanOrEqual(LOCAL_FATAL_CRASH_MAX_BYTES);
  });

  it('bounds input before normalization and avoids whole-string code-point arrays', () => {
    const memory = createMemoryStorage();
    const capture = createLocalFatalCrashCapture(memory.storage, {
      platform: `android${'x'.repeat(1_000_000)}`,
    });
    const error = new TypeError(`Cannot read properties of undefined (reading '${'private'.repeat(200_000)}')`);
    error.stack = 'TypeError: private text\n    at renderTask (index.android.bundle:1:2)';
    const arrayFromSpy = vi.spyOn(Array, 'from');
    const replaceSpy = vi.spyOn(String.prototype, 'replace');

    try {
      capture.capture(error);
      const replaceReceiverLengths = replaceSpy.mock.contexts.map((context) => String(context).length);
      expect(Math.max(...replaceReceiverLengths)).toBeLessThanOrEqual(32_768);
      expect(arrayFromSpy).not.toHaveBeenCalled();
    } finally {
      arrayFromSpy.mockRestore();
      replaceSpy.mockRestore();
    }
  });

  it('maps private-looking writable error names to the fixed standard class fallback', () => {
    const memory = createMemoryStorage();
    const capture = createLocalFatalCrashCapture(memory.storage);

    for (const name of ['ProjectFalconError', 'PrivateRoadmapException']) {
      const error = new Error('Maximum call stack size exceeded');
      error.name = name;
      capture.capture(error);
      expect(capture.read()?.context.exceptionType).toBe('Error');
      expect(memory.value()).not.toContain(name);
    }
  });

  it('round-trips bounded React error codes and omits oversized codes', () => {
    const memory = createMemoryStorage();
    const capture = createLocalFatalCrashCapture(memory.storage);

    capture.capture(new Error('Minified React error #418; visit the decoder'));
    expect(capture.read()?.message).toBe('Minified React error #418');

    capture.capture(new Error(`Minified React error #${'7'.repeat(100_000)}`));
    expect(capture.read()).toMatchObject({
      message: 'Fatal JavaScript error (message omitted for privacy)',
    });
    expect(memory.value()).not.toContain('7777777777');
  });

  it('reconstructs the retained schema and reserializes without extra fields', () => {
    const memory = createMemoryStorage();
    const capture = createLocalFatalCrashCapture(memory.storage);
    memory.storage.writeTextSync(`${JSON.stringify({
      ts: '2026-09-14T12:34:56.000Z',
      level: 'error',
      scope: 'fatal-recovery',
      message: 'Maximum call stack size exceeded',
      stack: 'at renderTask (index.android.bundle:123:45)',
      privateTopLevel: 'Project Falcon',
      context: {
        platform: 'android',
        appVersion: '1.3.1',
        buildVersion: '144',
        exceptionType: 'ProjectFalconError',
        privateContext: 'Private roadmap',
      },
    })}\n`);

    expect(capture.read()).toEqual({
      ts: '2026-09-14T12:34:56.000Z',
      level: 'error',
      scope: 'fatal-recovery',
      message: 'Maximum call stack size exceeded',
      stack: 'at renderTask (index.android.bundle:123:45)',
      context: {
        platform: 'android',
        appVersion: '1.3.1',
        buildVersion: '144',
        exceptionType: 'UnknownException',
      },
    });
    expect(capture.readText()).toBe(`${JSON.stringify(capture.read())}\n`);
    expect(capture.readText()).not.toContain('Project Falcon');
    expect(capture.readText()).not.toContain('Private roadmap');
    expect(capture.readText()).not.toContain('ProjectFalconError');
  });
});
