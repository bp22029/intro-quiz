/** @type {import('tailwindcss').Config} */
//
// 配色は「紺と金」。4画面（投影・参加者・管理・ロビー）で共通の言語にする。
// 役割で名前を付けているので、色そのものを変えたいときはここだけ触ればよい。
//
//   金   正解へ向かうもの（ラベル・罫線・帯・数字・押せるボタン）
//   深緑 受理された（早押しが通った）
//   深紅 不正解
//
// 早押しボタンに赤を使わないのは、赤を不正解の色として通すため。
// 角丸は面の大きさで r1 / r2 / r3 の3段＋全丸（名札とバッジ）だけにする。
// 値を散らすと、丸めたつもりが雑に見える。
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "#0a0f1e", // 主地
        sink: "#070b16", // サイドバー・沈める面
        panel: "#0e1526", // 管理画面のパネル
        rule: "#1b2340", // 境界線

        ink: {
          DEFAULT: "#f2ede1", // 生成りの白。純白にしない
          2: "#b9c2d4", // 副（アーティスト名など）
          3: "#7b88a3", // 弱（ラベル・URL）。可読性の下限
          4: "#6f7c99", // 極弱（隅の問題番号）
        },
        gold: {
          DEFAULT: "#d8b45c",
          bright: "#f4dda2", // 数字・強調
          dim: "#8a7439", // 「お手つき」など沈めた金
        },
        chip: {
          DEFAULT: "#2b3550",
          locked: "#1d2740",
          ink: "#4d5a76", // ロックされたチップの文字。本文には使わない
        },
        ok: "#6fbf94", // 接続中・準備完了

        // 受理された。金と組む古典的な深緑
        win: {
          DEFAULT: "#0e2a1f",
          glow: "#14402e",
          corner: "#4d7d67",
        },
        // 不正解。ここだけ金を一切使わない
        miss: {
          DEFAULT: "#4a1218",
          glow: "#6b1a22",
          deep: "#3a0f14", // 沈めた赤（管理画面の「お手つき」ボタン）
          border: "#7a2028",
          ink: "#f7dbd6",
          ink2: "#e6a9a2",
          corner: "#a06a68",
        },
        // 「正解は…」の溜め
        hush: {
          DEFAULT: "#101830",
          glow: "#1a2647",
        },
      },
      borderRadius: {
        r1: "10px", // 小さい操作・リスト行
        r2: "16px", // 面（パネル・入力欄・主要ボタン・映像枠）
        r3: "24px", // 大きい面（QRカード・全画面の早押しボタン）
      },
      fontFamily: {
        // 数字とコードだけ。見出しの本文には使わない（可読性が落ちる）
        disp: ['"Dela Gothic One"', '"Hiragino Kaku Gothic ProN"', '"Yu Gothic"', "sans-serif"],
        sans: ['"Zen Kaku Gothic New"', '"Hiragino Kaku Gothic ProN"', '"Yu Gothic"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
