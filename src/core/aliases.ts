import { isAlias, isMap, isPair, isScalar, isSeq } from 'yaml';
import type { Alias, Document, Node as YamlNode, Pair, Scalar } from 'yaml';
import type { Span } from './finding';
import { MAX_ALIAS_RESOLUTIONS, MAX_DEPTH, MAX_NODES } from './limits';
import { UnsupportedShape, position, spanOf } from './model';
import type { LEntry, LMap, LNode, LScalar, SourceInfo } from './model';

// PLAN D5 / [C] §1 item 2: the parser does not expand aliases. This module resolves
// every Alias itself (own anchor table in document order), with a cycle guard, an
// expansion budget of MAX_ALIAS_RESOLUTIONS, and depth/node caps. A merge key (`<<`)
// is refused. Content reached through an alias is located at the alias use site.

type RangeLike = readonly [number, number, number] | null | undefined;

function rangeOf(node: unknown): [number, number] {
  const range = (node as { range?: RangeLike } | null)?.range;
  return range ? [range[0], range[1]] : [0, 0];
}

/** Pass 1: walk the raw AST in document order, binding each alias to the latest anchor defined before it. */
function bindAliases(doc: Document, source: SourceInfo): Map<Alias, YamlNode> {
  const anchors = new Map<string, YamlNode>();
  const targets = new Map<Alias, YamlNode>();
  let nodes = 0;

  const visit = (node: unknown, depth: number): void => {
    if (node === null || node === undefined) return;
    if (depth > MAX_DEPTH) throw new UnsupportedShape(`nesting deeper than ${MAX_DEPTH} levels`, lineOf(source, node));
    if (++nodes > MAX_NODES) throw new UnsupportedShape(`more than ${MAX_NODES} YAML nodes`, lineOf(source, node));
    if (isAlias(node)) {
      const target = anchors.get(node.source);
      if (!target) throw new UnsupportedShape(`alias *${node.source} has no anchor before it`, lineOf(source, node));
      targets.set(node, target);
      return;
    }
    const anchor = (node as { anchor?: string }).anchor;
    // Registered before the children so an alias inside its own anchored node binds to it (a cycle, refused in pass 2).
    if (anchor && (isScalar(node) || isMap(node) || isSeq(node))) anchors.set(anchor, node);
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isMergeKey(pair, source)) throw new UnsupportedShape('merge key "<<" is not supported', lineOf(source, pair.key));
        visit(pair.key, depth + 1);
        visit(pair.value, depth + 1);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        if (isPair(item)) throw new UnsupportedShape('compact mapping inside a sequence is not supported', lineOf(source, item.key));
        visit(item, depth + 1);
      }
    }
  };

  visit(doc.contents, 0);
  return targets;
}

function isMergeKey(pair: Pair<unknown, unknown>, source: SourceInfo): boolean {
  const key = pair.key;
  if (!isScalar(key)) return false;
  if (key.value === '<<') return true;
  const [start, end] = rangeOf(key);
  return source.text.slice(start, end).trim() === '<<';
}

function lineOf(source: SourceInfo, node: unknown): number | undefined {
  const range = (node as { range?: RangeLike } | null)?.range;
  return range ? position(source, range[0]).line : undefined;
}

/** Pass 2: build the located tree, resolving aliases with a cycle guard and the resolution budget. */
class Expander {
  private resolutions = 0;
  private nodes = 0;

  constructor(
    private readonly source: SourceInfo,
    private readonly targets: Map<Alias, YamlNode>,
  ) {}

  expand(node: unknown, fallback: Span, aliasSite: Span | null, stack: YamlNode[], depth: number): LNode {
    if (node === null || node === undefined) {
      return { kind: 'scalar', value: null, text: '', style: 'plain', span: aliasSite ?? fallback, aliased: aliasSite !== null, anchored: false, yaml: null };
    }
    if (isAlias(node)) {
      if (++this.resolutions > MAX_ALIAS_RESOLUTIONS) {
        throw new UnsupportedShape(`more than ${MAX_ALIAS_RESOLUTIONS} alias resolutions`, lineOf(this.source, node));
      }
      const target = this.targets.get(node);
      if (!target) throw new UnsupportedShape(`alias *${node.source} could not be resolved`, lineOf(this.source, node));
      if (stack.includes(target)) throw new UnsupportedShape(`alias *${node.source} refers to itself (cycle)`, lineOf(this.source, node));
      const [start, end] = rangeOf(node);
      const site = aliasSite ?? spanOf(this.source, start, end);
      return this.expand(target, site, site, stack, depth);
    }
    if (depth > MAX_DEPTH) throw new UnsupportedShape(`nesting deeper than ${MAX_DEPTH} levels after alias expansion`, lineOf(this.source, node));
    if (++this.nodes > MAX_NODES) throw new UnsupportedShape(`more than ${MAX_NODES} nodes after alias expansion`, lineOf(this.source, node));

    const [start, end] = rangeOf(node);
    const span = aliasSite ?? spanOf(this.source, start, end);
    const aliased = aliasSite !== null;

    if (isScalar(node)) return this.scalar(node, span, aliased);

    if (isMap(node)) {
      stack.push(node);
      const entries: LEntry[] = [];
      for (const pair of node.items) entries.push(this.entry(pair, aliasSite, stack, depth));
      stack.pop();
      const map: LMap = { kind: 'map', entries, span, aliased, anchored: Boolean(node.anchor), yaml: node };
      return map;
    }

    if (isSeq(node)) {
      stack.push(node);
      const items: LNode[] = [];
      for (const item of node.items) items.push(this.expand(item, span, aliasSite, stack, depth + 1));
      stack.pop();
      return { kind: 'seq', items, span, aliased, anchored: Boolean(node.anchor), yaml: node };
    }

    throw new UnsupportedShape('unrecognised YAML node', lineOf(this.source, node));
  }

  private scalar(node: Scalar, span: Span, aliased: boolean): LScalar {
    const value: unknown = node.value;
    const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value);
    return { kind: 'scalar', value, text, style: styleOf(node), span, aliased, anchored: Boolean(node.anchor), yaml: node };
  }

  private entry(pair: Pair<unknown, unknown>, aliasSite: Span | null, stack: YamlNode[], depth: number): LEntry {
    let keyNode: unknown = pair.key;
    if (isAlias(keyNode)) {
      if (++this.resolutions > MAX_ALIAS_RESOLUTIONS) {
        throw new UnsupportedShape(`more than ${MAX_ALIAS_RESOLUTIONS} alias resolutions`, lineOf(this.source, keyNode));
      }
      keyNode = this.targets.get(keyNode);
    }
    if (!isScalar(keyNode)) throw new UnsupportedShape('mapping key is not a scalar', lineOf(this.source, pair.key));
    const key = keyText(keyNode, this.source);
    const [keyStart, keyEnd] = rangeOf(pair.key);
    const keySpan = aliasSite ?? spanOf(this.source, keyStart, keyEnd);
    const value = this.expand(pair.value, keySpan, aliasSite, stack, depth + 1);
    const valueEnd = pair.value === null || pair.value === undefined ? keyEnd : rangeOf(pair.value)[1];
    const span = aliasSite ?? spanOf(this.source, keyStart, Math.max(keyEnd, valueEnd));
    return { key, keySpan, span, value, aliased: aliasSite !== null || value.aliased, pair };
  }
}

/** Plain keys use their source text, so `on` stays the string "on" even under a YAML 1.1 directive. */
function keyText(key: Scalar, source: SourceInfo): string {
  if (styleOf(key) === 'plain') {
    const [start, end] = rangeOf(key);
    const raw = source.text.slice(start, end).trim();
    if (raw.length > 0) return raw;
  }
  return key.value === null || key.value === undefined ? '' : String(key.value);
}

function styleOf(node: Scalar): LScalar['style'] {
  switch (node.type) {
    case 'QUOTE_SINGLE':
      return 'single';
    case 'QUOTE_DOUBLE':
      return 'double';
    case 'BLOCK_LITERAL':
      return 'literal';
    case 'BLOCK_FOLDED':
      return 'folded';
    default:
      return 'plain';
  }
}

/** Builds the located tree for a parsed document whose root is a mapping. Throws UnsupportedShape. */
export function expandDocument(doc: Document, source: SourceInfo): LMap {
  const targets = bindAliases(doc, source);
  const root = new Expander(source, targets).expand(doc.contents, { startLine: 1, startCol: 1, endLine: 1, endCol: 1 }, null, [], 0);
  if (root.kind !== 'map') throw new UnsupportedShape('document root is not a mapping', 1);
  return root;
}
