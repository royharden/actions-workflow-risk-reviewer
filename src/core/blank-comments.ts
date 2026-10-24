import { Parser } from 'yaml';

// Replaces every YAML comment with spaces of the same length, using the CST so that a
// `#` inside a quoted scalar or block scalar is untouched. Lines and columns are preserved
// exactly. Used for model excerpts (M3); no rule reads comments.

interface CommentToken {
  type: 'comment';
  offset: number;
  source: string;
}

function isCommentToken(value: unknown): value is CommentToken {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { type?: unknown; offset?: unknown; source?: unknown };
  return v.type === 'comment' && typeof v.offset === 'number' && typeof v.source === 'string';
}

/** Collects comment tokens anywhere in a CST token tree (documents, collections, block-scalar props, flow items). */
function collectComments(token: unknown, out: CommentToken[]): void {
  if (Array.isArray(token)) {
    for (const item of token) collectComments(item, out);
    return;
  }
  if (typeof token !== 'object' || token === null) return;
  if (isCommentToken(token)) {
    out.push(token);
    return;
  }
  for (const value of Object.values(token as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) collectComments(value, out);
  }
}

export function blankComments(text: string): string {
  const comments: CommentToken[] = [];
  for (const token of new Parser().parse(text)) collectComments(token, comments);
  if (comments.length === 0) return text;
  const chars = text.split('');
  for (const comment of comments) {
    // Defensive: only blank text that really is this comment in the source.
    if (text.slice(comment.offset, comment.offset + comment.source.length) !== comment.source) continue;
    for (let i = comment.offset; i < comment.offset + comment.source.length; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}
