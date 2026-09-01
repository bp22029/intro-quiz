import { useEffect, useRef, useState } from "react";

/**
 * サーバーから届いた「残りミリ秒」を、画面表示用の残り秒数（3→2→1→0）に変える。
 * 絶対時刻ではなく残り時間を受け取るので、端末ごとの時計のズレを持ち込まない。
 */
export function useCountdown(resumeInMs: number): number {
  const [left, setLeft] = useState(0);
  const deadline = useRef(0);

  useEffect(() => {
    if (resumeInMs <= 0) {
      setLeft(0);
      return;
    }
    deadline.current = Date.now() + resumeInMs;
    const tick = () =>
      setLeft(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [resumeInMs]);

  return left;
}
