# GEMINI.md

## 目的
このファイルは Gemini CLI 向けのコンテキストと作業方針を定義します。

## 出力スタイル
- 言語: 日本語
- トーン: プロフェッショナルかつ簡潔
- 形式: Markdown

## 共通ルール
- 会話は日本語で行う。
- コミットメッセージは Conventional Commits に従い、説明文は日本語で記載する。
- 日本語と英数字の間には半角スペースを挿入する。

## プロジェクト概要
- VRCX の SQLite データベースを API として公開する Fastify ベースのウェブサーバー。
- TypeScript を使用し、pnpm でパッケージ管理を行っている。

## コーディング規約
- 会話言語・コメント: 日本語
- エラーメッセージ: 英語
- フォーマット: Prettier (`pnpm fix:prettier`)
- Lint: ESLint (`pnpm lint:eslint`)

## 開発コマンド
```bash
# 依存関係のインストール
pnpm install

# 開発
pnpm dev

# ビルド
pnpm build

# 全体的な Lint チェック
pnpm lint

# 修正
pnpm fix
```

## 注意事項
- **セキュリティ**: データベースのパスや認証情報をコードに直接記述しない。環境変数を使用する。
- **読み取り専用**: データベース接続は `readonly: true` で行う。
- **既存ルールの優先**: すでに存在するコードのスタイルやアーキテクチャ（`BaseRouter` 継承など）を尊重する。

## リポジトリ固有
- `src/endpoints/api.ts` が主要なロジックを含んでおり、SQLite へのクエリ処理が行われている。
- VRCX のデフォルトパスは Windows ユーザー向けに設定されているが、環境変数で上書き可能。
