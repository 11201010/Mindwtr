import { describe, expect, it } from 'vitest';

import {
    isLocalAttachmentPath,
    normalizeAttachmentPathForUrl,
    resolveAttachmentOpenTarget,
    toAttachmentBrowserUrl,
} from './attachment-paths';

describe('attachment path helpers', () => {
    it('treats file URIs and Windows paths as local attachments', () => {
        expect(isLocalAttachmentPath('file:///C:/Users/demo/Documents/spec.pdf')).toBe(true);
        expect(isLocalAttachmentPath('C:\\Users\\demo\\Documents\\spec.pdf')).toBe(true);
        expect(isLocalAttachmentPath('https://example.com/spec.pdf')).toBe(false);
    });

    it('strips file URIs into native open targets', () => {
        expect(resolveAttachmentOpenTarget('file:///C:/Users/demo/My%20Doc.pdf')).toBe('C:/Users/demo/My Doc.pdf');
        expect(resolveAttachmentOpenTarget('file:///tmp/demo.txt')).toBe('/tmp/demo.txt');
    });

    it('normalizes Windows paths for browser file URLs', () => {
        expect(normalizeAttachmentPathForUrl('C:\\Users\\demo\\file.png')).toBe('C:/Users/demo/file.png');
        expect(toAttachmentBrowserUrl('C:\\Users\\demo\\file.png')).toBe('file:///C:/Users/demo/file.png');
    });

    it('preserves non-file URLs', () => {
        expect(toAttachmentBrowserUrl('https://example.com/file.pdf')).toBe('https://example.com/file.pdf');
    });
});
