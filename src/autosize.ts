/** Sizes a textarea to its content. Accounts for borders, which scrollHeight leaves out under border-box. */
export function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return
  el.style.height = 'auto'
  const borders = el.offsetHeight - el.clientHeight
  el.style.height = `${el.scrollHeight + borders}px`
}
