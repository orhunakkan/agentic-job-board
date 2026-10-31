// Small DOM helpers. Every value from a test goes in as text or as an attribute, never as HTML, and nothing sets a
// style attribute or an inline event handler, which the report's Content Security Policy would refuse anyway.

export type Child = Node | string | null | undefined | false;
export type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Readonly<Record<string, AttrValue>>;

const SVG_NS = 'http://www.w3.org/2000/svg';

export class UnsafeAttributeError extends Error {
  override name = 'UnsafeAttributeError';
}

function setAttrs(node: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'style' || name.toLowerCase().startsWith('on'))
      throw new UnsafeAttributeError(`refused attribute ${name}`);
    if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function append(node: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** An HTML element; `text` sets its text content, every other key an attribute. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  append(node, children);
  return node;
}

let inertDocument: Document | null = null;

/**
 * A `<select>`. WebKit builds a select's inner parts with an inline style the moment it is created, which the
 * report's Content Security Policy then reports as a violation although nothing of the report's own is blocked; a
 * select made in a document without the policy and adopted into the page reports nothing and works the same.
 */
export function selectEl(attrs: Attrs = {}, ...children: Child[]): HTMLSelectElement {
  inertDocument ??= document.implementation.createHTMLDocument('');
  const node = document.adoptNode(inertDocument.createElement('select'));
  setAttrs(node, attrs);
  append(node, children);
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  setAttrs(node, attrs);
  append(node, children);
  return node;
}

/** A tooltip for an SVG shape. */
export function svgTitle(text: string): SVGTitleElement {
  return svg('title', { text });
}

/** A link that leaves the report; only ever given URLs from the data (GitHub, the CI run). */
export function externalLink(href: string, text: string, attrs: Attrs = {}): HTMLAnchorElement {
  return el('a', { ...attrs, href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

/** Text only screen readers hear. */
export function srOnly(text: string): HTMLSpanElement {
  return el('span', { class: 'sr-only', text });
}

let nextId = 0;

/** A document-unique id for aria-controls and labels. */
export function uid(prefix: string): string {
  nextId += 1;
  return `${prefix}-${String(nextId)}`;
}

/** Sets a CSS custom property through the CSSOM, which the Content Security Policy allows. */
export function setVar(node: HTMLElement | SVGElement, name: string, value: string): void {
  node.style.setProperty(name, value);
}

/** A `<pre>` that can scroll, so it is focusable for keyboard users. */
export function pre(text: string, className = ''): HTMLPreElement {
  return el('pre', { class: `code ${className}`.trim(), tabindex: 0, text });
}

/** A table in a box that scrolls sideways; focusable and named, like `pre`, so keyboard users can scroll it. */
export function scrollingTable(label: string, table: HTMLTableElement): HTMLDivElement {
  return el('div', { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': label }, table);
}

/** Renders the first `size` items and a button that shows the next ones, so long lists stay fast. */
export function chunked<T>(
  list: HTMLElement,
  items: readonly T[],
  render: (item: T) => Node,
  size = 200,
  noun = 'tests',
): HTMLElement {
  const wrapper = el('div', { class: 'chunked' }, list);
  let shown = 0;
  const more = el('button', { type: 'button', class: 'button button-ghost show-more' });
  const showNext = (): void => {
    const next = items.slice(shown, shown + size);
    const fragment = document.createDocumentFragment();
    for (const item of next) fragment.appendChild(render(item));
    list.appendChild(fragment);
    shown += next.length;
    const left = items.length - shown;
    if (left <= 0) more.remove();
    else more.textContent = `Show ${String(Math.min(size, left))} more ${noun} (${left.toLocaleString('en-US')} left)`;
  };
  more.addEventListener('click', () => {
    const focusIndex = shown;
    showNext();
    const target = list.children[focusIndex]?.querySelector<HTMLElement>('a, button');
    target?.focus();
  });
  wrapper.appendChild(more);
  showNext();
  return wrapper;
}
