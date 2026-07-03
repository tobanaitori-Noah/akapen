import { t } from './i18n';

interface BrowseEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

interface BrowseResponse {
  cwd: string;
  parent: string | null;
  entries: BrowseEntry[];
  status?: 'error';
  message?: string;
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

const STYLE = `
/* --- dialog shell --- */
.fp-dialog {
  border: none; border-radius: 10px; padding: 0;
  width: 780px; max-width: calc(100vw - 32px);
  height: 520px; max-height: calc(100vh - 64px);
  color: #1d1d1f;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  box-shadow: 0 22px 70px rgba(0,0,0,.3), 0 0 0 .5px rgba(0,0,0,.1);
  overflow: hidden;
  display: flex; flex-direction: column;
}
.fp-dialog::backdrop { background: rgba(0,0,0,.4); }

/* --- title bar --- */
.fp-titlebar {
  flex-shrink: 0;
  padding: 10px 16px;
  background: #f5f5f7; border-bottom: 1px solid #d2d2d7;
  font-weight: 600; font-size: 13px;
}

/* --- nav bar --- */
.fp-navbar {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 4px;
  padding: 6px 12px;
  background: #fafafa; border-bottom: 1px solid #e5e5ea;
}
.fp-nav-btn {
  border: 1px solid #d2d2d7; background: #fff; border-radius: 5px;
  width: 28px; height: 26px; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: #333; padding: 0;
}
.fp-nav-btn:hover { background: #f0f0f0; }
.fp-nav-btn:disabled { color: #c7c7cc; background: #fafafa; cursor: default; }
.fp-breadcrumb {
  flex: 1;
  display: flex; align-items: center;
  margin-left: 6px;
  padding: 4px 8px;
  background: #fff; border: 1px solid #d2d2d7; border-radius: 5px;
  overflow-x: auto; white-space: nowrap;
  font-size: 12px; color: #86868b;
  min-height: 26px;
}
.fp-breadcrumb button {
  border: none; background: none; padding: 0 3px;
  color: #007aff; font-size: 12px; cursor: pointer;
}
.fp-breadcrumb button:hover { text-decoration: underline; }
.fp-bc-sep { margin: 0 2px; color: #c7c7cc; }
.fp-bc-current { color: #1d1d1f; font-weight: 500; padding: 0 3px; }

/* --- body 2-col --- */
.fp-body {
  flex: 1; min-height: 0;
  display: flex;
  border-bottom: 1px solid #d2d2d7;
}

/* --- tree (left) --- */
.fp-tree {
  width: 200px; min-width: 200px;
  border-right: 1px solid #e0e0e0;
  background: #f7f7f9;
  overflow-y: auto; overflow-x: hidden;
  padding: 4px 0;
}
.fp-tree-node {
  display: flex; align-items: center;
  width: 100%; border: none; background: none;
  padding: 3px 8px 3px 0;
  text-align: left; cursor: pointer;
  font-size: 12px; color: #1d1d1f;
  white-space: nowrap;
  line-height: 1.5;
}
.fp-tree-node:hover { background: rgba(0,0,0,.04); }
.fp-tree-node.selected { background: #007aff; color: #fff; border-radius: 4px; margin: 0 4px; width: calc(100% - 8px); }
.fp-tree-toggle {
  width: 16px; flex-shrink: 0;
  text-align: center; font-size: 9px; color: #666;
  cursor: pointer; user-select: none;
}
.fp-tree-node.selected .fp-tree-toggle { color: rgba(255,255,255,.7); }
.fp-tree-icon { margin-right: 4px; font-size: 14px; flex-shrink: 0; }
.fp-tree-label { overflow: hidden; text-overflow: ellipsis; }
.fp-tree-children { display: none; }
.fp-tree-children.open { display: block; }

/* --- list (right) --- */
.fp-list {
  flex: 1; min-width: 0;
  overflow-y: auto;
  background: #fff;
}
.fp-row {
  display: flex; align-items: center; gap: 8px;
  width: 100%; border: none; background: none;
  padding: 5px 16px;
  text-align: left; cursor: pointer;
  font-size: 13px; color: #1d1d1f;
  border-bottom: .5px solid rgba(0,0,0,.04);
}
.fp-row:last-child { border-bottom: none; }
.fp-row:hover { background: #f2f2f7; }
.fp-row.selected { background: #007aff; color: #fff; }
.fp-row-icon { font-size: 18px; flex-shrink: 0; width: 24px; text-align: center; }
.fp-row[data-type="dir"] .fp-row-icon { color: #56a1f5; }
.fp-row[data-type="file"] .fp-row-icon { color: #8e8e93; }
.fp-row.selected .fp-row-icon { filter: brightness(10); }
.fp-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-empty {
  padding: 40px 16px; text-align: center;
  color: #86868b; font-size: 13px;
}

/* --- footer --- */
.fp-footer {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  background: #f5f5f7;
}
.fp-footer-label { font-size: 12px; color: #555; flex-shrink: 0; }
.fp-footer-filename {
  flex: 1; min-width: 0;
  border: 1px solid #d2d2d7; border-radius: 5px;
  padding: 5px 8px; font-size: 12px;
  background: #fff; color: #1d1d1f;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fp-footer input.fp-footer-filename { outline: none; }
.fp-footer input.fp-footer-filename:focus {
  border-color: #007aff; box-shadow: 0 0 0 2px rgba(0,122,255,.18);
}
.fp-btn {
  border: 1px solid #d2d2d7; border-radius: 5px;
  padding: 5px 14px; background: #fff; color: #1d1d1f;
  font-size: 12px; cursor: pointer; flex-shrink: 0;
}
.fp-btn:hover { background: #ebebed; }
.fp-btn-primary {
  border: none; border-radius: 5px;
  padding: 5px 18px; background: #007aff; color: #fff;
  font-size: 12px; font-weight: 500; cursor: pointer; flex-shrink: 0;
}
.fp-btn-primary:hover { background: #0062d1; }
.fp-btn-primary:disabled { background: #b0d4ff; cursor: default; }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function browse(dir?: string): Promise<BrowseResponse> {
  const url = dir ? `/api/file/browse?dir=${encodeURIComponent(dir)}` : '/api/file/browse';
  const res = await fetch(url);
  return (await res.json()) as BrowseResponse;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function defaultReviewName(basePath?: string | null): string {
  if (!basePath) return 'review.akapen.md';
  const name = basePath.split('/').pop() ?? 'review.md';
  if (/\.md$/i.test(name)) return `${name.slice(0, -3)}.akapen.md`;
  return `${name}.akapen.md`;
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/$/, '')}/${name.replace(/^\//, '')}`;
}

export function resolvePickerInputPath(input: string, currentDir: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.startsWith('/')) return value;
  return joinPath(currentDir || '/', value);
}

function parentPathFor(filePath: string): string {
  const parent = filePath.split('/').slice(0, -1).join('/');
  return parent || '/';
}

function basenameFor(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() ?? '';
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

function renderBreadcrumb(container: HTMLElement, cwdPath: string, onNav: (dir: string) => void): void {
  container.replaceChildren();
  const parts = cwdPath.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'fp-bc-sep';
      sep.textContent = ' › ';
      container.appendChild(sep);
    }
    if (i === parts.length - 1) {
      const span = document.createElement('span');
      span.className = 'fp-bc-current';
      span.textContent = parts[i];
      container.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = parts[i];
      const target = '/' + parts.slice(0, i + 1).join('/');
      btn.addEventListener('click', () => onNav(target));
      container.appendChild(btn);
    }
  }
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

interface TreeState {
  container: HTMLElement;
  selectedPath: string | null;
  onSelect: (dirPath: string) => void;
}

function createTreeNode(
  entry: { name: string; path: string },
  depth: number,
  state: TreeState,
): HTMLElement {
  const wrapper = document.createElement('div');

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'fp-tree-node';
  row.style.paddingLeft = `${8 + depth * 14}px`;

  const toggle = document.createElement('span');
  toggle.className = 'fp-tree-toggle';
  toggle.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'fp-tree-icon';
  icon.textContent = '📁';

  const label = document.createElement('span');
  label.className = 'fp-tree-label';
  label.textContent = entry.name;

  row.append(toggle, icon, label);

  const childContainer = document.createElement('div');
  childContainer.className = 'fp-tree-children';

  let loaded = false;
  let expanded = false;

  const doExpand = async () => {
    if (!loaded) {
      loaded = true;
      const data = await browse(entry.path);
      if (data.status !== 'error') {
        const dirs = data.entries.filter(e => e.type === 'dir');
        for (const d of dirs) {
          childContainer.appendChild(createTreeNode(d, depth + 1, state));
        }
        if (dirs.length === 0) {
          toggle.textContent = ' ';
        }
      }
    }
    expanded = true;
    childContainer.classList.add('open');
    toggle.textContent = toggle.textContent === ' ' ? ' ' : '▼';
  };

  const doCollapse = () => {
    expanded = false;
    childContainer.classList.remove('open');
    if (toggle.textContent !== ' ') toggle.textContent = '▶';
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (expanded) doCollapse();
    else void doExpand();
  });

  row.addEventListener('click', () => {
    state.selectedPath = entry.path;
    state.container.querySelectorAll('.fp-tree-node.selected').forEach(el => el.classList.remove('selected'));
    row.classList.add('selected');
    void doExpand();
    state.onSelect(entry.path);
  });

  wrapper.append(row, childContainer);
  wrapper.dataset.treePath = entry.path;
  return wrapper;
}

async function initTree(state: TreeState, homePath: string): Promise<void> {
  state.container.replaceChildren();
  const data = await browse(homePath);
  if (data.status === 'error') return;
  const dirs = data.entries.filter(e => e.type === 'dir');
  for (const d of dirs) {
    state.container.appendChild(createTreeNode(d, 0, state));
  }
}

function selectTreePath(container: HTMLElement, targetPath: string): void {
  container.querySelectorAll('.fp-tree-node.selected').forEach(el => el.classList.remove('selected'));
  const wrapper = container.querySelector(`[data-tree-path="${CSS.escape(targetPath)}"]`);
  if (wrapper) {
    const node = wrapper.querySelector('.fp-tree-node');
    if (node) node.classList.add('selected');
  }
}

// ---------------------------------------------------------------------------
// Right list
// ---------------------------------------------------------------------------

function renderList(
  container: HTMLElement,
  entries: BrowseEntry[],
  opts: {
    onEnterDir: (path: string) => void;
    onSelectFile?: (path: string) => void;
    onDoubleClickFile?: (path: string) => void;
    showFiles: boolean;
  },
): void {
  container.replaceChildren();
  const visible = opts.showFiles ? entries : entries.filter(e => e.type === 'dir');
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fp-empty';
    empty.textContent = opts.showFiles ? t('filePicker.noMarkdown') : t('filePicker.noFolder');
    container.appendChild(empty);
    return;
  }
  for (const entry of visible) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'fp-row';
    row.dataset.type = entry.type;
    const iconEl = document.createElement('span');
    iconEl.className = 'fp-row-icon';
    iconEl.textContent = entry.type === 'dir' ? '📁' : '📄';
    const nameEl = document.createElement('span');
    nameEl.className = 'fp-row-name';
    nameEl.textContent = entry.name;
    row.append(iconEl, nameEl);

    if (entry.type === 'dir') {
      row.addEventListener('click', () => opts.onEnterDir(entry.path));
    } else {
      row.addEventListener('click', () => {
        container.querySelectorAll('.fp-row.selected').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        opts.onSelectFile?.(entry.path);
      });
      row.addEventListener('dblclick', () => opts.onDoubleClickFile?.(entry.path));
    }
    container.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Open picker
// ---------------------------------------------------------------------------

export function showFilePicker(): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedFile: string | null = null;
    const history: string[] = [];
    let historyIdx = -1;

    const dialog = document.createElement('dialog');
    dialog.className = 'fp-dialog';
    const style = document.createElement('style');
    style.textContent = STYLE;

    // title bar
    const titlebar = document.createElement('div');
    titlebar.className = 'fp-titlebar';
    titlebar.textContent = t('filePicker.openTitle');

    // nav bar
    const navbar = document.createElement('div');
    navbar.className = 'fp-navbar';
    const backBtn = document.createElement('button');
    backBtn.type = 'button'; backBtn.className = 'fp-nav-btn'; backBtn.textContent = '←'; backBtn.disabled = true;
    const fwdBtn = document.createElement('button');
    fwdBtn.type = 'button'; fwdBtn.className = 'fp-nav-btn'; fwdBtn.textContent = '→'; fwdBtn.disabled = true;
    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'fp-nav-btn'; upBtn.textContent = '↑'; upBtn.disabled = true;
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'fp-breadcrumb';
    navbar.append(backBtn, fwdBtn, upBtn, breadcrumb);

    // body
    const body = document.createElement('div');
    body.className = 'fp-body';
    const treeEl = document.createElement('div');
    treeEl.className = 'fp-tree';
    const listEl = document.createElement('div');
    listEl.className = 'fp-list';
    body.append(treeEl, listEl);

    // footer
    const footer = document.createElement('div');
    footer.className = 'fp-footer';
    const fnLabel = document.createElement('span');
    fnLabel.className = 'fp-footer-label';
    fnLabel.textContent = t('filePicker.filename');
    const fnInput = document.createElement('input');
    fnInput.type = 'text';
    fnInput.className = 'fp-footer-filename';
    fnInput.value = '';
    fnInput.ariaLabel = t('filePicker.filename');
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'fp-btn'; cancelBtn.textContent = t('filePicker.cancel');
    const openBtn = document.createElement('button');
    openBtn.type = 'button'; openBtn.className = 'fp-btn-primary'; openBtn.textContent = t('filePicker.open'); openBtn.disabled = true;
    footer.append(fnLabel, fnInput, spacer, cancelBtn, openBtn);

    dialog.append(style, titlebar, navbar, body, footer);

    let currentDir = '';
    let parentDir: string | null = null;

    const treeState: TreeState = {
      container: treeEl,
      selectedPath: null,
      onSelect: (dirPath) => void navigateTo(dirPath, true),
    };

    const updateNav = () => {
      backBtn.disabled = historyIdx <= 0;
      fwdBtn.disabled = historyIdx >= history.length - 1;
      upBtn.disabled = !parentDir;
    };

    const clearInputError = (): void => {
      fnInput.setCustomValidity('');
    };

    const showInputError = (message?: string): void => {
      fnInput.setCustomValidity(message || t('filePicker.noMarkdown'));
      fnInput.reportValidity();
    };

    const loadDir = async (dir: string) => {
      selectedFile = null;
      openBtn.disabled = true;
      fnInput.value = '';
      clearInputError();

      const data = await browse(dir);
      if (data.status === 'error') return;

      currentDir = data.cwd;
      parentDir = data.parent;
      renderBreadcrumb(breadcrumb, data.cwd, (d) => void navigateTo(d, true));
      selectTreePath(treeEl, data.cwd);
      updateNav();

      renderList(listEl, data.entries, {
        onEnterDir: (p) => void navigateTo(p, true),
        onSelectFile: (p) => {
          selectedFile = p;
          openBtn.disabled = false;
          fnInput.value = basenameFor(p);
          clearInputError();
        },
        onDoubleClickFile: (p) => { dialog.close(); resolve(p); },
        showFiles: true,
      });
    };

    const openInputPath = async (): Promise<void> => {
      clearInputError();
      if (selectedFile && fnInput.value.trim() === basenameFor(selectedFile)) {
        dialog.close();
        resolve(selectedFile);
        return;
      }

      const candidate = resolvePickerInputPath(fnInput.value, currentDir);
      if (!candidate) return;

      const dirData = await browse(candidate);
      if (dirData.status !== 'error') {
        await navigateTo(dirData.cwd, true);
        return;
      }

      const parent = parentPathFor(candidate);
      const name = basenameFor(candidate);
      const parentData = await browse(parent);
      if (parentData.status === 'error') {
        showInputError(parentData.message);
        return;
      }

      const matched = parentData.entries.find((entry) => entry.name === name || entry.path === candidate);
      if (!matched) {
        showInputError(dirData.message);
        return;
      }
      if (matched.type === 'dir') {
        await navigateTo(matched.path, true);
        return;
      }

      dialog.close();
      resolve(matched.path);
    };

    const navigateTo = async (dir: string, pushHistory: boolean) => {
      if (pushHistory) {
        history.splice(historyIdx + 1);
        history.push(dir);
        historyIdx = history.length - 1;
      }
      await loadDir(dir);
    };

    backBtn.addEventListener('click', () => {
      if (historyIdx > 0) { historyIdx--; void loadDir(history[historyIdx]).then(updateNav); }
    });
    fwdBtn.addEventListener('click', () => {
      if (historyIdx < history.length - 1) { historyIdx++; void loadDir(history[historyIdx]).then(updateNav); }
    });
    upBtn.addEventListener('click', () => { if (parentDir) void navigateTo(parentDir, true); });
    fnInput.addEventListener('input', () => {
      selectedFile = null;
      clearInputError();
      openBtn.disabled = fnInput.value.trim().length === 0;
      listEl.querySelectorAll('.fp-row.selected').forEach((row) => row.classList.remove('selected'));
    });
    fnInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void openInputPath();
    });
    openBtn.addEventListener('click', () => {
      void openInputPath();
    });
    cancelBtn.addEventListener('click', () => { dialog.close(); resolve(null); });
    dialog.addEventListener('cancel', () => resolve(null), { once: true });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();

    fetch('/api/file/browse').then(r => r.json()).then(async (data: BrowseResponse) => {
      const home = data.cwd ?? '/Users';
      await initTree(treeState, home);
      void navigateTo(home, true);
    });
  });
}

// ---------------------------------------------------------------------------
// Save picker
// ---------------------------------------------------------------------------

export function showSaveLocationPicker(basePath?: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    let currentDir = '';

    const dialog = document.createElement('dialog');
    dialog.className = 'fp-dialog';
    const style = document.createElement('style');
    style.textContent = STYLE;

    // title bar
    const titlebar = document.createElement('div');
    titlebar.className = 'fp-titlebar';
    titlebar.textContent = t('filePicker.saveTitle');

    // nav bar
    const navbar = document.createElement('div');
    navbar.className = 'fp-navbar';
    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'fp-nav-btn'; upBtn.textContent = '↑'; upBtn.disabled = true;
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'fp-breadcrumb';
    navbar.append(upBtn, breadcrumb);

    // body
    const body = document.createElement('div');
    body.className = 'fp-body';
    const treeEl = document.createElement('div');
    treeEl.className = 'fp-tree';
    const listEl = document.createElement('div');
    listEl.className = 'fp-list';
    body.append(treeEl, listEl);

    // footer
    const footer = document.createElement('div');
    footer.className = 'fp-footer';
    const fnLabel = document.createElement('span');
    fnLabel.className = 'fp-footer-label';
    fnLabel.textContent = t('filePicker.filename');
    const input = document.createElement('input');
    input.className = 'fp-footer-filename';
    input.value = defaultReviewName(basePath);
    input.ariaLabel = t('filePicker.saveFilename');
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'fp-btn'; cancelBtn.textContent = t('filePicker.cancel');
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'fp-btn-primary'; saveBtn.textContent = t('filePicker.save');
    footer.append(fnLabel, input, spacer, cancelBtn, saveBtn);

    dialog.append(style, titlebar, navbar, body, footer);

    let parentPath: string | null = null;

    const treeState: TreeState = {
      container: treeEl,
      selectedPath: null,
      onSelect: (dirPath) => void loadDir(dirPath),
    };

    const loadDir = async (dir?: string) => {
      const data = await browse(dir);
      if (data.status === 'error') return;
      currentDir = data.cwd;
      parentPath = data.parent;
      upBtn.disabled = !data.parent;
      renderBreadcrumb(breadcrumb, data.cwd, (d) => void loadDir(d));
      selectTreePath(treeEl, data.cwd);

      renderList(listEl, data.entries, {
        onEnterDir: (p) => void loadDir(p),
        showFiles: false,
      });
    };

    upBtn.addEventListener('click', () => { if (parentPath) void loadDir(parentPath); });
    saveBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) return;
      dialog.close();
      resolve(joinPath(currentDir, name));
    });
    cancelBtn.addEventListener('click', () => { dialog.close(); resolve(null); });
    dialog.addEventListener('cancel', () => resolve(null), { once: true });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();

    const startDir = basePath ? basePath.split('/').slice(0, -1).join('/') : undefined;
    fetch('/api/file/browse').then(r => r.json()).then(async (data: BrowseResponse) => {
      const home = data.cwd ?? '/Users';
      await initTree(treeState, home);
      void loadDir(startDir ?? home);
    });
  });
}
