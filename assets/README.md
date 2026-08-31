# assets

くるむメディカル公式サイト（https://curumu-medical.co.jp/）から取得したブランド素材です。
アプリの動作には不要で、画面デザインや資料作成の参照用に置いています。

取得日: 2026-08-31

| ファイル | 内容 | 取得元 |
|---|---|---|
| `logo-wordmark.svg` | 横型ロゴ（シンボル＋社名）。Adobe Illustrator 書き出し版。**通常はこちらを使用** | トップページ内のインライン SVG（`viewBox="0 0 307 55"`） |
| `logo-wordmark-alt.svg` | 同じロゴの別実装。`width` / `height` 属性付き | 同上 |
| `favicon.ico` | サイトのタブアイコン。ICO / 48×48 / 32bpp | `<link rel="shortcut icon" href="/favicon.ico">` |
| `favicon-48.png` | `favicon.ico` を PNG 変換（原寸・透過保持） | 上記より変換 |
| `favicon-256.png` | 256px へ拡大。元が 48px のため輪郭は甘い（参考用） | 上記より変換 |
| `og-image.jpg` | SNS 共有用カード画像。JPEG / 1200×630 | `<meta property="og:image">` |

## ブランドカラー

ロゴの緑系グラデーションで使われている色です。

`#1c8742` `#2a8c41` `#6da93e` `#9ebd3b` `#bcca3a`

## 注意

- 拡大が必要な場面では必ず SVG を使ってください。`favicon-256.png` は 48px からの拡大です。
- 社外へ配布する資料に使う場合は、ロゴの使用規定を確認してください。
