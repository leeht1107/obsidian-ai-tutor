/**
 * Classifying a failed copilot request.
 *
 * A stored copilot credential says a token exists, not that it still works, so
 * a real request is the only thing that can correct a stale 연결됨. This is the
 * single place that recognises copilot's authentication failure; nothing else
 * may re-detect that string, because inventing a second auth classifier is
 * exactly the fragility this design was told to avoid.
 */
import type { RequestOutcome } from '../setup/providerConnection';

const AUTH_FAILURE = 'No authentication information found';

export interface CopilotFailure {
  outcome: RequestOutcome;
  /** What the chat shows the student. */
  message: string;
}

export function classifyCopilotFailure(rawError: string): CopilotFailure {
  if (rawError.includes(AUTH_FAILURE)) {
    return {
      outcome: 'auth-failed',
      message: 'GitHub Copilot authentication required. Please run "copilot" in terminal and use /login to authenticate.',
    };
  }
  // Anything else is a failure, not a verdict about the student's login.
  return { outcome: 'failed', message: rawError };
}

/**
 * What one finished copilot request proves about the student's login.
 *
 * Every finished request records something. The earlier version recorded only
 * when a non-zero exit also wrote to stderr, so a CLI that died silently left
 * a stale 최근 요청 성공 standing — the exact failure this badge exists to avoid.
 *
 * @param sawErrorChunk whether the answer already carried an error. A zero exit
 * that still produced an error is a failed answer, not a success.
 */
export function copilotRequestOutcome(
  exitCode: number | null,
  stderr: string,
  sawErrorChunk: boolean
): RequestOutcome {
  // classifyCopilotFailure answers 'failed' for empty stderr, which is what a
  // silent death should record.
  if (exitCode !== 0) return classifyCopilotFailure(stderr.trim()).outcome;
  return sawErrorChunk ? 'failed' : 'ok';
}
