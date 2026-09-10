// 動画タイトルから曲名・アーティストを取り出すロジックの検証。
// 実装をそのまま import するので、tsx で実行する（node では .ts を読めない）:
//   npx tsx scripts/metatest.ts
// サーバーは不要（通信しない）。
import { cleanChannelName, parseYouTubeMeta, stripVideoMarkers } from "../src/ytmeta";

let ng = 0;
function eq(label: string, got: string, want: string) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      得: ${JSON.stringify(got)}\n      期: ${JSON.stringify(want)}`}`);
  if (!ok) ng++;
}

function meta(label: string, title: string, author: string, wantArtist: string, wantTitle: string) {
  const got = parseYouTubeMeta(title, author);
  eq(`${label} / アーティスト`, got.artist, wantArtist);
  eq(`${label} / 曲名`, got.title, wantTitle);
}

// --- チャンネル名の掃除 ---
eq("Topic を落とす", cleanChannelName("sumika - Topic"), "sumika");
eq("OFFICIAL YouTube CHANNEL を落とす", cleanChannelName("乃木坂46 OFFICIAL YouTube CHANNEL"), "乃木坂46");
eq("VEVO を落とす", cleanChannelName("SomeArtistVEVO"), "SomeArtist");
eq("普通のチャンネル名はそのまま", cleanChannelName("Superfly"), "Superfly");

// --- 語尾の掃除 ---
eq("Official Music Video を落とす", stripVideoMarkers("Brand New Official Music Video"), "Brand New");
eq("括弧つきの MV を落とす", stripVideoMarkers("曲名 (MV)"), "曲名");
eq("重なった語尾を落とす", stripVideoMarkers("曲名 (Official Video) [MV]"), "曲名");
eq("曲名の一部は残す", stripVideoMarkers("Invisible Man (Adult Version)"), "Invisible Man (Adult Version)");
eq("語尾が無ければそのまま", stripVideoMarkers("島唄"), "島唄");

// --- 実際に当日使った8曲の形 ---
meta("乃木坂46（二重鉤括弧）", "乃木坂46 『帰り道は遠回りしたくなる』", "乃木坂46 OFFICIAL YouTube CHANNEL", "乃木坂46", "帰り道は遠回りしたくなる");
meta("sumika（アートトラック・鉤括弧のみ）", "「伝言歌」", "sumika - Topic", "sumika", "伝言歌");
meta("Mrs. GREEN APPLE（鉤括弧＋語尾）", "Mrs. GREEN APPLE「Brand New」Official Music Video", "Mrs. GREEN APPLE", "Mrs. GREEN APPLE", "Brand New");
meta("ELLEGARDEN（アートトラック・素のタイトル）", "スターフィッシュ", "Ellegarden - Topic", "Ellegarden", "スターフィッシュ");
meta("THE BOOM（チャンネル名が別名義）", "THE BOOM「島唄 (オリジナル・ヴァージョン)」Official Music Video", "MUSIC Liverary", "THE BOOM", "島唄 (オリジナル・ヴァージョン)");
meta("Superfly（二重鉤括弧＋語尾）", "Superfly 『タマシイレボリューション』Music Video", "Superfly", "Superfly", "タマシイレボリューション");
meta("King Gnu（アートトラック）", "AIZO", "King Gnu - Topic", "King Gnu", "AIZO");
meta("東京事変（括弧つきの副題）", "Invisible Man (Adult Version)", "Tokyo Incidents - Topic", "Tokyo Incidents", "Invisible Man (Adult Version)");

// --- よくある他の形 ---
meta("【】の注記を落とす", "あいみょん - マリーゴールド【OFFICIAL MUSIC VIDEO】", "あいみょん", "あいみょん", "マリーゴールド");
meta("先頭のアーティスト名を落とす", "YOASOBI アイドル", "YOASOBI", "YOASOBI", "アイドル");
meta("チャンネル名が使えないときは Artist - Song を試す", "Artist Name - Song Title", "", "Artist Name", "Song Title");
meta("チャンネル名が取れれば区切り記号で割らない", "Song - With - Dashes", "Some Channel", "Some Channel", "Song - With - Dashes");

// --- 壊れた入力 ---
meta("空文字", "", "", "", "");
meta("タイトルだけ", "ただの曲名", "", "", "ただの曲名");
meta("チャンネル名だけ", "", "アーティスト", "アーティスト", "");

console.log(ng === 0 ? "\nすべて PASS" : `\n${ng}件 FAIL`);
process.exit(ng === 0 ? 0 : 1);
