import fs from 'node:fs';
import path from 'node:path';

type CorpusCase = {
  id: string;
  category: 'retrieval' | 'stale-removal' | 'bounded' | 'cancellation' | 'unavailable';
  expectedTaskIds?: string[];
  expectedOutcome?: 'cancelled' | 'unavailable';
};

type Corpus = {
  version: number;
  resultLimit: number;
  thresholds: {
    minimumMeanPrecision: number;
    minimumMeanRecall: number;
    maximumP95LatencyMs: number;
    maximumMemoryDeltaMb: number;
  };
  cases: CorpusCase[];
};

type ObservedResult = {
  caseId: string;
  outcome: 'complete' | 'cancelled' | 'unavailable' | 'failed';
  taskIds: string[];
  latencyMs: number;
  memoryDeltaMb: number;
};

type Run = {
  corpusVersion: number;
  environment: Record<string, string>;
  results: ObservedResult[];
};

const directory = import.meta.dir;
const corpus = JSON.parse(fs.readFileSync(path.join(directory, 'search-corpus.json'), 'utf8')) as Corpus;
const runPath = path.resolve(process.argv[2] ?? path.join(directory, 'search-results.fixture.json'));
const run = JSON.parse(fs.readFileSync(runPath, 'utf8')) as Run;
const failures: string[] = [];

if (run.corpusVersion !== corpus.version) {
  failures.push(`corpus version ${run.corpusVersion} does not match ${corpus.version}`);
}

const resultByCaseId = new Map(run.results.map((result) => [result.caseId, result]));
if (resultByCaseId.size !== run.results.length) failures.push('run contains duplicate case ids');

const precisionValues: number[] = [];
const recallValues: number[] = [];
const completedLatencies: number[] = [];
let maximumMemoryDeltaMb = 0;

for (const testCase of corpus.cases) {
  const observed = resultByCaseId.get(testCase.id);
  if (!observed) {
    failures.push(`${testCase.id}: missing result`);
    continue;
  }
  if (!Number.isFinite(observed.latencyMs) || observed.latencyMs < 0) {
    failures.push(`${testCase.id}: invalid latency`);
  }
  if (!Number.isFinite(observed.memoryDeltaMb) || observed.memoryDeltaMb < 0) {
    failures.push(`${testCase.id}: invalid memory delta`);
  } else {
    maximumMemoryDeltaMb = Math.max(maximumMemoryDeltaMb, observed.memoryDeltaMb);
  }
  if (observed.taskIds.length > corpus.resultLimit) {
    failures.push(`${testCase.id}: returned ${observed.taskIds.length}, above the ${corpus.resultLimit} result cap`);
  }
  if (new Set(observed.taskIds).size !== observed.taskIds.length) {
    failures.push(`${testCase.id}: returned duplicate task ids`);
  }

  if (testCase.expectedOutcome) {
    if (observed.outcome !== testCase.expectedOutcome) {
      failures.push(`${testCase.id}: expected ${testCase.expectedOutcome}, observed ${observed.outcome}`);
    }
    if (observed.taskIds.length > 0) failures.push(`${testCase.id}: non-complete outcome returned task ids`);
    continue;
  }

  if (observed.outcome !== 'complete') {
    failures.push(`${testCase.id}: expected complete, observed ${observed.outcome}`);
    continue;
  }
  completedLatencies.push(observed.latencyMs);
  const expected = new Set(testCase.expectedTaskIds ?? []);
  const actual = new Set(observed.taskIds);
  const truePositiveCount = [...actual].filter((id) => expected.has(id)).length;
  const precision = actual.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositiveCount / actual.size;
  const recall = expected.size === 0 ? (actual.size === 0 ? 1 : 0) : truePositiveCount / expected.size;
  precisionValues.push(precision);
  recallValues.push(recall);
}

for (const result of run.results) {
  if (!corpus.cases.some((testCase) => testCase.id === result.caseId)) {
    failures.push(`${result.caseId}: result is not declared in the corpus`);
  }
}

const mean = (values: number[]) => values.length === 0
  ? 0
  : values.reduce((total, value) => total + value, 0) / values.length;
const percentile95 = (values: number[]) => {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};
const meanPrecision = mean(precisionValues);
const meanRecall = mean(recallValues);
const p95LatencyMs = percentile95(completedLatencies);

if (meanPrecision < corpus.thresholds.minimumMeanPrecision) {
  failures.push(`mean precision ${meanPrecision.toFixed(3)} is below ${corpus.thresholds.minimumMeanPrecision}`);
}
if (meanRecall < corpus.thresholds.minimumMeanRecall) {
  failures.push(`mean recall ${meanRecall.toFixed(3)} is below ${corpus.thresholds.minimumMeanRecall}`);
}
if (p95LatencyMs > corpus.thresholds.maximumP95LatencyMs) {
  failures.push(`p95 latency ${p95LatencyMs}ms exceeds ${corpus.thresholds.maximumP95LatencyMs}ms`);
}
if (maximumMemoryDeltaMb > corpus.thresholds.maximumMemoryDeltaMb) {
  failures.push(`memory delta ${maximumMemoryDeltaMb}MB exceeds ${corpus.thresholds.maximumMemoryDeltaMb}MB`);
}

const summary = {
  run: runPath,
  environment: run.environment,
  cases: corpus.cases.length,
  meanPrecision: Number(meanPrecision.toFixed(3)),
  meanRecall: Number(meanRecall.toFixed(3)),
  p95LatencyMs,
  maximumMemoryDeltaMb,
  failures,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) process.exitCode = 1;
