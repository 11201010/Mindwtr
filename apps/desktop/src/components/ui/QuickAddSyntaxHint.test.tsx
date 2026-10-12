import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useTaskStore } from '@mindwtr/core';
import { QuickAddSyntaxHint } from './QuickAddSyntaxHint';

describe('QuickAddSyntaxHint', () => {
    const initialSettings = useTaskStore.getState().settings;
    afterEach(() => useTaskStore.setState({ settings: initialSettings }));

    it('hides the estimate token while Time estimates is off (#1358)', () => {
        useTaskStore.setState({ settings: { ...initialSettings, features: { timeEstimates: false } } });
        const { container } = render(<QuickAddSyntaxHint text="Quick add supports /review:<when>, /estimate:45m, /note:<text>." />);
        expect(container.textContent).toBe('Quick add supports /review:<when>, /note:<text>.');
    });

    it('emphasizes entry tokens and dims placeholder parts', () => {
        const { container } = render(
            <QuickAddSyntaxHint text='Quick add supports /start:<when>, @context, +Project, %"Full Name".' />
        );
        const tokens = Array.from(container.querySelectorAll('span.font-medium')).map((el) => el.textContent);
        expect(tokens).toEqual(['/start:', '@context', '+Project', '%"Full Name"']);
        const meta = Array.from(container.querySelectorAll('span.opacity-70')).map((el) => el.textContent);
        expect(meta).toEqual(['<when>']);
        expect(container.textContent).toBe('Quick add supports /start:<when>, @context, +Project, %"Full Name".');
    });

    it('renders text without recognizable tokens unchanged', () => {
        const { container } = render(<QuickAddSyntaxHint text="Due dates stay date-only." />);
        expect(container.querySelector('span')).toBeNull();
        expect(container.textContent).toBe('Due dates stay date-only.');
    });
});
