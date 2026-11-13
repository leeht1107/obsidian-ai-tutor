import { parseMentionedLearningCommand } from '@/features/chat/controllers/InputController';

const manager = (path: string) => ({
  getResolvedMentionPaths: (text: string) => {
    const start = text.indexOf('@');
    return [{ start, end: text.indexOf(' ', start) === -1 ? text.length : text.indexOf(' ', start), path }];
  },
}) as never;

describe('learning commands with an @ mention', () => {
  it('starts /quiz on a note', () => {
    expect(parseMentionedLearningCommand('/quiz @week1.md', manager('notes/week1.md'))).toEqual({ mode: 'quiz', notePath: 'notes/week1.md' });
  });
  it('leaves /quiz on a pdf as a normal chat turn', () => {
    expect(parseMentionedLearningCommand('/quiz @slides.pdf', manager('week1/slides.pdf'))).toBeNull();
    expect(parseMentionedLearningCommand('/socratic @data.xlsx', manager('data.xlsx'))).toBeNull();
  });
});
