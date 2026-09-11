import { useEffect, useState } from "react";

/**
 * Webフォントが載ったら true を返す。
 *
 * 投影画面は文字の幅を測ってから大きさを決める（src/textfit.ts）。
 * Zen Kaku Gothic New は Google Fonts から後から届くので、最初の描画は
 * 代替フォントの幅で測ってしまう。届いた時点で一度だけ描き直させる。
 *
 * 状態が変われば自然に測り直されるが、投影画面は同じ画面のまま何分も
 * 置かれることがあるので、待っていられない。
 */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(
    () => typeof document !== "undefined" && document.fonts?.status === "loaded",
  );
  useEffect(() => {
    if (ready || typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    document.fonts.ready.then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}
