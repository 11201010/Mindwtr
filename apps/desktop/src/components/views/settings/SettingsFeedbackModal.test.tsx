import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getEnglishSettingsLabels } from './labels';
import { SettingsFeedbackModal } from './SettingsFeedbackModal';

const t = getEnglishSettingsLabels();

const renderFeedbackModal = (props?: Partial<Parameters<typeof SettingsFeedbackModal>[0]>) => {
    const baseProps: Parameters<typeof SettingsFeedbackModal>[0] = {
        isConfigured: true,
        isOpen: true,
        onClose: vi.fn(),
        onOpenGitHub: vi.fn(),
        onSubmit: vi.fn().mockResolvedValue(undefined),
        t,
    };
    return render(<SettingsFeedbackModal {...baseProps} {...props} />);
};

describe('SettingsFeedbackModal', () => {
    it('exposes the selected feedback category', () => {
        renderFeedbackModal();

        expect(screen.getByRole('group', { name: t.feedbackCategory })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: t.feedbackCategoryBug })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: t.feedbackCategoryFeature })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: t.feedbackCategoryOther })).toHaveAttribute('aria-pressed', 'false');
    });

    it('uses category-specific message placeholders', () => {
        renderFeedbackModal();

        expect(screen.getByPlaceholderText(t.feedbackMessagePlaceholderBug)).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: t.feedbackWhere })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: t.feedbackCategoryFeature }));

        expect(screen.getByPlaceholderText(t.feedbackMessagePlaceholderFeature)).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: t.feedbackWhere })).not.toBeInTheDocument();
    });

    it('includes the selected bug location in the submitted message', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        renderFeedbackModal({ onSubmit });

        fireEvent.change(screen.getByRole('combobox', { name: t.feedbackWhere }), {
            target: { value: 'sync' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: t.feedbackMessage }), {
            target: { value: 'CloudKit sync failed' },
        });
        fireEvent.click(screen.getByRole('button', { name: t.feedbackSubmit }));
        expect(onSubmit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: t.feedbackSendWithoutEmail }));

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
                category: 'bug',
                message: 'Where: Sync\n\nCloudKit sync failed',
                email: undefined,
                includeDiagnostics: false,
            }));
        });
    });

    it.each([
        ['bug', t.feedbackCategoryBug, ''],
        ['bug', t.feedbackCategoryBug, '   '],
        ['feature', t.feedbackCategoryFeature, ''],
        ['feature', t.feedbackCategoryFeature, '   '],
        ['other', t.feedbackCategoryOther, ''],
        ['other', t.feedbackCategoryOther, '   '],
    ])('requires confirmation for %s feedback with email %j', async (category, categoryLabel, email) => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        renderFeedbackModal({ onSubmit });
        fireEvent.click(screen.getByRole('button', { name: categoryLabel }));
        fireEvent.change(screen.getByRole('textbox', { name: t.feedbackMessage }), {
            target: { value: 'Please improve this' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: t.feedbackEmail }), {
            target: { value: email },
        });

        fireEvent.click(screen.getByRole('button', { name: t.feedbackSubmit }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: t.feedbackNoEmailTitle })).toHaveTextContent(t.feedbackNoEmailDesc);
        expect(screen.getByRole('button', { name: t.feedbackAddEmail })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: t.feedbackSendWithoutEmail }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
            category,
            message: 'Please improve this',
            email: undefined,
            includeDiagnostics: false,
        }));
    });

    it('keeps the bug draft and focuses email when choosing to add an email', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        renderFeedbackModal({ onSubmit, onClose });
        await waitFor(() => expect(screen.getByRole('textbox', { name: t.feedbackMessage })).toHaveFocus());
        fireEvent.change(screen.getByRole('combobox', { name: t.feedbackWhere }), {
            target: { value: 'sync' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: t.feedbackMessage }), {
            target: { value: 'Keep this report' },
        });
        fireEvent.click(screen.getByRole('switch', { name: t.feedbackIncludeDiagnostics }));
        fireEvent.click(screen.getByRole('button', { name: t.feedbackSubmit }));
        fireEvent.click(screen.getByRole('button', { name: t.feedbackAddEmail }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: t.feedbackNoEmailTitle })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: t.feedbackMessage })).toHaveValue('Keep this report');
        expect(screen.getByRole('combobox', { name: t.feedbackWhere })).toHaveValue('sync');
        expect(screen.getByRole('switch', { name: t.feedbackIncludeDiagnostics })).toBeChecked();
        await waitFor(() => expect(screen.getByRole('textbox', { name: t.feedbackEmail })).toHaveFocus());

        fireEvent.change(screen.getByRole('textbox', { name: t.feedbackEmail }), {
            target: { value: ' reply@example.com ' },
        });
        fireEvent.click(screen.getByRole('button', { name: t.feedbackSubmit }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
            category: 'bug',
            message: 'Where: Sync\n\nKeep this report',
            email: 'reply@example.com',
            includeDiagnostics: true,
        }));
        expect(screen.queryByRole('dialog', { name: t.feedbackNoEmailTitle })).not.toBeInTheDocument();
    });

    it('blocks invalid email without offering anonymous submission', () => {
        const onSubmit = vi.fn();
        renderFeedbackModal({ onSubmit });
        fireEvent.change(screen.getByRole('textbox', { name: t.feedbackMessage }), {
            target: { value: 'A valid message' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: t.feedbackEmail }), {
            target: { value: 'invalid-email' },
        });

        expect(screen.getByText(t.feedbackInvalidEmail)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: t.feedbackSubmit })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: t.feedbackSubmit }));
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog', { name: t.feedbackNoEmailTitle })).not.toBeInTheDocument();
    });

    it.each([
        ['bug', t.feedbackCategoryBug, t.feedbackOpenGitHubIssue],
        ['feature', t.feedbackCategoryFeature, t.feedbackOpenGitHubIssue],
        ['other', t.feedbackCategoryOther, t.feedbackOpenGitHubDiscussion],
    ])('opens GitHub for %s without submitting or clearing the draft', (category, categoryLabel, linkLabel) => {
        const onOpenGitHub = vi.fn();
        const onClose = vi.fn();
        const onSubmit = vi.fn();
        renderFeedbackModal({ onOpenGitHub, onClose, onSubmit });
        const message = screen.getByRole('textbox', { name: t.feedbackMessage });
        fireEvent.change(message, { target: { value: 'Keep this draft' } });

        fireEvent.click(screen.getByRole('button', { name: categoryLabel }));
        const githubLink = screen.getByRole('button', { name: linkLabel });
        expect(githubLink.closest('p')).toHaveTextContent(
            t.feedbackGitHubDesc.replace('{channel}', linkLabel),
        );
        expect(screen.queryByText(/No account needed/)).not.toBeInTheDocument();
        expect(screen.queryByText(t.feedbackDesc)).not.toBeInTheDocument();
        expect(screen.queryByText(t.feedbackPrivacy)).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: t.feedbackEmail })).not.toBeRequired();
        fireEvent.click(screen.getByRole('button', { name: linkLabel }));

        expect(onOpenGitHub).toHaveBeenCalledExactlyOnceWith(category);
        expect(onClose).not.toHaveBeenCalled();
        expect(onSubmit).not.toHaveBeenCalled();
        expect(message).toHaveValue('Keep this draft');
    });

    it('routes unconfigured builds to GitHub issues', () => {
        const onOpenGitHub = vi.fn();
        renderFeedbackModal({ isConfigured: false, onOpenGitHub });

        expect(screen.getByText(t.feedbackUnavailableDesc)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: t.feedbackSubmit })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: t.feedbackOpenGitHubIssue }));

        expect(onOpenGitHub).toHaveBeenCalled();
    });
});
