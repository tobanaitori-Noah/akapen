# akapen-dist｜配布用隔離フォルダ

このフォルダは PUBLIC 配布用。GitHub `tobanaitori-Noah/akapen` に対応。

## 最重要ルール

**コピー・git push・npm publish は、owner が明示的に指示するまで一切行わない。**
「配布用に更新して」「push して」「publish して」等の明示発言がない限り、AI はこれらの操作を提案も実行もしない。

## 鉄則

- **ここでは開発しない。** 開発は `Project_T/.company/app/akapen/` で行う。
- **ファイルの追加・変更は owner の明示指示があった時だけ。** AI が自主判断で操作しない。
- **git push / npm publish は owner 明示確認ゲート。**
- **機密を含めない。** API キー・個人情報・事業戦略・Project_T 内部情報は一切入れない。

詳細ルールは `../../CLAUDE.md`（claude.project 共通ルール）を参照。
