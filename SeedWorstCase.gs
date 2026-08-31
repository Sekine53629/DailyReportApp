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
 *    2. benchmarkWorstCase()   … 1週あたり何秒かかるかを測る
 *    3. freezeWorstCase()      … 実際に6週ぶん確定してみる
 *    4. clearWorstCaseMonth()  … 片づける
 * ============================================================
 */

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
  ALL_OUT_OF_RANGE: true
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

/**
 * ★ 1. いちばん時間がかかる形の1か月を作ります。
 *
 *    先に印影が1つでも登録されている必要があります。
 *    印影が無いと押印が1回も起きず、測っても意味がありません。
 */
function seedWorstCaseMonth() {
  const out = [];
  const say = function (l) { out.push(l); console.log(l); };

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
  say('   ' + donor.name + ' さんの印影を、テスト用の担当者全員に使い回します');

  /* ---- 先に片づける（何度実行しても同じ結果になるように） ---- */
  const wiped = clearSeedRows_();
  if (wiped) say('   （前に作ったデータ ' + wiped + ' 行を消しました）');

  /* ---- テスト用の担当者 ---- */
  const names = seedStaffNames_();
  const t = table_(SH.STAFF);
  const have = {};
  t.rows.forEach(function (x) { have[String(x['氏名'])] = x; });

  let added = 0;
  names.forEach(function (n) {
    if (have[n]) return;
    appendRow_(t, {
      'ID': uid_('S'), '氏名': n, 'メール': '',
      '在籍': true, '印影ファイルID': donor.sealFileId, '登録日時': new Date()
    });
    added++;
  });
  // 既にいる人にも印影を入れ直す(前回 消し忘れていた場合に備えて)
  const t2 = table_(SH.STAFF);
  t2.rows.forEach(function (x) {
    if (isSeedName_(x['氏名']) && !String(x['印影ファイルID'] || '')) {
      writeRow_(t2, x._row, { '印影ファイルID': donor.sealFileId });
    }
  });
  say('');
  say('■ 担当者');
  say('   ' + names.join('、') + '（新規 ' + added + ' 名）');

  /* ---- 管理薬剤師の交代 ---- */
  const chiefs = seedChiefs_(weeks, names);
  say('');
  say('■ 管理薬剤師（' + SEED.CHIEF_CHANGES + '）');
  chiefs.forEach(function (c) { say('   ' + c.from + ' 〜  ' + c.name); });
  if (SEED.CHIEF_CHANGES === 'weekly') {
    say('   ※ 毎週交代は現実には起きません。押印の使い回しを封じるための設定です');
  }

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
  const chk = freezeCheck_(SEED.MONTH);
  say('');
  say('■ ' + SEED.MONTH + ' は確定できるか');
  say('   ' + (chk.ok ? 'できます（第' + chk.nextVersion + '版）'
    : '★ できません：' + chk.reasons.join(' / ')));

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

/** 管理薬剤師の交代を登録する。既にある同じ就任日はそのまま使います */
function seedChiefs_(weeks, names) {
  const t = table_(SH.TERM);
  const staff = staffList_();
  const idOf = function (n) {
    const s = staff.filter(function (x) { return x.name === n; })[0];
    return s ? s.id : '';
  };

  let plan = [];
  if (SEED.CHIEF_CHANGES === 'weekly') {
    plan = weeks.map(function (w, i) { return { from: w, name: names[i % names.length] }; });
  } else if (SEED.CHIEF_CHANGES === 'once') {
    plan = [{ from: weeks[0], name: names[0] },
            { from: weeks[Math.floor(weeks.length / 2)], name: names[1] }];
  } else {
    plan = [{ from: weeks[0], name: names[0] }];
  }

  const has = {};
  t.rows.forEach(function (x) { has[fmt_(x['就任日'])] = true; });

  plan.forEach(function (p) {
    if (has[p.from]) return;
    appendRow_(t, { 'ID': uid_('T'), '担当者ID': idOf(p.name), '氏名': p.name, '就任日': p.from });
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
  console.log('');
  console.log('■ 6分の壁との突き合わせ');
  const per = ((t.copy || 0) + (t.values || 0) + (t.seals || 0)) / 1000;
  console.log('   1週あたり ' + per.toFixed(1) + ' 秒');
  console.log('   ' + weeks.length + '週で ' + (per * weeks.length / 60).toFixed(1) + ' 分');
  console.log('   夜間の1回あたりの上限は ' + (CFG.NIGHTLY.BUDGET_MS / 1000) + ' 秒なので、');
  const perExec = Math.max(1, Math.floor(CFG.NIGHTLY.BUDGET_MS / 1000 / Math.max(per, 0.1) / 1.5));
  console.log('   1回の実行で ' + perExec + ' 週ずつ、'
    + Math.ceil(weeks.length / perExec) + ' 回に分かれる見込みです');
  if (per * 60 > 150) {
    console.log('   ★ 1週が2.5分を超えています。1回1週でも6分に近づきます');
  }
  return t;
}

/**
 * ★ 3. 実際に6週ぶんを確定してみます（画面から確定するのと同じ経路）。
 *      1回の実行が6分に収まらない場合は、続きを自分で呼び直します。
 */
function freezeWorstCase() {
  const chk = freezeCheck_(SEED.MONTH);
  if (!chk.ok) {
    console.log('まだ確定できません：' + chk.reasons.join(' / '));
    console.log('先に seedWorstCaseMonth() を実行してください');
    return chk;
  }
  clearExport();
  startFreeze({ month: SEED.MONTH, actor: '測定',
                note: chk.frozen ? '測定用にもう一度' : '' });

  const t0 = Date.now();
  let n = 0;
  let job = null;
  do {
    const s = Date.now();
    job = runExportChunk(CFG.NIGHTLY.BUDGET_MS);
    n++;
    console.log('  ' + n + ' 回目: ' + ((Date.now() - s) / 1000).toFixed(1) + ' 秒 → '
      + job.done + ' / ' + job.weeks.length + ' 週');
  } while (job && job.state === 'running' && n < 20);

  console.log('');
  console.log('■ 結果: ' + job.state + '（' + n + ' 回 / 合計 '
    + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒）');
  if (job.weekMs) console.log('   1週あたり ' + (job.weekMs / 1000).toFixed(1) + ' 秒');
  if (job.pdfUrl) console.log('   PDF: ' + job.pdfUrl);
  console.log('');
  console.log('   ※ ここでは待たずに続けて呼んでいます。夜間は1回ごとに実行が分かれるので、');
  console.log('     1回あたりの秒数が6分(360秒)を超えていないかを見てください。');
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
  const termRows = tt.rows.filter(function (x) { return isSeedName_(x['氏名']); })
    .map(function (x) { return x._row; }).sort(function (a, b) { return b - a; });
  termRows.forEach(function (row) { tt.sh.deleteRow(row); });
  say('   管理薬剤師任期から ' + termRows.length + ' 行を消しました');

  /* ---- 担当者 ---- */
  const ts = table_(SH.STAFF);
  const staffRows = ts.rows.filter(function (x) { return isSeedName_(x['氏名']); })
    .map(function (x) { return x._row; }).sort(function (a, b) { return b - a; });
  staffRows.forEach(function (row) { ts.sh.deleteRow(row); });
  say('   担当者マスタから ' + staffRows.length + ' 行を消しました');
  say('   （印影のファイルは借り物なので消していません）');

  /* ---- 確定台帳。消さずに知らせる ---- */
  const fixes = fixOf_(SEED.MONTH);
  say('');
  say('■ 確定台帳');
  if (!fixes.length) {
    say('   ' + SEED.MONTH + ' の確定はありません');
  } else {
    say('   ★ ' + fixes.length + ' 件残っています。中身を見て、要らなければ手で消してください');
    fixes.forEach(function (f) {
      say('     ' + f.month + ' 第' + f.version + '版　' + f.name);
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
