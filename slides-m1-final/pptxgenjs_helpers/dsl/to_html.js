"use strict";
// to_html.js — 元素树 → 毛坯档单文件 HTML（含侧栏导航）
//
// 用法: node to_html.js <workspaceDir> -o <out.html>
//
// 毛坯档特征: 灰底白页框、元素虚线描边（悬停显示 eid）、图表为 div 柱状草稿。
// 与 to_pptx.js 消费同一棵元素树 → 几何/字号/柱条坐标完全一致。
// data-eid 属性内嵌在 DOM 上，为后续 patch 定位与 M6 回读做基础。

const fs = require("fs");
const path = require("path");
const { renderWorkspace } = require("./render");

const SCALE = 90; // px / inch；13.3in → 1197px, 7.5in → 675px
const px = (v) => Math.round(v * SCALE);
const fontPx = (pt) => Math.round(pt * (SCALE / 72) * 100) / 100;

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function boxCss(b) {
  return `left:${px(b.x)}px;top:${px(b.y)}px;width:${px(b.w)}px;height:${px(b.h)}px;`;
}

function elementHtml(el, tree) {
  if (el.kind === "text") {
    return `<div data-eid="${esc(el.eid)}" title="${esc(el.eid)}" class="el" style="${boxCss(el)}font-family:'${esc(el.fontFace)}',sans-serif;font-size:${fontPx(el.fontSize)}px;font-weight:${el.bold ? 700 : 400};color:#${esc(el.color)};">${esc(el.text)}</div>`;
  }
  if (el.kind === "bullets") {
    const items = el.items
      .map(
        (it) =>
          `<li style="font-weight:${it.bold ? 700 : 400};color:#${esc(it.color)};">${esc(it.text)}</li>`
      )
      .join("");
    return `<div data-eid="${esc(el.eid)}" title="${esc(el.eid)}" class="el" style="${boxCss(el)}"><ul style="margin:0;padding:0 0 0 1.5em;font-family:'${esc(el.fontFace)}',sans-serif;font-size:${fontPx(el.fontSize)}px;line-height:1.45;">${items}</ul></div>`;
  }
  if (el.kind === "chart") {
    const bars = el.bars
      .map(
        (b) =>
          `<div title="${esc(b.label)}: ${esc(b.value)}" style="position:absolute;${boxCss(b)}background:#${esc(el.barColor)};opacity:.82;"></div>`
      )
      .join("");
    const caption = el.caption
      ? `<div style="position:absolute;${boxCss(el.captionBox)}text-align:center;font-family:'${esc(el.captionStyle.fontFace)}',sans-serif;font-size:${fontPx(el.captionStyle.fontSize)}px;color:#${esc(el.captionStyle.color)};">${esc(el.caption)}</div>`
      : "";
    return `<div data-eid="${esc(el.eid)}" title="${esc(el.eid)}" class="el chart" style="${boxCss(el.frame)}background:#${esc(el.fill)};">
      ${bars}
      <div style="position:absolute;${boxCss(el.labelsBox)}text-align:center;font-family:'${esc(el.labelsStyle.fontFace)}',sans-serif;font-size:${fontPx(el.labelsStyle.fontSize)}px;color:#${esc(el.labelsStyle.color)};white-space:nowrap;">${esc(el.labelsText)}</div>
      ${caption}
    </div>`;
  }
  throw new Error(`[to_html] 未知元素类型: ${el.kind}`);
}

function pageHtml(s, tree) {
  const elements = s.elements.map((el) => elementHtml(el, tree)).join("\n      ");
  const nav = s.navTitle || "";
  const notes = s.notes ? `<p class="notes">备注：${esc(s.notes)}</p>` : "";
  return `<section class="slide-block" id="${esc(s.sid)}">
    <div class="slide-head">
      <span class="sid">${esc(s.sid)}</span><span class="lay-badge">${esc(s.layout)}</span>
      <h2>${esc(nav)}</h2>
    </div>
    <div class="frame" style="width:${px(tree.width)}px;height:${px(tree.height)}px;">
      ${elements}
    </div>
    ${notes}
  </section>`;
}

function buildHtml(tree) {
  const navItems = tree.slides
    .map(
      (s) =>
        `<a class="navitem" href="#${esc(s.sid)}"><span class="sid">${esc(s.sid)}</span><span class="lay-badge">${esc(s.layout)}</span><span class="navtitle">${esc(s.navTitle || "")}</span></a>`
    )
    .join("\n    ");
  const pages = tree.slides.map((s) => pageHtml(s, tree)).join("\n");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(tree.deckId)} · 毛坯稿</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#F0F0F0; font-family:'${esc(tree.fonts.body)}','PingFang SC','Noto Sans CJK SC',sans-serif; color:#333; }
  .layout { display:flex; align-items:flex-start; }
  .sidebar { position:sticky; top:0; height:100vh; width:260px; flex:none; background:#FAFAFA; border-right:1px solid #E0E0E0; padding:20px 16px; overflow:auto; }
  .sidebar h1 { font-size:15px; margin:0 0 4px; }
  .sidebar .meta { font-size:12px; color:#888; margin-bottom:16px; }
  .phase-badge { display:inline-block; background:#333; color:#fff; font-size:11px; padding:2px 8px; border-radius:10px; margin-bottom:12px; }
  .navitem { display:block; padding:8px 10px; margin:2px 0; border-radius:6px; text-decoration:none; color:#333; font-size:13px; line-height:1.5; }
  .navitem:hover { background:#EAEAEA; }
  .navitem .sid { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; color:#999; margin-right:6px; }
  .navitem .navtitle { display:block; }
  .lay-badge { display:inline-block; border:1px solid #CCC; border-radius:8px; padding:0 6px; font-size:10px; color:#888; margin-right:6px; vertical-align:1px; }
  .main { flex:1; padding:28px 32px 60px; min-width:0; overflow-x:auto; }
  .topbar { margin-bottom:22px; }
  .topbar h1 { font-size:18px; margin:0 0 4px; }
  .topbar p { font-size:12px; color:#888; margin:0; }
  .slide-block { margin-bottom:36px; }
  .slide-head { margin-bottom:8px; font-size:13px; color:#666; }
  .slide-head h2 { display:inline; font-size:14px; margin:0 0 0 6px; color:#444; }
  .slide-head .sid { font-family:ui-monospace,Menlo,Consolas,monospace; color:#999; }
  .frame { position:relative; background:#FFFFFF; border:1px solid #D5D5D5; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .el { position:absolute; border:1px dashed #D5D5D5; overflow:hidden; line-height:1.35; }
  .el:hover { border-color:#2F2F2F; }
  .el.chart { border-style:dashed; }
  .notes { font-size:12px; color:#999; margin:6px 2px 0; }
  .footer { font-size:11px; color:#AAA; margin-top:30px; }
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <span class="phase-badge">毛坯稿 · wireframe</span>
    <h1>${esc(tree.deckId)}</h1>
    <div class="meta">v${esc(tree.version)} · ${tree.slides.length} 页 · ${px(tree.width)}×${px(tree.height)}px</div>
    ${navItems}
  </aside>
  <main class="main">
    <div class="topbar">
      <h1>${esc(tree.deckId)} · 毛坯稿</h1>
      <p>由 Deck DSL 元素树驱动，PPTX 端同源生成；悬停元素可查看 eid（后续按 eid 精准修改）。</p>
    </div>
    ${pages}
    <p class="footer">slides-dsl M0 · phase=${esc(tree.phase)} · 图表为草稿形态，终稿档替换为原生可编辑对象（M2）</p>
  </main>
</div>
</body>
</html>
`;
}

function parseArgs(argv) {
  if (argv.length < 1) return null;
  const wsDir = argv[0];
  let out = null;
  const i = argv.indexOf("-o");
  if (i >= 0 && argv[i + 1]) out = argv[i + 1];
  return { wsDir, out };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args || !args.out) {
    console.error("用法: node to_html.js <workspaceDir> -o <out.html>");
    process.exit(2);
  }
  const tree = renderWorkspace(path.resolve(args.wsDir));
  const html = buildHtml(tree);
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  const nEl = tree.slides.reduce((n, s) => n + s.elements.length, 0);
  console.log(`[to_html] OK ${outPath} slides=${tree.slides.length} elements=${nEl} size=${(html.length / 1024).toFixed(1)}KB`);
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
