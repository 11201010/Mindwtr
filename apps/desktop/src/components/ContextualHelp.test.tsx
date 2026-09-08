import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContextualHelp } from './ContextualHelp';
import { dismissDesktopOnboardingHint } from '../lib/desktop-onboarding-events';

const t = (key: string) => key;
describe('ContextualHelp', () => {
    beforeEach(() => localStorage.clear());
    it('collapses on dismissal, survives remount, and can be reopened', () => {
        const { unmount } = render(<ContextualHelp topic="focus" t={t} />);
        expect(screen.getByText('onboarding.focusHint')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'common.dismiss' }));
        expect(screen.queryByText('onboarding.focusHint')).not.toBeInTheDocument();
        unmount();
        render(<ContextualHelp topic="focus" t={t} />);
        const help = screen.getByRole('button', { name: 'onboarding.help: agenda.title' });
        expect(help).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(help);
        expect(help).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('link')).toHaveAttribute('href', 'https://docs.mindwtr.app/use/desktop#%F0%9F%8E%AF-focus');
    });
    it('keeps the previous Inbox dismissal and does not transfer it to other topics', () => {
        dismissDesktopOnboardingHint('inbox-project');
        const { rerender } = render(<ContextualHelp topic="inbox-project" t={t} />);
        expect(screen.queryByText('inbox.projectHint')).not.toBeInTheDocument();
        rerender(<ContextualHelp topic="scheduling" t={t} />);
        expect(screen.getByText('onboarding.schedulingHint')).toBeInTheDocument();
    });
    it('leaves optional help closed when auto reveal is off', () => {
        render(<ContextualHelp topic="details" t={t} autoReveal={false} />);
        expect(screen.queryByText('onboarding.detailsHint')).not.toBeInTheDocument();
    });
});
