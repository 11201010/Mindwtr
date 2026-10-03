// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Markdown } from './Markdown';
import { LanguageProvider } from '../contexts/language-context';

const openShell = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: openShell }));

describe('Markdown', () => {
    it('renders explicit UpNote descriptions and preserves their URI through the opener', async () => {
        const uri = 'upnote://x-callback-url/openNote?noteId=Note%2FCase%2520&new_window=true';
        (window as any).__TAURI_INTERNALS__ = {};
        try {
            const { getByRole } = render(<LanguageProvider><Markdown markdown={`[Note](${uri})`} /></LanguageProvider>);
            expect(openShell).not.toHaveBeenCalled();
            expect(getByRole('link', { name: 'Note' })).toHaveAttribute('title', uri);
            fireEvent.click(getByRole('link', { name: 'Note' }));
            await waitFor(() => expect(openShell).toHaveBeenCalledWith(uri));
        } finally {
            delete (window as any).__TAURI_INTERNALS__;
            openShell.mockClear();
        }
    });

    it('renders list blocks after plain text without requiring a blank line', () => {
        const { container, getByText } = render(
            <LanguageProvider>
                <Markdown markdown={'Intro line\n- item one\n- item two'} />
            </LanguageProvider>
        );
        expect(getByText('item one')).toBeTruthy();
        expect(container.querySelectorAll('ul').length).toBe(1);
    });

    it('renders task list checkboxes when immediately following text', () => {
        const { getAllByRole } = render(
            <LanguageProvider>
                <Markdown markdown={'Notes\n- [x] done\n- [ ] todo'} />
            </LanguageProvider>
        );
        const checkboxes = getAllByRole('checkbox') as HTMLInputElement[];
        expect(checkboxes).toHaveLength(2);
        expect(checkboxes[0]?.checked).toBe(true);
        expect(checkboxes[1]?.checked).toBe(false);
    });

    it('indents nested bullet and task list items by their leading whitespace', () => {
        const { container } = render(
            <LanguageProvider>
                <Markdown markdown={'- parent\n  - child\n    - grandchild\nSteps\n- [ ] top\n\t- [x] nested'} />
            </LanguageProvider>
        );
        const bullets = Array.from(container.querySelectorAll('ul')[0]?.querySelectorAll('li') ?? []);
        expect(bullets.map((li) => li.style.marginLeft)).toEqual(['', '14px', '28px']);
        const tasks = Array.from(container.querySelectorAll('ul')[1]?.querySelectorAll('li') ?? []);
        expect(tasks.map((li) => li.style.marginLeft)).toEqual(['', '28px']);
    });

    it('renders horizontal separator from markdown hr syntax', () => {
        const { container } = render(
            <LanguageProvider>
                <Markdown markdown={'Top\n---\nBottom'} />
            </LanguageProvider>
        );
        expect(container.querySelector('hr')).not.toBeNull();
    });

    it('preserves intentional blank lines between blocks', () => {
        const { container } = render(
            <LanguageProvider>
                <Markdown markdown={'Top\n\nBottom'} />
            </LanguageProvider>
        );

        expect(container.querySelectorAll('.mindwtr-markdown-blank-line')).toHaveLength(1);
    });
});
