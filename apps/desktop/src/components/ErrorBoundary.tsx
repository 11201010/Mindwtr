import { Component, ErrorInfo, ReactNode } from 'react';
import { logError } from '../lib/app-log';
import { useLanguage } from '../contexts/language-context';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    strings?: {
        title: string;
        message: string;
        retry: string;
    };
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class BaseErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        void logError(error, {
            scope: 'react',
            extra: { componentStack: errorInfo.componentStack || '' },
        });
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-screen flex items-center justify-center bg-background" role="alert" aria-live="assertive">
                    <div className="max-w-md p-8 text-center space-y-4">
                        <div className="text-6xl">💥</div>
                        <h1 className="text-2xl font-bold text-foreground">{this.props.strings?.title ?? 'Something went wrong'}</h1>
                        <p className="text-muted-foreground">
                            {this.props.strings?.message ?? 'The app encountered an unexpected error.'}
                        </p>
                        <div className="bg-muted p-4 rounded-lg text-left">
                            <p className="text-sm font-mono text-destructive">
                                {this.state.error?.message}
                            </p>
                        </div>
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium hover:bg-primary/90"
                        >
                            {this.props.strings?.retry ?? 'Try again'}
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export function ErrorBoundary({ children, fallback }: Omit<Props, 'strings'>) {
    const { t } = useLanguage();
    return (
        <BaseErrorBoundary
            fallback={fallback}
            strings={{
                title: t('errorBoundary.title'),
                message: t('errorBoundary.message'),
                retry: t('errorBoundary.retry'),
            }}
        >
            {children}
        </BaseErrorBoundary>
    );
}
