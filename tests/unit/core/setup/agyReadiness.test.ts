/**
 * agy was recorded as having "no auth surface whatsoever" because
 * `agy auth status` answers `Error: unexpected argument "auth"`. That was the
 * wrong question. `agy models` asks the account, and on 2026-09-05 it printed
 * a model list when logged in and "Please sign in to view available models."
 * under a fresh HOME — both captured by running it, not from documentation.
 *
 * It exits 0 in both cases, so the exit code decides nothing.
 */
import { AGY_MODELS_PROBE } from '@/core/setup/providerReadiness';

describe('agy readiness probe', () => {
  const interpret = (stdout: string, stderr = '', code: number | null = 0) =>
    AGY_MODELS_PROBE.interpret(stdout, stderr, code);

  it('asks for the model list, which is the only account-backed agy command', () => {
    expect(AGY_MODELS_PROBE.args).toEqual(['models']);
  });

  it('reads the sign-in refusal as logged out, despite the zero exit code', () => {
    expect(interpret('Fetching available models...\nError: Please sign in to view available models. Launch the CLI without arguments to sign in.\n'))
      .toBe('logged-out');
  });

  it('reads a returned model list as logged in', () => {
    expect(interpret('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n'))
      .toBe('logged-in');
  });

  it('stays unknown when the answer is neither, rather than guessing', () => {
    expect(interpret('Fetching available models...\n')).toBe('unknown');
    expect(interpret('', 'socket hang up', 1)).toBe('unknown');
  });
});
