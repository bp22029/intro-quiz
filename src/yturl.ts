// YouTube の URL を読み書きする。
//
// 管理画面で司会が貼るのは、共有ボタンで出てくる短縮URL・普通の watch URL・
// 埋め込みURL・動画IDそのもの、どれもあり得る。`?t=66` や `?t=1m6s` で
// 開始位置が付いてくることもある。貼り方を指定するより、こちらで吸収する。
//
// HostView.tsx から切り出したのは、scripts/urltest.ts が実装をそのまま
// import して検査できるようにするため。HostView は React や socket を
// 読み込むので、node からは import できない。src/ytmeta.ts と同じ考え方。

/**
 * URL から動画IDと再生開始位置を取り出す。
 * `?t=66` `?t=1m6s` `&start=66` に対応する。t が無ければ null。
 */
export function parseYouTube(input: string): { videoId: string; t: number | null } {
  const v = input.trim();
  const idMatch =
    v.match(/[?&]v=([A-Za-z0-9_-]{5,})/) ??
    v.match(/youtu\.be\/([A-Za-z0-9_-]{5,})/) ??
    v.match(/\/embed\/([A-Za-z0-9_-]{5,})/);
  const videoId = (idMatch ? idMatch[1] : v).slice(0, 40);

  const tMatch = v.match(/[?&](?:t|start)=([0-9hms]+)/i);
  let t: number | null = null;
  if (tMatch) {
    const raw = tMatch[1];
    if (/^\d+$/.test(raw)) {
      t = Number(raw);
    } else {
      // 1m6s / 2h3m4s のような形式
      const h = Number(raw.match(/(\d+)h/)?.[1] ?? 0);
      const m = Number(raw.match(/(\d+)m/)?.[1] ?? 0);
      const sec = Number(raw.match(/(\d+)s/)?.[1] ?? 0);
      t = h * 3600 + m * 60 + sec;
    }
  }
  return { videoId, t };
}

/** 指定秒から始まる YouTube の URL を作る */
export function ytUrl(videoId: string, sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `https://www.youtube.com/watch?v=${videoId}&t=${t}s&autoplay=1`;
}
