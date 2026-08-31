/**
 * ============================================================
 *  くるむ薬局 札幌店  業務日報システム
 *  ―― これ1ファイルで全部入りです ――
 * ============================================================
 *  貼り付ける場所: スプレッドシート → 拡張機能 → Apps Script
 *  もう1つ、HTMLファイル「WebApp」も必要です。
 *
 *  貼り終わったら、関数 setup を1回だけ実行してください。
 *
 *  中身の並び:
 *    1. 設定          … ここだけ書き換える
 *    2. シートの用意
 *    3. 担当者・管理薬剤師・印影・変更履歴
 *    4. 日報の読み書き
 *    5. 画面から呼ばれる入口
 *    6. 週次帳票の出力
 * ============================================================
 */













/* ############################################################
   1. 設定
   ############################################################ */

const CFG = {

  /** 店舗。多店舗化したときはコードで日報DBを分けます */
  STORE_CODE: 'SPK',
  STORE_NAME: 'くるむ薬局 札幌店',

  /** 担当者の決め方
   *   'select' … 名簿からプルダウンで選ぶ(共用端末向け。既定)
   *   'google' … Googleアカウントで確定する
   *              ※ デプロイを「アクセスしているユーザーとして実行」にする必要があります
   */
  AUTH_MODE: 'select',

  /** 週の始まり。0=日, 1=月 … 6=土。帳票が土曜始まりなので 6 */
  WEEK_START: 6,

  /** 帳票の各日に印字する営業時間 */
  BUSINESS_HOURS: '10:00〜20:00',

  /** 管理基準。画面の警告表示と、印刷時の色分けに使います。
   *  null にすると、その項目は基準なし(警告を出さない)扱いになります */
  RANGES: {
    ROOM_TEMP:  [1, 30],    // 調剤室 温度(℃)
    ROOM_HUMID: [30, 70],   // 調剤室 湿度(%)
    COLD_TEMP:  [2, 8],     // 冷所 温度(℃)
    COLD_HUMID: null        // 冷所 湿度(%)… 管理基準を設けない
  },

  /** 「入力中」とみなす時間(分)。これを過ぎた編集ロックは自動で解除されます */
  LOCK_MINUTES: 10,

  /** 押印のきまり
   *
   *  ADMIN_EVERY_DAY … 管理者印は、その日に在任している管理薬剤師の印影を
   *                    記録の有無や承認の有無にかかわらず毎日入れる。
   *                    運用上そういうものなので、押す押さないの判定はしません。
   *                    false にすると、承認済みの日だけに印影が入ります。
   *
   *  REUSE_ADMIN_STAMP … 印影を1コマずつ押すのではなく、押し終えた
   *                    下ごしらえのシートを複製して引き継ぐ。
   *                    印影の貼り付けは1枚ずつシートと往復するため、
   *                    ここが出力時間のほとんどを占めています。
   *                    管理者印は毎日同じ人なので、管理薬剤師の交代日を
   *                    またがない限り、任期のあいだは下ごしらえ1枚で足ります。
   *                    複製で画像が引き継がれるかは環境しだいなので、
   *                    出力のはじめに1度だけ確かめ、駄目なら自動で
   *                    1コマずつ押す方式に戻ります。 */
  SEAL_POLICY: {
    ADMIN_EVERY_DAY: true,
    REUSE_ADMIN_STAMP: true
  },

  /** 帳票テンプレートの作り。
   *  テンプレートのシートを直接いじって行や列を変えたときは、ここも合わせてください。
   *  行番号・列番号はすべて1始まりです。 */
  TEMPLATE: {
    SHEET: '帳票テンプレート',
    HEAD_ROWS: 2,          // 見出しの行数(1行目=列名 / 2行目=譲渡記録の内訳)
    ROWS_PER_DAY: 2,       // 1日ぶんの行数(上段=数値と押印 / 下段=管理に関する事項)
    COLS: 12,              // A〜L

    COL: {
      DATE:   1,           // A 日付・曜日・営業時間(2行ぶち抜き)
      RX:     2,           // B 処方箋枚数(単位「枚」は隣のC列に印字済み)
      INQ:    4,           // D 疑義照会件数(単位「件」はE列)
      MGMT:   6,           // F 管理に関する事項(上段。自由記述)
      ROOM_T: 7,           // G 調剤室 温度
      ROOM_H: 8,           // H 調剤室 湿度
      COLD_T: 9,           // I 冷所 温度
      COLD_H: 10,          // J 冷所 湿度
      STAFF:  11,          // K 担当者印
      ADMIN:  12,          // L 管理者印
      NOTE:   2            // 下段 B(B〜Lが結合されている)の左上。譲渡・譲受記録
    },

    /** 単位は表示形式で付けます。値は数値のまま入るので集計にも使えます */
    FMT: {
      RX:    '0',
      INQ:   '0',
      TEMP:  '0.0"℃　/"',
      HUMID: '0"%"'
    },

    /** 記録のない日はテンプレートの見た目(℃　/ や %)をそのまま残す。
     *  手書きで埋められる白紙の帳票としても使えるようにするため */
    KEEP_BLANK_PLACEHOLDER: true,

    /* -------- ここから下は buildTemplate() でシートを作るときだけ使います -------- */

    /** 見出しの文言 */
    HEADER: {
      DATE:  '日付\n営業時間',
      RX:    '処方箋枚数',
      INQ:   '疑義照会件数',
      NOTE:  '管理に関する事項',
      ROOM:  '調剤室\n温度/湿度',
      COLD:  '冷所\n温度/湿度',
      ADMIN: '管理者印',
      STAFF: '担当者印',
      NOTE_SUB: '譲渡区分/譲渡先名/販売メーカー名称/医薬品名称/包装形態/譲渡数/Lot/使用期限'
    },

    /** C列・E列に置く固定の単位文字 */
    UNIT_TEXT: { RX: '枚', INQ: '件' },

    /** 未記入のときに温湿度セルへ置いておく下地 */
    PLACEHOLDER: { TEMP: '℃　/', HUMID: '%' },

    /** 列幅(A〜L) */
    WIDTH: [104, 50, 50, 50, 50, 359, 58, 50, 54, 50, 98, 98],

    /** 行の高さ */
    ROW_H: { HEAD1: 42, HEAD2: 42, UPPER: 42, LOWER: 42 },

    /** 罫線の色 */
    RULE: '#2b3330',
    HEAD_BG: '#f4f6f5'
  },

  /** PDFにするときの紙の設定。
   *
   *  MARGIN_IN を広げると、帳票を縮める割合が大きくなります。
   *  逆に狭めて帳票が原寸で収まるようになると、縮小せずに出力するので
   *  外枠と紙の端のあいだに余裕ができ、罫線が欠けにくくなります。
   *  （現在の帳票は 1071px ＝ 283.4mm。余白 0.2 インチなら原寸で収まります）
   *
   *  EDGE_GAP_PX … 原寸で出すかどうかの判定に使う余裕。罫線の太さぶん。 */
  PDF: {
    PAGE: 'A4',
    LANDSCAPE: true,
    MARGIN_IN: 0.4,
    EDGE_GAP_PX: 6
  },

  /** 印影PNGを入れるフォルダ名。スプレッドシートと同じ場所に自動作成します。
   *  ★ このフォルダは誰とも共有しないでください */
  SEAL_FOLDER_NAME: '業務日報_印影',

  TZ: 'Asia/Tokyo'
};

/** シート名 */
const SH = {
  DAILY: '日報DB',
  STAFF: '担当者マスタ',
  TERM:  '管理薬剤師任期',
  LOG:   '変更履歴',
  FIX:   '確定台帳',
  XFER:  '譲渡記録'
};

/** 列定義。ここを変えたら setup() を再実行してください */
const COLS = {
  DAILY: ['店舗コード', '日付',
          '処方箋枚数', '疑義照会件数',
          '調剤室温度', '調剤室湿度', '冷所温度', '冷所湿度',
          // 帳票 上段F列。自由記述。1日1つ
          '管理に関する事項',
          '担当者', '入力日時', '管理者', '承認日時', '状態', '編集者', '編集開始'],
  STAFF: ['ID', '氏名', 'メール', '在籍', '印影ファイルID', '登録日時'],
  TERM:  ['ID', '担当者ID', '氏名', '就任日'],
  LOG:   ['日時', '操作', '内容', '操作者'],
  // 月次を確定してPDFに焼いた記録。1行 = 1つの版
  FIX:   ['ID', '対象月', '版', '確定日時', '確定者',
          'ファイル名', 'ファイルID', 'リンク',
          // 証跡。ハッシュ = PDFそのもの、連鎖 = 1つ前の連鎖とこの行をまとめたもの
          'ハッシュ', '連鎖', '状態', '備考'],
  // 医薬品の譲渡・譲受。1日に何件でも入るので、日報とは別の行で持ちます
  XFER:  ['ID', '店舗コード', '日付', '連番',
          '譲渡区分', '譲渡先名', '販売メーカー名称', '医薬品名称',
          '包装形態', '譲渡数', 'Lot', '使用期限', '登録日時', '登録者']
};

/**
 * 昔の形。日報DBの列で譲渡記録を持っていたころの8列です。
 *
 * 新しく作るブックには足しません（COLS.DAILY に入れると、
 * 落としても ensureColumns_ が作り直してしまうため）。
 * 古いブックには残っているので、移行が済むまでは読み取りの控えとして使い、
 * updateDatabase で移したあとは dropLegacyXferColumns で落とせます。
 */
const LEGACY_XFER_COLS = ['譲渡区分', '譲渡先名', '販売メーカー名称', '医薬品名称',
                          '包装形態', '譲渡数', 'Lot', '使用期限'];

const PROP = PropertiesService.getScriptProperties();

/* ############################################################
   2. シートの用意と共通アクセス
   ############################################################ */

/** ★ 最初に1回だけ実行する */
function setup() {
  ensureSheet_(SH.DAILY, COLS.DAILY);
  ensureSheet_(SH.STAFF, COLS.STAFF);
  ensureSheet_(SH.TERM,  COLS.TERM);
  ensureSheet_(SH.LOG,   COLS.LOG);
  ensureSheet_(SH.FIX,   COLS.FIX);
  ensureSheet_(SH.XFER,  COLS.XFER);

  // 日付と就任日は文字列で持つ(タイムゾーンのずれで1日前後するのを避けるため)
  formatTextColumn_(SH.DAILY, '日付');
  formatTextColumn_(SH.TERM,  '就任日');
  formatTextColumn_(SH.XFER,  '日付');

  sealFolder_();   // 印影フォルダを作っておく

  Logger.log('====================================================');
  Logger.log('シートを用意しました: '
    + [SH.DAILY, SH.STAFF, SH.TERM, SH.LOG, SH.FIX, SH.XFER].join(' / '));
  Logger.log('印影フォルダ: ' + CFG.SEAL_FOLDER_NAME + '(共有しないでください)');
  Logger.log('');
  Logger.log('列が足りているかは、いつでも checkSheets で確かめられます。');
  Logger.log('Code.gs を新しくしたときは updateDatabase を1回実行してください。');
  Logger.log('');
  Logger.log('次に「デプロイ > 新しいデプロイ > 種類:ウェブアプリ」を実行してください。');
  Logger.log('  次のユーザーとして実行 : ' +
    (CFG.AUTH_MODE === 'google' ? 'アクセスしているユーザー' : '自分'));
  Logger.log('  アクセスできるユーザー : 必要な範囲で');
  Logger.log('====================================================');
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureSheet_(name, cols) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  const head = headerOf_(sh);

  // 足りない見出しだけ右に足す(既存データは動かさない)
  const missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (!head.length) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  } else if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn())
    .setFontWeight('bold').setBackground('#e8eaed');
  return sh;
}

/* ------------------------------------------------------------
 *  列の過不足をなくす
 *
 *  シートへの書き込みは「見出し行にある列」だけを対象にしています。
 *  そのため、あとから COLS に項目を足しただけでは、古いシートに
 *  その列が無く、書いた値が黙って捨てられてしまいます。
 *  （管理に関する事項の8列がこれにあたりました）
 *
 *  そこで、読み書きの前に必ず列をそろえます。1回の実行のあいだは
 *  結果を覚えておくので、シートを何度読んでも確認は1回だけです。
 * ---------------------------------------------------------- */

/** シート名 → あるべき列 */
const SHEET_COLS = {};
SHEET_COLS[SH.DAILY] = COLS.DAILY;
SHEET_COLS[SH.STAFF] = COLS.STAFF;
SHEET_COLS[SH.TERM]  = COLS.TERM;
SHEET_COLS[SH.LOG]   = COLS.LOG;
SHEET_COLS[SH.FIX]   = COLS.FIX;
SHEET_COLS[SH.XFER]  = COLS.XFER;

/** この実行で確認済みのシート */
const SCHEMA_CHECKED = {};

/** 見出し行。末尾の空セルは見出しではないので落とす */
function headerOf_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const raw = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  let width = raw.length;
  while (width > 0 && raw[width - 1] === '') width--;
  return raw.slice(0, width);
}

/** 足りていない列を返す */
function missingColumns_(name, cols) {
  const sh = ss_().getSheetByName(name);
  if (!sh) return cols.slice();
  const head = headerOf_(sh);
  return cols.filter(function (c) { return head.indexOf(c) < 0; });
}

/** 足りない列があれば足す。シートが無いときは何もしない(table_ 側で知らせる) */
function ensureColumns_(name) {
  if (SCHEMA_CHECKED[name]) return;
  const cols = SHEET_COLS[name];
  if (!cols) { SCHEMA_CHECKED[name] = true; return; }
  if (!ss_().getSheetByName(name)) return;

  const missing = missingColumns_(name, cols);
  SCHEMA_CHECKED[name] = true;          // 履歴を書く前に立てる(呼び戻りを避ける)
  if (!missing.length) return;

  ensureSheet_(name, cols);
  console.log('シート「' + name + '」に列を追加しました: ' + missing.join('、'));
  audit_('シートの列を自動追加', name + '：' + missing.join('、'), '');
}

/**
 * ★ 手で実行して、シートの列がそろっているかを確かめます。
 *    足りない列はその場で追加します。実行ログに結果が出ます。
 */
function checkSheets() {
  Object.keys(SHEET_COLS).forEach(function (name) {
    const cols = SHEET_COLS[name];
    if (!ss_().getSheetByName(name)) {
      console.log('［' + name + '］シートがありません。setup を実行してください');
      return;
    }
    const missing = missingColumns_(name, cols);
    if (!missing.length) {
      console.log('［' + name + '］そろっています（' + cols.length + '列）');
      return;
    }
    ensureSheet_(name, cols);
    console.log('［' + name + '］列を追加しました: ' + missing.join('、'));
  });
  console.log('確認おわり');
}

function formatTextColumn_(sheetName, colName) {
  const sh = ss_().getSheetByName(sheetName);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const i = head.indexOf(colName);
  if (i >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
}

/**
 * シート全体をオブジェクトの配列として読む。
 * 各行に _row(実際の行番号)が入るので、そのまま書き戻せます。
 */
function table_(name) {
  ensureColumns_(name);                 // 読む前に列をそろえる
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートがありません: ' + name + '（setup() を実行してください）');

  const values = sh.getDataRange().getValues();
  const header = values[0].map(function (h) { return String(h).trim(); });
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === '') continue;
    const o = { _row: i + 1 };
    header.forEach(function (h, j) { o[h] = values[i][j]; });
    rows.push(o);
  }
  return { sh: sh, header: header, rows: rows };
}

/**
 * 見出しに無いキーを書こうとしていないか確かめる。
 * ここを素通りさせると、値が保存されないのに成功したように見えてしまいます。
 */
function assertColumns_(t, patch) {
  const unknown = Object.keys(patch).filter(function (k) {
    return t.header.indexOf(k) < 0;
  });
  if (unknown.length) {
    throw new Error('シート「' + t.sh.getName() + '」に次の列がありません: '
      + unknown.join('、') + '。スクリプトエディタで checkSheets を実行してください');
  }
}

/** 見出し名で指定した値だけを1行にまとめて書く(1回のsetValuesで済ませる) */
function writeRow_(t, row, patch) {
  assertColumns_(t, patch);
  const width = t.header.length;
  const cur = t.sh.getRange(row, 1, 1, width).getValues()[0];
  t.header.forEach(function (h, j) {
    if (patch.hasOwnProperty(h)) cur[j] = patch[h];
  });
  t.sh.getRange(row, 1, 1, width).setValues([cur]);
}

/** 末尾に1行追加して、その行番号を返す */
function appendRow_(t, patch) {
  assertColumns_(t, patch);
  const rowValues = t.header.map(function (h) {
    return patch.hasOwnProperty(h) ? patch[h] : '';
  });
  t.sh.appendRow(rowValues);
  return t.sh.getLastRow();
}

function deleteRow_(t, row) { t.sh.deleteRow(row); }

/* ------------------------------------------------------------
 *  日付まわり
 * ---------------------------------------------------------- */

function today_() { return fmt_(new Date()); }

/** Date / 文字列 / シリアル値 を 'yyyy-MM-dd' に揃える */
function fmt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd');
}

function addDays_(iso, n) {
  const p = iso.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd');
}

/** その日を含む週の初日('yyyy-MM-dd') */
function weekStart_(iso) {
  const p = iso.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  const diff = (d.getDay() - CFG.WEEK_START + 7) % 7;
  return addDays_(iso, -diff);
}

function dowOf_(iso) {
  const p = iso.split('-');
  return ['日', '月', '火', '水', '木', '金', '土'][new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
}

function hhmm_(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : Utilities.formatDate(d, CFG.TZ, 'HH:mm');
}

function stamp_() { return Utilities.formatDate(new Date(), CFG.TZ, 'MM/dd HH:mm'); }

function num_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function uid_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

/* ############################################################
   3. 担当者・管理薬剤師・印影・変更履歴
   ############################################################ */

/* ------------------------------------------------------------
 *  読み出し
 * ---------------------------------------------------------- */

function staffList_() {
  const t = table_(SH.STAFF);
  const counts = dailyCountsByStaff_();
  return t.rows.map(function (r) {
    return {
      id: String(r['ID']),
      name: String(r['氏名']),
      email: String(r['メール'] || ''),
      // 在籍のセルは true/false で持つ。'退職' は以前の書き方で、古いシート用に残してある
      active: r['在籍'] !== false && String(r['在籍']) !== 'FALSE' && String(r['在籍']) !== '退職',
      sealFileId: String(r['印影ファイルID'] || ''),
      records: counts[String(r['氏名'])] || 0,
      _row: r._row
    };
  });
}

function termList_() {
  const t = table_(SH.TERM);
  return t.rows.map(function (r) {
    return {
      id: String(r['ID']),
      staffId: String(r['担当者ID']),
      name: String(r['氏名']),
      from: fmt_(r['就任日']),
      _row: r._row
    };
  }).filter(function (x) { return x.from; })
    .sort(function (a, b) { return a.from < b.from ? -1 : 1; });
}

function logList_(limit) {
  const t = table_(SH.LOG);
  return t.rows.slice(-(limit || 80)).reverse().map(function (r) {
    return {
      at: (r['日時'] instanceof Date)
        ? Utilities.formatDate(r['日時'], CFG.TZ, 'MM/dd HH:mm')
        : String(r['日時']),
      action: String(r['操作']),
      detail: String(r['内容']),
      actor: String(r['操作者'] || '')
    };
  });
}

/** 画面に渡す形。印影はデータURLにして持たせる */
function masterPayload_() {
  const staff = staffList_();
  return {
    staff: staff.map(function (s) {
      return {
        id: s.id, name: s.name, active: s.active,
        records: s.records, sealUrl: sealDataUrl_(s.sealFileId)
      };
    }),
    terms: termList_().map(function (t) {
      return { id: t.id, staffId: t.staffId, name: t.name, from: t.from };
    }),
    log: logList_(80),
    today: today_()
  };
}

/** その日の管理薬剤師 */
function chiefOn_(iso, terms) {
  const list = terms || termList_();
  let hit = null;
  list.forEach(function (t) {
    if (t.from <= iso && (!hit || t.from > hit.from)) hit = t;
  });
  return hit ? hit.name : '';
}

/* ------------------------------------------------------------
 *  更新
 * ---------------------------------------------------------- */

function addStaff_(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('氏名を入力してください');

  const t = table_(SH.STAFF);
  if (t.rows.some(function (r) { return String(r['氏名']).trim() === name; })) {
    throw new Error(name + ' さんは既に名簿にあります');
  }
  appendRow_(t, {
    'ID': uid_('S'), '氏名': name, 'メール': String(p.email || ''),
    '在籍': true, '印影ファイルID': '', '登録日時': new Date()
  });
  audit_('担当者を追加', name, p.actor);
  return masterPayload_();
}

function updateStaff_(p) {
  const t = table_(SH.STAFF);
  const row = t.rows.filter(function (r) { return String(r['ID']) === String(p.id); })[0];
  if (!row) throw new Error('名簿にありません');

  const name = String(row['氏名']);

  if (p.active === false && chiefOn_(today_()) === name) {
    throw new Error('現在の管理薬剤師です。先に交代を登録してください');
  }

  const patch = {};
  if (p.active !== undefined) patch['在籍'] = !!p.active;
  if (p.email !== undefined) patch['メール'] = String(p.email);
  writeRow_(t, row._row, patch);

  if (p.active !== undefined) {
    audit_(p.active ? '担当者を在籍に戻す' : '担当者を在籍から外す', name, p.actor);
  }
  return masterPayload_();
}

function removeStaff_(p) {
  const t = table_(SH.STAFF);
  const row = t.rows.filter(function (r) { return String(r['ID']) === String(p.id); })[0];
  if (!row) throw new Error('名簿にありません');

  const name = String(row['氏名']);
  if ((dailyCountsByStaff_()[name] || 0) > 0) {
    throw new Error('日報に記録が残っているため削除できません。在籍から外してください');
  }
  if (termList_().some(function (x) { return x.staffId === String(p.id); })) {
    throw new Error('管理薬剤師の履歴が残っているため削除できません。在籍から外してください');
  }

  removeSealFile_(String(row['印影ファイルID'] || ''));
  deleteRow_(t, row._row);
  audit_('担当者を削除', name, p.actor);
  return masterPayload_();
}

/* ---------- 管理薬剤師の任期 ---------- */

function setChief_(p) {
  const from = fmt_(p.from);
  if (!from) throw new Error('就任日の形式が正しくありません');

  const s = staffList_().filter(function (x) { return x.id === String(p.staffId); })[0];
  if (!s) throw new Error('名簿にありません');

  const terms = termList_();
  if (terms.some(function (x) { return x.from === from; })) {
    throw new Error('同じ就任日の登録が既にあります');
  }

  const prev = chiefOn_(from, terms);
  const t = table_(SH.TERM);
  appendRow_(t, { 'ID': uid_('T'), '担当者ID': s.id, '氏名': s.name, '就任日': from });

  audit_('管理薬剤師の交代',
    (prev ? prev + ' → ' : '') + s.name + '（' + from + ' から）', p.actor);
  return masterPayload_();
}

function updateTerm_(p) {
  const from = fmt_(p.from);
  if (!from) throw new Error('就任日の形式が正しくありません');

  const t = table_(SH.TERM);
  const row = t.rows.filter(function (r) { return String(r['ID']) === String(p.id); })[0];
  if (!row) throw new Error('任期がありません');

  if (t.rows.some(function (r) {
        return String(r['ID']) !== String(p.id) && fmt_(r['就任日']) === from; })) {
    throw new Error('同じ就任日の登録が既にあります');
  }

  const before = fmt_(row['就任日']);
  writeRow_(t, row._row, { '就任日': from });
  audit_('就任日を変更', String(row['氏名']) + '：' + before + ' → ' + from, p.actor);
  return masterPayload_();
}

function removeTerm_(p) {
  const t = table_(SH.TERM);
  const row = t.rows.filter(function (r) { return String(r['ID']) === String(p.id); })[0];
  if (!row) throw new Error('任期がありません');
  if (t.rows.length === 1) throw new Error('管理薬剤師が0人になります');

  deleteRow_(t, row._row);
  audit_('任期を削除', String(row['氏名']) + '（' + fmt_(row['就任日']) + ' 〜）', p.actor);
  return masterPayload_();
}

/* ------------------------------------------------------------
 *  印影
 * ------------------------------------------------------------
 *  画面側で「白背景を透過 → 余白を切り落とし → 300px角」まで
 *  済ませたPNGが届きます。ここでは保存だけを担当します。
 *  フォルダは共有しないため、公開URLは一切作りません。
 * ---------------------------------------------------------- */

function sealFolder_() {
  const cached = PROP.getProperty('SEAL_FOLDER_ID');
  if (cached) {
    try { return DriveApp.getFolderById(cached); } catch (e) { /* 消された場合は作り直す */ }
  }
  const parents = DriveApp.getFileById(ss_().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  const found = parent.getFoldersByName(CFG.SEAL_FOLDER_NAME);
  const folder = found.hasNext() ? found.next() : parent.createFolder(CFG.SEAL_FOLDER_NAME);
  PROP.setProperty('SEAL_FOLDER_ID', folder.getId());
  return folder;
}

function setSeal_(p) {
  const m = String(p.dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error('画像を読み込めませんでした');

  const t = table_(SH.STAFF);
  const row = t.rows.filter(function (r) { return String(r['ID']) === String(p.id); })[0];
  if (!row) throw new Error('名簿にありません');

  const bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 2 * 1024 * 1024) throw new Error('画像が大きすぎます');

  removeSealFile_(String(row['印影ファイルID'] || ''));

  const blob = Utilities.newBlob(bytes, 'image/png', 'seal_' + row['ID'] + '.png');
  const file = sealFolder_().createFile(blob);

  writeRow_(t, row._row, { '印影ファイルID': file.getId() });
  CacheService.getScriptCache().remove('seal_' + file.getId());
  audit_('印影を登録', String(row['氏名']), p.actor);
  return masterPayload_();
}

function removeSeal_(p) {
  const t = table_(SH.STAFF);
  const row = t.rows.filter(function (r) { return String(r['ID']) === String(p.id); })[0];
  if (!row) throw new Error('名簿にありません');

  removeSealFile_(String(row['印影ファイルID'] || ''));
  writeRow_(t, row._row, { '印影ファイルID': '' });
  audit_('印影を削除', String(row['氏名']), p.actor);
  return masterPayload_();
}

function removeSealFile_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    CacheService.getScriptCache().remove('seal_' + fileId);
  } catch (e) {
    console.warn('印影ファイルを削除できませんでした: ' + e);
  }
}

/** 画面表示用のデータURL。毎回Driveを読むと遅いのでキャッシュする */
function sealDataUrl_(fileId) {
  if (!fileId) return '';
  const key = 'seal_' + fileId;
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get(key);
    if (hit) return hit;
  } catch (e) { /* キャッシュ不調は無視 */ }

  try {
    const b64 = Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes());
    const url = 'data:image/png;base64,' + b64;
    try { cache.put(key, url, 21600); } catch (e) { /* 100KB超はキャッシュしない */ }
    return url;
  } catch (e) {
    console.warn('印影を読めませんでした: ' + e);
    return '';
  }
}

/** 印刷処理用。氏名 → 印影Blob の対応表を1回だけ作る(ループ内でDriveを叩かないため) */
function sealBlobMap_() {
  const map = {};
  staffList_().forEach(function (s) {
    if (!s.sealFileId) return;
    try { map[s.name] = DriveApp.getFileById(s.sealFileId).getBlob(); }
    catch (e) { console.warn('印影を読めませんでした: ' + s.name); }
  });
  return map;
}

/* ------------------------------------------------------------
 *  変更履歴(トランザクションログ)
 * ---------------------------------------------------------- */

function audit_(action, detail, actor) {
  try {
    const t = table_(SH.LOG);
    appendRow_(t, {
      '日時': new Date(), '操作': action, '内容': detail, '操作者': actor || ''
    });
  } catch (e) {
    console.error('履歴の記録に失敗: ' + e);
  }
}

/* ############################################################
   4. 日報の読み書き
   ############################################################ */

/**
 * 帳票 下段の「譲渡・譲受記録」。画面のキーと「譲渡記録」シートの列を1対1で結びます。
 *
 * ★ 帳票 上段F列の「管理に関する事項」とは別のものです。
 *    管理に関する事項 … その日の特記事項。自由記述。1日1つ
 *    譲渡・譲受記録   … 医薬品を渡した／受けた記録。1日に何件でも
 */
const XFER_MAP = [
  { key: 'xKind',    col: '譲渡区分' },
  { key: 'xPartner', col: '譲渡先名' },
  { key: 'xMaker',   col: '販売メーカー名称' },
  { key: 'xDrug',    col: '医薬品名称' },
  { key: 'xPack',    col: '包装形態' },
  { key: 'xQty',     col: '譲渡数' },
  { key: 'xLot',     col: 'Lot' },
  { key: 'xExpiry',  col: '使用期限' }
];

/** 日付 → 行 の対応表(当店舗のみ) */
function dailyIndex_() {
  const t = table_(SH.DAILY);
  const map = {};
  t.rows.forEach(function (r) {
    if (String(r['店舗コード']) !== CFG.STORE_CODE) return;
    map[fmt_(r['日付'])] = r;
  });
  return { t: t, map: map };
}

/* ------------------------------------------------------------
 *  譲渡・譲受記録
 *
 *  1日に何件でも入るので、日報とは別の行で持ちます。
 *  日付ごとにまとめて読み、書くときはその日のぶんを入れ替えます。
 * ---------------------------------------------------------- */

/** 日付 → その日の譲渡記録(連番順) */
function xferIndex_() {
  const t = table_(SH.XFER);
  const map = {};
  t.rows.forEach(function (r) {
    if (String(r['店舗コード']) !== CFG.STORE_CODE) return;
    const d = fmt_(r['日付']);
    if (!d) return;
    (map[d] = map[d] || []).push(r);
  });
  Object.keys(map).forEach(function (d) {
    map[d].sort(function (a, b) { return (Number(a['連番']) || 0) - (Number(b['連番']) || 0); });
  });
  return { t: t, map: map };
}

/**
 * その日の譲渡記録を、画面の形の配列で返す。
 *
 * まだ移行していないデータのために、譲渡記録シートに1件も無いときだけ
 * 日報DBの旧8列を見にいきます(1件ぶん入っていることがあります)。
 */
function xfersOf_(iso, xi, dailyRow) {
  const rows = (xi && xi.map[iso] ? xi.map[iso] : []).map(function (r) {
    const o = {};
    XFER_MAP.forEach(function (m) { o[m.key] = String(r[m.col] || '').trim(); });
    return o;
  });
  if (rows.length || !dailyRow) return rows;

  const legacy = {};
  let any = false;
  XFER_MAP.forEach(function (m) {
    legacy[m.key] = String(dailyRow[m.col] || '').trim();
    if (legacy[m.key]) any = true;
  });
  return any ? [legacy] : [];
}

/** 中身が1つでも入っている記録だけ残す */
function xferClean_(list) {
  return (list || []).map(function (x) {
    const o = {};
    XFER_MAP.forEach(function (m) { o[m.key] = String((x && x[m.key]) || '').trim(); });
    return o;
  }).filter(function (o) {
    return XFER_MAP.some(function (m) { return o[m.key]; });
  });
}

/** その日の譲渡記録を入れ替える。数が変わるので、消してから入れ直します */
function writeXfers_(iso, list, actor) {
  const xi = xferIndex_();
  const old = (xi.map[iso] || []).map(function (r) { return r._row; })
    .sort(function (a, b) { return b - a; });        // 下から消す(行番号がずれるため)
  old.forEach(function (row) { xi.t.sh.deleteRow(row); });

  const clean = xferClean_(list);
  if (!clean.length) return clean;

  const t = table_(SH.XFER);                         // 消したあとの状態で読み直す
  clean.forEach(function (x, i) {
    const patch = {
      'ID': uid_('X'), '店舗コード': CFG.STORE_CODE, '日付': iso, '連番': i + 1,
      '登録日時': new Date(), '登録者': String(actor || '')
    };
    XFER_MAP.forEach(function (m) { patch[m.col] = x[m.key]; });
    appendRow_(t, patch);
  });
  return clean;
}

function dailyCountsByStaff_() {
  const t = table_(SH.DAILY);
  const c = {};
  t.rows.forEach(function (r) {
    const n = String(r['担当者'] || '').trim();
    if (n) c[n] = (c[n] || 0) + 1;
  });
  return c;
}

/**
 * 1行を画面の形に変換する。
 *
 * note  … 管理に関する事項(帳票 上段F列)。自由記述。1日1つ
 * xfers … 譲渡・譲受記録(帳票 下段)。1日に何件でも。別シートから引く
 *
 * @param {Object} xi xferIndex_() の結果。渡さないと xfers は空のまま
 */
function toDay_(iso, row, terms, xi) {
  const base = {
    date: iso, dow: dowOf_(iso),
    rx: null, inquiry: null,
    roomTemp: null, roomHumid: null, coldTemp: null, coldHumid: null,
    note: '',
    xfers: [],
    staff: '', admin: '', savedAt: '', approvedAt: '', lockedBy: '',
    chief: chiefOn_(iso, terms),
    state: 'empty'
  };
  if (!row) {
    base.xfers = xfersOf_(iso, xi, null);
    return base;
  }

  base.rx        = num_(row['処方箋枚数']);
  base.inquiry   = num_(row['疑義照会件数']);
  base.roomTemp  = num_(row['調剤室温度']);
  base.roomHumid = num_(row['調剤室湿度']);
  base.coldTemp  = num_(row['冷所温度']);
  base.coldHumid = num_(row['冷所湿度']);

  base.note  = String(row['管理に関する事項'] || '');
  base.xfers = xfersOf_(iso, xi, row);
  base.staff    = String(row['担当者'] || '');
  base.admin    = String(row['管理者'] || '');
  base.savedAt  = hhmm_(row['入力日時']);
  base.approvedAt = hhmm_(row['承認日時']);

  const st = String(row['状態'] || '');
  if (st === '承認済') base.state = 'approved';
  else if (st === '入力済') base.state = 'saved';

  // 編集ロック。期限切れは無視する(閉じ忘れで永久に固まらないように)
  const editor = String(row['編集者'] || '');
  const startedAt = row['編集開始'];
  if (base.state === 'empty' && editor && startedAt) {
    const ageMin = (Date.now() - new Date(startedAt).getTime()) / 60000;
    if (ageMin < CFG.LOCK_MINUTES) {
      base.state = 'editing';
      base.lockedBy = editor;
    }
  }
  return base;
}

/** さかのぼって「まだ入力されていない日」を探す。
 *  入力忘れを拾うための一覧で、既定は過去60日ぶん。
 *  今日そのものは(まだ勤務中のこともあるので)含めません。 */
function missingDays_(span) {
  const n = Math.max(1, Math.min(400, Number(span) || 60));
  const today = today_();
  const idx = dailyIndex_();
  const terms = termList_();
  const out = [];
  for (let i = 1; i <= n; i++) {
    const iso = addDays_(today, -i);
    const d = toDay_(iso, idx.map[iso], terms);
    if (d.state === 'empty' || d.state === 'editing') {
      out.push({ date: iso, dow: d.dow, state: d.state, lockedBy: d.lockedBy });
    }
  }
  return { today: today, span: n, days: out };
}

/** 週まるごとの状態を返す(画面が最初に呼ぶ) */
function weekPayload_(anchorIso) {
  const today = today_();
  // 未来の週は開かせない。指定が先の週なら今週に戻す
  let anchor = anchorIso ? fmt_(anchorIso) : '';
  if (!anchor) anchor = today;
  if (weekStart_(anchor) > weekStart_(today)) anchor = today;
  const start = weekStart_(anchor);
  const idx = dailyIndex_();
  const terms = termList_();
  const xi = xferIndex_();

  const days = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays_(start, i);
    days.push(toDay_(iso, idx.map[iso], terms, xi));
  }

  const staff = staffList_();
  return {
    store: CFG.STORE_NAME,
    storeCode: CFG.STORE_CODE,
    today: today,
    weekStart: start,
    me: currentUserName_(staff),
    staff: staff.map(function (s) {
      return { id: s.id, name: s.name, active: s.active,
               records: s.records, sealUrl: sealDataUrl_(s.sealFileId) };
    }),
    terms: terms.map(function (t) {
      return { id: t.id, staffId: t.staffId, name: t.name, from: t.from };
    }),
    auth: authPayload_(staff),
    ranges: CFG.RANGES,
    // 紙の設定はここが唯一の出どころ。画面のブラウザ印刷にも同じ値を使わせ、
    // 「印刷」と「PDFを出力」で刷り上がりが食い違わないようにする
    paper: {
      page: CFG.PDF.PAGE,
      landscape: CFG.PDF.LANDSCAPE,
      marginIn: CFG.PDF.MARGIN_IN
    },
    // 前回までの実測。出力を始める前に「およそ○分」を出すために渡します
    exportRate: { secPerWeek: Number(PROP.getProperty(PRINT.RATE_KEY)) || 0 },
    days: days
  };
}

/* ------------------------------------------------------------
 *  書き込み
 * ---------------------------------------------------------- */

function saveDay_(p) {
  const iso = fmt_(p.date);
  if (!iso) throw new Error('日付が正しくありません');
  if (iso > today_()) throw new Error('未来の日付は登録できません');

  const staffName = String(p.staff || '').trim();
  if (!staffName) throw new Error('担当者が選ばれていません');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const idx = dailyIndex_();
    const row = idx.map[iso];

    // 他の人が入力中なら、上書きせずに知らせる
    if (row) {
      const editor = String(row['編集者'] || '');
      const started = row['編集開始'];
      if (editor && editor !== staffName && started &&
          (Date.now() - new Date(started).getTime()) / 60000 < CFG.LOCK_MINUTES &&
          String(row['状態'] || '') === '') {
        throw new Error(editor + ' さんが入力中です。少し待ってから開き直してください');
      }
      if (String(row['状態']) === '承認済' && !p.force) {
        throw new Error('承認済みの日です。修正するには先に承認を取り消してください');
      }
    }

    const patch = {
      '店舗コード': CFG.STORE_CODE,
      '日付': iso,
      '処方箋枚数': num_(p.rx),
      '疑義照会件数': num_(p.inquiry),
      '調剤室温度': num_(p.roomTemp),
      '調剤室湿度': num_(p.roomHumid),
      '冷所温度': num_(p.coldTemp),
      '冷所湿度': num_(p.coldHumid),
      '管理に関する事項': String(p.note || '').trim(),
      '担当者': staffName,
      '入力日時': new Date(),
      '状態': '入力済',
      '編集者': '',
      '編集開始': ''
    };
    // 旧8列が残っているブックでは空にしておく。残したままだと、譲渡を1件も
    // 入れずに保存したときに古い値が復活する。落としたブックでは何もしない
    LEGACY_XFER_COLS.forEach(function (c) {
      if (idx.t.header.indexOf(c) >= 0) patch[c] = '';
    });

    if (row) writeRow_(idx.t, row._row, patch);
    else appendRow_(idx.t, patch);

    writeXfers_(iso, p.xfers, staffName);   // その日のぶんを入れ替える

    return weekPayload_(iso);
  } finally {
    lock.releaseLock();
  }
}

function approveDay_(p) {
  const iso = fmt_(p.date);
  const who = String(p.admin || '').trim();
  if (!who) throw new Error('承認者が特定できません');

  const terms = termList_();
  const chief = chiefOn_(iso, terms);
  const nowChief = chiefOn_(today_(), terms);
  if (who !== chief && who !== nowChief) {
    throw new Error('承認できるのは管理薬剤師だけです');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const idx = dailyIndex_();
    const row = idx.map[iso];
    if (!row) throw new Error('記録がありません');
    if (String(row['状態']) !== '入力済') throw new Error('入力済みの日ではありません');

    writeRow_(idx.t, row._row, {
      '管理者': who, '承認日時': new Date(), '状態': '承認済'
    });

    if (chief && who !== chief) {
      audit_('日報を代行承認', iso + '：' + who + '（当日の管理薬剤師 ' + chief + '）', who);
    }
    return weekPayload_(iso);
  } finally {
    lock.releaseLock();
  }
}

/** 承認の取り消し(誤承認の訂正用) */
function unapproveDay_(p) {
  const iso = fmt_(p.date);
  const who = String(p.admin || '').trim();
  if (who !== chiefOn_(today_())) throw new Error('取り消せるのは現在の管理薬剤師だけです');

  const idx = dailyIndex_();
  const row = idx.map[iso];
  if (!row) throw new Error('記録がありません');

  writeRow_(idx.t, row._row, { '管理者': '', '承認日時': '', '状態': '入力済' });
  audit_('承認を取り消し', iso, who);
  return weekPayload_(iso);
}

/* ---------- 入力中の表示 ---------- */

function claimDay_(p) {
  const iso = fmt_(p.date);
  const who = String(p.staff || '').trim();
  if (!iso || !who) return weekPayload_(iso || today_());

  const idx = dailyIndex_();
  const row = idx.map[iso];

  if (row) {
    if (String(row['状態'] || '') !== '') return weekPayload_(iso);   // 既に入力済み
    writeRow_(idx.t, row._row, { '編集者': who, '編集開始': new Date() });
  } else {
    appendRow_(idx.t, {
      '店舗コード': CFG.STORE_CODE, '日付': iso, '状態': '',
      '編集者': who, '編集開始': new Date()
    });
  }
  return weekPayload_(iso);
}

function releaseDay_(p) {
  const iso = fmt_(p.date);
  const idx = dailyIndex_();
  const row = idx.map[iso];
  if (!row) return;
  if (String(row['状態'] || '') !== '') return;
  if (String(row['編集者'] || '') !== String(p.staff || '')) return;
  writeRow_(idx.t, row._row, { '編集者': '', '編集開始': '' });
}

/* ------------------------------------------------------------
 *  誰として使っているか
 * ---------------------------------------------------------- */

function currentUserEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; }
  catch (e) { return ''; }
}

function currentUserName_(staff) {
  if (CFG.AUTH_MODE !== 'google') return '';
  const email = currentUserEmail_().toLowerCase();
  if (!email) return '';
  const hit = (staff || staffList_()).filter(function (s) {
    return s.active && s.email && s.email.toLowerCase() === email;
  })[0];
  return hit ? hit.name : '';
}

function authPayload_(staff) {
  if (CFG.AUTH_MODE !== 'google') return { mode: 'select' };
  const email = currentUserEmail_();
  const name = currentUserName_(staff);
  return { mode: 'google', email: email, name: name, registered: !!name };
}

/* ############################################################
   5. 画面から呼ばれる入口
   ############################################################ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('WebApp')
    .setTitle(CFG.STORE_NAME + ' 業務日報')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------- 日報 ---------- */

function getWeekState(anchor) { return guard_('getWeekState', function () {
  return weekPayload_(anchor);
}); }

function findMissing(span) { return guard_('findMissing', function () {
  return missingDays_(span);
}); }

function saveDay(p) { return guard_('saveDay', function () {
  return saveDay_(p);
}); }

function approveDay(p) { return guard_('approveDay', function () {
  return approveDay_(p);
}); }

function unapproveDay(p) { return guard_('unapproveDay', function () {
  return unapproveDay_(p);
}); }

function claimDay(p) { return guard_('claimDay', function () {
  return claimDay_(p);
}); }

function releaseDay(p) { return guard_('releaseDay', function () {
  releaseDay_(p); return true;
}); }

/* ---------- 名簿 ---------- */

function getStaffMaster() { return guard_('getStaffMaster', function () {
  return masterPayload_();
}); }

function addStaff(p) { return guard_('addStaff', function () {
  return addStaff_(p);
}); }

function updateStaff(p) { return guard_('updateStaff', function () {
  return updateStaff_(p);
}); }

function removeStaff(p) { return guard_('removeStaff', function () {
  return removeStaff_(p);
}); }

/* ---------- 管理薬剤師 ---------- */

function setChief(p) { return guard_('setChief', function () {
  return setChief_(p);
}); }

function updateTerm(p) { return guard_('updateTerm', function () {
  return updateTerm_(p);
}); }

function removeTerm(p) { return guard_('removeTerm', function () {
  return removeTerm_(p);
}); }

/* ---------- 印影 ---------- */

function setSeal(p) { return guard_('setSeal', function () {
  return setSeal_(p);
}); }

function removeSeal(p) { return guard_('removeSeal', function () {
  return removeSeal_(p);
}); }

/* ------------------------------------------------------------
 *  共通の入口処理
 *  ・実行ログに残す(あとで追えるように)
 *  ・想定内のエラーはメッセージをそのまま画面へ返す
 * ---------------------------------------------------------- */
function guard_(name, fn) {
  const t0 = Date.now();
  try {
    const out = fn();
    console.log(name + ' ok (' + (Date.now() - t0) + 'ms)');
    return out;
  } catch (err) {
    console.error(name + ' failed: ' + (err && err.stack ? err.stack : err));
    throw new Error(err && err.message ? err.message : String(err));
  }
}

/* ------------------------------------------------------------
 *  動作確認用
 * ---------------------------------------------------------- */

/** 初期データを入れて一通り動くか確かめる(テスト用。本番では実行しないこと) */
function seedForTest() {
  const a = addStaff_({ name: '関根 禎浩', actor: 'setup' });
  addStaff_({ name: '山田 太郎', actor: 'setup' });
  addStaff_({ name: '佐藤 花子', actor: 'setup' });

  const me = staffList_().filter(function (s) { return s.name === '関根 禎浩'; })[0];
  setChief_({ staffId: me.id, from: addDays_(today_(), -120), actor: 'setup' });

  saveDay_({ date: addDays_(today_(), -1), staff: '山田 太郎',
             fridge: 5.2, humidity: 48, rx: 82, inquiry: 1 });

  Logger.log(JSON.stringify(weekPayload_(null), null, 2).slice(0, 1200));
}

/**
 * ★ 手で1回だけ実行して、日報DBの旧8列に入っている譲渡記録を
 *    「譲渡記録」シートへ移します。
 *
 *    以前は譲渡記録を日報DBの列で持っていたので、1日1件しか入りませんでした。
 *    移したあとは、1日に何件でも入れられます。
 *
 *    移したあと日報DBの旧8列は空にします(同じ内容が2か所に残ると、
 *    どちらが正しいのか分からなくなるため)。
 */
function migrateXfers() {
  const idx = dailyIndex_();
  const xi = xferIndex_();
  const moved = [];

  if (!LEGACY_XFER_COLS.some(function (c) { return idx.t.header.indexOf(c) >= 0; })) {
    console.log('日報DBに旧8列はありません。移すものはありません');
    return 0;
  }

  idx.t.rows.forEach(function (r) {
    if (String(r['店舗コード']) !== CFG.STORE_CODE) return;
    const iso = fmt_(r['日付']);
    if (!iso) return;
    if (xi.map[iso] && xi.map[iso].length) return;    // すでに移してある

    const one = {};
    let any = false;
    XFER_MAP.forEach(function (m) {
      one[m.key] = String(r[m.col] || '').trim();
      if (one[m.key]) any = true;
    });
    if (any) moved.push({ iso: iso, row: r._row, one: one });
  });

  if (!moved.length) {
    console.log('移すものはありませんでした');
    return 0;
  }

  moved.forEach(function (x) {
    writeXfers_(x.iso, [x.one], '移行');
    const patch = {};
    LEGACY_XFER_COLS.forEach(function (c) {
      if (idx.t.header.indexOf(c) >= 0) patch[c] = '';
    });
    writeRow_(idx.t, x.row, patch);
    console.log('  ' + x.iso + '  ' + xferOne_(x.one));
  });

  console.log(moved.length + ' 件を「' + SH.XFER + '」シートへ移しました');
  audit_('譲渡記録を別シートへ移行', moved.length + ' 件', '');
  return moved.length;
}

/* ------------------------------------------------------------
 *  ブックを新しい形に合わせる
 *
 *  Code.gs を貼り替えたあと、これを1回実行すれば済むようにしてあります。
 *  シートの作成・列の追加・書式・データの移行を、正しい順番で通します。
 *  何度実行しても同じ結果になります(済んでいるものは飛ばします)。
 * ---------------------------------------------------------- */

/**
 * ★ Code.gs を新しくしたら、これを1回実行してください。
 *
 *    やること
 *      1. 足りないシートを作る
 *      2. 足りない列を足す
 *      3. 日付の列を文字列書式にする(タイムゾーンで1日ずれるのを防ぐ)
 *      4. 印影フォルダを用意する
 *      5. 古い形のデータを新しい置き場所へ移す
 *      6. 残っている手作業を知らせる
 */
function updateDatabase() {
  const out = [];
  const say = function (line) { out.push(line); console.log(line); };

  say('■ シート');
  Object.keys(SHEET_COLS).forEach(function (name) {
    const cols = SHEET_COLS[name];
    const had = !!ss_().getSheetByName(name);
    const missing = had ? missingColumns_(name, cols) : cols.slice();
    ensureSheet_(name, cols);
    SCHEMA_CHECKED[name] = true;
    if (!had) say('   ［' + name + '］作りました（' + cols.length + '列）');
    else if (missing.length) say('   ［' + name + '］列を追加: ' + missing.join('、'));
    else say('   ［' + name + '］そろっています');
  });

  say('');
  say('■ 日付の書式');
  formatTextColumn_(SH.DAILY, '日付');
  formatTextColumn_(SH.TERM,  '就任日');
  formatTextColumn_(SH.XFER,  '日付');
  say('   日報DB.日付 / 管理薬剤師任期.就任日 / 譲渡記録.日付 を文字列にしました');

  say('');
  say('■ 印影フォルダ');
  try {
    sealFolder_();
    say('   ' + CFG.SEAL_FOLDER_NAME + '（共有しないでください）');
  } catch (e) {
    say('   用意できませんでした: ' + e);
  }

  say('');
  say('■ 譲渡記録の移行');
  const moved = migrateXfers();
  if (!moved) say('   移すものはありませんでした');

  say('');
  say('■ 残っていること');
  const t = table_(SH.DAILY);
  const legacy = LEGACY_XFER_COLS.filter(function (c) { return t.header.indexOf(c) >= 0; });
  if (legacy.length) {
    say('   日報DBに古い列が ' + legacy.length + ' つ残っています: ' + legacy.join('、'));
    say('   中身は移し終えているので、dropLegacyXferColumns で落とせます');
  } else {
    say('   古い列はありません');
  }
  if (!ss_().getSheetByName(T_().SHEET)) {
    say('   帳票テンプレートがありません。buildTemplate を実行してください');
  }

  say('');
  say('おわり。デプロイし直すと画面にも反映されます。');
  audit_('ブックを新しい形に合わせた',
    (moved ? '譲渡記録を ' + moved + ' 件移行' : '移行なし'), '');
  return out.join('\n');
}

/**
 * ★ 移行のあとで、日報DBに残っている古い8列を落とします。
 *
 *    中身が1つでも残っている列は落としません(先に updateDatabase を実行してください)。
 *    列を消すと元に戻せないので、実行前にブックのコピーを取っておくと安心です。
 */
function dropLegacyXferColumns() {
  const t = table_(SH.DAILY);
  const present = LEGACY_XFER_COLS.filter(function (c) { return t.header.indexOf(c) >= 0; });
  if (!present.length) {
    console.log('古い列はありません');
    return 0;
  }

  // 1つでも中身が残っていたら触らない
  const left = present.filter(function (c) {
    return t.rows.some(function (r) { return String(r[c] || '').trim(); });
  });
  if (left.length) {
    console.log('★ まだ中身が残っている列があります: ' + left.join('、'));
    console.log('   先に updateDatabase を実行して、譲渡記録へ移してください');
    return 0;
  }

  // 右から消す(左から消すと、そのたびに列番号がずれる)
  present.map(function (c) { return t.header.indexOf(c) + 1; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (col) { t.sh.deleteColumn(col); });

  console.log(present.length + ' 列を落としました: ' + present.join('、'));
  audit_('日報DBの古い列を削除', present.join('、'), '');
  return present.length;
}

/** 期限切れの編集ロックを掃除する。1日1回のトリガーに入れておくと安心 */
function sweepStaleLocks() {
  const idx = dailyIndex_();
  let n = 0;
  idx.t.rows.forEach(function (r) {
    if (String(r['状態'] || '') !== '') return;
    const started = r['編集開始'];
    if (!started) return;
    if ((Date.now() - new Date(started).getTime()) / 60000 >= CFG.LOCK_MINUTES) {
      writeRow_(idx.t, r._row, { '編集者': '', '編集開始': '' });
      n++;
    }
  });
  console.log('編集ロックを ' + n + ' 件解除しました');
}

/* ############################################################
   6. 週次帳票の出力
   ############################################################ */

const PRINT = {
  JOB_KEY: 'PRINT_JOB',
  RATE_KEY: 'EXPORT_SEC_PER_WEEK',   // 1週あたりの実測(次回の見込みに使う)
  OUT_FOLDER: '業務日報_出力',
  TIME_BUDGET_MS: 4.5 * 60 * 1000,   // 6分の上限に対して余裕を取る
  DAY_ROWS: 7
};

/** テンプレートの寸法。設定(CFG.TEMPLATE)を見にいくだけの入口 */
function T_() { return CFG.TEMPLATE; }

function templateSheet_() {
  const sh = ss_().getSheetByName(T_().SHEET);
  if (!sh) {
    throw new Error('「' + T_().SHEET + '」シートがありません。'
      + '帳票のシートを用意して、この名前にしてください');
  }
  return sh;
}

/* ============================================================
 *  1. テンプレートを作る
 * ============================================================
 *  手で組んだシートをそのまま使うこともできますが、
 *  この関数で同じものを作り直せます。
 *  文言・列幅・行高はすべて CFG.TEMPLATE にあります。
 * ========================================================== */

/** ★ 帳票テンプレートのシートを作る。既にあれば退避してから作り直します */
function buildTemplate() {
  const t = T_();
  const ss = ss_();
  const C = t.COL;

  // 既存のテンプレートは消さずに名前を変えて残す(手で直した分を失わないため)
  const old = ss.getSheetByName(t.SHEET);
  if (old) {
    const stamp = Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd_HHmm');
    old.setName(t.SHEET + '_旧' + stamp);
    Logger.log('既存のテンプレートを「' + old.getName() + '」に退避しました');
  }

  const sh = ss.insertSheet(t.SHEET);
  const totalRows = t.HEAD_ROWS + PRINT.DAY_ROWS * t.ROWS_PER_DAY;

  // 余分な行と列を落として、印刷範囲をぴったりにする
  if (sh.getMaxColumns() > t.COLS) sh.deleteColumns(t.COLS + 1, sh.getMaxColumns() - t.COLS);
  if (sh.getMaxRows() > totalRows) sh.deleteRows(totalRows + 1, sh.getMaxRows() - totalRows);

  t.WIDTH.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  /* ---- 見出し(2行) ---- */
  mergeSet_(sh, 1, C.DATE, t.HEAD_ROWS, 1, t.HEADER.DATE);
  mergeSet_(sh, 1, C.RX,   1, 2, t.HEADER.RX);      // B:C
  mergeSet_(sh, 1, C.INQ,  1, 2, t.HEADER.INQ);     // D:E
  sh.getRange(1, C.MGMT).setValue(t.HEADER.NOTE);             // F
  mergeSet_(sh, 1, C.ROOM_T, 1, 2, t.HEADER.ROOM);  // G:H
  mergeSet_(sh, 1, C.COLD_T, 1, 2, t.HEADER.COLD);  // I:J
  sh.getRange(1, C.ADMIN).setValue(t.HEADER.ADMIN);
  sh.getRange(1, C.STAFF).setValue(t.HEADER.STAFF);

  // 2行目は譲渡記録の内訳。B〜L をひと続きに
  mergeSet_(sh, 2, C.NOTE, 1, t.COLS - C.NOTE + 1, t.HEADER.NOTE_SUB);

  sh.getRange(1, 1, t.HEAD_ROWS, t.COLS)
    .setBackground(t.HEAD_BG).setFontWeight('bold').setFontSize(9)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sh.getRange(2, C.NOTE).setFontWeight('normal').setFontSize(7.5);
  sh.setRowHeight(1, t.ROW_H.HEAD1);
  sh.setRowHeight(2, t.ROW_H.HEAD2);

  /* ---- 各日(1日 = 2行) ---- */
  for (let i = 0; i < PRINT.DAY_ROWS; i++) {
    const r1 = t.HEAD_ROWS + 1 + i * t.ROWS_PER_DAY;
    const r2 = r1 + 1;

    sh.setRowHeight(r1, t.ROW_H.UPPER);
    sh.setRowHeight(r2, t.ROW_H.LOWER);

    // 日付は2行ぶち抜き
    sh.getRange(r1, C.DATE, t.ROWS_PER_DAY, 1).merge()
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setWrap(true).setFontSize(9);

    // 下段は「処方箋枚数」から「担当者印」までひと続き
    sh.getRange(r2, C.NOTE, 1, t.COLS - C.NOTE + 1).merge()
      .setHorizontalAlignment('left').setVerticalAlignment('middle')
      .setWrap(true).setFontSize(8);

    // 数値のセル
    [C.RX, C.INQ].forEach(function (c) {
      sh.getRange(r1, c).setHorizontalAlignment('right')
        .setVerticalAlignment('middle').setFontSize(11);
    });
    // 単位の固定文字(C列・E列)
    sh.getRange(r1, C.RX + 1).setValue(t.UNIT_TEXT.RX);
    sh.getRange(r1, C.INQ + 1).setValue(t.UNIT_TEXT.INQ);
    [C.RX + 1, C.INQ + 1].forEach(function (c) {
      sh.getRange(r1, c).setHorizontalAlignment('left')
        .setVerticalAlignment('middle').setFontSize(8);
    });

    // 温湿度。未記入のときの下地を置き、表示形式で単位を付ける
    [[C.ROOM_T, t.FMT.TEMP,  t.PLACEHOLDER.TEMP],
     [C.ROOM_H, t.FMT.HUMID, t.PLACEHOLDER.HUMID],
     [C.COLD_T, t.FMT.TEMP,  t.PLACEHOLDER.TEMP],
     [C.COLD_H, t.FMT.HUMID, t.PLACEHOLDER.HUMID]].forEach(function (x) {
      sh.getRange(r1, x[0]).setValue(x[2]).setNumberFormat(x[1])
        .setHorizontalAlignment('right').setVerticalAlignment('middle').setFontSize(9);
    });

    // 押印
    [C.ADMIN, C.STAFF].forEach(function (c) {
      sh.getRange(r1, c).setHorizontalAlignment('center').setVerticalAlignment('middle');
    });
  }

  sh.getRange(1, 1, totalRows, t.COLS)
    .setBorder(true, true, true, true, true, true, t.RULE, SpreadsheetApp.BorderStyle.SOLID);

  sh.setHiddenGridlines(true);
  ss.setActiveSheet(sh);

  Logger.log('「' + t.SHEET + '」を作りました（' + totalRows + '行 × ' + t.COLS + '列）。');
  Logger.log('罫線や列幅を微調整したい場合は、このシートを直接いじってください。');
  Logger.log('出力時はこのシートをコピーして値を流し込むので、書式はそのまま引き継がれます。');
  return checkTemplate();
}

/** 結合して値を入れる小道具 */
function mergeSet_(sh, row, col, nRows, nCols, value) {
  const r = sh.getRange(row, col, nRows, nCols);
  if (nRows > 1 || nCols > 1) r.merge();
  r.setValue(value);
  return r;
}

/* ============================================================
 *  1b. テンプレートの確認
 * ========================================================== */

/** テンプレートの形を確認する。ずれていれば何が違うかを表示します */
function checkTemplate() {
  const t = T_();
  const sh = templateSheet_();
  const need = t.HEAD_ROWS + PRINT.DAY_ROWS * t.ROWS_PER_DAY;
  const msg = [];

  msg.push('シート名 : ' + t.SHEET);
  msg.push('必要な行数 : ' + need + ' 行（見出し ' + t.HEAD_ROWS
    + ' 行 ＋ 7日 × ' + t.ROWS_PER_DAY + ' 行）');
  msg.push('実際の行数 : ' + sh.getMaxRows() + ' 行');
  msg.push('必要な列数 : ' + t.COLS + ' 列 / 実際 : ' + sh.getMaxColumns() + ' 列');

  if (sh.getMaxRows() < need) msg.push('★ 行が足りません');
  if (sh.getMaxColumns() < t.COLS) msg.push('★ 列が足りません');

  msg.push('');
  msg.push('各日の書き込み先:');
  for (let i = 0; i < PRINT.DAY_ROWS; i++) {
    const r1 = t.HEAD_ROWS + 1 + i * t.ROWS_PER_DAY;
    msg.push('  ' + (i + 1) + '日目 … 上段 ' + r1 + ' 行 / 下段 ' + (r1 + 1) + ' 行');
  }
  Logger.log(msg.join('\n'));
  return msg.join('\n');
}

/** テンプレートに表示形式だけを流し込む(単位を書式で出したいとき用) */
function applyTemplateFormats() {
  const t = T_();
  const sh = templateSheet_();
  for (let i = 0; i < PRINT.DAY_ROWS; i++) {
    const r1 = t.HEAD_ROWS + 1 + i * t.ROWS_PER_DAY;
    sh.getRange(r1, t.COL.RX).setNumberFormat(t.FMT.RX);
    sh.getRange(r1, t.COL.INQ).setNumberFormat(t.FMT.INQ);
    sh.getRange(r1, t.COL.ROOM_T).setNumberFormat(t.FMT.TEMP);
    sh.getRange(r1, t.COL.ROOM_H).setNumberFormat(t.FMT.HUMID);
    sh.getRange(r1, t.COL.COLD_T).setNumberFormat(t.FMT.TEMP);
    sh.getRange(r1, t.COL.COLD_H).setNumberFormat(t.FMT.HUMID);
  }
  Logger.log('表示形式を設定しました（温度 ' + t.FMT.TEMP + ' / 湿度 ' + t.FMT.HUMID + '）');
}

/* ============================================================
 *  1c. テンプレートの実寸を読む
 * ============================================================
 *  画面のプレビューはこの寸法で描きます。
 *  シートの列幅や行高を変えれば、プレビューもそのまま追従します。
 * ========================================================== */

/** 列幅・行高・見出しの実際の値をまとめて返す */
function templateLayout_() {
  const t = T_();
  const sh = templateSheet_();
  const totalRows = t.HEAD_ROWS + PRINT.DAY_ROWS * t.ROWS_PER_DAY;

  const widths = [];
  for (let c = 1; c <= t.COLS; c++) widths.push(sh.getColumnWidth(c));

  const heights = [];
  for (let r = 1; r <= totalRows; r++) heights.push(sh.getRowHeight(r));

  // 見出しの実際の文字。結合されたセルは左上だけに文字が入るので、
  // 「空のセルは直前の見出しの続き」とみなして幅を復元します
  const row1 = sh.getRange(1, 1, 1, t.COLS).getDisplayValues()[0];
  const firstDay = t.HEAD_ROWS + 1;

  return {
    cols: t.COLS,
    headRows: t.HEAD_ROWS,
    rowsPerDay: t.ROWS_PER_DAY,
    widths: widths,
    heights: heights,
    row1: row1,
    sub: sh.getRange(t.HEAD_ROWS, t.COL.NOTE).getDisplayValue(),
    unitRx:  sh.getRange(firstDay, t.COL.RX + 1).getDisplayValue(),
    unitInq: sh.getRange(firstDay, t.COL.INQ + 1).getDisplayValue(),
    phTemp:  t.PLACEHOLDER.TEMP,
    phHumid: t.PLACEHOLDER.HUMID,
    col: t.COL
  };
}

/**
 * ★ いまのテンプレートの寸法を書き出す。
 *    実行ログに、そのまま CFG.TEMPLATE に貼れる形で出ます。
 */
function dumpTemplateLayout() {
  const t = T_();
  const sh = templateSheet_();
  const totalRows = t.HEAD_ROWS + PRINT.DAY_ROWS * t.ROWS_PER_DAY;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const out = [];

  out.push('■ 列幅');
  const widths = [];
  for (let c = 1; c <= t.COLS; c++) {
    const w = sh.getColumnWidth(c);
    widths.push(w);
    out.push('  ' + A[c - 1] + '列 : ' + w + ' px');
  }

  out.push('');
  out.push('■ 行の高さ');
  const heights = [];
  for (let r = 1; r <= totalRows; r++) {
    const h = sh.getRowHeight(r);
    heights.push(h);
    const label = r <= t.HEAD_ROWS
      ? '見出し' + r
      : (Math.floor((r - t.HEAD_ROWS - 1) / t.ROWS_PER_DAY) + 1) + '日目'
        + ((r - t.HEAD_ROWS - 1) % t.ROWS_PER_DAY === 0 ? ' 上段' : ' 下段');
    out.push('  ' + r + '行目 (' + label + ') : ' + h + ' px');
  }

  out.push('');
  out.push('■ 合計 : 幅 ' + widths.reduce(function (a, b) { return a + b; }, 0)
    + ' px / 高さ ' + heights.reduce(function (a, b) { return a + b; }, 0) + ' px');
  out.push('  ※ A4横の印刷可能幅はおよそ 1030px 相当（余白0.4インチのとき）');

  out.push('');
  out.push('■ CFG.TEMPLATE に貼れる形');
  out.push('    WIDTH: [' + widths.join(', ') + '],');
  out.push('    ROW_H: { HEAD1: ' + heights[0] + ', HEAD2: ' + heights[1]
    + ', UPPER: ' + heights[t.HEAD_ROWS] + ', LOWER: ' + heights[t.HEAD_ROWS + 1] + ' },');

  // 日ごとに高さが違えばそれも知らせる
  const uppers = [], lowers = [];
  for (let i = 0; i < PRINT.DAY_ROWS; i++) {
    uppers.push(heights[t.HEAD_ROWS + i * t.ROWS_PER_DAY]);
    lowers.push(heights[t.HEAD_ROWS + i * t.ROWS_PER_DAY + 1]);
  }
  const uniq = function (a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); };
  if (uniq(uppers).length > 1 || uniq(lowers).length > 1) {
    out.push('');
    out.push('★ 日によって行の高さが違います（上段 ' + uniq(uppers).join('/')
      + ' / 下段 ' + uniq(lowers).join('/') + '）。');
    out.push('  buildTemplate() で作り直すと、すべて同じ高さに揃います。');
  }

  const text = out.join('\n');
  Logger.log(text);
  return text;
}

/* ============================================================
 *  2. 1週間分の流し込み
 * ========================================================== */

/** 帳票用に整えた1週間分のデータ(画面のプレビューでも使う) */
function weekRows_(startIso, idx, terms, xi) {
  const rows = [];
  for (let i = 0; i < PRINT.DAY_ROWS; i++) {
    const iso = addDays_(startIso, i);
    const d = toDay_(iso, idx.map[iso], terms, xi);
    rows.push({
      date: iso,
      dow: d.dow,
      hours: CFG.BUSINESS_HOURS,
      rx: d.rx, inquiry: d.inquiry,
      note: d.note,          // 上段F列。管理に関する事項
      xfers: xferLines_(d),  // 下段。譲渡・譲受記録(0件以上)
      roomTemp: d.roomTemp, roomHumid: d.roomHumid,
      coldTemp: d.coldTemp, coldHumid: d.coldHumid,
      filled: d.state !== 'empty' && d.state !== 'editing',
      approved: d.state === 'approved',
      admin: sealOwnerAdmin_(d),
      staff: d.staff
    });
  }
  return rows;
}

/** 譲渡記録1件を、帳票の1行ぶんの文字列にする */
function xferOne_(x) {
  return XFER_MAP.map(function (m) { return String((x && x[m.key]) || '').trim(); })
    .filter(function (v) { return v; }).join('／');
}

/** その日の譲渡記録を、帳票の下段に出す行の配列にする */
function xferLines_(d) {
  return (d.xfers || []).map(xferOne_).filter(function (v) { return v; });
}

/**
 * 管理者印に押す人。
 *
 * 承認した人がいればその人、いなければその日に在任している管理薬剤師です。
 * 管理者印は運用上「毎日押されるもの」なので、記録の有無や承認の有無で
 * 押す押さないを判定しません。
 *
 * 結果として、管理薬剤師の交代日をまたがない限り、どの週も管理者印の
 * 並びが同じになります。sealBase_ がそれを見て、押し終えたシートを
 * 期間まるごと使い回します。
 */
function sealOwnerAdmin_(d) {
  if (d.admin) return d.admin;
  if (!CFG.SEAL_POLICY.ADMIN_EVERY_DAY) return '';
  return d.chief;
}

function outOfRange_(v, range) {
  return !!(range && v !== null && (v < range[0] || v > range[1]));
}

/**
 * テンプレートをコピーして1週間分を書き込み、そのシートを返す。
 * 記録のない日はテンプレートの見た目を残します(白紙のまま印刷できるように)。
 */
/**
 * 印影を置く位置の計算に使う寸法。
 * テンプレートで決まっていて週ごとに変わらないので、出力の最初に1回だけ読みます。
 * これを1コマごとに読むと、書き込みの列に読み取りが割り込み、
 * そのたびにシートへの反映待ちが起きて目に見えて遅くなります。
 */
function stampGeometry_(tpl) {
  const t = T_();
  const sh = tpl || templateSheet_();
  const colW = {};
  [t.COL.STAFF, t.COL.ADMIN].forEach(function (c) { colW[c] = sh.getColumnWidth(c); });
  const rowH = {};
  for (let i = 0; i < PRINT.DAY_ROWS; i++) {
    const r = t.HEAD_ROWS + 1 + i * t.ROWS_PER_DAY;
    rowH[r] = sh.getRowHeight(r);
  }
  return { colW: colW, rowH: rowH };
}

/**
 * 1週間ぶんを流し込む。
 *
 * 値の書き込みと印影の貼り付けを分けてあります。
 * 印影は1枚ずつシートと往復し、しかも保留していた書き込みを
 * その場で反映させるため、混ぜて書くと値の反映が日数ぶんに分断されます。
 * 先に値をぜんぶ書いて1回で反映させ、そのあと印影を貼ります。
 *
 * @param {Object}  done      複製元で押し済みか {adminDone, staffDone}
 * @param {Object}  timing    渡すと、処理ごとの所要時間(ミリ秒)を書き込みます
 */
function renderWeekSheet_(target, startIso, rows, seals, geo, tpl, done, timing) {
  const adminDone = !!(done && done.adminDone);
  const staffDone = !!(done && done.staffDone);
  const t = T_();
  const R = CFG.RANGES;
  const mark = function (key, from) {
    if (timing) timing[key] = (timing[key] || 0) + (Date.now() - from);
  };

  /* ---- 1. テンプレートを複製する ---- */
  let t0 = Date.now();
  const sh = (tpl || templateSheet_()).copyTo(target);
  sh.setName(startIso);
  sh.showSheet();
  mark('copy', t0);

  /* ---- 2. 値をぜんぶ書く(まとめて1回で反映させる) ----
   *
   *  セルを1つずつ書かず、隣り合う列をまとめて setValues で書きます。
   *  まとめられるのは結合されていない範囲だけなので、次の2かたまりです。
   *    B〜E … 処方箋枚数・疑義照会と、その単位
   *    G〜J … 調剤室と冷所の温湿度
   *  日付(A)は2行ぶち抜き、管理に関する事項(下段B〜L)も結合されているので、
   *  こちらは左上のセルに1つずつ書きます。 */
  t0 = Date.now();
  const keepBlank = t.KEEP_BLANK_PLACEHOLDER;
  // 値が無いときは、テンプレートの下地(℃　/ や %)をそのまま書き戻す
  const orBlank = function (v, ph) {
    if (v !== null && v !== undefined && v !== '') return v;
    return keepBlank ? ph : '';
  };

  rows.forEach(function (r, i) {
    const r1 = t.HEAD_ROWS + 1 + i * t.ROWS_PER_DAY;
    const r2 = r1 + 1;

    // 日付(2行ぶち抜きのセル)
    sh.getRange(r1, t.COL.DATE).setValue(
      r.date.replace(/-/g, '/') + '\n' + r.dow + '\n' + r.hours);

    // 処方箋枚数・疑義照会と、その単位(B〜E)。
    // 単位はテンプレートと同じ文字を書き戻すので、見た目は変わりません
    sh.getRange(r1, t.COL.RX, 1, t.COL.INQ + 1 - t.COL.RX + 1)
      .setValues([[
        orBlank(r.filled ? r.rx : null, ''), t.UNIT_TEXT.RX,
        orBlank(r.filled ? r.inquiry : null, ''), t.UNIT_TEXT.INQ
      ]])
      .setNumberFormats([[t.FMT.RX, '@', t.FMT.INQ, '@']]);

    // 温湿度(G〜J)
    const temp = sh.getRange(r1, t.COL.ROOM_T, 1, t.COL.COLD_H - t.COL.ROOM_T + 1);
    temp.setValues([[
      orBlank(r.roomTemp,  t.PLACEHOLDER.TEMP),
      orBlank(r.roomHumid, t.PLACEHOLDER.HUMID),
      orBlank(r.coldTemp,  t.PLACEHOLDER.TEMP),
      orBlank(r.coldHumid, t.PLACEHOLDER.HUMID)
    ]]).setNumberFormats([[t.FMT.TEMP, t.FMT.HUMID, t.FMT.TEMP, t.FMT.HUMID]]);

    // 管理基準を外れた値は赤字にする(逸脱を目立たせるため)。
    // 逸脱が1つも無い日は、テンプレートの書式のまま触りません
    const bad = [
      outOfRange_(r.roomTemp,  R.ROOM_TEMP),
      outOfRange_(r.roomHumid, R.ROOM_HUMID),
      outOfRange_(r.coldTemp,  R.COLD_TEMP),
      outOfRange_(r.coldHumid, R.COLD_HUMID)
    ];
    if (bad.some(function (x) { return x; })) {
      temp.setFontColors([bad.map(function (x) { return x ? ALERT_RED : '#000000'; })])
          .setFontWeights([bad.map(function (x) { return x ? 'bold' : 'normal'; })]);
    }

    // 上段F。管理に関する事項(その日の特記事項)
    if (r.note) sh.getRange(r1, t.COL.MGMT).setValue(r.note);

    // 下段(B〜Lが結合されている)。譲渡・譲受記録。何件でも1つのセルに並べる
    if (r.xfers && r.xfers.length) {
      sh.getRange(r2, t.COL.NOTE).setValue(r.xfers.join('\n'));
    }
  });

  // いちばん外側の罫線は、PDFにすると切り取り線の真上に来て削られます
  // （四隅が欠けて見える原因）。少し太くしておくと欠けずに残ります。
  // 内側の罫線は null を渡して触りません。
  sh.getRange(1, 1, t.HEAD_ROWS + PRINT.DAY_ROWS * t.ROWS_PER_DAY, t.COLS)
    .setBorder(true, true, true, true, null, null,
               t.RULE, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  SpreadsheetApp.flush();          // ここまでを1回で反映させる
  mark('values', t0);

  /* ---- 3. 印影を貼る(ここが出力時間のほとんど) ---- */
  t0 = Date.now();
  let n = 0;
  rows.forEach(function (r, i) {
    const r1 = t.HEAD_ROWS + 1 + i * t.ROWS_PER_DAY;
    if (!adminDone && stampCell_(sh, r1, t.COL.ADMIN, seals[r.admin], geo)) n++;
    if (!staffDone && stampCell_(sh, r1, t.COL.STAFF, seals[r.staff], geo)) n++;
  });
  mark('seals', t0);
  if (timing) timing.sealCount = (timing.sealCount || 0) + n;

  return sh;
}

/**
 * 管理者印を押し終えた「下ごしらえのシート」を作って使い回す。
 *
 * 管理者印はその週の7日ぶんが同じ並びになることがほとんどです。
 * 1コマずつ押すと1週あたり7枚ぶん往復しますが、押し終えたシートを
 * 複製すれば、2週目からは0枚で済みます。
 *
 * 複製で画像が引き継がれるかは環境しだいなので、最初に1度だけ
 * 実際に複製して確かめ、駄目なら1コマずつ押す方式に戻します。
 */
/**
 * その週の押印の並び。同じ並びなら、押し終えたシートを使い回せます。
 *
 * 押す場所は曜日で決まっている(1日目は3行目、2日目は5行目…)ので、
 * 「誰の印がどの位置に来るか」は名前を並べただけで言い表せます。
 *
 *   admin … 管理者印の並びだけ。管理薬剤師は交代しない限り毎日同じ
 *   full  … 担当者印もあわせた並び。曜日ごとの担当が毎週同じなら一致する
 */
function sealKeys_(rows) {
  const a = rows.map(function (r) { return r.admin || ''; }).join('|');
  const b = rows.map(function (r) { return r.staff || ''; }).join('|');
  return { admin: a, full: a + '#' + b };
}

/**
 * 押印を済ませた「下ごしらえのシート」を作って使い回す。
 *
 * 印影の貼り付けは1枚ずつシートと往復するため、ここが出力時間のほとんどです。
 * 押す位置は曜日で決まっているので、同じ並びの週なら押し終えたシートを
 * 複製するだけで済みます。
 *
 *   ・担当者印まで一致する週があるなら、1週ぶん14枚を丸ごと引き継ぐ
 *   ・そこまで一致しなくても、管理者印7枚だけは引き継げることが多い
 *
 * 1度しか出てこない並びには作りません(複製1回ぶん損になるため)。
 * 複製で画像が引き継がれるかは環境しだいなので、最初に1枚だけ押して
 * 確かめ、駄目なら1コマずつ押す方式へ自動で戻ります。
 */
function sealBase_(temp, tpl, rows, seals, geo, cache) {
  const none = { sheet: tpl, adminDone: false, staffDone: false };
  if (!cache.ok) return none;

  const k = sealKeys_(rows);

  // すでに作ってあるものを優先する
  if (cache.map[k.full])  return { sheet: cache.map[k.full],  adminDone: true, staffDone: true };
  if (cache.map[k.admin]) return { sheet: cache.map[k.admin], adminDone: true, staffDone: false };

  // 担当者印まで一致する週が2回以上あるなら、そちらで作る
  const withStaff = (cache.count[k.full] || 0) >= 2;
  const key = withStaff ? k.full : k.admin;
  if (!withStaff && (cache.count[k.admin] || 0) < 2) return none;

  const t = T_();
  const rowAt = function (i) { return t.HEAD_ROWS + 1 + i * t.ROWS_PER_DAY; };

  // 押す順番を先に組み立てる。押すものが無いなら下ごしらえの意味がない
  const plan = [];
  rows.forEach(function (r, i) {
    if (seals[r.admin]) plan.push({ i: i, at: t.COL.ADMIN, blob: seals[r.admin] });
    if (withStaff && seals[r.staff]) plan.push({ i: i, at: t.COL.STAFF, blob: seals[r.staff] });
  });
  if (!plan.length) return none;

  const base = tpl.copyTo(temp);
  base.setName('_b' + Utilities.getUuid().slice(0, 8));

  // まず1枚だけ押して、複製で引き継がれるか確かめる(無駄打ちを1枚に抑える)
  stampCell_(base, rowAt(plan[0].i), plan[0].at, plan[0].blob, geo);

  if (!cache.checked) {
    cache.checked = true;
    const probe = base.copyTo(temp);
    const kept = probe.getImages().length;
    temp.deleteSheet(probe);
    if (!kept) {
      console.warn('複製では印影が引き継がれないため、1コマずつ押す方式に切り替えます');
      cache.ok = false;
      temp.deleteSheet(base);
      return none;
    }
  }

  for (let n = 1; n < plan.length; n++) {
    stampCell_(base, rowAt(plan[n].i), plan[n].at, plan[n].blob, geo);
  }
  base.hideSheet();

  cache.map[key] = base;
  return { sheet: base, adminDone: true, staffDone: withStaff };
}

/** 管理基準を外れた値の文字色 */
const ALERT_RED = '#c42a26';

/** セルの中央に印影を置く。
 *  列幅・行の高さはシートから読むので、テンプレートを直しても中央のままです */
function stampCell_(sh, row, col, blob, geo) {
  if (!blob) return false;
  // 寸法は stampGeometry_ で先に読んである。無いときだけその場で読む
  const cw = (geo && geo.colW[col]) || sh.getColumnWidth(col);
  const ch = (geo && geo.rowH[row]) || sh.getRowHeight(row);
  const size = Math.max(16, Math.min(cw, ch) - 6);   // セルからはみ出さない大きさ
  const img = sh.insertImage(blob, col, row,
                             Math.round((cw - size) / 2),
                             Math.round((ch - size) / 2));
  img.setWidth(size).setHeight(size);
  return true;
}

/* ============================================================
 *  3. 画面用のプレビュー
 * ========================================================== */

/** 指定週の帳票プレビュー用データを返す */
function getPrintPreview(anchorIso) {
  return guard_('getPrintPreview', function () {
    const start = weekStart_(anchorIso ? fmt_(anchorIso) : today_());
    const rows = weekRows_(start, dailyIndex_(), termList_(), xferIndex_());
    const seals = {};
    staffList_().forEach(function (s) {
      if (s.sealFileId) seals[s.name] = sealDataUrl_(s.sealFileId);
    });
    return {
      store: CFG.STORE_NAME,
      start: start,
      end: addDays_(start, 6),
      hours: CFG.BUSINESS_HOURS,
      ranges: CFG.RANGES,
      rows: rows,
      seals: seals,
      hasTemplate: !!ss_().getSheetByName(T_().SHEET),
      layout: ss_().getSheetByName(T_().SHEET) ? templateLayout_() : null
    };
  });
}

/* ============================================================
 *  4. 期間指定の一括出力(数週間ずつ)
 * ========================================================== */

/** 期間に含まれる週の開始日を並べる */
function weeksBetween_(fromIso, toIso) {
  const out = [];
  let w = weekStart_(fromIso);
  const last = weekStart_(toIso);
  let guard = 0;
  while (w <= last && guard++ < 400) {
    out.push(w);
    w = addDays_(w, 7);
  }
  return out;
}

/**
 * 出力を始める。実際の処理は runExportChunk を繰り返し呼んで進めます。
 * @param {Object} p {from:'yyyy-MM-dd', to:'yyyy-MM-dd', title:'2026年8月分'}
 */
function startExport(p) {
  return guard_('startExport', function () { return startExport_(p); });
}

/** 出力の開始そのもの。月次の確定(startFreeze)からも呼びます */
function startExport_(p) {
  {
    // 出力先の一時ファイルはジョブ1件ぶんしか覚えられない。
    // 走っているうちに次を始めると、前の一時ファイルが行方不明になる
    const cur = currentJob_();
    if (cur && cur.state === 'running') {
      throw new Error('別の出力を実行中です（' + cur.from + ' 〜 ' + cur.to
        + '）。終わるのを待つか、いったん中止してください');
    }

    const from = fmt_(p.from), to = fmt_(p.to);
    if (!from || !to) throw new Error('期間が正しくありません');
    if (from > to) throw new Error('開始日が終了日より後になっています');
    if (!ss_().getSheetByName(T_().SHEET)) {
      throw new Error('「' + T_().SHEET + '」シートがありません。帳票のシートを用意してください');
    }

    const weeks = weeksBetween_(from, to);
    if (!weeks.length) throw new Error('対象の週がありません');
    if (weeks.length > 60) throw new Error('一度に出力できるのは60週までです。期間を分けてください');

    // 出力先の一時スプレッドシート(最後にPDFにしてから捨てる)
    const title = p.title || (from + '_' + to + '_業務日報');
    const temp = SpreadsheetApp.create(title);
    temp.getSheets()[0].setName('_');   // 既定シートは最後に消す

    const job = {
      from: from, to: to, title: title,
      weeks: weeks, done: 0,
      tempId: temp.getId(),
      actor: String(p.actor || ''),
      startedAt: new Date().toISOString(),
      state: 'running', pdfUrl: '', message: ''
    };
    PROP.setProperty(PRINT.JOB_KEY, JSON.stringify(job));
    audit_('帳票の出力を開始', from + ' 〜 ' + to + '（' + weeks.length + '週）', p.actor);
    return job;
  }
}

/** 続きを処理する。時間が来たら止まるので、完了まで繰り返し呼びます */
function runExportChunk() {
  return guard_('runExportChunk', function () {
    const job = currentJob_();
    if (!job || job.state !== 'running') return job;

    const t0 = Date.now();
    const temp = SpreadsheetApp.openById(job.tempId);
    const idx = dailyIndex_();
    const terms = termList_();
    const xi = xferIndex_();               // 譲渡記録も1回だけ読む
    const seals = sealBlobMap_();          // 印影は1回だけ読む(ここが効く)
    const tpl = templateSheet_();          // テンプレートの引き直しも1回に
    const geo = stampGeometry_(tpl);       // 印影を置く寸法も1回に

    // 管理者印を押し終えた下ごしらえシート。同じ並びの週で使い回す。
    // どの並びが何回出るかを先に数えておき、2回以上のものだけ用意します
    // (1回きりなら、下ごしらえの複製ぶんだけ損になるため)
    const base = { ok: !!CFG.SEAL_POLICY.REUSE_ADMIN_STAMP, checked: false, map: {}, count: {} };
    for (let i = job.done; i < job.weeks.length; i++) {
      const k = sealKeys_(weekRows_(job.weeks[i], idx, terms, xi));
      base.count[k.admin] = (base.count[k.admin] || 0) + 1;
      base.count[k.full]  = (base.count[k.full]  || 0) + 1;
    }

    try {
      while (job.done < job.weeks.length && Date.now() - t0 < PRINT.TIME_BUDGET_MS) {
        const w = job.weeks[job.done];
        const rows = weekRows_(w, idx, terms, xi);
        const b = sealBase_(temp, tpl, rows, seals, geo, base);
        renderWeekSheet_(temp, w, rows, seals, geo, b.sheet, b);
        job.done++;
        PROP.setProperty(PRINT.JOB_KEY, JSON.stringify(job));
      }

      if (job.done >= job.weeks.length) {
        finishExport_(job, temp);
      }
    } catch (err) {
      // 途中で落ちたまま放っておくと、一時ファイルがドライブに残り、
      // ジョブも running のままで次の出力を始められなくなる
      job.state = 'error';
      job.message = String(err && err.message ? err.message : err);
      trashTemp_(job);
      PROP.setProperty(PRINT.JOB_KEY, JSON.stringify(job));
      throw err;
    }
    return job;
  });
}

/**
 * 1週あたりに何秒かかったかを覚えておく。
 * 次に出力を始めるとき「およそ○分かかります」と先に出すために使います。
 * 極端な値は捨て、前回の値と半分ずつ混ぜてならします。
 *
 * 画面から出したときは往復の待ちも含んだ実測、エディタから手で
 * 実行したときは含まれません。あくまで目安として扱ってください。
 */
function rememberRate_(job) {
  try {
    const weeks = (job.weeks || []).length;
    if (!weeks || !job.startedAt) return;
    const sec = (Date.now() - new Date(job.startedAt).getTime()) / 1000 / weeks;
    if (!isFinite(sec) || sec <= 0 || sec > 600) return;
    const prev = Number(PROP.getProperty(PRINT.RATE_KEY)) || 0;
    const next = prev ? (prev * 0.5 + sec * 0.5) : sec;
    PROP.setProperty(PRINT.RATE_KEY, String(Math.round(next * 10) / 10));
  } catch (e) {
    console.warn('出力の所要時間を覚えられませんでした: ' + e);
  }
}

/** 一時スプレッドシートを捨てる。成否にかかわらず必ず通す */
function trashTemp_(job) {
  if (!job || !job.tempId) return;
  try {
    DriveApp.getFileById(job.tempId).setTrashed(true);
  } catch (e) {
    console.warn('一時ファイルを片づけられませんでした: ' + e);
  }
  job.tempId = '';
}

/** すべての週が終わったらPDFにして、一時ファイルを片づける */
function finishExport_(job, temp) {
  try {
    // 既定のシートと、下ごしらえ用のシート(_で始まる)をすべて消す
    temp.getSheets().forEach(function (x) {
      if (String(x.getName()).charAt(0) === '_') temp.deleteSheet(x);
    });
    SpreadsheetApp.flush();

    const pdf = exportPdf_(job.tempId, job.title);
    const folder = (job.kind === 'freeze')
      ? outFolderFor_(job.month.slice(0, 4))
      : outFolder_();
    const file = folder.createFile(pdf);

    job.state = 'done';
    job.pdfUrl = file.getUrl();
    job.finishedAt = new Date().toISOString();
    rememberRate_(job);        // 次に出すときの「およそ何分」に使う

    if (job.kind === 'freeze') {
      recordFix_(job, file);   // 確定台帳に版として残す
    } else {
      audit_('帳票を出力', job.title + '（' + job.weeks.length + '週）', job.actor || '');
    }
  } catch (e) {
    job.state = 'error';
    job.message = String(e && e.message ? e.message : e);
    throw e;
  } finally {
    trashTemp_(job);
    PROP.setProperty(PRINT.JOB_KEY, JSON.stringify(job));
  }
}

/**
 * 帳票が紙に原寸で収まるかを調べる。
 * 収まるなら縮小をやめられます。縮小すると帳票の幅が
 * 「印刷できる幅」とぴったり同じになり、外枠が切り取り線の真上に来ます。
 */
function printFit_() {
  const t = T_();
  const cfg = CFG.PDF;
  const rows = t.HEAD_ROWS + PRINT.DAY_ROWS * t.ROWS_PER_DAY;

  let w = 0, h = 0;
  try {
    const sh = templateSheet_();
    for (let c = 1; c <= t.COLS; c++) w += sh.getColumnWidth(c);
    for (let r = 1; r <= rows; r++) h += sh.getRowHeight(r);
  } catch (e) {
    return null;
  }

  const pageW = cfg.LANDSCAPE ? 297 : 210;   // A4 (mm)
  const pageH = cfg.LANDSCAPE ? 210 : 297;
  const availW = (pageW / 25.4 - cfg.MARGIN_IN * 2) * 96;   // シートの1pxは1/96インチ
  const availH = (pageH / 25.4 - cfg.MARGIN_IN * 2) * 96;

  return {
    width: w, height: h,
    availW: availW, availH: availH,
    fits: (w + cfg.EDGE_GAP_PX <= availW) && (h + cfg.EDGE_GAP_PX <= availH),
    scale: Math.min(1, availW / w)
  };
}

/**
 * ★ 手で実行して、出力のどこに時間がかかっているかを測ります。
 *    1週間ぶんだけ作って、複製・値の書き込み・印影に分けて出します。
 *    速くしたいときは、まずこれで当たりを付けてください。
 */
function benchmarkExport() {
  const idx = dailyIndex_();
  const terms = termList_();
  const tpl = templateSheet_();
  const start = addDays_(weekStart_(today_()), -7);   // 先週(記録がある想定)

  let t0 = Date.now();
  const seals = sealBlobMap_();
  const tSeals = Date.now() - t0;

  t0 = Date.now();
  const geo = stampGeometry_(tpl);
  const tGeo = Date.now() - t0;

  t0 = Date.now();
  const temp = SpreadsheetApp.create('_ベンチマーク_' + stamp_());
  const tCreate = Date.now() - t0;

  try {
    const rows = weekRows_(start, idx, terms, xferIndex_());
    const timing = {};
    const base = { ok: !!CFG.SEAL_POLICY.REUSE_ADMIN_STAMP, checked: false, map: {}, count: {} };
    const k = sealKeys_(rows);
    base.count[k.admin] = 2;           // 実際の出力では使い回す前提で測る
    base.count[k.full]  = 2;

    t0 = Date.now();
    const b = sealBase_(temp, tpl, rows, seals, geo, base);
    const tBase = Date.now() - t0;

    renderWeekSheet_(temp, start, rows, seals, geo, b.sheet, b, timing);
    SpreadsheetApp.flush();

    const total = tSeals + tGeo + tCreate + tBase
      + (timing.copy || 0) + (timing.values || 0) + (timing.seals || 0);
    const pct = function (ms) { return Math.round(ms / total * 100) + '%'; };
    const line = function (label, ms) {
      console.log('   ' + label + ' … ' + (ms / 1000).toFixed(1) + '秒 (' + pct(ms) + ')');
    };

    console.log('■ 1週間ぶんの内訳（' + start + ' の週）');
    line('印影をDriveから読む  ', tSeals);
    line('テンプレートの寸法   ', tGeo);
    line('一時ファイルを作る   ', tCreate);
    line('管理者印の下ごしらえ ', tBase);
    line('テンプレートの複製   ', timing.copy || 0);
    line('値の書き込み         ', timing.values || 0);
    line('印影を貼る           ', timing.seals || 0);
    console.log('   ────────────────────────');
    console.log('   合計 ' + (total / 1000).toFixed(1) + '秒');
    console.log('');
    console.log('■ この週で貼った印影 ' + (timing.sealCount || 0) + ' 枚'
      + (b.staffDone ? '（担当者印・管理者印とも下ごしらえから引き継ぎ）'
        : b.adminDone ? '（管理者印は下ごしらえから引き継ぎ）' : '（1コマずつ）'));
    console.log('');
    console.log('■ 2週目からの見込み');
    console.log('   下ごしらえと一時ファイルの作成は1回だけなので、'
      + ((((timing.copy || 0) + (timing.values || 0) + (timing.seals || 0))) / 1000).toFixed(1)
      + '秒/週 が目安です');
    return timing;
  } finally {
    try { DriveApp.getFileById(temp.getId()).setTrashed(true); } catch (e) { /* 既に無い */ }
  }
}

/**
 * ★ 手で実行して、帳票が紙に収まるかを確かめます。
 *    外枠が欠けるときは、まずこれで縮小率を見てください。
 */
function checkPrintFit() {
  const f = printFit_();
  if (!f) { console.log('帳票テンプレートが読めませんでした'); return; }
  const mm = function (px) { return (px / 96 * 25.4).toFixed(1) + 'mm'; };
  const cfg = CFG.PDF;

  console.log('■ 帳票の実寸');
  console.log('   幅 ' + f.width + 'px (' + mm(f.width) + ')  高 '
    + f.height + 'px (' + mm(f.height) + ')');
  console.log('■ ' + cfg.PAGE + (cfg.LANDSCAPE ? '横' : '縦')
    + '・余白' + cfg.MARGIN_IN + 'インチ のとき印刷できる範囲');
  console.log('   幅 ' + Math.round(f.availW) + 'px (' + mm(f.availW) + ')  高 '
    + Math.round(f.availH) + 'px (' + mm(f.availH) + ')');
  console.log('■ 結果');
  if (f.fits) {
    console.log('   原寸で収まります。縮小せずに出力するので、外枠は欠けません。');
  } else {
    console.log('   はみ出すので ' + Math.round(f.scale * 1000) / 10 + '% に縮小します。');
    console.log('   縮小すると帳票の幅が印刷できる幅と一致し、外枠が切り取り線の');
    console.log('   真上に来ます（四隅が欠けて見える原因）。外枠は太くしてあるので');
    console.log('   欠けにくくしていますが、気になるときは次のどちらかを。');
    console.log('     ・CFG.PDF.MARGIN_IN を 0.2 に下げる（原寸で収まるようになります）');
    console.log('     ・帳票テンプレートの列幅を合計 '
      + Math.ceil(f.width + cfg.EDGE_GAP_PX - f.availW) + 'px ぶん詰める');
  }
  return f;
}

/** スプレッドシート全体をPDFにする */
function exportPdf_(ssId, name) {
  const cfg = CFG.PDF;
  const m = cfg.MARGIN_IN;
  const fit = printFit_();
  // 収まるなら縮めない。縮めると外枠が紙の端に貼りついて欠けやすくなる
  const fitw = !(fit && fit.fits);

  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export'
    + '?format=pdf&size=' + cfg.PAGE
    + '&portrait=' + (cfg.LANDSCAPE ? 'false' : 'true')
    + '&fitw=' + (fitw ? 'true' : 'false')
    + '&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER'
    + '&horizontal_alignment=CENTER&vertical_alignment=TOP'
    + '&top_margin=' + m + '&bottom_margin=' + m
    + '&left_margin=' + m + '&right_margin=' + m;

  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('PDFの作成に失敗しました (' + res.getResponseCode() + ')');
  }
  return res.getBlob().setName(name + '.pdf');
}

function outFolder_() {
  const cached = PROP.getProperty('OUT_FOLDER_ID');
  if (cached) {
    try { return DriveApp.getFolderById(cached); } catch (e) { /* 作り直す */ }
  }
  const parents = DriveApp.getFileById(ss_().getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const found = parent.getFoldersByName(PRINT.OUT_FOLDER);
  const folder = found.hasNext() ? found.next() : parent.createFolder(PRINT.OUT_FOLDER);
  PROP.setProperty('OUT_FOLDER_ID', folder.getId());
  return folder;
}

/** 年ごとの入れ物。確定PDFは 業務日報_出力/2026/ のように分けて置きます */
function outFolderFor_(year) {
  const root = outFolder_();
  const found = root.getFoldersByName(String(year));
  return found.hasNext() ? found.next() : root.createFolder(String(year));
}

function currentJob_() {
  const raw = PROP.getProperty(PRINT.JOB_KEY);
  return raw ? JSON.parse(raw) : null;
}

function getExportStatus() {
  return guard_('getExportStatus', function () { return currentJob_(); });
}

/** 途中で止めたいとき */
function cancelExport() {
  return guard_('cancelExport', function () {
    const job = currentJob_();
    if (!job) return null;
    trashTemp_(job);
    job.state = 'canceled';
    PROP.setProperty(PRINT.JOB_KEY, JSON.stringify(job));
    audit_('帳票の出力を中止', job.from + ' 〜 ' + job.to, job.actor || '');
    return job;
  });
}

/** ★ 出力の記録を消す。一時ファイルが残っていれば一緒に片づけます */
function clearExport() {
  return guard_('clearExport', function () {
    const job = currentJob_();
    if (job) trashTemp_(job);
    PROP.deleteProperty(PRINT.JOB_KEY);
    return null;
  });
}

/* ============================================================
 *  5. 手動で使うショートカット
 * ========================================================== */

/**
 * 画面から呼ぶのと同じ経路で最後まで走らせる。
 * 手で実行するショートカットは、どれもこれを通します。
 */
function runExportNow_(from, to, title) {
  clearExport();                       // 前の記録が残っていても始められるように
  startExport({ from: from, to: to, title: title, actor: '手動実行' });
  let job = runExportChunk();
  while (job && job.state === 'running') job = runExportChunk();

  if (job && job.state === 'done') Logger.log('PDF: ' + job.pdfUrl);
  else Logger.log('出力できませんでした: ' + ((job && job.message) || '理由不明'));
  return job;
}

/** ★ 今週分だけ出す */
function exportThisWeek() {
  const w = weekStart_(today_());
  return runExportNow_(w, addDays_(w, 6), w + '_週報_業務日報');
}

/** ★ 前月分を出す */
function exportLastMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return runExportNow_(fmt_(first), fmt_(last),
    Utilities.formatDate(first, CFG.TZ, 'yyyy年MM月') + '分_業務日報');
}

/** ★ 表示中の月を出す(記録簿のボタンと同じ範囲) */
function exportThisMonth() {
  const t = today_();
  return runExportNow_(monthStart_(t), monthEnd_(t),
    t.slice(0, 4) + '年' + t.slice(5, 7) + '月分_業務日報');
}

/* ############################################################
   7. 記録簿ビュー(監査用の一覧表示と、PCからの直接修正)
   ############################################################
   保健所などの立入検査で、その場で見せられる画面のためのデータを作ります。
   ・1か月ぶんを「週」に区切って返します。帳票の1ページ = 1週なので、
     画面の1枚が印刷の1ページにそのまま対応します。
   ・PCから直しやすいよう、編集に必要な値もそのまま持たせています。
   ・承認済みの日も直せますが、必ず承認を解除し、変更内容を履歴に残します。
   ############################################################ */

/** 管理基準を持つ項目。CFG.RANGES のキーと結びつけます */
const RANGE_FIELDS = [
  { key: 'roomTemp',  label: '調剤室温度', range: 'ROOM_TEMP',  dec: 1, unit: '℃' },
  { key: 'roomHumid', label: '調剤室湿度', range: 'ROOM_HUMID', dec: 0, unit: '%'  },
  { key: 'coldTemp',  label: '冷所温度',   range: 'COLD_TEMP',  dec: 1, unit: '℃' },
  { key: 'coldHumid', label: '冷所湿度',   range: 'COLD_HUMID', dec: 0, unit: '%'  }
];

/** 変更履歴に「前の値 → 後の値」を残すための項目 */
const DIFF_FIELDS = [
  { key: 'rx',        label: '処方箋枚数', dec: 0, unit: '枚' },
  { key: 'inquiry',   label: '疑義照会',   dec: 0, unit: '件' },
  { key: 'roomTemp',  label: '調剤室温度', dec: 1, unit: '℃' },
  { key: 'roomHumid', label: '調剤室湿度', dec: 0, unit: '%'  },
  { key: 'coldTemp',  label: '冷所温度',   dec: 1, unit: '℃' },
  { key: 'coldHumid', label: '冷所湿度',   dec: 0, unit: '%'  }
];

/** その月の初日 */
function monthStart_(iso) { return iso.slice(0, 7) + '-01'; }

/** その月の末日(翌月の0日 = 当月の末日) */
function monthEnd_(iso) {
  const p = iso.split('-');
  return Utilities.formatDate(new Date(+p[0], +p[1], 0), CFG.TZ, 'yyyy-MM-dd');
}

/** 管理基準を外れている項目を並べる */
function rangeAlerts_(d) {
  const out = [];
  RANGE_FIELDS.forEach(function (f) {
    const r = CFG.RANGES[f.range];
    if (outOfRange_(d[f.key], r)) {
      out.push({ key: f.key, label: f.label, value: d[f.key], min: r[0], max: r[1] });
    }
  });
  return out;
}

function showNum_(v, dec, unit) {
  return (v === null || v === undefined || v === '') ? '空欄' : Number(v).toFixed(dec) + unit;
}

/** 修正の前後を、履歴に残せる文字列の配列にする */
function diffDay_(before, after) {
  const out = [];
  DIFF_FIELDS.forEach(function (f) {
    const a = before[f.key];
    const b = num_(after[f.key]);
    if (a === b) return;
    out.push(f.label + ' ' + showNum_(a, f.dec, f.unit) + '→' + showNum_(b, f.dec, f.unit));
  });
  const na = String(before.note || '').trim();
  const nb = String(after.note || '').trim();
  if (na !== nb) {
    out.push('管理に関する事項「' + (na || '空欄') + '」→「' + (nb || '空欄') + '」');
  }

  // 譲渡記録は件数が変わるので、行ごとに見比べる
  const xa = (before.xfers || []).map(xferOne_);
  const xb = xferClean_(after.xfers).map(xferOne_);
  if (xa.join('\u0001') !== xb.join('\u0001')) {
    out.push('譲渡・譲受記録 ' + xa.length + '件 → ' + xb.length + '件'
      + (xb.length ? '：' + xb.join(' ／ ') : ''));
  }
  return out;
}

/* ------------------------------------------------------------
 *  1か月ぶんの記録簿
 * ---------------------------------------------------------- */

function ledgerPayload_(anchorIso) {
  const today = today_();
  let anchor = anchorIso ? fmt_(anchorIso) : today;
  if (!anchor) anchor = today;
  // 未来の月は開かせない
  if (monthStart_(anchor) > monthStart_(today)) anchor = today;

  const mStart = monthStart_(anchor);
  const mEnd   = monthEnd_(anchor);

  const idx   = dailyIndex_();
  const terms = termList_();
  const xi    = xferIndex_();
  const staff = staffList_();

  const seals = {};
  staff.forEach(function (s) {
    if (s.sealFileId) seals[s.name] = sealDataUrl_(s.sealFileId);
  });

  const hasTemplate = !!ss_().getSheetByName(T_().SHEET);
  const stat = { days: 0, filled: 0, approved: 0, missing: 0, alerts: 0, future: 0 };
  const alertList = [];
  const weeks = [];

  // 月をまたぐ週も帳票では1ページなので、週の頭から週の終わりまで通しで持ちます
  let w = weekStart_(mStart);
  const lastW = weekStart_(mEnd);
  let guard = 0;
  while (w <= lastW && guard++ < 10) {
    const rows = [];
    for (let i = 0; i < PRINT.DAY_ROWS; i++) {
      const iso = addDays_(w, i);
      const d = toDay_(iso, idx.map[iso], terms, xi);
      const row = {
        date: iso, dow: d.dow, hours: CFG.BUSINESS_HOURS,
        rx: d.rx, inquiry: d.inquiry,
        roomTemp: d.roomTemp, roomHumid: d.roomHumid,
        coldTemp: d.coldTemp, coldHumid: d.coldHumid,
        note: d.note,          // 上段F列。管理に関する事項
        xfers: d.xfers,        // 下段。譲渡・譲受記録(0件以上)
        state: d.state,
        filled: d.state !== 'empty' && d.state !== 'editing',
        approved: d.state === 'approved',
        staff: d.staff,
        admin: sealOwnerAdmin_(d),   // 印を押す人(未承認でも当日の管理薬剤師)
        approver: d.admin,           // 実際に承認した人
        chief: d.chief,
        savedAt: d.savedAt, approvedAt: d.approvedAt, lockedBy: d.lockedBy,
        inMonth: iso >= mStart && iso <= mEnd,
        future: iso > today,
        alerts: rangeAlerts_(d)
      };
      rows.push(row);

      if (!row.inMonth) continue;
      stat.days++;
      if (row.future) {
        stat.future++;
      } else if (row.filled) {
        stat.filled++;
        if (row.approved) stat.approved++;
      } else {
        stat.missing++;
      }
      if (row.alerts.length) {
        stat.alerts += row.alerts.length;
        alertList.push({ date: iso, dow: row.dow, items: row.alerts });
      }
    }
    weeks.push({ start: w, end: addDays_(w, 6), rows: rows });
    w = addDays_(w, 7);
  }

  const nextFirst = addDays_(mEnd, 1);
  return {
    store: CFG.STORE_NAME,
    storeCode: CFG.STORE_CODE,
    today: today,
    month: mStart.slice(0, 7),
    monthLabel: mStart.slice(0, 4) + '年' + Number(mStart.slice(5, 7)) + '月',
    monthStart: mStart,
    monthEnd: mEnd,
    prevMonth: addDays_(mStart, -1),
    nextMonth: monthStart_(nextFirst) > monthStart_(today) ? '' : nextFirst,
    hours: CFG.BUSINESS_HOURS,
    ranges: CFG.RANGES,
    layout: hasTemplate ? templateLayout_() : null,
    hasTemplate: hasTemplate,
    seals: seals,
    weeks: weeks,
    stat: stat,
    alerts: alertList,
    freeze: freezeCheck_(mStart.slice(0, 7), idx, terms)
  };
}

/* ------------------------------------------------------------
 *  記録簿からの書き込み
 * ---------------------------------------------------------- */

/**
 * 記録簿の1日を直す。
 *
 * 承認済みの日について
 *   内容が変わった記録に、前の内容に対する承認印を残したままにはできません。
 *   そのため、承認済みの日を直したときは
 *     1. 変更前後の値を変更履歴に残し
 *     2. 承認を解除して「入力済」に戻す(管理薬剤師の再承認が必要になる)
 *   という扱いにしています。画面側で必ず確認をとってから呼んでください。
 *
 * 担当者について
 *   既に記録がある日は、その日の担当者を勝手に書き換えません。
 *   直した人は変更履歴の「操作者」に残ります。
 *   担当者そのものを直すときは rowStaff に新しい氏名を入れてください。
 */
function saveLedgerDay_(p) {
  const iso = fmt_(p.date);
  if (!iso) throw new Error('日付が正しくありません');
  if (iso > today_()) throw new Error('未来の日付は登録できません');

  const actor = String(p.actor || p.staff || '').trim();
  if (!actor) throw new Error('操作者が特定できません');

  const terms  = termList_();
  const before = toDay_(iso, dailyIndex_().map[iso], terms, xferIndex_());
  const wasApproved = before.state === 'approved';

  if (wasApproved && !p.force) {
    throw new Error('承認済みの日です。画面の確認に同意してから保存してください');
  }

  const staffName = String(p.rowStaff || before.staff || actor).trim();
  if (!staffName) throw new Error('担当者が選ばれていません');

  const changes = diffDay_(before, p);
  if (before.staff && staffName !== before.staff) {
    changes.push('担当者「' + before.staff + '」→「' + staffName + '」');
  }

  // 承認済みなら、先に承認を落としてから書き込む
  if (wasApproved) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const idx = dailyIndex_();
      const row = idx.map[iso];
      if (row) writeRow_(idx.t, row._row, { '管理者': '', '承認日時': '', '状態': '入力済' });
    } finally {
      lock.releaseLock();
    }
  }

  const q = { date: iso, staff: staffName, force: true,
              note: p.note, xfers: p.xfers };
  DIFF_FIELDS.forEach(function (f) { q[f.key] = p[f.key]; });
  saveDay_(q);

  if (wasApproved) {
    audit_('承認済みの日報を修正（承認を解除）',
      iso + '：' + (changes.length ? changes.join('、') : '内容の変更なし') +
      '／承認者 ' + (before.admin || '—') + ' の承認を解除', actor);
  } else if (changes.length) {
    audit_('日報を修正（記録簿）', iso + '：' + changes.join('、'), actor);
  } else if (before.state === 'empty') {
    audit_('日報を追加（記録簿）', iso + '：担当 ' + staffName, actor);
  }

  return ledgerPayload_(iso);
}

/* ############################################################
   8. 記録簿の入口(画面から呼ばれる)
   ############################################################ */

function getLedger(anchor) { return guard_('getLedger', function () {
  return ledgerPayload_(anchor);
}); }

function saveLedgerDay(p) { return guard_('saveLedgerDay', function () {
  return saveLedgerDay_(p);
}); }

function approveLedgerDay(p) { return guard_('approveLedgerDay', function () {
  approveDay_(p);
  return ledgerPayload_(p.date);
}); }

function unapproveLedgerDay(p) { return guard_('unapproveLedgerDay', function () {
  unapproveDay_(p);
  return ledgerPayload_(p.date);
}); }


/* ############################################################
   9. 月次の確定(PDFに焼いて残す)
   ############################################################
   日々の記録は「データ」が正本で、画面(記録簿ビュー)から毎回描き直します。
   ただしそれだけだと、あとから印影を差し替えたりテンプレートの列幅を
   変えたりしたときに、過去の帳票の見た目まで変わってしまいます。
   監査で「これは当時のものです」と言えなくなるため、月が締まった時点で
   1回だけPDFに焼き、それを残します。

   ・確定できるのは「月が終わっていて、未記録が無く、全日が承認済み」のときだけ
   ・訂正が出たら、承認を解除して直し、もう一度確定する。
     前の版は消さず、新しい版として積み増します(v1, v2, …)
   ・変更履歴シートに「何をなぜ直したか」が残るので、版と履歴が対応します

   確定PDFは 業務日報_出力/<年>/ に、次の名前で入ります。
     2026-08_業務日報_v2_確定20260915.pdf
   ############################################################ */

/** その月の記録の埋まり具合。記録簿を作るときは idx / terms を渡して読み直しを避けます */
function monthStats_(month, idx, terms) {
  const mStart = month + '-01';
  const mEnd = monthEnd_(mStart);
  const i = idx || dailyIndex_();
  const tm = terms || termList_();
  const out = { month: month, start: mStart, end: mEnd,
                days: 0, filled: 0, approved: 0, missing: 0 };

  for (let d = mStart; d <= mEnd; d = addDays_(d, 1)) {
    out.days++;
    const day = toDay_(d, i.map[d], tm);
    if (day.state === 'empty' || day.state === 'editing') { out.missing++; continue; }
    out.filled++;
    if (day.state === 'approved') out.approved++;
  }
  return out;
}

/** 確定台帳をぜんぶ読む(新しい順) */
function fixList_() {
  const t = table_(SH.FIX);
  return t.rows.map(function (r) {
    return {
      id: String(r['ID']),
      month: String(r['対象月']),
      version: Number(r['版']) || 0,
      at: (r['確定日時'] instanceof Date)
        ? Utilities.formatDate(r['確定日時'], CFG.TZ, 'yyyy/MM/dd HH:mm')
        : String(r['確定日時'] || ''),
      by: String(r['確定者'] || ''),
      name: String(r['ファイル名'] || ''),
      fileId: String(r['ファイルID'] || ''),
      url: String(r['リンク'] || ''),
      hash: String(r['ハッシュ'] || ''),
      chain: String(r['連鎖'] || ''),
      alive: String(r['状態'] || '有効') !== '取消',
      note: String(r['備考'] || ''),
      _row: r._row
    };
  }).sort(function (a, b) {
    if (a.month !== b.month) return a.month < b.month ? 1 : -1;   // 新しい月が先
    return b.version - a.version;                                  // 新しい版が先
  });
}

/** その月の版だけ(新しい順) */
function fixOf_(month, all) {
  return (all || fixList_()).filter(function (x) { return x.month === month; });
}

/** 次に付ける版番号。取り消した版も番号は使い切ります(番号を再利用しない) */
function nextVersion_(versions) {
  return versions.reduce(function (m, x) { return Math.max(m, x.version); }, 0) + 1;
}

/**
 * その月を確定できるか。できないときは理由を並べて返します。
 * 画面はこれをそのまま出すので、理由は運用者が読んで動ける言葉にしています。
 */
function freezeCheck_(month, idx, terms) {
  const stat = monthStats_(month, idx, terms);
  const versions = fixOf_(month);
  const live = versions.filter(function (x) { return x.alive; });
  const reasons = [];

  if (stat.end >= today_()) reasons.push('その月がまだ終わっていません');
  if (stat.missing) reasons.push('未記録が ' + stat.missing + ' 日あります');
  const unapproved = stat.filled - stat.approved;
  if (unapproved) reasons.push('未承認が ' + unapproved + ' 日あります');

  return {
    month: month,
    stat: stat,
    unapproved: unapproved,
    versions: versions,
    latest: live.length ? live[0] : null,
    frozen: !!live.length,
    nextVersion: nextVersion_(versions),
    ok: !reasons.length,
    reasons: reasons
  };
}

/**
 * 確定した結果を台帳に1行残す。
 *
 * ハッシュは、Driveに保存されたPDFそのものから取ります(渡された blob ではなく)。
 * 「保存されている物」と「台帳の記録」を突き合わせたいので、保存後の実物を読みます。
 */
function recordFix_(job, file) {
  const t = table_(SH.FIX);
  const at = new Date();
  const hash = sha256Bytes_(file.getBlob().getBytes());
  const chain = chainOf_(lastChain_(t), job.month, job.version, at, hash);

  appendRow_(t, {
    'ID': uid_('F'),
    '対象月': job.month,
    '版': job.version,
    '確定日時': at,
    '確定者': job.actor || '',
    'ファイル名': file.getName(),
    'ファイルID': file.getId(),
    'リンク': file.getUrl(),
    'ハッシュ': hash,
    '連鎖': chain,
    '状態': '有効',
    '備考': String(job.note || '')
  });
  audit_('月次を確定', job.month + '（第' + job.version + '版）'
    + '／SHA-256 ' + hash.slice(0, 16) + '…'
    + (job.note ? '：' + job.note : ''), job.actor || '');
}

/**
 * 月次の確定を始める。あとは runExportChunk を繰り返すだけで、
 * 期間指定の出力と同じ仕組みで進みます。
 */
function startFreeze(p) {
  return guard_('startFreeze', function () {
    const month = String(p.month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('対象月が正しくありません');

    const chk = freezeCheck_(month);
    if (!chk.ok) {
      throw new Error('この月はまだ確定できません：' + chk.reasons.join('／'));
    }
    // 2回目以降は、なぜもう一度確定するのかを残してもらう
    const note = String(p.note || '').trim();
    if (chk.frozen && !note) {
      throw new Error('すでに第' + chk.latest.version
        + '版があります。作り直す理由を書いてください');
    }

    const v = chk.nextVersion;
    const job = startExport_({
      from: chk.stat.start,
      to: chk.stat.end,
      title: month + '_業務日報_v' + v
        + '_確定' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd'),
      actor: p.actor
    });
    job.kind = 'freeze';
    job.month = month;
    job.version = v;
    job.note = note;
    PROP.setProperty(PRINT.JOB_KEY, JSON.stringify(job));
    return job;
  });
}

/**
 * 誤って確定した版を取り消す。ファイルもDriveの記録も消しません。
 * 消してしまうと「間違えて出した」という事実まで消えてしまうため、
 * 台帳に取消として残し、理由を付けます。
 */
function voidFix(p) {
  return guard_('voidFix', function () {
    const why = String(p.reason || '').trim();
    if (!why) throw new Error('取り消す理由を書いてください');

    const t = table_(SH.FIX);
    const row = t.rows.filter(function (r) { return String(r['ID']) === String(p.id); })[0];
    if (!row) throw new Error('確定台帳にありません');
    if (String(row['状態'] || '') === '取消') throw new Error('すでに取り消されています');

    writeRow_(t, row._row, {
      '状態': '取消',
      '備考': String(row['備考'] || '') + (row['備考'] ? ' / ' : '') + '取消：' + why
    });
    audit_('確定を取り消し',
      String(row['対象月']) + '（第' + row['版'] + '版）：' + why, p.actor || '');
    return fixPayload_();
  });
}

/** 確定簿の画面に渡す形 */
function fixPayload_() {
  const all = fixList_();
  const byMonth = {};
  all.forEach(function (x) {
    (byMonth[x.month] = byMonth[x.month] || []).push(x);
  });
  const months = Object.keys(byMonth).sort().reverse().map(function (m) {
    const live = byMonth[m].filter(function (x) { return x.alive; });
    return {
      month: m,
      label: m.slice(0, 4) + '年' + Number(m.slice(5, 7)) + '月',
      versions: byMonth[m],
      latest: live.length ? live[0] : null
    };
  });
  return { store: CFG.STORE_NAME, today: today_(), months: months };
}

/* ---------- 画面から呼ばれる入口 ---------- */

function getFixList() { return guard_('getFixList', function () {
  return fixPayload_();
}); }

function getFreezeState(month) { return guard_('getFreezeState', function () {
  return freezeCheck_(String(month || today_()).slice(0, 7));
}); }

/**
 * ★ 手で実行して、前月を確定します。画面から確定するのと同じ経路を通ります。
 */
function freezeLastMonth() {
  const now = new Date();
  const m = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 1),
                                 CFG.TZ, 'yyyy-MM');
  const chk = freezeCheck_(m);
  if (!chk.ok) {
    console.log('［' + m + '］まだ確定できません：' + chk.reasons.join(' / '));
    return chk;
  }
  clearExport();
  startFreeze({ month: m, actor: '手動実行', note: chk.frozen ? '手動で作り直し' : '' });
  let job = runExportChunk();
  while (job && job.state === 'running') job = runExportChunk();
  console.log(job && job.state === 'done'
    ? '［' + m + '］第' + job.version + '版を確定しました: ' + job.pdfUrl
    : '確定できませんでした: ' + ((job && job.message) || '理由不明'));
  return job;
}


/* ############################################################
   10. 証跡（ハッシュ）と、まとめて渡すZIP
   ############################################################
   確定したPDFが「確定した時のまま」かどうかを、あとから確かめられるようにします。

   ・ハッシュ … PDFそのもののSHA-256。中身が1バイトでも変われば変わります
   ・連鎖    … 1つ前の連鎖とこの行をまとめたSHA-256。
               台帳の古い行をこっそり書き換えると、それ以降の連鎖が全部合わなくなります

   ここで分かるのは「変わっているかどうか」までです。
   台帳を編集できる人は、ファイルと一緒にハッシュも書き換えられます。
   本当の意味での否認防止には、時刻認証局など第三者の記録が要ります。
   それでも、取り違え・破損・第三者による差し替えはこれで検出できます。

   まとめて渡すときは、確定済みのPDFをそのままZIPにします。
   PDFを1つに結合しないのは、結合すると別のファイルになってしまい、
   台帳のハッシュがどれとも一致しなくなるためです。
   ZIPには、どのPDFが何のハッシュなのかを書いた目録を同梱します。
   ############################################################ */

/** バイト列を16進の文字列に。computeDigest は符号つきで返すので & 0xFF する */
function hex_(bytes) {
  return bytes.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function sha256Bytes_(bytes) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}

function sha256Text_(text) {
  return hex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

/** 台帳のいちばん下の連鎖。無ければ空(最初の1件) */
function lastChain_(t) {
  const tb = t || table_(SH.FIX);
  if (!tb.rows.length) return '';
  return String(tb.rows[tb.rows.length - 1]['連鎖'] || '');
}

/** 1行ぶんの連鎖を作る。1つ前の連鎖を混ぜるので、途中を書き換えると以降が合わなくなる */
function chainOf_(prev, month, version, at, hash) {
  const atIso = (at instanceof Date) ? at.toISOString() : String(at);
  return sha256Text_([prev, month, version, atIso, hash].join('|'));
}

/**
 * ★ 手で実行して、確定PDFが確定時のままかを確かめます。
 *    実行ログに、行ごとの結果が出ます。画面(確定簿)からも呼べます。
 */
function verifyFixes() {
  return guard_('verifyFixes', function () { return verifyFixes_(); });
}

function verifyFixes_() {
  const t = table_(SH.FIX);
  const rows = t.rows;
  const out = [];
  let prev = '';
  let bad = 0;

  rows.forEach(function (r) {
    const month = String(r['対象月']);
    const version = Number(r['版']) || 0;
    const hash = String(r['ハッシュ'] || '');
    const chain = String(r['連鎖'] || '');
    const item = { month: month, version: version, name: String(r['ファイル名'] || ''),
                   alive: String(r['状態'] || '有効') !== '取消',
                   state: 'ok', detail: '' };

    if (!hash) {
      item.state = 'none';
      item.detail = 'ハッシュが記録されていません（この仕組みより前の確定です）';
    } else {
      // 1. Driveの実物と突き合わせる
      let now = '';
      try {
        now = sha256Bytes_(DriveApp.getFileById(String(r['ファイルID'])).getBlob().getBytes());
      } catch (e) {
        item.state = 'missing';
        item.detail = 'PDFが見つかりません（消されたか、権限がありません）';
      }
      if (item.state === 'ok') {
        if (now !== hash) {
          item.state = 'changed';
          item.detail = 'PDFの中身が確定時と違います';
        } else {
          // 2. 台帳そのものが書き換えられていないか
          const want = chainOf_(prev, month, version, r['確定日時'], hash);
          if (chain && want !== chain) {
            item.state = 'broken';
            item.detail = '台帳の記録が書き換えられています';
          }
        }
      }
    }

    if (item.state !== 'ok') bad++;
    out.push(item);
    prev = chain;
  });

  const label = { ok: '一致', none: 'ハッシュなし', missing: 'PDFなし',
                  changed: '中身が変わっている', broken: '台帳が書き換えられている' };
  console.log('■ 確定PDFの証跡（' + rows.length + ' 件）');
  out.forEach(function (x) {
    console.log('   ' + x.month + ' v' + x.version + (x.alive ? '' : '(取消)')
      + ' … ' + label[x.state] + (x.detail ? ' … ' + x.detail : ''));
  });
  console.log('   ────────────────');
  console.log(bad ? '   ★ ' + bad + ' 件に問題があります' : '   すべて確定時のままです');

  return { total: rows.length, bad: bad, items: out, at: stamp_() };
}

/**
 * ★ 手で実行して、ハッシュが無い古い行に後から入れます。
 *
 *    注意：後から入れたハッシュが証明するのは「入れた時点のファイル」までです。
 *    確定した時点のものである保証にはならないので、備考にその旨を残します。
 */
function backfillFixHashes() {
  const t = table_(SH.FIX);
  let n = 0;
  let prev = '';
  t.rows.forEach(function (r) {
    let hash = String(r['ハッシュ'] || '');
    const month = String(r['対象月']);
    const version = Number(r['版']) || 0;

    if (!hash) {
      try {
        hash = sha256Bytes_(DriveApp.getFileById(String(r['ファイルID'])).getBlob().getBytes());
      } catch (e) {
        console.warn(month + ' v' + version + ' のPDFを読めませんでした');
        prev = String(r['連鎖'] || '');
        return;
      }
      n++;
    }
    const chain = chainOf_(prev, month, version, r['確定日時'], hash);
    const note = String(r['備考'] || '');
    writeRow_(t, r._row, {
      'ハッシュ': hash,
      '連鎖': chain,
      '備考': note + (note ? ' / ' : '') + '後からハッシュを記録（' + today_() + '）'
    });
    prev = chain;
  });
  console.log(n ? n + ' 件にハッシュを入れました' : 'ハッシュの無い行はありませんでした');
  if (n) audit_('確定台帳にハッシュを追記', n + ' 件', '');
  return n;
}

/* ------------------------------------------------------------
 *  まとめて渡す（ZIP）
 * ---------------------------------------------------------- */

/** ZIPに入れる目録。どのPDFが何のハッシュなのかを平文で残します */
function bundleManifest_(items, from, to, actor) {
  const line = [];
  line.push(CFG.STORE_NAME + '　業務日報');
  line.push('対象期間 : ' + from + ' 〜 ' + to);
  line.push('作成日時 : ' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyy/MM/dd HH:mm'));
  line.push('作成者   : ' + (actor || '—'));
  line.push('');
  line.push('この束は、確定済みのPDFをそのまま集めたものです。');
  line.push('中身は確定した時点のままで、作り直していません。');
  line.push('下の SHA-256 で、各PDFが確定時と同じものか確かめられます。');
  line.push('');
  line.push('----------------------------------------------------------------');
  items.forEach(function (x) {
    line.push('');
    line.push(x.month + '　第' + x.version + '版');
    line.push('  確定    : ' + x.at + '　' + (x.by || '—'));
    line.push('  ファイル: ' + x.name);
    line.push('  SHA-256 : ' + (x.hash || '（記録なし）'));
    if (x.note) line.push('  備考    : ' + x.note);
  });
  line.push('');
  line.push('----------------------------------------------------------------');
  line.push('確認のしかた（Windows の PowerShell）');
  line.push('  Get-FileHash .\\ファイル名.pdf -Algorithm SHA256');
  line.push('');
  // Windowsのメモ帳で開いても文字化けしないよう、BOM付きUTF-8・CRLFにする
  return Utilities.newBlob('﻿' + line.join('\r\n'), 'text/plain', '目録.txt');
}

/**
 * 期間ぶんの確定PDFを1つのZIPにまとめる。
 *
 * PDFを作り直さないので、待ち時間はファイルを読むぶんだけです。
 * 各月は、取り消されていない最新の版を入れます。
 *
 * @param {Object} p { from:'2026-04', to:'2026-06', actor:'…' }
 */
function bundleFixes(p) {
  return guard_('bundleFixes', function () {
    const from = String(p.from || '').slice(0, 7);
    const to = String(p.to || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      throw new Error('対象月が正しくありません');
    }
    if (from > to) throw new Error('開始の月が終わりの月より後になっています');

    const all = fixList_();
    const picked = [];
    const seen = {};
    all.forEach(function (x) {
      if (!x.alive || x.month < from || x.month > to) return;
      if (seen[x.month]) return;      // fixList_ は版の新しい順なので、最初のものが最新
      seen[x.month] = true;
      picked.push(x);
    });
    if (!picked.length) throw new Error('この期間に確定済みの月がありません');
    if (picked.length > 36) throw new Error('一度にまとめられるのは36か月までです');

    picked.sort(function (a, b) { return a.month < b.month ? -1 : 1; });

    const blobs = [bundleManifest_(picked, from, to, p.actor)];
    picked.forEach(function (x) {
      const blob = DriveApp.getFileById(x.fileId).getBlob();
      blobs.push(blob.setName(x.name));
    });

    const name = from + '_' + to + '_業務日報_'
      + Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd');
    const zip = Utilities.zip(blobs, name + '.zip');
    const file = outFolder_().createFile(zip);

    audit_('確定PDFをまとめて出力',
      from + ' 〜 ' + to + '（' + picked.length + 'か月）', p.actor || '');

    return {
      name: file.getName(),
      url: file.getUrl(),
      months: picked.length,
      items: picked.map(function (x) {
        return { month: x.month, version: x.version, name: x.name, hash: x.hash };
      })
    };
  });
}
