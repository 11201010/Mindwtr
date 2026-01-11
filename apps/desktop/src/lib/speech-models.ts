export const WHISPER_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const WHISPER_MODELS: Array<{ id: string; fileName: string; label: string }> = [
    { id: 'whisper-tiny', fileName: 'ggml-tiny.bin', label: 'whisper-tiny' },
    { id: 'whisper-tiny.en', fileName: 'ggml-tiny.en.bin', label: 'whisper-tiny.en' },
    { id: 'whisper-base', fileName: 'ggml-base.bin', label: 'whisper-base' },
    { id: 'whisper-base.en', fileName: 'ggml-base.en.bin', label: 'whisper-base.en' },
];

export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[0]?.id ?? 'whisper-tiny';

export const OPENAI_SPEECH_MODELS = ['gpt-4o-transcribe'];

export const GEMINI_SPEECH_MODELS = ['gemini-2.5-flash'];
