/**
 * The review card under an Agent-mode answer: one block per hunk with ✓ / ✕, and an apply
 * button that writes only the accepted blocks. Nothing touches the note before that click.
 * Every click re-checks that the note (its open editor, or its file) still equals what the
 * CLI read; if not, nothing is written and the student can ask for a fresh proposal.
 */
import type { App } from 'obsidian';

import type { EditReviewState, ReviewHunk } from '../../core/types/chat';
import { applyToLiveNote } from './liveNote';

export interface EditReviewCardDeps {
  app: App;
  /** Persist the conversation after the review state changed. */
  onChange: () => void;
  /** Send `request` again as a new turn against the note as it is now. */
  resend: (request: string) => void;
  /** True while a turn is streaming; a fresh proposal waits for it. */
  isBusy: () => boolean;
}

const MESSAGES = {
  malformed: '수정안을 읽지 못했어요. 노트는 바뀌지 않았어요. 같은 요청을 한 번 더 보내 주세요.',
  too_large: '노트가 너무 길어 블록별로 비교할 수 없어요. 노트는 바뀌지 않았어요. 고칠 부분을 선택한 뒤 다시 요청해 주세요.',
  noChange: 'AI가 보낸 수정안이 지금 노트와 같아서 바꿀 곳이 없어요.',
  missing: '노트를 찾을 수 없어요. 이름이 바뀌었거나 삭제됐는지 확인해 주세요.',
  stale: '수정안을 만든 뒤 노트가 바뀌었어요. 그래서 아무것도 적용하지 않았어요. 지금 노트로 새 수정안을 받아 주세요.',
  not_applied: '적용하지 못했어요. 노트는 바뀌지 않았어요.',
  check_note: '적용 결과가 예상과 달라요. 노트를 확인하고, 필요하면 Ctrl/Cmd+Z로 되돌려 주세요.',
  failed: '노트에 쓰지 못했어요. 노트는 바뀌지 않았어요.',
};

function hunkTitle(h: ReviewHunk): string {
  const first = h.oldStart + 1;
  if (h.oldLines.length === 0) return h.oldStart === 0 ? '맨 앞에 추가' : `${h.oldStart}행 뒤에 추가`;
  const last = h.oldStart + h.oldLines.length;
  const range = first === last ? `${first}행` : `${first}–${last}행`;
  return h.newLines.length === 0 ? `${range} 삭제` : `${range} 수정`;
}

function renderLines(el: HTMLElement, cls: string, sign: string, lines: string[]): void {
  for (const text of lines) {
    const row = el.createDiv({ cls: `ocop-edit-review-line ${cls}` });
    row.createSpan({ cls: 'ocop-edit-review-sign', text: sign });
    row.createSpan({ cls: 'ocop-edit-review-text', text: text === '' ? ' ' : text });
  }
}

/** Renders (or re-renders) the card for `review` at the end of `parentEl`. */
export function renderEditReviewCard(parentEl: HTMLElement, review: EditReviewState, deps: EditReviewCardDeps): void {
  const card = parentEl.createDiv({ cls: 'ocop-edit-review' });
  let banner: { text: string; offerResend: boolean } | null = null;
  let appliedUndoable = false;
  let busy = false;

  const notice = (text: string, cls = 'ocop-edit-review-notice') => card.createDiv({ cls, text });

  const draw = (): void => {
    card.empty();
    if (review.status === 'malformed' || review.status === 'too_large') {
      notice(MESSAGES[review.status]);
      return;
    }
    if (review.status !== 'pending' && review.status !== 'applied') return;
    if (review.hunks.length === 0) {
      notice(MESSAGES.noChange);
      return;
    }

    const head = card.createDiv({ cls: 'ocop-edit-review-head' });
    head.createSpan({ cls: 'ocop-edit-review-file', text: review.notePath });
    const added = review.hunks.reduce((n, h) => n + h.newLines.length, 0);
    const removed = review.hunks.reduce((n, h) => n + h.oldLines.length, 0);
    const stats = head.createSpan({ cls: 'ocop-edit-review-stats' });
    stats.createSpan({ cls: 'ocop-edit-review-added', text: `+${added}` });
    stats.createSpan({ cls: 'ocop-edit-review-removed', text: ` −${removed}` });
    stats.createSpan({ text: ` · 블록 ${review.hunks.length}개` });

    const locked = review.status === 'applied' || busy;
    if (review.status === 'applied') {
      const n = review.appliedIds?.length ?? 0;
      const undo = appliedUndoable ? ' 되돌리려면 노트에서 Ctrl/Cmd+Z를 누르세요.' : '';
      notice(`${n}개 블록을 노트에 적용했어요. 거부했거나 고르지 않은 블록은 들어가지 않았어요.${undo}`, 'ocop-edit-review-done');
    }
    if (banner) {
      const bar = card.createDiv({ cls: 'ocop-edit-review-banner' });
      bar.createSpan({ text: banner.text });
      if (banner.offerResend) {
        const again = bar.createEl('button', { text: '새 수정안 받기', cls: 'ocop-edit-review-btn' });
        again.type = 'button';
        again.addEventListener('click', () => {
          if (deps.isBusy()) return;
          deps.resend(review.request);
        });
      }
    }

    const baseLines = review.base.replace(/\r\n/g, '\n').split('\n');
    for (const h of review.hunks) {
      const decision = review.decisions[h.id];
      const block = card.createDiv({ cls: 'ocop-edit-review-hunk' });
      block.dataset.state = decision ?? 'pending';
      const bar = block.createDiv({ cls: 'ocop-edit-review-hunk-bar' });
      const label = review.status === 'applied' ? (review.appliedIds?.includes(h.id) ? '적용됨' : '적용 안 함')
        : decision === 'accepted' ? '적용 예정' : decision === 'rejected' ? '거부' : '검토 전';
      bar.createSpan({ text: `${hunkTitle(h)} · ${label}` });
      if (!locked) {
        const btns = bar.createDiv({ cls: 'ocop-edit-review-btns' });
        for (const [value, text] of [['accepted', '✓ 적용'], ['rejected', '✕ 거부']] as const) {
          const btn = btns.createEl('button', { text, cls: `ocop-edit-review-btn is-${value}` });
          btn.type = 'button';
          btn.setAttribute('aria-pressed', String(decision === value));
          btn.addEventListener('click', () => {
            if (review.decisions[h.id] === value) delete review.decisions[h.id];
            else review.decisions[h.id] = value;
            deps.onChange();
            draw();
          });
        }
      }
      const lines = block.createDiv({ cls: 'ocop-edit-review-lines' });
      const before = h.oldStart > 0 ? baseLines[h.oldStart - 1] : undefined;
      if (before !== undefined && (h.oldLines.length === 0 || h.newLines.length === 0)) renderLines(lines, 'is-context', ' ', [before]);
      renderLines(lines, 'is-removed', '−', h.oldLines);
      renderLines(lines, 'is-added', '+', h.newLines);
    }

    if (review.status === 'applied') return;
    const foot = card.createDiv({ cls: 'ocop-edit-review-foot' });
    const bulk = foot.createDiv({ cls: 'ocop-edit-review-btns' });
    for (const [value, text] of [['accepted', '모두 ✓'], ['rejected', '모두 ✕']] as const) {
      const btn = bulk.createEl('button', { text, cls: 'ocop-edit-review-btn' });
      btn.type = 'button';
      btn.disabled = locked;
      btn.addEventListener('click', () => {
        for (const h of review.hunks) review.decisions[h.id] = value;
        deps.onChange();
        draw();
      });
    }
    const acceptedIds = review.hunks.filter((h) => review.decisions[h.id] === 'accepted').map((h) => h.id);
    const undecided = review.hunks.filter((h) => !review.decisions[h.id]).length;
    const apply = foot.createEl('button', {
      cls: 'ocop-edit-review-btn mod-cta',
      text: undecided > 0
        ? `선택한 변경 적용 (${acceptedIds.length}개, 검토 전 ${undecided}개 제외)`
        : `선택한 변경 적용 (${acceptedIds.length}개)`,
    });
    apply.type = 'button';
    apply.disabled = locked || acceptedIds.length === 0;
    apply.addEventListener('click', () => { void applyAccepted(acceptedIds); });
  };

  const applyAccepted = async (acceptedIds: string[]): Promise<void> => {
    busy = true;
    banner = null;
    draw();
    try {
      const result = await applyToLiveNote(deps.app, review.notePath, review.base, review.hunks, acceptedIds);
      if (result.kind === 'applied') {
        review.status = 'applied';
        review.appliedIds = acceptedIds;
        appliedUndoable = result.undoable;
        deps.onChange();
      } else {
        banner = { text: MESSAGES[result.kind], offerResend: result.kind === 'stale' };
      }
    } catch (e) {
      console.error('[ObsidianCopilot] Edit review apply failed:', e);
      banner = { text: MESSAGES.failed, offerResend: false };
    } finally {
      busy = false;
      draw();
    }
  };

  draw();
}
