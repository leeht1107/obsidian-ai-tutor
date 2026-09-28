/**
 * ObsidianCode - Slash command utilities
 *
 * Core parsing logic for slash command YAML frontmatter and warning formatting.
 */

/** Shared slash-tool policy used by chat and inline edit. */
export function resolveSlashAllowedTools(command: { allowedTools?: string[]; content: string }): string[] | undefined {
  if (command.allowedTools !== undefined) return command.allowedTools;
  return parseSlashCommandContent(command.content).allowedTools;
}

export function slashAllowsInlineBash(allowedTools?: string[]): boolean {
  if (allowedTools === undefined) return true;
  return allowedTools.some((tool) => tool.trim().toLowerCase() === 'bash');
}

function sharedSlashToolKey(tool: string): string {
  const trimmed = tool.trim().toLowerCase();
  const knownAlias = trimmed.replace(/[-_]/g, '');
  if (knownAlias === 'read' || knownAlias === 'view') return 'view';
  if (knownAlias === 'websearch') return 'websearch';
  if (knownAlias === 'webfetch') return 'webfetch';
  // Unknown/MCP tool names are identities, not spelling variants. Removing '-'/'_'
  // here can collapse distinct provider permissions into the same key.
  return trimmed;
}

/**
 * Monotonic slash-tool policy: once a conversation is restricted, a later command
 * may keep or narrow that policy but never widen it.
 */
export function intersectSlashAllowedTools(
  existing: string[] | undefined,
  next: string[] | undefined
): string[] | undefined {
  if (existing === undefined) return next;
  if (next === undefined) return existing;
  const nextSet = new Set(next.map(sharedSlashToolKey));
  return existing.filter((tool) => nextSet.has(sharedSlashToolKey(tool)));
}

/** Formats expansion errors for display. */
export function formatSlashCommandWarnings(errors: string[]): string {
  const maxItems = 3;
  const head = errors.slice(0, maxItems);
  const more = errors.length > maxItems ? `\n...and ${errors.length - maxItems} more` : '';
  return `Slash command expansion warnings:\n- ${head.join('\n- ')}${more}`;
}

/** Parsed slash command frontmatter and prompt content. */
export interface ParsedSlashCommandContent {
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  promptContent: string;
}

/**
 * Parses YAML frontmatter from command content.
 * Returns parsed metadata and the remaining prompt content.
 */
export function parseSlashCommandContent(content: string): ParsedSlashCommandContent {
  const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterPattern);

  if (!match) {
    return { promptContent: content };
  }

  const yamlContent = match[1];
  const promptContent = match[2];
  const result: ParsedSlashCommandContent = { promptContent };

  const lines = yamlContent.split(/\r?\n/);
  let arrayKey: string | null = null;
  let arrayItems: string[] = [];

  const flushArray = () => {
    if (arrayKey === 'allowed-tools') {
      result.allowedTools = arrayItems;
    }
    arrayKey = null;
    arrayItems = [];
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (arrayKey) {
      if (trimmedLine.startsWith('- ')) {
        arrayItems.push(unquoteYamlString(trimmedLine.slice(2).trim()));
        continue;
      }

      if (trimmedLine === '') {
        continue;
      }

      flushArray();
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    switch (key) {
      case 'description':
        result.description = unquoteYamlString(value);
        break;
      case 'argument-hint':
        result.argumentHint = unquoteYamlString(value);
        break;
      case 'model':
        result.model = unquoteYamlString(value);
        break;
      case 'allowed-tools':
        if (!value) {
          arrayKey = key;
          arrayItems = [];
          break;
        }

        if (value.startsWith('[') && value.endsWith(']')) {
          result.allowedTools = value
            .slice(1, -1)
            .split(',')
            .map((s) => unquoteYamlString(s.trim()))
            .filter(Boolean);
          break;
        }

        result.allowedTools = [unquoteYamlString(value)].filter(Boolean);
        break;
    }
  }

  if (arrayKey) {
    flushArray();
  }

  return result;
}

function unquoteYamlString(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
