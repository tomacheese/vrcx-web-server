# vrcx-web-server

VRCX WebサーバーはVRCXデータベースからのFeedやGame logをWebインターフェース経由でリアルタイムに表示するサーバーです。

## 新機能: リアルタイム更新

WebSocketを使用してFeedやGame logデータのリアルタイム更新を実装しました。従来の10秒間隔でのポーリングから、データベースの変更を即座に検知して更新する方式に変更されています。

### WebSocket 機能

- **リアルタイム更新**: VRCX SQLiteデータベースの変更を2秒間隔で監視し、変更が検知されると即座にクライアントに更新を送信
- **自動再接続**: 接続が切断された場合、指数バックオフ（最大30秒）で自動再接続を試行
- **接続状態表示**: UI上でWebSocket接続状態を表示

### WebSocket エンドポイント

```
ws://localhost:8000/api/ws
```

### メッセージ形式

#### クライアント → サーバー
```json
{ "type": "subscribe" }  // 更新の購読
{ "type": "ping" }       // 接続維持のためのping
```

#### サーバー → クライアント
```json
{
  "type": "initial_data",
  "data": {
    "feed": [...],
    "gamelog": [...]
  }
}

{
  "type": "data_update", 
  "data": {
    "feed": [...],
    "gamelog": [...]
  }
}

{ "type": "pong" }  // pingに対する応答
```

## 開発

```bash
# 依存関係のインストール
pnpm install

# 開発サーバーの起動
pnpm run dev

# ビルド
pnpm run build
```
