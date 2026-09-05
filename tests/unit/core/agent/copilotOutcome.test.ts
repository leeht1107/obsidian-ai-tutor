/**
 * What a finished copilot request proves.
 *
 * copilot cannot be asked whether it is logged in: every non-interactive
 * subcommand answers from local files (checked by running each twice, once
 * under an empty HOME, with identical output), and its only account-backed
 * surfaces are the interactive footer and /statusline. Settings decides its
 * badge from a stored credential; a credential that exists but no longer works
 * can only be caught here, by a request that fails on authentication.
 */
import { classifyCopilotFailure, copilotRequestOutcome } from '@/core/agent/copilotOutcome';

describe('classifyCopilotFailure', () => {
  it('recognises the one authentication string the CLI emits', () => {
    const result = classifyCopilotFailure('No authentication information found');
    expect(result.outcome).toBe('auth-failed');
    expect(result.message).toContain('authentication required');
  });

  it('passes any other failure through untouched and does not call it an auth problem', () => {
    const result = classifyCopilotFailure('ENOENT: spawn failed');
    expect(result.outcome).toBe('failed');
    expect(result.message).toBe('ENOENT: spawn failed');
  });
});

/**
 * Two independent reviewers converged on the same hole: the first version only
 * recorded an outcome when a non-zero exit ALSO wrote to stderr. A CLI that
 * died silently — killed, OOM, a crash with no message — recorded nothing, so a
 * badge reading 최근 요청 성공 survived the failure that should have replaced it.
 * That is precisely the stale-positive this feature was built to avoid.
 */
describe('copilotRequestOutcome', () => {
  it('records a failure when the CLI dies without saying anything', () => {
    expect(copilotRequestOutcome(1, '', false)).toBe('failed');
    expect(copilotRequestOutcome(null, '   ', false)).toBe('failed');
  });

  it('still recognises the authentication failure', () => {
    expect(copilotRequestOutcome(1, 'No authentication information found', false)).toBe('auth-failed');
  });

  it('does not call a zero exit successful when the answer carried an error', () => {
    expect(copilotRequestOutcome(0, '', true)).toBe('failed');
  });

  it('records success only for a clean exit with no error in the answer', () => {
    expect(copilotRequestOutcome(0, '', false)).toBe('ok');
  });
});
