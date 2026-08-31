/**
 * ============================================================
 *  性能測定用のテストデータ（2026年1月）
 * ============================================================
 *  ★★ 本番に移す前に、このファイルごと削除してください ★★
 *
 *  出力にいちばん時間がかかる形の1か月を作ります。
 *  「夜間の自動確定が6分の壁に収まるか」を実機で確かめるためのものです。
 *
 *  ------------------------------------------------------------
 *  なぜ2026年1月が最悪なのか
 *  ------------------------------------------------------------
 *  帳票は土曜始まりの1週 = 1ページです。2026年1月は
 *
 *      1/1(木) を含む週は 2025-12-27(土) から
 *      1/31(土) はその日から新しい週
 *
 *  なので 12/27・1/3・1/10・1/17・1/24・1/31 の **6ページ** になります。
 *  31日の月で取りうる最大です。
 *
 *  ------------------------------------------------------------
 *  何を「いちばん遅い」にしているか
 *  ------------------------------------------------------------
 *  出力時間のほとんどは印影の貼り付け(insertImage)です。
 *  同じ押印の並びが2週以上あると、押し終えたシートを複製して使い回すので
 *  激減します。ここではその近道を全部ふさぎます。
 *
 *    1. 管理薬剤師を毎週交代させる
 *       → 管理者印の並びが週ごとに変わり、下ごしらえが使えません
 *    2. 担当者を日ごとに入れ替え、週ごとに並びを変える
 *       → 担当者印の並びも週ごとに変わります
 *    3. 6週ぶん(12/27〜2/6)を全部埋める
 *       → 空の日は押印しないので、埋めないと軽くなってしまいます
 *
 *  結果、押印は 14コマ × 6週 = 84回。使い回しが効く月の10倍以上です。
 *
 *  そのほか
 *    4. 全項目を管理基準から外す … 赤字にする書き込みが毎日増えます
 *    5. 譲渡・譲受を毎日4件      … 下段の文字量が最大になります
 *    6. 管理に関する事項を長文    … 上段F列の文字量が最大になります
 *
 *  ※ 毎週の管理薬剤師交代は、現実には起きません。
 *    「これより遅くなることはない」という上限を測るためのものです。
 *    現実に近い形で測りたいときは SEED.CHIEF_CHANGES を 'once' にしてください。
 *
 *  ------------------------------------------------------------
 *  使い方
 *  ------------------------------------------------------------
 *    ★ まずブックのコピーを取り、コピーの上で実行してください。
 *      確定まで試すと、確定台帳とドライブにテストの版が残ります。
 *
 *    1. seedWorstCaseMonth()   … データを作る
 *    2. benchmarkWorstCase()   … 1週あたりの見込みを出す(多め・当たりを付ける用)
 *    3. freezeWorstCase()      … 実際に6週ぶん確定する(これが本当の値)
 *    4. clearWorstCaseMonth()  … 片づける
 * ============================================================
 */

/** この版の Code.gs が要ります。古いと途中で落ちるので、先に確かめます */
const SEED_NEEDS = '2026-09-02';

const SEED = Object.freeze({
  /** 対象の月 */
  MONTH: '2026-01',

  /** 帳票は週単位なので、1月にかかる6週(12/27〜2/6)を全部埋めます。
   *  false にすると 1/1〜1/31 だけになり、端の週が軽くなります */
  FILL_WHOLE_WEEKS: true,

  /** テスト用の担当者。本番の名簿を汚さないよう、この名前で作って最後に消します */
  STAFF_PREFIX: '検証',
  STAFF_COUNT: 8,

  /** 管理薬剤師の交代
   *    'weekly' … 毎週交代（最悪。押印の使い回しが完全に効かなくなる）
   *    'once'   … 月の途中で1回だけ（現実に近い）
   *    'none'   … 交代しない（いちばん速い） */
  CHIEF_CHANGES: 'weekly',

  /** 1日あたりの譲渡・譲受の件数。下段の行は42pxなので、
   *  4件だと画面上ははみ出します(時間を測るためのデータなので承知の上) */
  XFERS_PER_DAY: 4,

  /** 全項目を管理基準の外に置く（赤字にする書き込みが毎日増えます） */
  ALL_OUT_OF_RANGE: true,

  /** テスト用の担当者に、中身の違う印影を1つずつ作る。
   *
   *  false にすると、1人ぶんの印影を全員で使い回します。そのとき
   *  84回の押印はすべて同じ画像なので、Googleが同じ画像をまとめて
   *  扱っていた場合、実際より速い値が出てしまいます。
   *  true にすると、元の印影に注記を1つ足した「見た目は同じで
   *  中身が違う」画像を人数ぶん作り、印影フォルダに置きます。
   *  片づけのときに消します。 */
  DISTINCT_SEALS: true
});

/** 埋める範囲。FILL_WHOLE_WEEKS なら、その月にかかる週の端から端まで */
function seedRange_() {
  const mStart = SEED.MONTH + '-01';
  const mEnd = monthEnd_(mStart);
  if (!SEED.FILL_WHOLE_WEEKS) return { from: mStart, to: mEnd };
  return { from: weekStart_(mStart), to: addDays_(weekStart_(mEnd), 6) };
}

function seedDays_() {
  const r = seedRange_();
  const out = [];
  for (let d = r.from; d <= r.to; d = addDays_(d, 1)) out.push(d);
  return out;
}

function seedStaffNames_() {
  const out = [];
  for (let i = 1; i <= SEED.STAFF_COUNT; i++) {
    out.push(SEED.STAFF_PREFIX + ('0' + i).slice(-2));
  }
  return out;
}

/** テスト用の担当者かどうか */
function isSeedName_(n) {
  return String(n || '').indexOf(SEED.STAFF_PREFIX) === 0;
}

/** テスト用に足した任期かどうか。
 *  「元の管理薬剤師に戻す」ための任期は本物の氏名で入るので、IDで見分けます */
function isSeedTermId_(id) {
  return String(id || '').indexOf('TSEED') === 0;
}

/* ------------------------------------------------------------
 *  中身の違う印影を作る
 *
 *  PNGは [長さ][種類][中身][CRC] という塊の並びでできています。
 *  終わりの IEND の手前に、注記(tEXt)の塊を1つ差し込むだけで、
 *  見た目はそのままに中身(バイト列)だけが変わります。
 *
 *  84回の押印を全部「別の画像」で測るためのものです。
 * ---------------------------------------------------------- */

/** CRC32 の表。PNGの塊ごとの検査値に使います */
const CRC_TABLE = (function () {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32_(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ (bytes[i] & 0xFF)) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 0〜255 を、GASが扱う符号つきバイトに直す */
function sign_(arr) {
  return arr.map(function (b) { return (b & 0xFF) > 127 ? (b & 0xFF) - 256 : (b & 0xFF); });
}

/** 4バイトの大きい桁から並べた数 */
function be32_(n) {
  return sign_([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]);
}

/**
 * PNGに注記を1つ足して、中身の違う画像にする。見た目は変わりません。
 * 形が想定と違うときは、何もせず元のまま返します。
 */
function pngVariant_(bytes, tag) {
  const cut = bytes.length - 12;                 // 終わりの IEND は12バイト
  if (cut < 8) return bytes;
  const isIEND = bytes[cut + 4] === 0x49 && bytes[cut + 5] === 0x45
              && bytes[cut + 6] === 0x4E && bytes[cut + 7] === 0x44;
  if (!isIEND) {
    console.warn('PNGの終わりが想定と違うため、印影は使い回しになります');
    return bytes;
  }

  const text = 'Comment\u0000' + tag;
  const data = [];
  for (let i = 0; i < text.length; i++) data.push(text.charCodeAt(i) & 0xFF);
  const type = [0x74, 0x45, 0x58, 0x74];         // 'tEXt'

  const chunk = be32_(data.length)
    .concat(sign_(type))
    .concat(sign_(data))
    .concat(be32_(crc32_(type.concat(data))));

  return bytes.slice(0, cut).concat(chunk).concat(bytes.slice(cut));
}

/** 測定用に作った印影の名前の頭。これで見分けて掃除します */
const SEED_SEAL_PREFIX = 'seedseal_';

/**
 * 印影フォルダから、測定用に作った印影をすべて片づける。
 *
 * 担当者の行をたどって消すのでは足りません。作り直すたびに参照が
 * 新しいものへ向くので、前のファイルが誰からも指されなくなり、
 * 迷子のまま溜まっていきます。フォルダを名前で掃きます。
 * 途中で止まって残ったものも、これで片づきます。
 */
function dropSeedSeals_() {
  let n = 0;
  try {
    const it = sealFolder_().getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (String(f.getName()).indexOf(SEED_SEAL_PREFIX) === 0) { f.setTrashed(true); n++; }
    }
  } catch (e) {
    console.warn('測定用の印影を片づけられませんでした: ' + e);
  }
  return n;
}

/**
 * テスト用の担当者ぶん、中身の違う印影を作って印影フォルダに置く。
 * 名前は seedseal_ で始めるので、あとから見分けて消せます。
 */
function makeDistinctSeals_(donorFileId, names) {
  dropSeedSeals_();          // 前に作ったものを先に片づける(溜めないため)
  const src = DriveApp.getFileById(donorFileId).getBlob().getBytes();
  const folder = sealFolder_();
  const out = {};
  names.forEach(function (n, i) {
    const bytes = pngVariant_(src, 'seed-' + ('0' + (i + 1)).slice(-2));
    const blob = Utilities.newBlob(bytes, 'image/png', SEED_SEAL_PREFIX + n + '.png');
    out[n] = folder.createFile(blob).getId();
  });
  return out;
}

/**
 * Code.gs が足りているかを、何も書く前に確かめる。
 *
 * 途中で落ちると、担当者と任期だけが残って中途半端な状態になります。
 * 貼り替え忘れは実際に起きたので、ここで止めます。
 */
function seedPreflight_() {
  const missing = [];
  // typeof なら、宣言されていない名前でも例外になりません
  const need = [
    ['ensureRowRoom_()', typeof ensureRowRoom_],
    ['monthEnd_()',      typeof monthEnd_],
    ['weekStart_()',     typeof weekStart_],
    ['weeksBetween_()',  typeof weeksBetween_],
    ['freezeCheck_()',   typeof freezeCheck_],
    ['freezeWeeks()',    typeof freezeWeeks],
    ['openWeeks_()',     typeof openWeeks_],
    ['runExportChunk()', typeof runExportChunk],
    ['benchmarkExport()', typeof benchmarkExport]
  ];
  need.forEach(function (x) { if (x[1] !== 'function') missing.push(x[0]); });

  // 引数を受け取れる版か(古い版は引数を黙って無視してしまう)
  if (typeof benchmarkExport === 'function' && benchmarkExport.length < 1) {
    missing.push('benchmarkExport(週) … 引数を受け取れる版');
  }
  if (typeof runExportChunk === 'function' && runExportChunk.length < 1) {
    missing.push('runExportChunk(上限) … 引数を受け取れる版');
  }
  if (typeof CFG === 'undefined' || !CFG.NIGHTLY) missing.push('CFG.NIGHTLY');

  if (!missing.length) return null;

  const out = [];
  out.push('★ 貼ってある Code.gs が古いため、実行できません。');
  out.push('');
  out.push('   いま貼ってある版 : '
    + ((typeof CFG !== 'undefined' && CFG.VERSION) || '（不明）'));
  out.push('   必要な版         : ' + SEED_NEEDS + ' 以降');
  out.push('');
  out.push('   見つからないもの:');
  missing.forEach(function (m) { out.push('     ・' + m); });
  out.push('');
  out.push('   直し方');
  out.push('     1. Code.gs を貼り替える');
  out.push('     2. updateDatabase() を実行する');
  out.push('     3. もう一度 seedWorstCaseMonth() を実行する');
  out.push('');
  out.push('   ここまでで何も書いていません。ブックはそのままです。');
  const text = out.join('\n');
  console.log(text);
  return text;
}

/**
 * ★ 1. いちばん時間がかかる形の1か月を作ります。
 *
 *    先に印影が1つでも登録されている必要があります。
 *    印影が無いと押印が1回も起きず、測っても意味がありません。
 */
function seedWorstCaseMonth() {
  const out = [];
  const say = function (l) { out.push(l); console.log(l); };

  // 何かを書く前に、Code.gs が足りているかを確かめる
  const stop = seedPreflight_();
  if (stop) return stop;

  const days = seedDays_();
  const r = seedRange_();
  const weeks = weeksBetween_(r.from, r.to);

  say('■ これから作るもの');
  say('   対象月 : ' + SEED.MONTH);
  say('   埋める : ' + r.from + ' 〜 ' + r.to + '（' + days.length + '日 / '
    + weeks.length + '週 = ' + weeks.length + 'ページ）');
  say('');

  /* ---- 使い回せる印影があるか。無いと測る意味がない ---- */
  const donor = staffList_().filter(function (s) { return s.sealFileId; })[0];
  if (!donor) {
    say('★ 印影が1つも登録されていません。');
    say('   画面の名簿から誰かの印影を登録してから、もう一度実行してください。');
    say('   印影が無いと押印が1回も起きず、いちばん重い処理を測れません。');
    return out.join('\n');
  }
  say('■ 印影');

  /* ---- 先に片づける（何度実行しても同じ結果になるように） ---- */
  const wiped = clearSeedRows_();
  if (wiped) say('   （前に作ったデータ ' + wiped + ' 行を消しました）');

  /* ---- テスト用の担当者 ---- */
  const names = seedStaffNames_();

  // 84回の押印を全部「別の画像」で測るため、人数ぶん作ります。
  // 同じ画像だと、Googleがまとめて扱っていた場合に速く出てしまいます
  let seals = {};
  if (SEED.DISTINCT_SEALS) {
    seals = makeDistinctSeals_(donor.sealFileId, names);
    say('   ' + donor.name + ' さんの印影から、中身の違うものを '
      + names.length + ' 個作りました（見た目は同じです）');
    say('   同じ画像だと、まとめて扱われて実際より速く出るおそれがあるためです');
  } else {
    names.forEach(function (n) { seals[n] = donor.sealFileId; });
    say('   ' + donor.name + ' さんの印影を、テスト用の担当者全員で使い回します');
    say('   ★ 84回とも同じ画像なので、実際より速い値が出るかもしれません');
  }

  const t = table_(SH.STAFF);
  const have = {};
  t.rows.forEach(function (x) { have[String(x['氏名'])] = x; });

  let added = 0;
  names.forEach(function (n) {
    if (have[n]) return;
    appendRow_(t, {
      'ID': uid_('S'), '氏名': n, 'メール': '',
      '在籍': true, '印影ファイルID': seals[n], '登録日時': new Date()
    });
    added++;
  });
  // 既にいる人にも入れ直す(前回のものが残っていれば置き換える)
  const t2 = table_(SH.STAFF);
  t2.rows.forEach(function (x) {
    const n = String(x['氏名']);
    if (isSeedName_(n) && seals[n]) writeRow_(t2, x._row, { '印影ファイルID': seals[n] });
  });
  say('');
  say('■ 担当者');
  say('   ' + names.join('、') + '（新規 ' + added + ' 名）');

  /* ---- 管理薬剤師の交代 ---- */
  const chiefs = seedChiefs_(weeks, names, r);
  say('');
  say('■ 管理薬剤師（' + SEED.CHIEF_CHANGES + '）');
  chiefs.forEach(function (c) {
    say('   ' + c.from + ' 〜  ' + c.name + (c.restore ? '　← ここから元に戻ります' : ''));
  });
  if (SEED.CHIEF_CHANGES === 'weekly') {
    say('   ※ 毎週交代は現実には起きません。押印の使い回しを封じるための設定です');
  }
  say('   いまの管理薬剤師: ' + (chiefOn_(today_()) || '（未登録）'));

  /* ---- 日報と譲渡記録をまとめて書く ---- */
  ensureRowRoom_(SH.DAILY);
  ensureRowRoom_(SH.XFER);

  const terms = termList_();
  const daily = [];
  const xfers = [];

  days.forEach(function (iso, i) {
    const staff = names[(i + Math.floor(i / 7)) % names.length];   // 週ごとに並びをずらす
    const chief = chiefOn_(iso, terms);
    const at = new Date();

    daily.push({
      '店舗コード': CFG.STORE_CODE,
      '日付': iso,
      '処方箋枚数': 120 + (i % 40),
      '疑義照会件数': 3 + (i % 5),
      // 管理基準を外した値。赤字にする書き込みが毎日走ります
      '調剤室温度': SEED.ALL_OUT_OF_RANGE ? 33.5 : 23.0,
      '調剤室湿度': SEED.ALL_OUT_OF_RANGE ? 78 : 47,
      '冷所温度':   SEED.ALL_OUT_OF_RANGE ? 9.7 : 5.0,
      '冷所湿度':   62,
      '管理に関する事項': seedNote_(iso, i),
      '担当者': staff,
      '入力日時': at,
      '管理者': chief,
      '承認日時': at,
      '状態': '承認済',
      '編集者': '', '編集開始': ''
    });

    for (let k = 1; k <= SEED.XFERS_PER_DAY; k++) {
      xfers.push(seedXfer_(iso, k, staff, at));
    }
  });

  const nD = bulkAppend_(SH.DAILY, daily);
  const nX = bulkAppend_(SH.XFER, xfers);

  say('');
  say('■ 書き込み');
  say('   日報DB   ' + nD + ' 行（全日 承認済み）');
  say('   譲渡記録 ' + nX + ' 行（1日 ' + SEED.XFERS_PER_DAY + ' 件）');

  /* ---- 確認 ---- */
  say('');
  say('■ 確定できるか（確定は週の単位です）');
  const ready = weeks.filter(function (w) { return freezeCheck_(w).ok; });
  weeks.forEach(function (w) {
    const c = freezeCheck_(w);
    say('   ' + c.label + '　' + (c.ok ? '確定できます（第' + c.nextVersion + '版）'
      : '★ ' + c.reasons.join(' / ')));
  });
  say('   → ' + ready.length + ' / ' + weeks.length + ' 週');

  say('');
  say('■ 見込み');
  say('   押印 ' + (weeks.length * 14) + ' コマ（14 × ' + weeks.length + '週）');
  say('   ' + (SEED.CHIEF_CHANGES === 'weekly'
    ? '下ごしらえの使い回しは効きません（狙いどおり）'
    : '下ごしらえの使い回しが一部効きます'));

  say('');
  say('次に benchmarkWorstCase() を実行して、1週あたり何秒かかるかを測ってください。');
  audit_('測定用データを作成', SEED.MONTH + '（' + nD + '日 / ' + weeks.length + '週）', '');
  return out.join('\n');
}

/**
 * 管理薬剤師の交代を登録する。既にある同じ就任日はそのまま使います。
 *
 * ★ 任期は「その日から後ずっと」なので、足しっぱなしにすると
 *   今日の管理薬剤師までテスト用の人に変わり、承認できなくなります。
 *   期間の翌日から元の人に戻す任期を必ず足します。
 */
function seedChiefs_(weeks, names, range) {
  const t = table_(SH.TERM);
  const staff = staffList_();
  const idOf = function (n) {
    const s = staff.filter(function (x) { return x.name === n; })[0];
    return s ? s.id : '';
  };

  // 足す前の状態で、期間の翌日に誰が管理薬剤師だったかを控えておく
  const before = termList_();
  const backTo = range ? addDays_(range.to, 1) : '';
  const backName = backTo ? chiefOn_(backTo, before) : '';

  let plan = [];
  if (SEED.CHIEF_CHANGES === 'weekly') {
    plan = weeks.map(function (w, i) { return { from: w, name: names[i % names.length] }; });
  } else if (SEED.CHIEF_CHANGES === 'once') {
    plan = [{ from: weeks[0], name: names[0] },
            { from: weeks[Math.floor(weeks.length / 2)], name: names[1] }];
  } else {
    plan = [{ from: weeks[0], name: names[0] }];
  }

  // 期間が終わったら元の人に戻す。これが無いと今日の管理薬剤師が変わったままになります
  if (backName) plan.push({ from: backTo, name: backName, restore: true });

  const has = {};
  t.rows.forEach(function (x) { has[fmt_(x['就任日'])] = true; });

  plan.forEach(function (p) {
    if (has[p.from]) return;
    // 戻すための任期は本物の氏名で入るので、IDで見分けられるようにします
    appendRow_(t, {
      'ID': uid_(p.restore ? 'TSEED' : 'T'),
      '担当者ID': idOf(p.name), '氏名': p.name, '就任日': p.from
    });
  });
  return plan;
}

/** 上段F列の「管理に関する事項」。文字量を多めにします */
function seedNote_(iso, i) {
  return '【測定用】' + iso + ' 調剤台の照度を測定（' + (480 + i) + 'lx／基準 300lx以上）。'
    + '冷蔵庫の温度記録計を校正し、記録紙を差し替え。'
    + '調剤室の温湿度が管理基準を外れたため、空調を調整のうえ再測定。'
    + '医薬品の使用期限を棚卸しし、期限切れ間近の ' + (3 + i % 7) + ' 品目を隔離。';
}

/** 下段の「譲渡・譲受記録」1件 */
function seedXfer_(iso, k, staff, at) {
  const kinds = ['譲渡', '譲受'];
  const partners = ['あおぞら薬局 北24条店', 'きた薬局 麻生店',
                    'さくら調剤薬局 琴似店', 'みどり薬局 円山店'];
  const makers = ['第一三共', 'あゆみ製薬', '沢井製薬', '日医工'];
  const drugs = ['ロキソプロフェンNa錠60mg「サワイ」', 'カロナール錠500mg',
                 'アムロジピンOD錠5mg「トーワ」', 'ムコダイン錠500mg'];
  const o = {
    'ID': uid_('X'), '店舗コード': CFG.STORE_CODE, '日付': iso, '連番': k,
    '譲渡区分': kinds[k % kinds.length],
    '譲渡先名': partners[k % partners.length],
    '販売メーカー名称': makers[k % makers.length],
    '医薬品名称': drugs[k % drugs.length],
    '包装形態': 'PTP 100錠',
    '譲渡数': k + '箱',
    'Lot': 'A' + ('000' + k).slice(-3) + 'K21',
    '使用期限': '2028-0' + (1 + (k % 9)),
    '登録日時': at, '登録者': staff
  };
  return o;
}

/** 見出しの並びに合わせて、まとめて1回で書く */
function bulkAppend_(sheetName, objs) {
  if (!objs.length) return 0;
  const t = table_(sheetName);
  const rows = objs.map(function (o) {
    return t.header.map(function (h) { return o.hasOwnProperty(h) ? o[h] : ''; });
  });
  t.sh.getRange(t.sh.getLastRow() + 1, 1, rows.length, t.header.length).setValues(rows);
  return rows.length;
}

/**
 * ★ 2. 1週ぶんを作って、どこに何秒かかるかを測ります。
 *      いちばん重い週(担当者も管理薬剤師も他の週と違う週)を測ります。
 */
function benchmarkWorstCase() {
  const r = seedRange_();
  const weeks = weeksBetween_(r.from, r.to);
  const w = weeks[Math.floor(weeks.length / 2)];
  console.log('■ ' + w + ' の週を測ります（' + SEED.MONTH + ' の ' + weeks.length + '週のうち1つ）');
  console.log('');
  const t = benchmarkExport(w);
  const sec = function (ms) { return (ms || 0) / 1000; };

  // benchmarkExport は「使い回しが効く」前提で測るので、押印の時間は
  // 下ごしらえ(base)のほうに入ります。いちばん遅い形のデータでは
  // 使い回しが効かないので、その時間を毎週ぶん足し直します。
  const stampSec = sec(t.stampMs);
  const perFast = sec(t.copy) + sec(t.values);                 // 使い回しが効くとき
  const perSlow = perFast + stampSec * 14;                     // 効かないとき(14コマ)
  const slow = (SEED.CHIEF_CHANGES === 'weekly');
  const per = slow ? perSlow : perFast;

  console.log('');
  console.log('■ 1コマあたりの押印');
  console.log('   ' + sec(t.base).toFixed(1) + '秒 / ' + (t.baseStamps || 0) + 'コマ'
    + ' = ' + stampSec.toFixed(2) + ' 秒/コマ');
  console.log('   ここが出力時間のほとんどです');

  console.log('');
  console.log('■ 1週あたりの見込み');
  console.log('   使い回しが効くとき  ' + perFast.toFixed(1) + ' 秒（押印 0 コマ）');
  console.log('   効かないとき        ' + perSlow.toFixed(1) + ' 秒（押印 14 コマ）');
  console.log('   このデータ（' + SEED.CHIEF_CHANGES + '）は '
    + (slow ? '効きません' : '効きます') + ' → ' + per.toFixed(1) + ' 秒/週');

  const budget = CFG.NIGHTLY.BUDGET_MS / 1000;
  const setup = sec(t.setup);
  const total = setup + per * weeks.length;

  console.log('');
  console.log('■ 6分の壁との突き合わせ');
  console.log('   ' + weeks.length + '週ぶん = ' + total.toFixed(0) + ' 秒（'
    + (total / 60).toFixed(1) + ' 分）');
  console.log('   夜間の1回あたりの上限は ' + budget + ' 秒');

  // 1回の実行に入る週数。1週目は必ず走り、2週目からは
  // 「いちばん遅かった週がもう1回入る余地」を求めます(WEEK_MARGIN)
  const room = budget - setup;
  const perExec = Math.max(1, 1 + Math.floor((room - per) / (per * 1.5)));
  const times = Math.ceil(weeks.length / perExec);
  console.log('   1回の実行で ' + perExec + ' 週ずつ、' + times + ' 回に分かれる見込み');
  console.log('   1回あたり およそ ' + (setup + per * Math.min(perExec, weeks.length)).toFixed(0)
    + ' 秒');

  console.log('');
  console.log('   ※ この見込みは多めに出ます。押印1コマの時間を下ごしらえから');
  console.log('     割り出していますが、そこにはシートの複製ぶんも混ざるためです。');
  console.log('     実際の値は freezeWorstCase() で測ってください');
  console.log('     （実測では、この見込みより4割ほど速く終わりました）');

  console.log('');
  if (per > 150) {
    console.log('   ★ 1週が2.5分を超えています。1回1週でも6分に近づきます。');
    console.log('     この仕組みでは確定しきれないので、作り直しが要ります');
  } else if (setup + per > 300) {
    console.log('   ★ 1回の実行が5分を超えます。6分の上限に近すぎます');
  } else {
    console.log('   6分の上限には余裕があります（1回あたり最大 '
      + (setup + per * perExec).toFixed(0) + ' 秒）');
  }
  return t;
}

/**
 * ★ 3. 実際に6週ぶんを確定してみます（画面から確定するのと同じ経路）。
 *
 *    確定は週の単位（1週=1ページ）なので、6週なら6回に分かれます。
 *    夜間は1回ごとに実行が分かれるので、1回あたりの秒数を見てください。
 */
function freezeWorstCase() {
  const r = seedRange_();
  const weeks = weeksBetween_(r.from, r.to);
  const ready = weeks.filter(function (w) { return freezeCheck_(w).ok; });

  if (!ready.length) {
    console.log('確定できる週がありません。先に seedWorstCaseMonth() を実行してください');
    weeks.forEach(function (w) {
      const c = freezeCheck_(w);
      if (!c.ok) console.log('  ' + c.label + '：' + c.reasons.join(' / '));
    });
    return null;
  }

  clearExport();
  console.log('■ ' + ready.length + ' 週を確定します（1週 = 1ページ = 1PDF）');
  let job = freezeWeeks({ weeks: ready, actor: '測定',
                          note: '測定用にもう一度' });

  const t0 = Date.now();
  const spans = [];
  let n = 0;
  do {
    const s0 = Date.now();
    const before = (job.frozen || []).length;
    job = runExportChunk(CFG.NIGHTLY.BUDGET_MS);
    const took = (Date.now() - s0) / 1000;
    spans.push(took);
    n++;
    console.log('  ' + n + ' 回目: ' + took.toFixed(1) + ' 秒'
      + '（焼けた週 ' + ((job.frozen || []).length) + ' / ' + ready.length + '）');
  } while (job && job.state === 'running' && n < 40);

  const worst = spans.reduce(function (m, x) { return Math.max(m, x); }, 0);
  console.log('');
  console.log('■ 結果: ' + job.state + '（' + n + ' 回 / 合計 '
    + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）');
  console.log('   1回あたり いちばん長かったの ' + worst.toFixed(1) + ' 秒');
  console.log('   ' + (worst < 300 ? '6分(360秒)の上限に余裕があります'
    : '★ 6分に近づいています。CFG.NIGHTLY.BUDGET_MS を下げてください'));
  console.log('');
  console.log('   ※ ここでは待たずに続けて呼んでいます。夜間は1回ごとに実行が');
  console.log('     分かれるので、上の「1回あたり」が360秒を超えていないかを見てください。');
  return job;
}

/**
 * ★ 4. 作ったものを片づけます。
 *
 *    消すもの : 日報DB / 譲渡記録 の対象期間、テスト用の担当者と任期
 *    消さないもの : 確定台帳の行と、ドライブのPDF
 *      台帳の行を消すとハッシュの連鎖が切れ、あとの行が
 *      「書き換えられています」と出るようになるためです。
 *      見つけたものは一覧で出すので、要否を見て手で消してください。
 */
function clearWorstCaseMonth() {
  const out = [];
  const say = function (l) { out.push(l); console.log(l); };

  const n = clearSeedRows_();
  say('■ 記録');
  say('   日報DB / 譲渡記録 から ' + n + ' 行を消しました');

  /* ---- 任期 ---- */
  const tt = table_(SH.TERM);
  const termRows = tt.rows.filter(function (x) {
    return isSeedName_(x['氏名']) || isSeedTermId_(x['ID']);
  })
    .map(function (x) { return x._row; }).sort(function (a, b) { return b - a; });
  termRows.forEach(function (row) { tt.sh.deleteRow(row); });
  say('   管理薬剤師任期から ' + termRows.length + ' 行を消しました');
  say('   いまの管理薬剤師: ' + (chiefOn_(today_()) || '★ 未登録。名簿から登録してください'));

  /* ---- 担当者 ---- */
  const ts = table_(SH.STAFF);
  const seedStaff = ts.rows.filter(function (x) { return isSeedName_(x['氏名']); });

  // 測定のために作った印影を、フォルダごと掃く。
  // 借り物(本番の方の印影)は名前が違うので触れません
  const killed = dropSeedSeals_();

  const staffRows = seedStaff.map(function (x) { return x._row; })
    .sort(function (a, b) { return b - a; });
  staffRows.forEach(function (row) { ts.sh.deleteRow(row); });
  say('   担当者マスタから ' + staffRows.length + ' 行を消しました');
  say('   測定用に作った印影 ' + killed + ' 個をごみ箱に入れました'
    + '（本番の方の印影には触れていません）');

  /* ---- 確定台帳。消さずに知らせる ---- */
  const rr = seedRange_();
  const target = {};
  weeksBetween_(rr.from, rr.to).forEach(function (w) { target[w] = true; });
  const fixes = fixList_().filter(function (x) { return target[x.week]; });
  say('');
  say('■ 確定台帳');
  if (!fixes.length) {
    say('   この期間の確定はありません');
  } else {
    say('   ★ ' + fixes.length + ' 件残っています。中身を見て、要らなければ手で消してください');
    fixes.forEach(function (f) {
      say('     ' + f.label + ' 第' + f.version + '版　' + f.name);
      say('       ' + f.url);
    });
    say('   台帳の途中の行を消すと、そのあとの行の連鎖が合わなくなります。');
    say('   本番のデータを入れる前なら、まとめて消してしまうのが安全です。');
    say('   （そもそも、この測定はブックのコピーの上でやるのがいちばんです）');
  }

  audit_('測定用データを片づけた', SEED.MONTH + '：' + n + ' 行', '');
  return out.join('\n');
}

/** 日報DB と 譲渡記録 から、対象期間の行を消す */
function clearSeedRows_() {
  const r = seedRange_();
  let n = 0;

  [SH.DAILY, SH.XFER].forEach(function (name) {
    const t = table_(name);
    const rows = t.rows.filter(function (x) {
      const d = fmt_(x['日付']);
      return d >= r.from && d <= r.to;
    }).map(function (x) { return x._row; }).sort(function (a, b) { return b - a; });
    rows.forEach(function (row) { t.sh.deleteRow(row); });
    n += rows.length;
  });
  return n;
}
