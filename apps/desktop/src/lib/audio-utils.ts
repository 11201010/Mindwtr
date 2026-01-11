const clampSample = (value: number) => Math.max(-1, Math.min(1, value));

export const resampleAudio = (
    input: Float32Array,
    inputSampleRate: number,
    targetSampleRate: number
): Float32Array => {
    if (inputSampleRate === targetSampleRate) return input;
    if (input.length === 0) return new Float32Array();
    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
        const position = i * ratio;
        const index = Math.floor(position);
        const nextIndex = Math.min(index + 1, input.length - 1);
        const fraction = position - index;
        const sample = input[index] * (1 - fraction) + input[nextIndex] * fraction;
        output[i] = sample;
    }
    return output;
};

export const encodeWav = (samples: Float32Array, sampleRate: number): Uint8Array => {
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * bytesPerSample, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
        const clamped = clampSample(samples[i]);
        const sample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        view.setInt16(offset, sample, true);
        offset += 2;
    }

    return new Uint8Array(buffer);
};
