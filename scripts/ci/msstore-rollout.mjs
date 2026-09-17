import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://manage.devcenter.microsoft.com/v1.0/my';
const API_BASE = new URL(`${API}/`);
const ACTIONS = new Set(['status', 'increase', 'halt', 'finalize']);
const IN_PROGRESS = 'PackageRolloutInProgress';
const STOPPED = 'PackageRolloutStopped';

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parsePercentage(value) {
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage >= 100) {
    throw new Error('Rollout percentage must be finite and greater than 0 and less than 100.');
  }
  return percentage;
}

export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!['--submission-id', '--action', '--percentage'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag || '<empty>'}.`);
    }
    if (values.has(flag)) throw new Error(`Duplicate argument: ${flag}.`);
    values.set(flag, requiredValue(argv, index, flag));
  }

  const submissionId = values.get('--submission-id');
  if (!submissionId) throw new Error('--submission-id is required.');
  if (!/^\d+$/.test(submissionId)) throw new Error('--submission-id must be a numeric Store submission ID.');

  const action = values.get('--action');
  if (!action) throw new Error('--action is required.');
  if (!ACTIONS.has(action)) throw new Error('--action must be one of status, increase, halt, or finalize.');

  const rawPercentage = values.get('--percentage');
  if (action === 'increase' && rawPercentage === undefined) {
    throw new Error('--percentage is required when --action is increase.');
  }
  if (action !== 'increase' && rawPercentage !== undefined) {
    throw new Error('--percentage is supported only when --action is increase.');
  }

  return {
    submissionId,
    action,
    percentage: rawPercentage === undefined ? undefined : parsePercentage(rawPercentage),
  };
}

function storeUrl(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\')) {
    throw new Error('Store requests must stay on the fixed Microsoft Store origin.');
  }
  const url = new URL(path, API_BASE);
  if (url.origin !== API_BASE.origin || !url.pathname.startsWith(API_BASE.pathname)) {
    throw new Error('Store requests must stay on the fixed Microsoft Store origin.');
  }
  return url;
}

export function createStoreRequest({ token, tenantId, fetchImpl = fetch }) {
  if (!token || !tenantId) throw new Error('Store request authentication is incomplete.');
  return async (method, path) => {
    if (!['GET', 'POST'].includes(method)) {
      throw new Error('Rollout transport supports only GET and POST requests.');
    }
    const url = storeUrl(path);
    const response = await fetchImpl(url.href, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        TenantId: tenantId,
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const uncertainty = method === 'POST'
        ? ' The write outcome may be uncertain; inspect Partner Center before retrying.'
        : '';
      throw new Error(`Microsoft Store rollout ${method} failed (HTTP ${response.status}).${uncertainty}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  };
}

function validateIdentity({ app, appId, submissionId }) {
  if (!app || String(app.id) !== appId) {
    throw new Error('Microsoft Store returned the wrong application identity.');
  }
  const publishedId = app.lastPublishedApplicationSubmission?.id;
  if (String(publishedId ?? '') !== submissionId) {
    throw new Error(`Submission ${submissionId} is not the current last published application submission.`);
  }
  if (app.pendingApplicationSubmission?.id) {
    throw new Error(`Application has pending production submission ${app.pendingApplicationSubmission.id}; resolve it before managing rollout ${submissionId}.`);
  }
}

function rolloutResult(submissionId, action, rollout) {
  const percentage = Number(rollout?.packageRolloutPercentage);
  if (!rollout || typeof rollout.isPackageRollout !== 'boolean' || !Number.isFinite(percentage) || typeof rollout.packageRolloutStatus !== 'string') {
    throw new Error('Microsoft Store returned invalid package rollout data.');
  }
  return {
    submissionId,
    action,
    isPackageRollout: rollout.isPackageRollout,
    percentage,
    status: rollout.packageRolloutStatus,
    fallbackSubmissionId: String(rollout.fallbackSubmissionId ?? ''),
  };
}

export async function manageRollout({
  appId,
  submissionId,
  action,
  percentage,
  request,
  log = console.log,
}) {
  if (!/^[A-Z0-9]+$/.test(appId)) throw new Error('Invalid Microsoft Store application ID.');
  if (!/^\d+$/.test(submissionId)) throw new Error('Invalid Microsoft Store submission ID.');
  if (!ACTIONS.has(action)) throw new Error('Unsupported Microsoft Store rollout action.');
  if (action === 'increase') parsePercentage(percentage);

  const appPath = `applications/${appId}`;
  const submissionPath = `${appPath}/submissions/${submissionId}`;
  const app = await request('GET', appPath);
  validateIdentity({ app, appId, submissionId });

  const submission = await request('GET', submissionPath);
  if (String(submission?.id ?? '') !== submissionId || submission.status !== 'Published') {
    throw new Error(`Submission ${submissionId} must be Published before its package rollout can be managed.`);
  }

  const rolloutPath = `${submissionPath}/packagerollout`;
  const rollout = await request('GET', rolloutPath);
  const current = rolloutResult(submissionId, action, rollout);
  if (action === 'status') {
    log(`Microsoft Store submission ${submissionId}: ${current.status}, ${current.percentage}% rollout.`);
    return current;
  }

  if (current.status === STOPPED) {
    throw new Error('This package rollout was halted and cannot be resumed through the API. Publish a new submission to deliver another update.');
  }
  if (!current.isPackageRollout) {
    throw new Error(`Package rollout is not enabled for submission ${submissionId}.`);
  }
  if (current.status !== IN_PROGRESS) {
    throw new Error(`Package rollout action ${action} requires ${IN_PROGRESS}; current state is ${current.status}.`);
  }

  let actionPath;
  if (action === 'increase') {
    const target = parsePercentage(percentage);
    if (target <= current.percentage) {
      throw new Error(`New rollout percentage ${target} must be greater than the current ${current.percentage}.`);
    }
    actionPath = `${submissionPath}/updatepackagerolloutpercentage?percentage=${encodeURIComponent(target)}`;
  } else if (action === 'halt') {
    actionPath = `${submissionPath}/haltpackagerollout`;
  } else {
    actionPath = `${submissionPath}/finalizepackagerollout`;
  }

  // Store rollout POSTs are deliberately attempted once. Retrying after a lost
  // response could repeat a write whose outcome is unknown.
  const updated = rolloutResult(submissionId, action, await request('POST', actionPath));
  log(`Microsoft Store submission ${submissionId}: ${updated.status}, ${updated.percentage}% rollout after ${action}.`);
  return updated;
}

async function accessToken({ env, fetchImpl }) {
  const response = await fetchImpl(
    `https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/token`,
    {
      method: 'POST',
      redirect: 'error',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        resource: 'https://manage.devcenter.microsoft.com',
        client_id: env.MS_CLIENT_ID,
        client_secret: env.MS_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`Microsoft Store authentication failed (HTTP ${response.status}).`);
  const token = (await response.json()).access_token;
  if (!token) throw new Error('Microsoft Store authentication returned no access token.');
  return token;
}

export async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const args = parseArgs(argv);
  for (const name of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_STORE_APP_ID']) {
    if (!env[name]) throw new Error(`Missing required configuration: ${name}.`);
  }
  const token = await accessToken({ env, fetchImpl });
  log(`::add-mask::${token}`);
  const request = createStoreRequest({
    token,
    tenantId: env.MS_TENANT_ID,
    fetchImpl,
  });
  const result = await manageRollout({
    appId: env.MS_STORE_APP_ID,
    ...args,
    request,
    log,
  });
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `\n## Microsoft Store package rollout\n\n- Submission: \`${result.submissionId}\`\n- Action: **${result.action}**\n- State: **${result.status}**\n- Percentage: **${result.percentage}%**\n`,
    );
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    // Never print tokens, secrets, request objects, or response bodies.
    console.error(error instanceof TypeError || error instanceof SyntaxError
      ? 'Microsoft Store rollout request failed; check connectivity and configuration.'
      : error.message);
    process.exitCode = 1;
  });
}
