import { SocraticBanner } from '@/ui/components/SocraticBanner';

type Listener = (event: any) => void;

class MockClassList {
  private classes = new Set<string>();

  add(...items: string[]): void {
    items.forEach((item) => this.classes.add(item));
  }

  remove(...items: string[]): void {
    items.forEach((item) => this.classes.delete(item));
  }

  toggle(item: string, force?: boolean): void {
    if (force === undefined) {
      if (this.classes.has(item)) {
        this.classes.delete(item);
      } else {
        this.classes.add(item);
      }
    } else if (force) {
      this.classes.add(item);
    } else {
      this.classes.delete(item);
    }
  }

  contains(item: string): boolean {
    return this.classes.has(item);
  }

  has(item: string): boolean {
    return this.classes.has(item);
  }

  toArray(): string[] {
    return Array.from(this.classes);
  }
}

class MockElement {
  tagName: string;
  classList = new MockClassList();
  style: Record<string, string> = {};
  children: MockElement[] = [];
  attributes: Record<string, string> = {};
  parent: MockElement | null = null;
  textContent = '';
  private listeners: Record<string, Listener[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set className(value: string) {
    this.classList = new MockClassList();
    value.split(/\s+/).filter(Boolean).forEach((cls) => this.classList.add(cls));
  }

  get className(): string {
    return this.classList.toArray().join(' ');
  }

  appendChild(child: MockElement): MockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: MockElement, _ref: MockElement | null): MockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  dispatchEvent(event: any): void {
    const listeners = this.listeners[event.type] || [];
    for (const listener of listeners) {
      listener(event);
    }
  }

  click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const matches: MockElement[] = [];
    const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/);
    const walk = (el: MockElement) => {
      if (!classMatch || el.classList.has(classMatch[1])) {
        matches.push(el);
      }
      for (const child of el.children) {
        walk(child);
      }
    };
    for (const child of this.children) {
      walk(child);
    }
    return matches;
  }
}

function withMockDocument(run: (container: MockElement) => void): void {
  const originalDocument = (global as any).document;
  const body = new MockElement('body');
  (global as any).document = {
    body,
    createElement: (tag: string) => new MockElement(tag),
  };
  try {
    const container = new MockElement('div');
    body.appendChild(container);
    run(container);
  } finally {
    (global as any).document = originalDocument;
  }
}

describe('SocraticBanner', () => {
  it('wires the 힌트/모르겠어요 shortcut buttons without closing or replacing the banner', () => {
    withMockDocument((container) => {
      const banner = new SocraticBanner();
      banner.mount(container as unknown as HTMLElement);

      const onHint = jest.fn();
      const onStuck = jest.fn();
      banner.show('현재 노트', 'CTE', onHint, onStuck);

      const buttons = container.querySelectorAll('.ocop-socratic-banner-action-btn');
      expect(buttons).toHaveLength(2);
      expect(buttons[0].textContent).toContain('힌트');
      expect(buttons[1].textContent).toContain('모르겠어요');

      buttons[0].click();
      expect(onHint).toHaveBeenCalledTimes(1);
      expect(onStuck).not.toHaveBeenCalled();

      buttons[1].click();
      expect(onStuck).toHaveBeenCalledTimes(1);

      // Banner stays mounted/visible — shortcuts are side requests, not dismissals.
      expect(banner.isVisible()).toBe(true);
    });
  });

  it('omits the action row entirely when no shortcut callbacks are given', () => {
    withMockDocument((container) => {
      const banner = new SocraticBanner();
      banner.mount(container as unknown as HTMLElement);
      banner.show('현재 노트');

      expect(container.querySelectorAll('.ocop-socratic-banner-action-btn')).toHaveLength(0);
    });
  });
});
