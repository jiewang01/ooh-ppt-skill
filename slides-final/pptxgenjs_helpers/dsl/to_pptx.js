"use strict";
// to_pptx.js — 元素树 → PPTX（毛坯档）
//
// 用法: node to_pptx.js <workspaceDir> -o <out.pptx>
//
// 翻译规则（纯映射，不做几何决策——一切几何/字号已在 render.js 推导）:
//   text   → slide.addText(objectName=eid)
//   bullets→ slide.addText(runs with bullet:true, objectName=eid)
//   chart  → 虚线框 + 柱条草稿 + labels 行 + caption 行（几何取自元素树）
// 渲染即断言: 每页跑 warnIfSlideHasOverlaps + warnIfSlideElementsOutOfBounds，
// 任何违规 → 文件仍写出（便于诊断）但退出码 1，CI 可拦截。

const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const { renderWorkspace } = require("./render");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("../layout");

function parseArgs(argv) {
  if (argv.length < 1) return null;
  const wsDir = argv[0];
  let out = null;
  const i = argv.indexOf("-o");
  if (i >= 0 && argv[i + 1]) out = argv[i + 1];
  return { wsDir, out };
}

function addElement(slide, el, tree) {
  if (el.kind === "text") {
    slide.addText(el.text, {
      objectName: el.eid,
      x: el.x, y: el.y, w: el.w, h: el.h,
      fontFace: el.fontFace,
      fontSize: el.fontSize,
      bold: el.bold,
      color: el.color,
      align: "left",
      valign: "top",
      margin: 0,
    });
    return;
  }
  if (el.kind === "bullets") {
    const runs = el.items.map((it) => ({
      text: it.text,
      options: { bullet: true, bold: it.bold, color: it.color },
    }));
    slide.addText(runs, {
      objectName: el.eid,
      x: el.x, y: el.y, w: el.w, h: el.h,
      fontFace: el.fontFace,
      fontSize: el.fontSize,
      paraSpaceAfter: el.paraSpaceAfter,
      valign: "top",
      margin: 0,
    });
    return;
  }
  if (el.kind === "chart") {
    slide.addShape("rect", {
      objectName: el.eid,
      x: el.frame.x, y: el.frame.y, w: el.frame.w, h: el.frame.h,
      fill: { color: el.fill },
      line: { color: el.frameColor, width: 1, dashType: "dash" },
    });
    el.bars.forEach((b, i) => {
      slide.addShape("rect", {
        objectName: `${el.eid}_bar${i + 1}`,
        x: b.x, y: b.y, w: b.w, h: b.h,
        fill: { color: el.barColor },
        line: { color: el.barColor, width: 0.5 },
      });
    });
    slide.addText(el.labelsText, {
      objectName: `${el.eid}_labels`,
      x: el.labelsBox.x, y: el.labelsBox.y, w: el.labelsBox.w, h: el.labelsBox.h,
      fontFace: el.labelsStyle.fontFace,
      fontSize: el.labelsStyle.fontSize,
      color: el.labelsStyle.color,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    if (el.caption && el.captionStyle) {
      slide.addText(el.caption, {
        objectName: `${el.eid}_caption`,
        x: el.captionBox.x, y: el.captionBox.y, w: el.captionBox.w, h: el.captionBox.h,
        fontFace: el.captionStyle.fontFace,
        fontSize: el.captionStyle.fontSize,
        color: el.captionStyle.color,
        align: "center",
        valign: "middle",
        margin: 0,
      });
    }
    return;
  }
  throw new Error(`[to_pptx] 未知元素类型: ${el.kind}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args || !args.out) {
    console.error("用法: node to_pptx.js <workspaceDir> -o <out.pptx>");
    process.exit(2);
  }
  const tree = renderWorkspace(path.resolve(args.wsDir));

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.3 × 7.5，与 render 校验过的 deck.size 对应
  pptx.author = "slides-dsl";
  pptx.title = tree.deckId;

  const warnings = [];
  const origWarn = console.warn;
  const origError = console.error;
  const collect = (...a) => { warnings.push(a.map(String).join(" ")); };

  for (const s of tree.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: tree.colors.bg };
    for (const el of s.elements) addElement(slide, el, tree);
    if (s.notes) slide.addNotes(s.notes);
    console.warn = collect;
    console.error = collect;
    try {
      warnIfSlideHasOverlaps(slide, pptx);
      warnIfSlideElementsOutOfBounds(slide, pptx);
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }
  }

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await pptx.writeFile({ fileName: outPath });

  if (warnings.length) {
    warnings.forEach((w) => origError(w));
    console.error(`[to_pptx] FAIL 布局断言未通过（${warnings.length} 条违规）: ${outPath}`);
    process.exit(1);
  }
  const nEl = tree.slides.reduce((n, s) => n + s.elements.length, 0);
  console.log(`[to_pptx] OK ${outPath} slides=${tree.slides.length} elements=${nEl}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
