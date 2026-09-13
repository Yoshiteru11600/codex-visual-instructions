# Codex 作業指示書：Local Visual Instruction Tool for Codex

## 0. この文書の目的

このディレクトリには、Codex の組み込みブラウザとローカル開発プロジェクトを組み合わせて使用する **Visual Instruction Tool** を新規実装する。

最終的な目的は、開発者がブラウザ上で対象 UI を直接操作して「理想に近い After」を作り、その **視覚差分 + 変更意図** を複数まとめて Codex に渡せるようにすることである。

本ツールは、一般 Web サイトを編集するためのブラウザ拡張ではない。

主対象は以下の開発環境である。

```text
Local source code
  ↓
Dev server (localhost / local container / remote dev environment)
  ↓
Codex built-in browser
  ↓
Visual Instruction Tool
  ↓
Structured visual instructions
  ↓
Codex
  ↓
Codex が元ソースを調査して実装
```

重要な設計原則：

> DOM 上で作られた After は「実装結果」ではなく「Visual Specification」である。

ユーザーが DOM を 24px 右へ動かしたからといって、Codex に `left: 24px` を書かせてはならない。

Codex は元プロジェクトの HTML / CSS / JavaScript / TypeScript / React 等を調査し、既存レイアウト、コンポーネント設計、レスポンシブ設計、アクセシビリティを尊重して、Visual Intent を適切なソース変更へ翻訳すること。

---

# 1. 最初に行うこと

ユーザーはこの作業用ディレクトリだけを作成している前提とする。

Codex は以下を自律的に実施すること。

1. 現在のディレクトリを確認する。
2. 既存ファイルがある場合は勝手に削除せず確認・保全する。
3. Git repository でなければ `git init` する。
4. Node.js / npm / pnpm 等の利用可能環境を確認する。
5. package manager は原則として `pnpm` を優先する。ただし環境や公式 scaffold が別の package manager を要求する場合は合理的なものを選択する。
6. TypeScript ベースのプロジェクトとして初期化する。
7. 現時点の OpenAI 公式ドキュメントを確認し、Codex Plugin / WebMCP / Site Tools の最新仕様に合わせる。
8. GitHub CLI `gh` の有無と認証状態を確認する。
9. 実装・テスト・README・LICENSE・GitHub 公開 repository 作成・初回 push まで完了させる。
10. npm package として公開可能な構成まで整える。ただし npm publish 自体は認証・公開名・ユーザー承認が必要になる可能性があるため、勝手に公開してはならない。

GitHub repository は **public** とする。

repository 名は、現在のディレクトリ名が妥当ならそれを使用する。妥当でない場合は `codex-visual-instructions` を第一候補とする。

GitHub CLI では既存ローカル repository から public repository を作成して push できる。最新の `gh repo create` 仕様を確認したうえで実行すること。

---

# 2. OSS 方針

本プロジェクトは OSS とする。

## License

初期ライセンスは **MIT License** とする。

理由：

- 小規模な開発支援ツールとして採用障壁が低い。
- 商用・社内利用を妨げない。
- fork / contribution を受けやすい。
- 本プロジェクト自体に copyleft を要求する強い理由が現時点ではない。

以下を遵守すること。

- `LICENSE` を repository root に置く。
- 著作権者名は GitHub の認証ユーザー情報から安全に取得できる場合のみ利用する。
- 取得できない場合は無理に推測せず、`LICENSE` の年と holder の扱いを README/TODO に明示してユーザー確認対象とする。
- VisBug 等の既存ツールのソースコードをコピーしない。
- UI の考え方や一般的な操作概念を参考にしても、実装は独立して行う。
- 依存 package のライセンスを確認し、MIT project として配布可能なものを使用する。

---

# 3. 製品の定義

## 一文での定義

> ブラウザ上で理想の見た目を直接作り、その視覚差分と変更意図をまとめて Codex へ渡す、ローカル開発向け Visual Instruction Tool。

## 解決する問題

現在、Codex に UI 修正を依頼するときは、以下のような自然言語指示が必要になる。

```text
この見出しをもう少し右にして、
画像との間を広くして、
ボタンを少し大きくして、
スマホでは縦並びにしてほしい。
```

この指示は曖昧である。

本ツールではユーザー自身がブラウザ上で After を視覚的に作り、

```text
見出し：この程度まで右へ
理由：画像との余白を増やしたい

ボタン：この程度の大きさ
理由：主要 CTA としてもう少し目立たせたい
```

という形で **操作結果 + 意図** を構造化し、一括して Codex に渡す。

---

# 4. v1 のスコープ

v1 は意図的に小さくする。

## Must

### 4.1 ページ内 Overlay

対象 Web アプリに開発時だけ読み込める Overlay を実装する。

要件：

- Shadow DOM 等を利用し、対象アプリの CSS の影響を極力受けない。
- Overlay 自身の DOM がレビュー対象として選択されない。
- 本番 bundle に誤って含めても自動で動作しないよう defensive design を行う。
- 明示的な `install()` または開発フラグによってのみ起動する。
- external telemetry は送信しない。
- cloud storage は使用しない。
- 外部 API は不要。

想定例：

```ts
if (import.meta.env.DEV) {
  import("codex-visual-instructions").then(({ install }) => {
    install();
  });
}
```

API 名・package 名は repository の最終名称に合わせて調整してよい。

---

### 4.2 Review Mode

通常の Web アプリ操作とレビュー操作を混同しない。

Review Mode 中はデフォルトで以下を抑止する。

- `<a>` の navigation
- form submit
- submit button
- `window.open` による意図しない遷移
- SPA router navigation（可能な範囲）
- 対象アプリの click handler 発火

ただし要素選択は可能にする。

リンクを選択した場合は遷移せず、必要なら destination URL を確認できるようにする。

例：

```text
<a href="/pricing">

Target: /pricing
```

Review Mode の目的は「アプリを操作すること」ではなく「UI を観察して変更意図を表現すること」である。

---

### 4.3 Element Selection

最低限以下を実装する。

- hover highlight
- click selection
- selected outline
- current element basic metadata
  - tag name
  - id
  - class
  - accessible name / text summary が安全に取れる場合
- multi-select
- selection clear

選択対象から以下を除外する。

- Overlay 自身
- `script`
- `style`
- `template`
- 明らかに review 対象にならない内部 element

---

### 4.4 Keyboard DOM Traversal

選択中 element をキーボードで移動できるようにする。

Command として内部実装し、shortcut と分離する。

必要 command：

```ts
selection.parent
selection.firstChild
selection.previousSibling
selection.nextSibling
```

動作：

- 親要素
- 子要素
- 前の兄弟
- 次の兄弟

非表示 element や Overlay 内 element 等を適切に skip する。

初期 shortcut は OS / browser / Codex UI との衝突を考慮して決める。

候補：

```text
Ctrl/Cmd + ↑ : parent
Ctrl/Cmd + ↓ : first child
Ctrl/Cmd + ← : previous sibling
Ctrl/Cmd + → : next sibling
```

ただし衝突リスクが高ければより安全な初期値へ変更してよい。

shortcut は後述の config で変更可能にする。

---

### 4.5 Move

selected element を視覚的に移動できる。

- mouse drag
- keyboard nudge
- Shift 等による大きい nudge

標準候補：

```text
Arrow         1px
Shift+Arrow  10px
```

ただしこれを「実装 CSS」と解釈しないこと。

記録するのは Visual Delta である。

例：

```json
{
  "operation": "move",
  "delta": {
    "x": 24,
    "y": 0
  }
}
```

---

### 4.6 Resize

selected element の visual size を変更できる。

最低限：

- resize handles
- width / height change
- original rect
- target rect

これも CSS implementation を決定しない。

---

### 4.7 Text Replacement Preview

text node / text-bearing element に対して、表示テキストを一時変更できる。

記録する：

```json
{
  "operation": "replace-text",
  "before": "...",
  "after": "..."
}
```

React source 等を直接変更してはならない。

---

### 4.8 Hide / Remove Preview

以下を明確に分ける。

#### Hide

「画面上では表示したくない」という Visual Intent。

```json
{
  "operation": "hide",
  "intent": "not-visible"
}
```

#### Remove

「UI / source から要素自体を削除したい」という Intent。

```json
{
  "operation": "remove",
  "intent": "delete-from-ui-and-source",
  "risk": "high",
  "verificationRequired": true
}
```

Remove preview は DOM を一時的に消してよい。

ただし UI 上で警告すること。

警告内容：

```text
This element may be referenced by JavaScript, event handlers,
ARIA relationships, forms, or framework state.

The preview does not guarantee runtime behavior after removal.
Codex must inspect source dependencies before implementing this change.
```

翻訳対応する。

重要：

> Preview が壊れてもよい。Preview は最終アプリではない。

Codex が最終的な source dependency を調査する。

---

### 4.9 Basic Align / Spacing Assistance

v1 では巨大な design tool にしない。

最低限便利な以下のみ検討する。

- horizontal align
- vertical align
- simple equal spacing
- visual guide
- distance measurement

複雑な auto-layout editor は v1 に入れない。

---

# 5. Visual Intent

本ツールで最も重要な概念である。

ユーザー操作を単なる数値差分として送らない。

操作ごとに「なぜそうしたいのか」を付随させられるようにする。

## Intent categories

初期候補：

```ts
type IntentCategory =
  | "spacing"
  | "alignment"
  | "visual-hierarchy"
  | "responsive"
  | "copy"
  | "visibility"
  | "interaction"
  | "exact-position"
  | "other";
```

UI 例：

```text
Why?

[Spacing]
[Alignment]
[Hierarchy]
[Responsive]
[Copy]
[Other]

Comment:
画像との距離をもう少し広げたい
```

操作から候補 category を推定して preselect してもよい。

ただし自動推定結果を確定扱いしない。

---

## Precision

Visual manipulation が厳密値なのか目安なのかを表現できるようにする。

```ts
type Precision =
  | "exact"
  | "approximate"
  | "relationship"
  | "intent-only";
```

デフォルトは `approximate` を推奨する。

例：

```json
{
  "precision": "approximate",
  "tolerance": 4
}
```

ユーザーが 31px 動かしたからといって、31px を絶対値として source に実装させない。

---

# 6. Review Session

複数変更を一つの session として保持する。

最低限：

```ts
interface ReviewSession {
  version: number;
  sessionId: string;
  route: string;
  viewport: ViewportInfo;
  createdAt: string;
  annotations: ReviewInstruction[];
}
```

例：

```json
{
  "version": 1,
  "sessionId": "review-...",
  "route": "/",
  "viewport": {
    "width": 1440,
    "height": 900,
    "devicePixelRatio": 1
  },
  "annotations": []
}
```

ReviewInstruction は selector 一つだけに依存しない。

少なくとも以下のような fingerprint を保存する。

```ts
interface ElementFingerprint {
  cssSelector?: string;
  tagName: string;
  id?: string;
  classes?: string[];
  testId?: string;
  ariaLabel?: string;
  textSnippet?: string;
  domPath?: string;
}
```

React Component / source file の特定は v1 では行わない。

---

# 7. Before / After

これは v1 の主要機能である。

## 必須 view

- Edited only
- Original only
- Side by side
- Overlay

必要に応じて top/bottom も実装してよいが Must ではない。

## Original

v1 では Review 開始時の DOM / visual state を元にする。

完全な runtime clone を保証しなくてよい。

目的は visual comparison である。

可能なら以下を実装する。

- review start snapshot
- sync scroll
- overlay opacity slider

Side-by-side ではスクロール同期を行う。

基本アルゴリズムは ratio sync でよい。

動的 canvas / WebGL / iframe / video 等で完全一致しない場合は limitation として明記する。

---

# 8. Viewport

v1 で「完全なスマートフォン emulator」を作らない。

以下の viewport presets を提供する。

```text
Desktop
Tablet
Mobile
Custom
```

重要：

- viewport width と input type は同一概念ではない。
- v1 では本格的な touch emulation はしない。
- Mobile は主に responsive layout を確認するための viewport とする。

各 annotation には適用範囲を付けられるようにする。

例：

```ts
type ApplyScope =
  | "current-viewport"
  | "current-breakpoint"
  | "all-narrower"
  | "all-wider"
  | "all-viewports";
```

既存 media query の完全解析は v1 の必須要件ではない。

---

# 9. Undo / Redo

Visual operations は必ず undo / redo 可能にする。

最低限：

- selection change は履歴対象外でもよい
- visual edit は履歴対象
- text replacement
- move
- resize
- hide/remove
- align
- annotation edit

History の architecture は将来 Variant / Timeline に拡張可能にしておく。

v1 では Variant A/B/C は実装しない。

---

# 10. Config

project-level config を提供する。

候補：

```json
{
  "version": 1,
  "locale": "auto",
  "shortcuts": {},
  "review": {
    "navigationPolicy": "block-all",
    "defaultViewport": "desktop",
    "defaultCompareMode": "side-by-side",
    "scrollSync": "ratio"
  },
  "privacy": {
    "telemetry": false
  }
}
```

ファイル名候補：

```text
.codex-visual-review.json
```

または package 名に合わせた短い名称を採用してよい。

優先順位：

```text
project config
  ↓
local user preferences
  ↓
built-in defaults
```

個人 shortcut は localStorage / IndexedDB 等に保持してよい。

project config を勝手に書き換えない。

---

# 11. Shortcut System

shortcut は command ID と分離する。

例：

```ts
type CommandId =
  | "review.toggle"
  | "selection.parent"
  | "selection.firstChild"
  | "selection.previousSibling"
  | "selection.nextSibling"
  | "edit.nudgeUp"
  | "edit.nudgeDown"
  | "edit.nudgeLeft"
  | "edit.nudgeRight"
  | "compare.next"
  | "session.submit"
  | "settings.open";
```

設定 UI で shortcut を変更可能にする。

検出：

- 同一ツール内 duplicate
- 明らかな browser / OS shortcut conflict

conflict は警告するが、ユーザーが意図的に設定する場合まで全面禁止しなくてよい。

`Escape` は operation cancel / modal close / selection clear の共通用途として優先する。

---

# 12. i18n

初期対応 locale：

```text
English (default)
Japanese
French
Russian
Auto
```

```ts
type Locale = "auto" | "en" | "ja" | "fr" | "ru";
```

Auto：

```text
ja-* → ja
fr-* → fr
ru-* → ru
other → en
```

locale files は明確に分離する。

```text
src/locales/
  en.ts
  ja.ts
  fr.ts
  ru.ts
```

重要：

- UI labels のみ翻訳する。
- WebMCP tool name
- JSON keys
- command IDs
- protocol fields

は常に英語にする。

ユーザーが入力した comment は翻訳しない。

---

# 13. WebMCP / Site Tools Integration

Codex built-in browser との連携は、可能な限り OpenAI 公式の **WebMCP / Site Tools** を使用する。

実装前に必ず OpenAI 公式ドキュメントの現行仕様を確認すること。

Site Tool registration は target page の top-level document で行う。

v1 で必要な tool 候補：

```text
get_visual_review_session
list_visual_review_instructions
get_visual_review_instruction
mark_visual_review_resolved
clear_visual_review_session
```

tool name は package 名が衝突しないよう prefix を付けてもよい。

例：

```text
visual_review.get_session
```

ただし実際の命名形式は現行 WebMCP 仕様に合わせる。

read 系 tool は read-only annotation を設定できるなら設定する。

Codex が受け取る instruction payload には以下を含める。

- target fingerprint
- before
- after
- operation
- intent category
- free-form comment
- precision
- viewport
- apply scope
- risk
- implementation requirements

---

# 14. Codex に渡す共通 Implementation Instruction

session を Codex が取得したとき、次の原則を必ず伝える。

```text
The browser edits are visual specifications, not source-level implementation instructions.

For each review instruction:

1. Locate the corresponding source in the current workspace.
2. Inspect the existing HTML/CSS/JavaScript/TypeScript/framework structure.
3. Infer the user's visual intent from the before/after state and attached intent/comment.
4. Do not blindly reproduce temporary DOM styles or pixel offsets.
5. Prefer the project's existing layout system, components, utilities, and conventions.
6. Preserve responsive behavior unless the instruction explicitly changes it.
7. For destructive or structural changes, inspect JavaScript/framework references,
   event handlers, ARIA relationships, form semantics, and layout dependencies.
8. Implement all compatible instructions together rather than independently when
   a shared source-level change is more appropriate.
9. Reload the page after implementation and verify the result visually.
10. Do not modify files unrelated to the requested visual changes without a clear reason.
```

この文言は README / Skill / integration code の適切な場所に共通ルールとして持つ。

---

# 15. Codex Plugin / Skill

v1 の中心は page-side Overlay + WebMCP である。

Codex Plugin / Skill は補助的なものとして作成する。

目的：

- Visual Review Session の読み取り方を Codex に教える。
- DOM の temporary changes を source changes と誤認しないようにする。
- 複数 instruction をまとめて実装させる。
- high-risk instruction で dependency check を要求する。
- 実装後に browser verification を行わせる。

現時点の OpenAI Plugin 仕様を公式ドキュメントで確認し、最新 scaffold / manifest に従うこと。

過去仕様を推測して固定しない。

必要なら Codex の公式 plugin creator を利用する。

---

# 16. Source Mapping は v1 で行わない

非常に重要。

v1 では以下を実装しない。

```text
Rendered DOM
  ↓
React component
  ↓
TSX source line
```

理由：

- React/Vue/Svelte/Solid/Astro/Next.js 等で構造が違う。
- minify/source map/dev runtime の条件差が大きい。
- Server Components 等では単純対応できない。
- 実装量の割に v1 の本質ではない。

Codex 自身が workspace source を探索する。

Overlay は **画面上の対象を十分識別できる fingerprint と Visual Intent** を渡すことに集中する。

---

# 17. v1 非対象

以下は明示的に後回しにする。

- Git Visual Diff
- Git HEAD vs Working Tree の二重 dev server
- DOM → React/Vue/Svelte source mapping
- component usage Blast Radius
- Design Token 自動解析
- Component API / props editor
- Storybook integration
- GitHub PR integration
- automatic regression traversal
- accessibility full scanner
- visual regression test generation
- full mobile device emulation
- multi-touch emulation
- network throttling
- user-agent emulation
- breakpoint auto detection
- breakpoint ±1 testing
- variant A/B/C
- AI automatic inconsistency detection
- external cloud sync
- collaboration server
- Kanban/task management

architecture は将来拡張を妨げないようにするが、v1 の実装へ混ぜない。

---

# 18. Privacy / Security

これは README で明確に訴求する。

原則：

```text
Telemetry: none
External API: none
Cloud storage: none
Required broad browser permissions: none
```

本ツールは一般 Chrome extension として全 Web ページへのアクセス権を要求しない。

対象開発アプリ自身へ dev dependency として読み込む方式を基本とする。

review data は local のみ。

可能なら：

- session data: localStorage / IndexedDB
- project config: local project file

secret を保存しない。

HTML 内の input value / password / token 等を無条件に review payload へ入れない。

以下は必ず sanitize する。

- password fields
- hidden auth tokens
- authorization headers
- cookies
- localStorage 全内容
- form secrets
- API response body

本ツールが送る対象は UI review に必要な最小限の DOM metadata にする。

---

# 19. DOM Mutation Safety

Overlay が target page を一時変更する際、元状態を復元可能にする。

要件：

- original property を保持する。
- reset session で可能な限り元に戻す。
- app re-render によって node reference が無効になった場合は安全に失敗する。
- MutationObserver を濫用して対象アプリの performance を大幅に落とさない。
- framework internal fields へ直接依存しない。
- private React internals 等を v1 で利用しない。

Visual manipulation のための CSS は専用 class / style layer で適用し、ユーザーアプリの source stylesheet を書き換えない。

---

# 20. Re-render 対応

SPA では DOM が再生成されるため、raw Node reference の永続利用を避ける。

annotation には ElementFingerprint を保持し、re-render 後に best-effort で再解決する。

候補優先度：

1. id
2. `data-testid` 等の stable data attribute
3. aria-label / semantic attributes
4. CSS selector
5. DOM path
6. text snippet + geometry

誤った要素へ自動適用するくらいなら unresolved にする。

---

# 21. Architecture

framework agnostic な core を優先する。

候補構成：

```text
src/
  core/
    commands/
    selection/
    operations/
    history/
    session/
    fingerprint/
    config/
  overlay/
    components/
    styles/
  compare/
  webmcp/
  locales/
  storage/
  utils/
  index.ts

plugin/
  ... Codex plugin / skill files

tests/
  unit/
  integration/
  e2e/

examples/
  vanilla/
  react-vite/

docs/
```

UI implementation 自体に React を使うかどうかは自由だが、consumer application に React を強制しないこと。

Overlay の bundle は framework-neutral に動作させる。

---

# 22. Example Projects

最低限 2 つ用意する。

## Vanilla

```text
examples/vanilla
```

- HTML
- CSS
- JS

## React + Vite

```text
examples/react-vite
```

- TypeScript
- React
- Vite

これにより「元ソースの framework mapping を行わなくても、Codex が source を調査して実装できる」ことを検証する。

---

# 23. Testing

テストを省略しない。

## Unit

対象：

- command registry
- shortcut parsing
- config merge
- locale resolution
- ElementFingerprint
- session serialization
- undo / redo
- operation delta
- sanitization

## Browser / E2E

Playwright 等を使用する。

最低限：

1. Overlay install
2. element select
3. move
4. keyboard nudge
5. resize
6. text change
7. hide
8. remove warning
9. undo / redo
10. navigation blocked
11. multi-select
12. session serialization
13. original/edited switch
14. side-by-side
15. locale switch
16. config shortcut override

React example でも主要 flow を確認する。

---

# 24. Performance

Overlay を入れたことで開発ページが著しく重くならないようにする。

特に：

- pointermove で全 DOM scan をしない。
- layout thrashing を避ける。
- `getBoundingClientRect()` の乱用を避ける。
- MutationObserver scope を抑える。
- event listener を cleanup する。
- uninstall API を提供する。

例：

```ts
const handle = install();

handle.destroy();
```

---

# 25. Accessibility of the Tool

Overlay 自身もキーボード操作可能にする。

最低限：

- focus indication
- buttons に accessible name
- modal focus trap
- Esc close
- usable contrast
- tooltips の mouse-only 依存を避ける

対象アプリの focus を過度に破壊しない。

---

# 26. Packaging

npm package として配布可能にする。

確認事項：

- ESM
- TypeScript declarations
- tree-shakable exports where practical
- CSS injection strategy
- package `files`
- `exports`
- `sideEffects`
- source maps
- package size

package 名が npm 上で取得可能か確認する。

取得できない場合は無理に publish せず、候補を README/TODO に残す。

---

# 27. README

README は公開 repository の重要な成果物である。

英語を primary language とする。

日本語 section / separate Japanese README を追加してもよい。

最低限：

1. What it is
2. Why it exists
3. Screenshots / demo GIF の placeholder
4. Quick start
5. Vite example
6. Vanilla example
7. How review sessions work
8. Visual Intent concept
9. Codex integration
10. WebMCP requirement
11. Keyboard shortcuts
12. i18n
13. Privacy
14. Security limitations
15. Known limitations
16. v1 non-goals
17. Roadmap
18. Contributing
19. License

README 冒頭で明記：

> This tool is designed primarily for local development environments where Codex has access to the corresponding project source code.

そして：

> Browser edits are visual specifications. They are not intended to be copied literally into source code.

---

# 28. CONTRIBUTING / Community Files

public OSS repository として最低限以下を検討する。

```text
CONTRIBUTING.md
CODE_OF_CONDUCT.md
SECURITY.md
.github/
  ISSUE_TEMPLATE/
```

過剰に enterprise 化しなくてよい。

SECURITY.md では、ページ内に読み込む開発ツールであるため、DOM data leakage や external transmission に関する脆弱性報告を重要項目として扱う。

---

# 29. CI

GitHub Actions を追加する。

Pull Request / push で最低限：

```text
install
typecheck
lint
unit tests
build
```

E2E が安定して実行可能なら追加する。

Node version matrix は過剰に広くしない。

現行 Active LTS + 必要なら最新安定版程度でよい。

Dependabot / Renovate は任意。

---

# 30. Git Workflow

初期実装完了後：

1. generated files を確認
2. secret が含まれていないか確認
3. `git status`
4. tests
5. build
6. README verification
7. commit

初回 commit message 例：

```text
feat: initial visual instruction tool
```

default branch は `main`。

---

# 31. GitHub Public Repository 作成

`gh auth status` で認証を確認する。

認証されている場合、現在の local repository から public repository を作成する。

現行 GitHub CLI では概ね以下の形式が利用可能だが、実行時に最新 help を確認すること。

```bash
gh repo create <repo-name> \
  --public \
  --source=. \
  --remote=origin \
  --push
```

repository description の候補：

```text
A local-first visual instruction layer for Codex: edit the desired UI in-browser, attach intent, and send structured review instructions back to Codex.
```

topics 候補：

```text
codex
openai
webmcp
developer-tools
frontend
visual-review
ui-review
typescript
```

GitHub repository 作成は本タスクに含む。

ただし以下の場合は止めて報告する。

- `gh` が未インストール
- GitHub 未認証
- public repository 作成権限がない
- repository 名 collision
- organization policy で public repository を作れない

認証情報を生成・推測・回避してはならない。

---

# 32. Release Preparation

v1.0.0 を急がない。

初回公開は：

```text
0.1.0
```

を推奨する。

Git tag / GitHub Release は実装品質と README が十分なら作成してよいが、npm publish と同様に、外部公開の最終 package version を不必要に確定しない。

CHANGELOG.md を用意する。

---

# 33. Definition of Done

以下をすべて満たして初めて作業完了とする。

## Core

- [ ] target project に Overlay を install できる
- [ ] Review Mode を開始・終了できる
- [ ] element を選択できる
- [ ] multi-select できる
- [ ] mouse で move できる
- [ ] arrow key で nudge できる
- [ ] DOM hierarchy を keyboard で traverse できる
- [ ] resize できる
- [ ] text preview を変更できる
- [ ] hide/remove preview ができる
- [ ] remove に risk warning が出る
- [ ] undo / redo が動く
- [ ] Original / Edited を切替できる
- [ ] Side-by-side を表示できる
- [ ] Overlay compare ができる
- [ ] viewport preset を変更できる
- [ ] annotation に intent を付けられる
- [ ] annotation に free-form comment を付けられる
- [ ] precision を持てる
- [ ] apply scope を持てる
- [ ] session を serialize できる

## Codex integration

- [ ] WebMCP / Site Tools が現行公式仕様に従っている
- [ ] Codex が review session を取得できる
- [ ] 複数 instruction を一括取得できる
- [ ] temporary DOM edit を literal source change と誤解しない共通 instruction がある
- [ ] high-risk operation に implementation requirements が付く
- [ ] Plugin / Skill が必要な workflow を説明する

## Quality

- [ ] TypeScript typecheck pass
- [ ] lint pass
- [ ] unit tests pass
- [ ] E2E pass
- [ ] build pass
- [ ] Vanilla example が動く
- [ ] React + Vite example が動く
- [ ] telemetry なし
- [ ] external API なし
- [ ] secret leakage がない
- [ ] package license が適切
- [ ] README が完成
- [ ] MIT LICENSE がある
- [ ] CONTRIBUTING / SECURITY を整備
- [ ] GitHub Actions がある

## Publishing

- [ ] Git initialized
- [ ] initial commit
- [ ] GitHub public repository created
- [ ] origin configured
- [ ] main pushed
- [ ] repository description / topics set
- [ ] npm publish ready

---

# 34. 実装時の優先順位

一気に巨大実装をしない。

以下の順で進める。

## Phase 1 — Foundation

- project scaffold
- overlay
- selection
- commands
- config
- i18n
- session model

## Phase 2 — Visual Editing

- move
- resize
- keyboard nudge
- text
- hide/remove
- undo/redo

## Phase 3 — Intent

- intent UI
- comments
- precision
- apply scope
- multi-change session

## Phase 4 — Comparison

- original snapshot
- edited
- side-by-side
- overlay
- sync scroll
- viewport

## Phase 5 — Codex Integration

- WebMCP tools
- structured payload
- Plugin / Skill
- React / Vanilla verification

## Phase 6 — OSS Quality

- tests
- docs
- examples
- CI
- security review
- packaging

## Phase 7 — Publish Repository

- final audit
- initial commit
- `gh repo create --public`
- push
- repository metadata

各 Phase の終了時に tests を走らせる。

---

# 35. 判断ルール

不明点が出ても、些細な命名や内部設計について逐一ユーザーへ質問しない。

以下の原則で合理的に決定する。

優先順位：

1. security
2. data privacy
3. simplicity
4. framework neutrality
5. Codex usability
6. developer UX
7. package size
8. future extensibility

ただし以下は勝手に進めない。

- 課金
- npm publish
- secret の発行
- GitHub authentication の迂回
- 既存 remote repository の破壊
- 既存 user data の削除

---

# 36. 最終報告

作業完了後、ユーザーへ以下を簡潔に報告する。

```text
Implemented
- ...

Tests
- typecheck: pass
- unit: pass
- e2e: pass
- build: pass

Repository
- GitHub: <URL>
- branch: main
- latest commit: <hash>

Package
- package name: ...
- version: 0.1.0
- npm publish: ready / blocked by ...

Known limitations
- ...

Recommended next step
- ...
```

失敗した項目を成功したように報告しない。

---

# 37. v2 以降の候補

v1 完了後にのみ検討する。

優先候補：

1. Git Visual Diff
2. HEAD / Working Tree visual comparison
3. visual diff ↔ code diff navigation
4. source-aware mapping
5. component usage / blast radius
6. design token suggestion
7. responsive breakpoint analysis
8. review variants
9. targeted regression verification
10. review → Playwright / visual regression test
11. AI inconsistency discovery
12. PR review integration

特に Git Visual Diff は独立した大機能として扱う。

v1 に混ぜない。

---

# 38. 最重要原則

実装中、常に以下を基準にすること。

> The user manipulates the page to communicate a desired visual outcome.
> Codex decides how that outcome should be implemented in the real source code.

この境界を壊さない。

本ツールは DOM editor ではない。

本ツールは **Visual Instruction Layer for Codex** である。
