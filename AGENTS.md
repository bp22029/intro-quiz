# AGENTS.md — エージェント共通の作業ルール

> **このファイルは当日の記録です。現在は有効ではありません。**
> 交流会当日に Claude と Codex が同じディレクトリで並行作業していたときの分担表で、
> 下記の所有権テーブル・タスク一覧・スコープの制約は、いずれも**もう従う必要がありません**。
> 現在の作業ルールは `CLAUDE.md` を見てください。当時の判断の理由を追うためだけに残しています。

イントロクイズ早押しシステム。**本日夜の交流会で使う。残り時間は約6時間。**

- 仕様の正は `docs/SPEC.md`（実装指示書）。**着手前に必ず全文を読む。**
- 環境固有の注意（依存バージョン固定など）は `CLAUDE.md`。**こちらも必ず読む。**
- リポジトリ root は本ディレクトリ。SPEC 2 に出てくる `introquiz/` サブディレクトリは**作らない**。

現在 **Claude Code と Codex の2エージェントが同一ディレクトリで並行作業**している。
衝突を避けるため、下記の所有権テーブルを厳守すること。

---

## 絶対に守ること

1. **SPEC「10. スコープ外」の機能を実装しない。提案もしない。** 得点・ランキング・DB・認証・司会画面・演出アニメ等。
2. **SPEC「11. 実装順序」を入れ替えない。** 手動モードが先。YouTube 統合は後。
3. **依存パッケージを勝手に増やさない。** SPEC 1 のリスト以外を入れない。
4. **音声ファイル（mp3/wav 等）を追加しない。** 効果音は Web Audio で生成する。
5. **`src/types.ts` を単独で書き換えない。** 両側が同時に壊れる。変更が必要なら人間に報告し、合意してから触る。
6. **所有権のないファイルを編集しない。** 壊れて見えても直さず、インターフェースの不一致として報告する。

---

## ファイル所有権

| ファイル | 所有 | 備考 |
|---|---|---|
| `package.json` / `vite.config.ts` / `tailwind.config.js` / `postcss.config.js` / `index.html` / `src/index.css` | **Claude** | ビルド基盤。`npm install` も Claude が実行する |
| `server/index.ts` | **Claude** | Socket.IO・QR・静的配信 |
| `src/types.ts` | **Claude**（共有） | 変更は要合意 |
| `src/socket.ts` / `src/main.tsx` | **Claude** | |
| `src/PlayerView.tsx` | **Claude** | 参加者画面 |
| `src/ScreenView.tsx` | **Claude** | 投影画面・キーボード操作 |
| `src/beep.ts` | **Codex** | 下記の契約どおりに実装 |
| `src/useYouTube.ts` | **Codex** | 下記の契約どおりに実装 |
| `public/songs.json` | **Codex** | ダミー4曲 + 人間が差し替える前提 |
| `README.md` / `docs/RUNBOOK.md` | **Codex** | 起動手順・Render デプロイ手順・当日運用チェックリスト |

`docs/SPEC.md` は読み取り専用。誰も編集しない。

---

## Codex の担当タスク（第1バッチ・いま着手可）

`npm install` の完了を待つ必要はない。**下記の契約に従ってファイルを書くだけでよい。**
型チェックやビルドは Claude 側の基盤が揃ってから行う。**この段階では `npm install` / `npm run build` を実行しない**（Claude と競合するため）。

### 1. `src/beep.ts`

以下の3つを export する。これ以外の export を増やさない。

```ts
/** モジュールスコープで AudioContext を1つだけ持つ。毎回 new しない */
export function beep(): void;

/** 「準備完了」ボタンのクリックハンドラから呼ぶ。AudioContext.resume() する */
export function unlockAudio(): Promise<void>;

/** 解除済みかどうか。投影画面の警告表示に使う */
export function isAudioUnlocked(): boolean;
```

- `beep()` の中身は SPEC 6.2 のコードをそのまま使う（square / 880Hz / 0.12秒）。
- `beep()` は AudioContext 未解除でも**例外を投げずに黙って何もしない**こと。投影画面はこれを buzzed 受信時に無条件で呼ぶ。
- **手動モードではこのビープが唯一の停止トリガー**なので、確実に鳴ることを最優先。曲より大きく聞こえるよう、必要ならゲインは 0.2 より上げてよい。

### 2. `src/useYouTube.ts`

`src/types.ts` の `Song` を import して使う。以下の契約を**厳密に**守ること。`ScreenView.tsx` がこの形で呼ぶ。

```ts
import type { Song } from "./types";

export type YouTubeController = {
  /** 全プレイヤーの onReady が揃ったか */
  ready: boolean;
  /** 進捗表示用。「3 / 4 準備完了」 */
  readyCount: number;
  total: number;
  /** 曲index -> YouTube エラーコード。onError で埋める */
  errors: Record<number, number>;

  /** 各曲の <div> に付ける ref コールバックを返す。<div ref={ctrl.registerRef(i)} /> */
  registerRef: (index: number) => (el: HTMLDivElement | null) => void;

  play: (index: number) => void;
  pause: (index: number) => void;
  /** songs[index].startSec に頭出しして一時停止状態に戻す */
  seekToStart: (index: number) => void;
};

/** enabled=false（手動モード）のときはプレイヤーを一切作らない */
export function useYouTube(songs: Song[], enabled: boolean): YouTubeController;

/** エラーコードを日本語文言にする。101 と 150 は「埋め込み再生が禁止されています」 */
export function ytErrorMessage(code: number): string;
```

実装上の必須事項:

- **問題数ぶんのプレイヤーを初期化時に全部作る。** `loadVideoById` での差し替えは禁止（SPEC 6.3）。生成待ちでイントロの頭が欠ける。
- 各プレイヤーは `cueVideoById({ videoId, startSeconds })` で待機させる。
- `<script src="https://www.youtube.com/iframe_api">` を動的に挿入する。npm パッケージは使わない。**二重挿入しないこと**（既に `window.YT` があれば再利用）。
- `playerVars` は `{ controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1 }`。
- `play`/`pause`/`seekToStart` は、未準備・範囲外 index・エラー中のとき**黙って no-op** にする。投影画面から無条件に呼ばれる。
- 型は `declare global { interface Window { YT: any; onYouTubeIframeAPIReady: () => void } }` で済ませてよい。`@types/youtube` は入れない。
- `onYouTubeIframeAPIReady` はグローバルに1つしか持てない。既存があれば chain する。

**プレイヤー要素の配置・目隠しカバー・非表示の扱いは `ScreenView.tsx`（Claude 担当）側の責務。** `useYouTube.ts` から DOM のスタイルを操作しないこと。

### 3. `public/songs.json`

SPEC 6.6 の形式でダミー4件。`videoId` は**埋め込み確認済みの実在ID**を入れる（当日は人間が差し替える）。
`title` / `artist` / `owner` は「サンプル曲1」等でよい。`startSec` は 0。

### 4. `README.md` と `docs/RUNBOOK.md`

- `README.md`: 何のシステムか、開発サーバーの起動手順（`npm run dev` と `npm run server` を2枚のターミナルで）、スマホ実機からの繋ぎ方（PC の LAN IP）。
- `docs/RUNBOOK.md`: **当日の運用手順書。** Render デプロイ手順（SPEC 8）、キー操作一覧（SPEC 5.3）、SPEC 12 の人間側チェックリスト、トラブル時の逃げ道（`M` で手動モードへ）。当日この1枚だけ見れば操作できる粒度で書く。

---

## Codex の担当タスク（第2バッチ・Claude から合図があってから）

Claude が `ScreenView.tsx` を書き終えてから着手する。先走ると衝突する。

- 投影画面の視認性チューニング（プロジェクター前提。回答者名は画面高の1/3）
- 実機テスト観点の洗い出しと、SPEC 9 の受け入れ条件10項目の消化

---

## 報告のしかた

タスクを終えたら、以下を人間に短く報告する。

1. 書いたファイルと、契約どおりに export したか
2. 契約から外れた点（あれば）とその理由
3. 相手の担当ファイルに必要な前提（例:「ScreenView は `ctrl.registerRef(i)` を各 div に付けること」）

**相手の担当ファイルを直接直さない。報告して待つ。**
