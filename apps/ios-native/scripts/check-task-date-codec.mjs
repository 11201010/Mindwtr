import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(app, 'App/TaskViewSheet.swift'), 'utf8');
const start = source.indexOf('enum TaskDatePickerComponents {');
const end = source.indexOf('\nprivate struct TaskRecurrenceField:', start);
if (start < 0 || end < 0) throw new Error('TaskDatePickerComponents source boundary changed');
const cases = ['1970-01-01T00:00:00.000Z', '2026-10-02T12:34:56.789Z', '1582-01-02T03:04:05.678Z',
    '0000-01-02T03:04:05.678Z', '-000001-01-02T03:04:05.678Z', '+020000-01-02T03:04:05.678Z'];
const oracle = cases.map(value => {
    const epoch = Date.parse(value);
    if (!Number.isFinite(epoch)) throw new Error(`Invalid JS oracle ${value}`);
    return `(${JSON.stringify(value)}, ${epoch}.0, ${JSON.stringify(new Date(epoch + 60_000).toISOString())}, ${JSON.stringify(new Date(epoch - 60_000).toISOString())})`;
}).join(',\n');
const swift = `import Foundation
typealias CoreObject = [String: Any]
extension Dictionary where Key == String, Value == Any {
    func text(_ name: String) -> String { self[name] as? String ?? "" }
}
${source.slice(start, end)}
let cases: [(String, Double, String, String)] = [${oracle}]
for (value, epoch, changedMinute, earlierMinute) in cases {
    guard let parsed = TaskDatePickerComponents.instant(value) else { fatalError("Cannot parse \\(value)") }
    precondition(abs(parsed.timeIntervalSince1970 * 1_000 - epoch) < 0.5, "Epoch differs for \\(value)")
    precondition(TaskDatePickerComponents.instantString(parsed) == value, "Round trip differs for \\(value)")
    precondition(TaskDatePickerComponents.instantString(Date(timeIntervalSince1970: epoch / 1_000)) == value,
                 "JS epoch differs for \\(value)")
    precondition(TaskDatePickerComponents.instantString(Date(timeIntervalSince1970: (epoch + 60_000) / 1_000)) == changedMinute,
                 "Changed minute differs for \\(value)")
    precondition(TaskDatePickerComponents.instantString(Date(timeIntervalSince1970: (epoch - 60_000) / 1_000)) == earlierMinute,
                 "Earlier minute differs for \\(value)")
}
for invalid in ["2026-10-02", "2026-10-02T12:34:56Z", "2026-02-30T12:34:56.789Z", "-000000-01-02T03:04:05.678Z"] {
    precondition(TaskDatePickerComponents.instant(invalid) == nil, "Accepted noncanonical \\(invalid)")
}
print("TaskDatePickerComponents JS instant parity: \\(cases.count) ordinary/precision/proleptic/extended cases and changed minutes passed")
`;
const folder = resolve(app, '../../.orchestrator/task-date-codec-check');
mkdirSync(folder, { recursive: true });
const path = resolve(folder, 'check.swift');
writeFileSync(path, swift);
if (process.argv.includes('--emit-only')) console.log(path);
else {
    const result = spawnSync('swift', [path], { stdio: 'inherit', env: { ...process.env, TMPDIR: folder } });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
