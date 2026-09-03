/**
 * Constants for the chat feature.
 */

/** MCP (Model Context Protocol) icon SVG. */
export const MCP_ICON_SVG = `<svg fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>MCP</title><path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z"></path><path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z"></path></svg>`;

/** Check icon SVG for MCP selector. */
export const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

/** Obsidian AI Tutor compass mark used in the chat header. */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 100 100" role="img" aria-label="Obsidian AI Tutor"><path fill="#7c3aed" d="M50 5 62 29l26 7-18 20 3 27-23-11-23 11 3-27-18-20 26-7z"/><path fill="#fff" d="m50 20 6 25 25 5-25 6-6 25-6-25-25-6 25-5z"/><path fill="#a78bfa" d="m50 31 3 16 16 3-16 3-3 16-3-16-16-3 16-3z"/></svg>`;
/** Bundled provider marks; provider UI never fetches branding at runtime. */
export const PROVIDER_MARKS: Record<'copilot' | 'claude' | 'codex' | 'agy', string> = {
  copilot: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="#f0b429" d="M5 4h4l2 3 2-3h3v4l-3 2 3 2v4h-3l-2-3-2 3H5v-4l3-2-3-2z"/></svg>',
  claude: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="#d97757" d="m10 2 1.7 5.8L17 5l-3.1 5 4.7 2.4-5.9-.1L14 18l-4-4.4L6 18l1.3-5.7-5.9.1L6.1 10 3 5l5.3 2.8z"/></svg>',
  codex: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round" d="M5 5.5 10 3l5 2.5v6L10 17l-5-2.5zM5 5.5l5 2.8 5-2.8M10 8.3V17"/><path fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" d="m7.5 11 2 2 3-3"/></svg>',
  agy: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="#4285f4" d="m10 2 2 5.1 5.5.4-4.2 3.5 1.4 5.3-4.7-2.8-4.7 2.8 1.4-5.3-4.2-3.5 5.5-.4z"/></svg>',
};
