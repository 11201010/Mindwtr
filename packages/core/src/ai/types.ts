import type { TimeEstimate } from '../types';

export type AIProviderId = 'gemini' | 'openai' | 'anthropic';

export type AIReasoningEffort = 'low' | 'medium' | 'high';

export type AudioCaptureMode = 'smart_parse' | 'transcribe_only';

export type AudioFieldStrategy = 'smart' | 'title_only' | 'description_only';

export type ReviewAction = 'someday' | 'archive' | 'breakdown' | 'keep';

export interface ReviewSnapshotItem {
    id: string;
    title: string;
    daysStale: number;
    status: 'next' | 'waiting' | 'project';
}

export interface ReviewSuggestion {
    id: string;
    action: ReviewAction;
    reason: string;
}

export interface ReviewAnalysisResponse {
    suggestions: ReviewSuggestion[];
}

export interface ReviewAnalysisInput {
    items: ReviewSnapshotItem[];
}

export interface CopilotInput {
    title: string;
    contexts?: string[];
    tags?: string[];
}

export interface CopilotResponse {
    context?: string;
    timeEstimate?: TimeEstimate;
    tags?: string[];
}

export interface ClarifyOption {
    label: string;
    action: string;
}

export interface ClarifySuggestion {
    title: string;
    timeEstimate?: TimeEstimate;
    context?: string;
    isProject?: boolean;
}

export interface ClarifyResponse {
    question: string;
    options: ClarifyOption[];
    suggestedAction?: ClarifySuggestion;
}

export interface BreakdownResponse {
    steps: string[];
}

export interface ClarifyInput {
    title: string;
    contexts?: string[];
    projectTitle?: string;
    projectTasks?: string[];
}

export interface BreakdownInput {
    title: string;
    description?: string;
    projectTitle?: string;
    projectTasks?: string[];
}

export interface AIProviderConfig {
    provider: AIProviderId;
    apiKey: string;
    model: string;
    endpoint?: string;
    reasoningEffort?: AIReasoningEffort;
    thinkingBudget?: number;
    timeoutMs?: number;
}

export interface AIRequestOptions {
    signal?: AbortSignal;
}

export interface AIProvider {
    clarifyTask: (input: ClarifyInput, options?: AIRequestOptions) => Promise<ClarifyResponse>;
    breakDownTask: (input: BreakdownInput, options?: AIRequestOptions) => Promise<BreakdownResponse>;
    analyzeReview: (input: ReviewAnalysisInput, options?: AIRequestOptions) => Promise<ReviewAnalysisResponse>;
    predictMetadata: (input: CopilotInput, options?: AIRequestOptions) => Promise<CopilotResponse>;
}
