import { describe, expect, it } from 'vitest';
import { resolveBoardDropColumnIndex, resolveBoardDropColumnIndexFromY } from './board-view.utils';

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

describe('resolveBoardDropColumnIndexFromY', () => {
    const bounds = [
        { index: 0, top: 0, bottom: 100 },
        { index: 1, top: 120, bottom: 220 },
        { index: 2, top: 240, bottom: 340 },
    ];

    it('matches the column containing drag center', () => {
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 150,
            currentColumnIndex: 0,
            columnBounds: bounds,
        })).toBe(1);
    });

    it('returns nearest column when drag center lands in a gap', () => {
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 111,
            currentColumnIndex: 2,
            columnBounds: bounds,
        })).toBe(1);
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 231,
            currentColumnIndex: 0,
            columnBounds: bounds,
        })).toBe(2);
    });

    it('returns current column when drag center or bounds are invalid', () => {
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: Number.NaN,
            currentColumnIndex: 2,
            columnBounds: bounds,
        })).toBe(2);
        expect(resolveBoardDropColumnIndexFromY({
            dragCenterY: 180,
            currentColumnIndex: 1,
            columnBounds: [],
        })).toBe(1);
    });
});
