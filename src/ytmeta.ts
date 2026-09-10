// YouTube の動画タイトルから、曲名とアーティスト名を取り出す。
//
// oEmbed が返すのは「動画のタイトル」と「チャンネル名」であって、曲名とアーティスト名
// ではない。日本の楽曲では次のような形が多い。
//
//   乃木坂46 『帰り道は遠回りしたくなる』            → 乃木坂46 / 帰り道は遠回りしたくなる
//   Mrs. GREEN APPLE「Brand New」Official Music Video → Mrs. GREEN APPLE / Brand New
//   「伝言歌」                     (sumika - Topic)   → sumika / 伝言歌
//   AIZO                           (King Gnu - Topic) → King Gnu / AIZO
//
// 完全には当てられないので、**下書きを作るための処理**と割り切る。
// 司会が管理画面で直せる前提。server/index.ts からも import して使う。

/** チャンネル名から、アーティスト名として使えない部分を落とす */
export function cleanChannelName(author: string): string {
  return author
    .replace(/\s*[-–—]\s*Topic\s*$/i, "") // アートトラックの自動生成チャンネル
    .replace(/\s*OFFICIAL\s+YouTube\s+CHANNEL\s*$/i, "")
    .replace(/\s*Official\s+(?:YouTube\s+)?Channel\s*$/i, "")
    .replace(/\s*VEVO\s*$/i, "")
    .trim();
}

/** 「Official Music Video」のような、曲名ではない語尾を落とす */
export function stripVideoMarkers(title: string): string {
  const marker =
    /[\s\-–—|/]*[（(\[【]?\s*(?:official\s+)?(?:music\s+video|lyric\s+video|music\s+clip|official\s+video|official\s+audio|mv)\s*[）)\]】]?\s*$/i;
  let out = title.trim();
  // 「... (Official Video) [MV]」のように重なることがあるので繰り返す
  for (let i = 0; i < 4; i++) {
    const next = out.replace(marker, "").trim();
    if (next === out || next === "") break;
    out = next;
  }
  return out;
}

/**
 * 動画タイトルとチャンネル名から、曲名とアーティスト名の下書きを作る。
 * どちらも取れなければ空文字を返す（呼び出し側で元の値を残す判断をする）。
 */
export function parseYouTubeMeta(
  rawTitle: string,
  rawAuthor: string,
): { title: string; artist: string } {
  const channelArtist = cleanChannelName(rawAuthor ?? "");
  // 【】は「【MV】」「【公式】」のような注記であることがほとんどなので丸ごと落とす
  const cleaned = (rawTitle ?? "").replace(/【[^】]*】/g, " ").trim();

  const quoted = cleaned.match(/[「『]([^」』]+)[」』]/);
  if (quoted && quoted.index !== undefined) {
    const before = cleaned.slice(0, quoted.index).trim();
    return {
      // 鉤括弧の前にある名前を優先する。チャンネル名がレーベル名義のことがあるため
      // （例: THE BOOM「島唄」… が MUSIC Liverary から出ている）
      artist: before || channelArtist,
      title: stripVideoMarkers(quoted[1]),
    };
  }

  let title = cleaned;
  let artist = channelArtist;

  // 先頭がアーティスト名なら落とす（「Superfly タマシイレボリューション」など）
  if (artist && title.toLowerCase().startsWith(artist.toLowerCase())) {
    title = title.slice(artist.length).replace(/^[\s:：\-–—]+/, "").trim();
  } else if (!artist) {
    // チャンネル名から取れないときだけ「Artist - Song」を試す
    const dash = cleaned.split(/\s+[-–—]\s+/);
    if (dash.length >= 2) {
      artist = dash[0].trim();
      title = dash.slice(1).join(" - ").trim();
    }
  }

  return { artist, title: stripVideoMarkers(title) || stripVideoMarkers(cleaned) };
}
