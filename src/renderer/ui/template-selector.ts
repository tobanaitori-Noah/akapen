import { getLanguage, t } from '../i18n';
import {
  getCommentTemplateText,
  selectableCommentTemplates,
  type CommentTemplate,
} from './comment-templates';

export const TEMPLATE_SELECTOR_CLASS = 'akapen-template-selector';

export interface TemplateSelectorHandle {
  element: HTMLElement;
  result: Promise<CommentTemplate | null>;
  close(): void;
}

interface TemplateSelectorOptions {
  templates: readonly CommentTemplate[];
  mount: HTMLElement;
  anchor: HTMLElement;
  widthElement?: HTMLElement;
  returnFocus?: HTMLElement;
}

const CLOSE_MS = 80;
const MENU_MIN_WIDTH = 320;
const MENU_OFFSET_Y = 6;
const MENU_VIEWPORT_GAP = 12;
const MENU_LIST_MAX_HEIGHT = 320;
const MENU_LIST_MIN_HEIGHT = 72;

export function openTemplateSelector(
  options: TemplateSelectorOptions,
): TemplateSelectorHandle {
  const templates = selectableCommentTemplates(options.templates);
  let done = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveResult: (template: CommentTemplate | null) => void = () => undefined;
  const result = new Promise<CommentTemplate | null>((resolve) => {
    resolveResult = resolve;
  });

  const root = document.createElement('div');
  root.className = TEMPLATE_SELECTOR_CLASS;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', t('commentTemplate.selectorLabel'));
  root.tabIndex = -1;

  const list = document.createElement('div');
  list.className = `${TEMPLATE_SELECTOR_CLASS}__list`;

  if (templates.length === 0) {
    const empty = document.createElement('div');
    empty.className = `${TEMPLATE_SELECTOR_CLASS}__empty`;
    empty.textContent = t('commentTemplate.empty');
    list.appendChild(empty);
  } else {
    templates.forEach((template, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `${TEMPLATE_SELECTOR_CLASS}__item`;
      item.dataset.templateIndex = String(index);

      const indexEl = document.createElement('span');
      indexEl.className = `${TEMPLATE_SELECTOR_CLASS}__index`;
      indexEl.setAttribute('aria-hidden', 'true');
      indexEl.textContent = String(index + 1);

      const textEl = document.createElement('span');
      textEl.className = `${TEMPLATE_SELECTOR_CLASS}__text`;
      textEl.textContent = getCommentTemplateText(template, getLanguage());

      item.append(indexEl, textEl);
      list.appendChild(item);
    });
  }

  const hint = document.createElement('div');
  hint.className = `${TEMPLATE_SELECTOR_CLASS}__hint`;
  hint.textContent = t('commentTemplate.keyboardHint');

  root.append(list, hint);
  options.mount.appendChild(root);

  const cards = (): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('[data-template-index]'));

  const positionMenu = (): void => {
    if (!options.mount.isConnected || !options.anchor.isConnected) return;
    const mountRect = options.mount.getBoundingClientRect();
    const anchorRect = options.anchor.getBoundingClientRect();
    const widthRect = (options.widthElement ?? options.anchor).getBoundingClientRect();
    const maxWidth = Math.max(180, window.innerWidth - MENU_VIEWPORT_GAP * 2);
    const width = Math.min(
      maxWidth,
      Math.max(MENU_MIN_WIDTH, Math.round(widthRect.width)),
    );
    const leftViewport = Math.min(
      Math.max(anchorRect.left, MENU_VIEWPORT_GAP),
      Math.max(MENU_VIEWPORT_GAP, window.innerWidth - MENU_VIEWPORT_GAP - width),
    );
    const availableBelow =
      window.innerHeight - anchorRect.bottom - MENU_OFFSET_Y - MENU_VIEWPORT_GAP;
    const availableAbove = anchorRect.top - MENU_OFFSET_Y - MENU_VIEWPORT_GAP;
    const openAbove =
      availableBelow < MENU_LIST_MIN_HEIGHT && availableAbove > availableBelow;
    const available = Math.max(
      MENU_LIST_MIN_HEIGHT,
      openAbove ? availableAbove : availableBelow,
    );
    const hintHeight = hint.getBoundingClientRect().height || 28;
    const listMaxHeight = Math.max(
      MENU_LIST_MIN_HEIGHT,
      Math.min(MENU_LIST_MAX_HEIGHT, available - hintHeight),
    );

    list.style.maxHeight = `${Math.round(listMaxHeight)}px`;
    root.style.width = `${width}px`;
    root.classList.toggle('is-above', openAbove);

    const measuredHeight = root.getBoundingClientRect().height;
    const topViewport = openAbove
      ? anchorRect.top - MENU_OFFSET_Y - measuredHeight
      : anchorRect.bottom + MENU_OFFSET_Y;
    const clampedTop = Math.min(
      Math.max(topViewport, MENU_VIEWPORT_GAP),
      Math.max(MENU_VIEWPORT_GAP, window.innerHeight - MENU_VIEWPORT_GAP - measuredHeight),
    );
    root.style.left = `${Math.max(
      0,
      Math.round(leftViewport - mountRect.left + options.mount.scrollLeft),
    )}px`;
    root.style.top = `${Math.max(
      0,
      Math.round(clampedTop - mountRect.top + options.mount.scrollTop),
    )}px`;
  };

  const cleanup = (): void => {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    document.removeEventListener('scroll', positionMenu, true);
    window.removeEventListener('resize', positionMenu);
  };

  const close = (selected: CommentTemplate | null): void => {
    if (done) return;
    done = true;
    root.classList.remove('is-open');
    root.classList.add('is-closing');
    cleanup();
    closeTimer = setTimeout(() => {
      root.remove();
      resolveResult(selected);
      if (selected === null && options.returnFocus?.isConnected) {
        options.returnFocus.focus();
      }
      closeTimer = null;
    }, CLOSE_MS);
  };

  const selectTemplate = (card: HTMLButtonElement): void => {
    if (done || card.classList.contains('is-selected')) return;
    const index = Number(card.dataset.templateIndex);
    const template = templates[index];
    if (!template) return;
    card.classList.add('is-selected');
    close(template);
  };

  const moveFocus = (delta: number): void => {
    const all = cards();
    if (all.length === 0) return;
    const active = document.activeElement;
    const current = active instanceof HTMLButtonElement ? all.indexOf(active) : -1;
    const next = current < 0 ? 0 : (current + delta + all.length) % all.length;
    all[next].focus();
  };

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(null);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      cards()[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      cards().at(-1)?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && active.dataset.templateIndex) {
        event.preventDefault();
        selectTemplate(active);
      }
    }
  }

  function onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Node && root.contains(target)) return;
    close(null);
  }

  root.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-template-index]',
    );
    if (card) selectTemplate(card);
  });
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onDocumentMouseDown, true);
  document.addEventListener('scroll', positionMenu, true);
  window.addEventListener('resize', positionMenu);

  positionMenu();
  requestAnimationFrame(() => {
    if (done) return;
    positionMenu();
    root.classList.add('is-open');
    (cards()[0] ?? root).focus();
  });

  return {
    element: root,
    result,
    close: () => {
      close(null);
    },
  };
}
