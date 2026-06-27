/**
 * plan30 Phase 1: prosemirror-changeset ベースの変更追跡。
 *
 * PM plugin として動作し、トランザクションの step maps を ChangeSet に蓄積する。
 * 追記（inserted）区間を PM Decoration で赤字表示する。
 *
 * - ChangeSet は PM plugin state として保持（イミュータブル更新）
 * - 削除は PM marks（criticDeletion）で管理（ChangeSet では追跡しない）
 * - 追記は ChangeSet.changes の inserted 区間 → Decoration.inline で赤字
 *
 * setMarkdown（AKAPEN_SKIP_INSERTION_META）が来たときは currentDoc を新しい基準にする。
 * source→preview は AnnotationStore から CriticMarkup を再投影済みなので、ここで
 * baseDoc→currentDoc の構造差分を再計算すると削除済み Markdown 記号を追記扱いする。
 */
import { ChangeSet } from "prosemirror-changeset";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { AKAPEN_SKIP_INSERTION_META } from "./milkdown";

/** plugin state: ChangeSet と、追記判定の基準文書を保持する */
interface ChangeSetState {
  changeSet: ChangeSet;
  baseDoc: Node;
}

export const changeSetKey = new PluginKey<ChangeSetState>("akapen-changeset");

/**
 * PM plugin: トランザクションの step maps を ChangeSet に蓄積する。
 * init で ChangeSet.create(doc) を呼び、apply で addSteps する。
 * setMarkdown（AKAPEN_SKIP_INSERTION_META）の場合は currentDoc を新しい基準にする。
 */
export const changeSetPlugin = $prose(
  () =>
    new Plugin({
      key: changeSetKey,
      state: {
        init(_, state) {
          return { changeSet: ChangeSet.create(state.doc), baseDoc: state.doc };
        },
        apply(tr, pluginState, _oldState, newState) {
          if (tr.getMeta(AKAPEN_SKIP_INSERTION_META)) {
            return {
              changeSet: ChangeSet.create(newState.doc),
              baseDoc: newState.doc,
            };
          }
          if (tr.docChanged) {
            const maps = tr.steps.map((step) => step.getMap());
            return {
              ...pluginState,
              changeSet: pluginState.changeSet.addSteps(
                newState.doc,
                maps,
                null,
              ),
            };
          }
          return pluginState;
        },
      },
    }),
);

const insertionDecoKey = new PluginKey<DecorationSet>("akapen-insertion-deco");

/**
 * PM plugin: ChangeSet の inserted 区間を Decoration.inline で赤字表示する。
 *
 * criticDeletion mark 付きテキストは「削除マーク」であり追記ではないため除外する。
 * ChangeSet は marks を無視する（デフォルト TokenEncoder）ので、addMark による
 * criticDeletion は ChangeSet の changes に現れない。
 *
 * ChangeSet.changes の各 Change は:
 * - fromA/toA: 元文書上の置換範囲（fromA === toA なら純挿入）
 * - fromB/toB: 現文書上の置換範囲（fromB < toB なら挿入テキストあり）
 *
 * fromB < toB の区間に赤字 decoration を付ける。
 */
export const insertionDecoPlugin = $prose(
  () =>
    new Plugin({
      key: insertionDecoKey,
      state: {
        init(_, state) {
          return buildInsertionDecos(state);
        },
        apply(tr, _decoSet, _oldState, newState) {
          if (!tr.docChanged) return _decoSet;
          return buildInsertionDecos(newState);
        },
      },
      props: {
        decorations(state) {
          return insertionDecoKey.getState(state);
        },
      },
    }),
);

function buildInsertionDecos(
  state: import("@milkdown/kit/prose/state").EditorState,
): DecorationSet {
  const pluginState = changeSetKey.getState(state);
  if (!pluginState) return DecorationSet.empty;
  const changeSet = pluginState.changeSet;

  const decos: Decoration[] = [];
  for (const change of changeSet.changes) {
    if (change.fromB >= change.toB) continue;

    // 現文書上の [fromB, toB) にインライン decoration を付ける。
    // criticDeletion mark が付いたテキストは ChangeSet に現れない（marks 無視）ので
    // ここでフィルタする必要はない。
    //
    // ただし fromB/toB が doc の content 範囲を超える場合のガード。
    const docSize = state.doc.content.size;
    const from = Math.max(0, Math.min(change.fromB, docSize));
    const to = Math.max(from, Math.min(change.toB, docSize));
    if (from < to) {
      decos.push(
        Decoration.inline(from, to, {
          class: "critic-insertion",
          nodeName: "ins",
        }),
      );
    }
  }
  return DecorationSet.create(state.doc, decos);
}
