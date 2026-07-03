import { onLanguageChange, t } from '../i18n';

export interface TabBarItem {
  id: string;
  title: string;
  path: string;
  dirty: boolean;
}

export interface TabBarOptions {
  onAdd(): void;
  onSelect(id: string): void;
  onClose(id: string): void;
  onMove(sourceId: string, targetId: string): void;
}

export interface TabBarHandle {
  element: HTMLElement;
  render(items: readonly TabBarItem[], activeId: string | null): void;
}

export function createTabBar(options: TabBarOptions): TabBarHandle {
  const element = document.createElement('nav');
  element.className = 'akapen-tabbar';
  element.setAttribute('aria-label', t('tabs.label'));

  let items: readonly TabBarItem[] = [];
  let activeId: string | null = null;
  let draggedId: string | null = null;
  let indicatorFrame: number | null = null;

  const indicator = document.createElement('div');
  indicator.className = 'akapen-tabbar__indicator';
  indicator.setAttribute('aria-hidden', 'true');

  const itemById = (id: string): TabBarItem | undefined =>
    items.find((item) => item.id === id);

  const updateIndicator = (): void => {
    indicatorFrame = null;
    const activeTab = element.querySelector<HTMLElement>('.akapen-tabbar__tab.is-active');
    if (!indicator.isConnected || !activeTab || activeTab.offsetWidth === 0) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.width = `${activeTab.offsetWidth}px`;
    indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
    indicator.style.opacity = '1';
  };

  const scheduleIndicatorUpdate = (): void => {
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      updateIndicator();
      return;
    }
    if (indicatorFrame !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(indicatorFrame);
      }
      indicatorFrame = null;
    }
    indicatorFrame = window.requestAnimationFrame(updateIndicator);
  };

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => scheduleIndicatorUpdate());
  resizeObserver?.observe(element);
  element.addEventListener('scroll', scheduleIndicatorUpdate);

  const render = (nextItems: readonly TabBarItem[], nextActiveId: string | null): void => {
    items = nextItems;
    activeId = nextActiveId;
    element.setAttribute('aria-label', t('tabs.label'));
    element.innerHTML = '';

    for (const item of items) {
      const tab = document.createElement('div');
      tab.className = 'akapen-tabbar__tab';
      tab.classList.toggle('is-active', item.id === activeId);
      tab.draggable = true;
      tab.dataset.tabId = item.id;
      tab.title = item.path;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(item.id === activeId));

      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'akapen-tabbar__select';
      selectButton.dataset.action = 'select-tab';
      selectButton.textContent = item.title;
      selectButton.setAttribute('aria-label', t('tabs.switchTo', { name: item.title }));
      selectButton.addEventListener('click', () => options.onSelect(item.id));

      const dirty = document.createElement('span');
      dirty.className = 'akapen-tabbar__dirty';
      dirty.textContent = item.dirty ? '•' : '';
      dirty.setAttribute('aria-label', item.dirty ? t('tabs.modified') : '');

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'akapen-tabbar__close';
      closeButton.dataset.action = 'close-tab';
      closeButton.textContent = '×';
      closeButton.setAttribute('aria-label', t('tabs.close', { name: item.title }));
      closeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        options.onClose(item.id);
      });

      tab.addEventListener('dragstart', (event) => {
        draggedId = item.id;
        event.dataTransfer?.setData('text/plain', item.id);
        event.dataTransfer?.setDragImage(tab, 12, 12);
      });
      tab.addEventListener('dragover', (event) => {
        if (!draggedId || draggedId === item.id) return;
        event.preventDefault();
        tab.classList.add('is-drag-target');
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('is-drag-target');
      });
      tab.addEventListener('drop', (event) => {
        event.preventDefault();
        tab.classList.remove('is-drag-target');
        const sourceId = event.dataTransfer?.getData('text/plain') || draggedId;
        if (!sourceId || sourceId === item.id) return;
        if (itemById(sourceId)) options.onMove(sourceId, item.id);
      });
      tab.addEventListener('dragend', () => {
        draggedId = null;
        for (const el of element.querySelectorAll('.is-drag-target')) {
          el.classList.remove('is-drag-target');
        }
      });

      tab.append(selectButton, dirty, closeButton);
      element.appendChild(tab);
    }

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'akapen-tabbar__add';
    addButton.dataset.action = 'add-tab';
    addButton.textContent = '+';
    addButton.setAttribute('aria-label', t('tabs.add'));
    addButton.addEventListener('click', () => options.onAdd());
    element.appendChild(addButton);
    element.appendChild(indicator);
    scheduleIndicatorUpdate();
  };

  onLanguageChange(() => render(items, activeId));

  return { element, render };
}
