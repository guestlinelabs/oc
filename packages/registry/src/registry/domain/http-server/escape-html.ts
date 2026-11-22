/**
 * Port of `escape-html` (https://github.com/component/escape-html, MIT
 * licensed).
 */

const ESCAPE_LOOKUP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const ESCAPE_REPLACE_REGEXP = /[&<>"']/g;

export function escapeHtml(str: string): string {
  return String(str).replace(
    ESCAPE_REPLACE_REGEXP,
    (match) => ESCAPE_LOOKUP[match]
  );
}
