// Shared keyboard guard (ui-spec §2.4): global keydown handlers must skip
// events while the user is typing in ANY form control — including <select>
// (Backspace/Enter there used to leak into delete / draft handlers) and
// contentEditable hosts, not just INPUT / TEXTAREA.
export function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable
}
