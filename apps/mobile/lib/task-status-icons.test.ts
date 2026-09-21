import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// #1256: an icon only helps while it means one thing. The inbox steps show Start later, Someday
// and Incubate side by side, next to statuses the editor shows as chips.
//
// The mobile test setup swaps every lucide icon for one stand-in, so comparing the icon objects
// would always pass or always fail. Read the glyph NAMES from the source instead.
describe('task status icons', () => {
    it('gives every status, Start later and Incubate a glyph of its own', () => {
        const source = readFileSync(path.join(__dirname, 'task-status-icons.ts'), 'utf8');
        const statusBlock = source.slice(source.indexOf('TASK_STATUS_ICONS'), source.indexOf('};'));
        const statusGlyphs = Array.from(statusBlock.matchAll(/^\s+\w+: (\w+),$/gm), (match) => match[1]);
        const extraGlyphs = Array.from(source.matchAll(/_ICON: LucideIcon = (\w+);/g), (match) => match[1]);

        expect(statusGlyphs).toHaveLength(7);
        expect(extraGlyphs).toHaveLength(2);
        const glyphs = [...statusGlyphs, ...extraGlyphs];
        expect(new Set(glyphs).size).toBe(glyphs.length);
        // Waiting never wears the hourglass: the editor uses it for Time estimate.
        expect(glyphs).not.toContain('Hourglass');
    });
});
