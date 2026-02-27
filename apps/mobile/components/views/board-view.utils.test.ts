import { describe, expect, it } from 'vitest';
import { resolveBoardDropColumnIndex } from './board-view.utils';

describe('resolveBoardDropColumnIndex', () => {
    it('keeps current column when drag is below trigger distance', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 20,
            currentColumnIndex: 2,
            columnCount: 5,
        })).toBe(2);
    });

    it('moves one column when crossing trigger distance', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 32,
            currentColumnIndex: 1,
            columnCount: 5,
        })).toBe(2);
    });

    it('moves multiple columns for larger drags', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 190,
            currentColumnIndex: 1,
            columnCount: 5,
        })).toBe(4);
        expect(resolveBoardDropColumnIndex({
            translationX: -190,
            currentColumnIndex: 3,
            columnCount: 5,
        })).toBe(0);
    });

    it('clamps output to valid column bounds', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: -100,
            currentColumnIndex: 0,
            columnCount: 5,
        })).toBe(0);
        expect(resolveBoardDropColumnIndex({
            translationX: 1000,
            currentColumnIndex: 4,
            columnCount: 5,
        })).toBe(4);
    });

    it('returns current index when column count is invalid', () => {
        expect(resolveBoardDropColumnIndex({
            translationX: 120,
            currentColumnIndex: 2,
            columnCount: 0,
        })).toBe(2);
    });
});
