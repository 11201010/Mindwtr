import { describe, expect, it } from 'vitest';
import { createSearchHighlighter } from './search-highlight';

const compact = (query: string, text: string) =>
    createSearchHighlighter(query)(text)
        .map(
            (segment) =>
                `${segment.highlighted ? '[' : ''}${segment.text}${segment.highlighted ? ']' : ''}`,
        )
        .join('');

describe('createSearchHighlighter', () => {
    it('highlights nonadjacent plain terms without changing source case or spacing', () => {
        expect(compact('beta\nALPHA', 'Alpha keeps  beta apart')).toBe(
            '[Alpha] keeps  [beta] apart',
        );
    });

    it('highlights literal CJK terms and regex punctuation', () => {
        expect(compact('搬家 清單', '準備搬家清單')).toBe('準備[搬家清單]');
        expect(compact('C++ file[1]', 'Fix C++ in file[1].')).toBe(
            'Fix [C++] in [file[1]].',
        );
    });

    it('deduplicates repeated terms and merges overlapping matches', () => {
        expect(createSearchHighlighter('aba bab ABA')('abab')).toEqual([
            { text: 'abab', highlighted: true },
        ]);
    });

    it('ignores negated terms and OR while retaining words the parser treats as literals', () => {
        expect(
            compact(
                'alpha -beta OR gamma AND not near',
                'alpha beta gamma AND not near',
            ),
        ).toBe('[alpha] beta [gamma] [AND] [not] [near]');
    });

    it('returns the original text without highlights for blank or structured queries', () => {
        expect(createSearchHighlighter('   ')('Alpha')).toEqual([
            { text: 'Alpha', highlighted: false },
        ]);
        expect(
            createSearchHighlighter('status:next Alpha')('Alpha next'),
        ).toEqual([{ text: 'Alpha next', highlighted: false }]);
    });
});
