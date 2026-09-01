# イントロクイズ早押しシステム

スマホから参加するイントロクイズ用の早押しシステムです。Socket.IOサーバーが参加者・早押し・問題進行を共有し、用途別に3画面を提供します。

| パス | 用途 |
|---|---|
| `/` | 参加者用。スマホで名前を登録して早押しする |
| `/screen` | プロジェクター投影用。表示と音声再生のみ |
| `/host` | 進行管理用。手元PCからボタンですべて操作する |

本番環境: [https://intro-quiz-u3vn.onrender.com](https://intro-quiz-u3vn.onrender.com)

当日の操作方法は [docs/RUNBOOK.md](docs/RUNBOOK.md) を参照してください。

## 開発環境

### セットアップ

リポジトリのルートで依存パッケージをインストールします。

```powershell
npm install
```

### 起動

2枚のターミナルを開き、どちらもリポジトリのルートで実行します。

ターミナル1 — Socket.IO・HTTPサーバー（ポート3000）:

```powershell
npm run server
```

ターミナル2 — Vite開発サーバー（通常はポート5173）:

```powershell
npm run dev
```

ローカルで開くURL:

- 参加者: `http://localhost:5173/`
- 投影画面: `http://localhost:5173/screen`
- 管理画面: `http://localhost:5173/host`

スマホ実機から確認する場合は、PCとスマホを同じLANに接続し、Viteが表示するNetwork URLを開きます。例: `http://192.168.1.20:5173/`

### その他のnpmスクリプト

```powershell
npm run typecheck
npm run build
npm start
```

- `typecheck`: TypeScriptの型チェックのみを実行
- `build`: フロントエンドを `dist/` にビルド
- `start`: ビルド済みの `dist/` をHTTP・Socket.IOサーバーから配信

## Socket.IOテスト

3本とも、実行前に対象サーバーを起動しておきます。引数を省略すると `http://localhost:3000` へ接続します。

### 早押し・排他制御 — buzztest

```powershell
node scripts/buzztest.mjs
```

同時押しで1人だけが受理されること、お手つきした本人だけがロックされること、3秒後の受付再開、押下取消、ラウンドのリセット、未登録参加者の拒否などを検証します。

### 管理画面と投影状態の同期 — hosttest

```powershell
node scripts/hosttest.mjs
```

問題選択、答え表示、手動・YouTubeモード切替、再生状態、お手つき表示と3秒カウントダウン、後から接続した画面への状態同期など、`/host` 相当の操作が共有状態へ正しく反映されることを検証します。

### リロード後のお手つき維持 — relocktest

```powershell
node scripts/relocktest.mjs
```

同じ `clientId` の参加者が切断・再接続・名前変更をしてもお手つきが解除されず、次の問題でのみ解除されることを検証します。同じ端末を二重に開いても参加者が重複しないことも確認します。

### Render環境をテストする

各スクリプトの第1引数に接続先URLを渡します。

```powershell
node scripts/buzztest.mjs https://intro-quiz-u3vn.onrender.com
node scripts/hosttest.mjs https://intro-quiz-u3vn.onrender.com
node scripts/relocktest.mjs https://intro-quiz-u3vn.onrender.com
```

リモート環境が遅い場合は、環境変数 `D` で各確認の待ち時間をミリ秒指定できます。

```powershell
$env:D=1500
node scripts/hosttest.mjs https://intro-quiz-u3vn.onrender.com
```

テストは参加者の追加、問題選択、モード変更、早押し状態の変更を実際に行います。本番進行中のサーバーには実行しないでください。

## 実装上の前提

- 参加者端末は `localStorage` に保存した `clientId` で識別します。ブラウザをリロードしても、その問題のお手つき状態は維持されます。
- お手つきは `clientId` に加えて表示名でも照合し、管理画面の参加者名クリックで個別に付け外しできます。
- 状態はサーバープロセスのメモリ上だけに保持します。サーバー再起動で参加者と進行状態はリセットされます。
- 早押しの排他制御は単一プロセス前提です。本番サーバーを複数インスタンスに増やさないでください。
