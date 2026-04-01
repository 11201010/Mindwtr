import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';
import { LanguageProvider } from './contexts/language-context';

const renderWithProviders = (ui: React.ReactElement) => {
    return render(
        <LanguageProvider>
            {ui}
        </LanguageProvider>
    );
};

// Mock electronAPI
// Mock electronAPI
Object.defineProperty(window, 'electronAPI', {
    value: {
        saveData: vi.fn(),
        getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], settings: {} }),
    },
    writable: true,
});

describe('App', () => {
    it('renders Inbox by default', () => {
        const { getByRole } = renderWithProviders(<App />);
        expect(getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    });

    it('renders Sidebar navigation', () => {
        const { getByRole } = renderWithProviders(<App />);
        expect(getByRole('button', { name: 'Projects' })).toBeInTheDocument();
    });
});
