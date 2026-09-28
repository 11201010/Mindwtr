import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64 } from './base64-bytes';

describe('base64 bytes', () => {
    it('encodes standard padded base64 and round-trips every byte value', () => {
        expect(bytesToBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
        expect(bytesToBase64(new TextEncoder().encode('Ma'))).toBe('TWE=');
        expect(bytesToBase64(new TextEncoder().encode('M'))).toBe('TQ==');
        expect(bytesToBase64(new Uint8Array())).toBe('');

        const all = Uint8Array.from({ length: 256 }, (_, index) => index);
        expect(Array.from(base64ToBytes(bytesToBase64(all)))).toEqual(Array.from(all));
    });

    it('skips characters outside the alphabet and honors padding', () => {
        expect(Array.from(base64ToBytes('TW\nFu'))).toEqual([77, 97, 110]);
        expect(Array.from(base64ToBytes('TQ=='))).toEqual([77]);
    });

    it('decodes a truncated value to a shorter array, so a 32-byte key check fails closed', () => {
        const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
        const encoded = bytesToBase64(key);
        expect(base64ToBytes(encoded)).toHaveLength(32);
        expect(base64ToBytes(encoded.slice(0, 20)).length).toBeLessThan(32);
    });
});
