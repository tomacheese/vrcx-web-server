# GitHub Copilot Instructions

## プロジェクト概要
- 目的: VRCX の SQLite データベースを API として公開するウェブサーバー
- 主な機能: テーブル一覧の取得、指定したテーブルのレコード取得（ページネーション対応）
- 対象ユーザー: 開発者、VRCX ユーザー

## 共通ルール
- 会話は日本語で行う。
- PR とコミットは Conventional Commits に従う。
- 日本語と英数字の間には半角スペースを入れる。
- コード内のコメントは日本語で記載する。
- エラーメッセージは原則英語で記載する。

## 技術スタック
- 言語: TypeScript
- フレームワーク: Fastify
- データベース: better-sqlite3
- パッケージマネージャー: pnpm

## コーディング規約
- フォーマット: Prettier
- Lint: ESLint
- TypeScript: `skipLibCheck` の使用を禁止
- ドキュメント: 関数やインターフェースには JSDoc を日本語で記載

## 開発コマンド
```bash
# 依存関係のインストール
pnpm install

# 開発（ウォッチモード）
pnpm dev

# ビルド
pnpm build

# Lint チェック
pnpm lint

# 自動修正（ESLint, Prettier）
pnpm fix
```

## テスト方針
- 現在、テストコードは実装されていないが、追加する場合は Vitest 等の現代的なフレームワークを検討する。

## セキュリティ / 機密情報
- 認証情報やパスを直接コードに記述せず、環境変数（`ENV` オブジェクト）経由で取得する。
- ログに機密情報を出力しない。

## リポジトリ固有
- VRCX のデータベースパスは環境変数 `VRCX_SQLITE_FILEPATH` で指定可能。
- デフォルトでは Windows の標準的な VRCX データベースパスを参照する。
- API は読み取り専用（readonly モードでデータベースをオープン）として実装する。
