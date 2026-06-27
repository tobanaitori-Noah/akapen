/**
 * 選択ポップオーバー（3操作の入口＝削除/コメント/マーク解除・計画2 Task 5 Step 5）。
 *
 * 右ペインで選択が非空のとき選択近傍に表示する。
 * 表示判定は document の selectionchange（programmatic な PM setSelection／CM6 dispatch
 * ＋focus でも発火する）＋refresh() の手動呼び出し（モード切替時）。
 * 「コメント」は指示文の入力欄を開き、確定で onComment（適用は app.ts＝applyComment）。
 * コメント表示の v1 最終形（引き出し線つき欄外注）は Task 9・C25＝このタスクでは
 * 赤下線＋hover 吹き出し（補助・CSS は ui/styles.css）まで。
 * v1.1 F8: 2行目に Markdown 整形（H1/H2/H3/太字/箇条書き＝Apple メモ風）を追加。
 * v1.1 F6: 原文（source）モードでも表示する。選択状態は getTarget()（app.ts が現モードの
 * 実体から作る）に抽象化し、source では削除/コメントだけ出す（マーク解除・整形は
 * preview 専用＝CSS .is-source で隠す）。適用は app.ts＝ここは表示と発火だけ。
 *
 * plan15 C-2: 「マーク解除」廃止→「削除解除」コンテキスト別表示。
 *   - context が 'deletion' のとき「削除解除」ボタンのみ追加表示
 *   - context が 'comment' のときはコメント削除は comment-popup.ts 側の「コメント削除」ボタンで実施
 *   - それ以外（'plain'/null）は解除系ボタン非表示
 *   getMarkContext?: () => 'deletion' | 'comment' | 'plain' | null
 *   onRemoveDeletion?: () => void
 *   後方互換: onRemoveMarks は plan16 で清掃されるまでシムとして保持。
 *
 * plan15 追加修正 A: 「コメント削除」は PopOver から廃止し comment-popup.ts 側に移動。
 *   PopOver には「削除解除」だけ残す（削除マーク選択時のみ）。
 */
export interface PopoverTarget {
  /** 'preview'＝Milkdown／'source'＝CM6（source ではマーク解除・整形を出さない） */
  kind: "preview" | "source";
  /** 選択が空か（空なら非表示） */
  empty: boolean;
  /** 選択末尾の viewport 座標（取得不可なら null＝非表示） */
  coords: { left: number; bottom: number } | null;
}

export interface SelectionPopoverOptions {
  /** ポップオーバーを重ねる親（position: relative の右ペイン本体） */
  container: HTMLElement;
  /** 現モードの選択状態（未ロード等は null＝非表示） */
  getTarget(): PopoverTarget | null;
  onDelete(): void;
  onComment(instruction: string): void;
  /** @deprecated plan15 C-2 で onRemoveDeletion に分離。plan16 で削除予定。 */
  onRemoveMarks(): void;
  /**
   * plan15 C-2: 選択範囲のマークコンテキストを返す。
   *   'deletion' = 削除マーク内、'comment' = コメントマーク内、'plain' = 通常テキスト。
   *   undefined の場合は後方互換（旧 onRemoveMarks ボタンを非表示にしてコンテキスト解除非対応）。
   */
  getMarkContext?(): "deletion" | "comment" | "plain" | null;
  /** plan15 C-2: 削除マーク解除（{--X--} → X）。 */
  onRemoveDeletion?(): void;
  /** F8: 見出し化（H1〜H3。同レベル再適用は app 側で段落へ戻す） */
  onHeading(level: 1 | 2 | 3): void;
  /** F8: 太字トグル */
  onBold(): void;
  /** F8: 箇条書き化 */
  onBulletList(): void;
}

export interface SelectionPopoverHandle {
  element: HTMLElement;
  /** 選択状態を再評価して表示/非表示・位置を更新する */
  refresh(): void;
  destroy(): void;
}

export function createSelectionPopover(
  options: SelectionPopoverOptions,
): SelectionPopoverHandle {
  const element = document.createElement("div");
  element.className = "akapen-popover";
  element.innerHTML = `
    <div class="akapen-popover__row">
      <button type="button" data-action="popover-delete">削除</button>
      <button type="button" data-action="popover-comment">コメント</button>
      <button type="button" data-action="popover-remove-deletion" hidden>削除解除</button>
      <span class="akapen-popover__comment">
        <input type="text" data-role="comment-input" placeholder="添削指示" />
        <button type="button" data-action="popover-comment-confirm">確定</button>
      </span>
    </div>
    <div class="akapen-popover__row akapen-popover__format" role="group" aria-label="Markdown 整形">
      <button type="button" data-action="popover-h1" aria-label="見出し1にする">H1</button>
      <button type="button" data-action="popover-h2" aria-label="見出し2にする">H2</button>
      <button type="button" data-action="popover-h3" aria-label="見出し3にする">H3</button>
      <button type="button" data-action="popover-bold" aria-label="太字にする">太字</button>
      <button type="button" data-action="popover-bullet" aria-label="箇条書きにする">箇条書き</button>
    </div>
  `;
  options.container.appendChild(element);

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = element.querySelector<T>(selector);
    if (!el) throw new Error(`popover: ${selector} not found`);
    return el;
  };
  const commentRow = query<HTMLSpanElement>(".akapen-popover__comment");
  const commentInput = query<HTMLInputElement>('[data-role="comment-input"]');
  const btnRemoveDeletion = query<HTMLButtonElement>(
    '[data-action="popover-remove-deletion"]',
  );
  const btnComment = query<HTMLButtonElement>(
    '[data-action="popover-comment"]',
  );
  const btnDeleteAction = query<HTMLButtonElement>(
    '[data-action="popover-delete"]',
  );

  const closeCommentRow = (): void => {
    commentRow.classList.remove("is-open");
    commentInput.value = "";
  };
  const hide = (): void => {
    element.classList.remove("is-open");
    closeCommentRow();
  };

  /** plan15 C-2 + 追加修正A/B/C: コンテキスト別ボタン表示・disabled 制御。
   * - 削除解除: 削除マーク選択時のみ表示。
   * - コメントボタン disabled: 選択範囲が削除マーク または 既存コメントマークと1文字でも重なる場合。
   * コメント削除は comment-popup.ts 側の「コメント削除」ボタンで実施するため PopOver から廃止。 */
  const updateContextButtons = (): void => {
    if (!options.getMarkContext) {
      // 後方互換: getMarkContext 未提供 → 解除ボタン非表示・コメントは常時有効
      btnRemoveDeletion.hidden = true;
      btnComment.disabled = false;
      return;
    }
    const ctx = options.getMarkContext();
    btnRemoveDeletion.hidden = ctx !== "deletion";
    // コメント範囲を含む選択では「削除」「コメント」を disabled にする
    const commentDisabled = ctx === "deletion" || ctx === "comment";
    btnDeleteAction.disabled = ctx === "comment";
    btnComment.disabled = commentDisabled;
    if (commentDisabled) {
      closeCommentRow();
    }
  };

  // ボタン操作でエディター側の選択を失わない（mousedown の既定動作＝フォーカス移動を
  // 抑止）。指示文 input はフォーカスが必要なので除外。
  element.addEventListener("mousedown", (event) => {
    if ((event.target as HTMLElement).closest('[data-role="comment-input"]'))
      return;
    event.preventDefault();
  });

  query('[data-action="popover-delete"]').addEventListener("click", () => {
    closeCommentRow();
    options.onDelete();
  });
  // plan15 C-2: 削除解除ボタン
  btnRemoveDeletion.addEventListener("click", () => {
    closeCommentRow();
    if (options.onRemoveDeletion) {
      options.onRemoveDeletion();
    }
  });

  query('[data-action="popover-comment"]').addEventListener("click", () => {
    commentRow.classList.add("is-open");
    commentInput.focus();
  });
  query('[data-action="popover-comment-confirm"]').addEventListener(
    "click",
    () => {
      const instruction = commentInput.value.trim();
      if (instruction === "") return;
      closeCommentRow();
      options.onComment(instruction);
    },
  );
  // 修正 F 改: Enter 2 回確定（IME 配慮）
  // IME 変換中（isComposing=true）は何もしない（変換確定を許可）。
  // 変換中でない Enter: 1 回目は preventDefault + enterPending=true、
  // 2 回目で confirmEdit。他キー押下/input/blur でフラグリセット。
  let enterPending = false;
  const resetEnterPending = (): void => {
    enterPending = false;
  };
  commentInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (e.isComposing) return; // IME 変換確定 Enter は無視（変換を許可）
      e.preventDefault();
      if (!enterPending) {
        enterPending = true;
      } else {
        enterPending = false;
        const instruction = commentInput.value.trim();
        if (instruction === "") return;
        closeCommentRow();
        options.onComment(instruction);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      resetEnterPending();
      closeCommentRow();
    } else {
      resetEnterPending();
    }
  });
  commentInput.addEventListener("input", resetEnterPending);
  commentInput.addEventListener("blur", resetEnterPending);
  // F8: 整形（見出し/太字/箇条書き）＝コメント入力中なら閉じてから適用
  for (const level of [1, 2, 3] as const) {
    query(`[data-action="popover-h${level}"]`).addEventListener("click", () => {
      closeCommentRow();
      options.onHeading(level);
    });
  }
  query('[data-action="popover-bold"]').addEventListener("click", () => {
    closeCommentRow();
    options.onBold();
  });
  query('[data-action="popover-bullet"]').addEventListener("click", () => {
    closeCommentRow();
    options.onBulletList();
  });

  const refresh = (): void => {
    const target = options.getTarget();
    if (!target || target.empty || !target.coords) {
      hide();
      return;
    }
    // 指示文の入力中（フォーカスがポップオーバー内）は位置を据え置いて出しっぱなし
    if (
      element.classList.contains("is-open") &&
      element.contains(document.activeElement)
    ) {
      return;
    }
    // F6: source ではマーク解除・整形行を隠す（CSS .is-source）
    element.classList.toggle("is-source", target.kind === "source");
    // plan15 C-2: コンテキスト別ボタン更新
    updateContextButtons();
    const containerRect = options.container.getBoundingClientRect();
    const left =
      target.coords.left - containerRect.left + options.container.scrollLeft;
    const top =
      target.coords.bottom -
      containerRect.top +
      options.container.scrollTop +
      6;
    element.style.left = `${Math.max(0, left)}px`;
    element.style.top = `${Math.max(0, top)}px`;
    element.classList.add("is-open");
  };

  document.addEventListener("selectionchange", refresh);

  return {
    element,
    refresh,
    destroy() {
      document.removeEventListener("selectionchange", refresh);
      element.remove();
    },
  };
}
