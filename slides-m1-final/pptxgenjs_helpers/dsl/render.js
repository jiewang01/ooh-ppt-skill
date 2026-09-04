"use strict";
// render.js — Deck DSL 工作区 → 渲染无关的元素树
//
// 输入: workspace 目录（deck.json + theme.json + slides/*.json + assets/data/*.json）
// 输出: 元素树。槽位展开、字号自适应（autoFontSize）、图表条形几何推导全部在
//       此完成；to_pptx.js / to_html.js 只做“元素树 → 格式”的纯翻译，
//       以此保证双端渲染结果一致（同一棵树，两份皮）。
//
// 设计不变量:
//   - 每个分片（单页/主题/数据）独立解析，错误精确定位到文件与字段
//   - 预算硬闸: 每槽位 ≤ maxBulletsPerSlot 条，每条 ≤ maxBulletChars 字符
//   - LLM 只产出语义内容（slides/*.json），坐标/字号/样式一律由本层推导
//
// 用法: node render.js <workspaceDir>

const fs = require("fs");
const path = require("path");
const { autoFontSize } = require("../text");
const S = require("./schema");
const { validateWorkspace } = require("./validate");

// 规则与预算常量统一来自 schema.js（单一事实源），此处仅 re-export 保持兼容
const { LAYOUT_SIZES, BUDGET, REQUIRED_SLOTS, SLIDE_META_KEYS } = S;

// bullets 行间距（pt），双端一致（渲染期测量常量，非 schema 规则）
const PARASPACE_AFTER = 6;

function fail(msg) {
  throw new Error(`[render] ${msg}`);
}

function num(v, what) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(`字段 ${what} 必须是有限数字（得到: ${JSON.stringify(v)}）`);
  }
  return v;
}

function readJson(file, what) {
  if (!fs.existsSync(file)) fail(`${what} 缺失: ${file}`);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    fail(`无法读取 ${what}: ${file} (${e.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${what} JSON 解析失败: ${file} (${e.message})`);
  }
}

// theme.styles[name] → {fontFace, fontSize, minFontSize, bold, color}
function resolveStyle(theme, styleName, where) {
  const s = theme.styles && theme.styles[styleName];
  if (!s) fail(`${where}: 样式 "${styleName}" 未在 theme.styles 中定义`);
  const fontFace = theme.fonts && theme.fonts[s.font];
  if (!fontFace) fail(`${where}: 字体槽 "${s.font}" 未在 theme.fonts 中定义`);
  const color = theme.colors && theme.colors[s.color];
  if (!color) fail(`${where}: 颜色令牌 "${s.color}" 未在 theme.colors 中定义`);
  return {
    fontFace,
    fontSize: num(s.fontSize, `${where} styles.${styleName}.fontSize`),
    minFontSize: num(s.minFontSize, `${where} styles.${styleName}.minFontSize`),
    bold: !!s.bold,
    color,
  };
}

function zoneGeom(zone, where) {
  return {
    x: num(zone.x, `${where}.x`),
    y: num(zone.y, `${where}.y`),
    w: num(zone.w, `${where}.w`),
    h: num(zone.h, `${where}.h`),
  };
}

// 槽位内容 → 元素。内容对象三选一: {text} | {bullets} | {chart}
function expandSlot(sid, slot, zoneDef, content, theme, wsDir) {
  const where = `slides/${sid}.json 槽位 "${slot}"`;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    fail(`${where}: 内容必须是对象 {text|bullets|chart}`);
  }
  const kinds = ["text", "bullets", "chart"].filter((k) => content[k] !== undefined);
  if (kinds.length === 0) fail(`${where}: 缺少 text/bullets/chart 之一`);
  if (kinds.length > 1) fail(`${where}: text/bullets/chart 互斥（同时出现: ${kinds.join(",")}）`);

  const g = zoneGeom(zoneDef, `${where} zone`);
  const style = resolveStyle(theme, zoneDef.style, where);
  const eid = `${sid}_${slot}`;

  if (content.text !== undefined) {
    if (typeof content.text !== "string" || !content.text.trim()) {
      fail(`${where}: text 必须是非空字符串`);
    }
    const sized = autoFontSize(content.text, style.fontFace, {
      x: g.x, y: g.y, w: g.w, h: g.h,
      mode: "shrink",
      fontSize: style.fontSize,
      minFontSize: style.minFontSize,
      bold: style.bold,
    });
    return {
      kind: "text", eid, slot,
      ...g,
      text: content.text,
      fontFace: style.fontFace,
      fontSize: sized.fontSize,
      bold: style.bold,
      color: style.color,
    };
  }

  if (content.bullets !== undefined) {
    if (!Array.isArray(content.bullets) || content.bullets.length === 0) {
      fail(`${where}: bullets 必须是非空数组`);
    }
    if (content.bullets.length > BUDGET.maxBulletsPerSlot) {
      fail(`${where}: 条目数 ${content.bullets.length} 超出预算（≤${BUDGET.maxBulletsPerSlot}）`);
    }
    const accent = theme.colors && theme.colors.accent;
    if (!accent) fail(`${where}: emphasis 条目需要 theme.colors.accent`);
    const items = content.bullets.map((it, i) => {
      if (!it || typeof it.text !== "string" || !it.text.trim()) {
        fail(`${where}: 第 ${i + 1} 条缺少非空 text`);
      }
      const chars = Array.from(it.text).length;
      if (chars > BUDGET.maxBulletChars) {
        fail(`${where}: 第 ${i + 1} 条 ${chars} 字符，超出预算（≤${BUDGET.maxBulletChars}）`);
      }
      const emph = it.emphasis === true;
      return { text: it.text, bold: emph, color: emph ? accent : style.color };
    });
    // 行距计入有效测量高度：n 条之间有 (n-1) 个 paraSpaceAfter
    const hEff = Math.max(
      0.4,
      g.h - ((items.length - 1) * PARASPACE_AFTER) / 72
    );
    const joined = items.map((it) => it.text).join("\n");
    const sized = autoFontSize(joined, style.fontFace, {
      x: g.x, y: g.y, w: g.w, h: hEff,
      mode: "shrink",
      fontSize: style.fontSize,
      minFontSize: style.minFontSize,
      bold: style.bold,
    });
    return {
      kind: "bullets", eid, slot,
      ...g,
      items,
      fontFace: style.fontFace,
      fontSize: sized.fontSize,
      paraSpaceAfter: PARASPACE_AFTER,
    };
  }

  // chart: {ref, type, caption}
  const spec = content.chart;
  if (!spec || typeof spec !== "object") fail(`${where}: chart 必须是对象`);
  if (!spec.ref || typeof spec.ref !== "string") fail(`${where}: chart.ref 必须是字符串`);
  const type = spec.type || "bar";
  if (type !== "bar") fail(`${where}: M0 仅支持 chart.type="bar"`);
  const dataFile = path.resolve(wsDir, spec.ref);
  const data = readJson(dataFile, `图表数据（${where} ref）`);
  if (!Array.isArray(data.series) || data.series.length === 0) {
    fail(`${where}: 图表数据 ${spec.ref} 缺少非空 series 数组`);
  }
  const series = data.series.map((d, i) => {
    if (!d || typeof d.label !== "string") {
      fail(`${where}: 图表数据第 ${i + 1} 项缺少 label`);
    }
    if (typeof d.value !== "number" || !Number.isFinite(d.value) || d.value < 0) {
      fail(`${where}: 图表数据第 ${i + 1} 项 value 必须是非负数字`);
    }
    return { label: d.label, value: d.value };
  });
  const caption =
    typeof spec.caption === "string" && spec.caption.trim()
      ? spec.caption
      : typeof data.title === "string" && data.title.trim()
        ? data.title
        : "";

  const chart = layoutChart(eid, g, type, caption, series, theme, where);
  return chart;
}

// 图表条形几何推导：双端共用的绝对坐标（英寸）
function layoutChart(eid, g, type, caption, series, theme, where) {
  const captionH = caption ? 0.35 : 0.05;
  const labelsH = 0.3;
  const pad = 0.15;
  const plotTop = g.y + pad;
  const plotBottom = g.y + g.h - captionH - labelsH - 0.05;
  const plotH = plotBottom - plotTop;
  if (plotH < 0.8) fail(`${where}: 图表区高度不足（plotH=${plotH.toFixed(2)}in）`);
  const maxV = Math.max(...series.map((d) => d.value), 1e-9);
  const n = series.length;
  const cellW = g.w / n;
  const barW = Math.max(0.25, cellW * 0.55);
  const bars = series.map((d, i) => {
    const bh = Math.max(0.1, plotH * 0.8 * (d.value / maxV));
    return {
      label: d.label,
      value: d.value,
      x: g.x + i * cellW + (cellW - barW) / 2,
      y: plotBottom - bh,
      w: barW,
      h: bh,
    };
  });
  const captionStyle = resolveStyle(theme, "caption", where);
  const labelsText = series.map((d) => `${d.label} ${d.value}`).join(" · ");
  // labels 行与 caption 行各自做 shrink 自适应
  const labelsBox = { x: g.x, y: plotBottom + 0.05, w: g.w, h: labelsH };
  const labelsSized = autoFontSize(labelsText, captionStyle.fontFace, {
    ...labelsBox, mode: "shrink",
    fontSize: Math.min(10, captionStyle.fontSize),
    minFontSize: Math.min(8, captionStyle.minFontSize),
  });
  const captionBox = { x: g.x, y: g.y + g.h - captionH, w: g.w, h: captionH };
  const captionSized = caption
    ? autoFontSize(caption, captionStyle.fontFace, {
        ...captionBox, mode: "shrink",
        fontSize: captionStyle.fontSize,
        minFontSize: captionStyle.minFontSize,
      })
    : null;
  return {
    kind: "chart", eid, slot: null,
    frame: { ...g },
    type, caption, series, bars,
    labelsBox, labelsText,
    labelsStyle: {
      fontFace: captionStyle.fontFace,
      fontSize: labelsSized.fontSize,
      color: captionStyle.color,
    },
    captionBox,
    captionStyle: caption
      ? { fontFace: captionStyle.fontFace, fontSize: captionSized.fontSize, color: captionStyle.color }
      : null,
    barColor: theme.colors.accent,
    frameColor: theme.colors.line,
    fill: theme.colors.fill,
  };
}

function renderWorkspace(wsDir) {
  // 渲染预检：先跑 validate.js 收集全部结构/预算错误，全绿才进入渲染。
  // 这样把“内容不合法”的失败前置到生成期，避免渲染到一半才发现问题。
  const { ok, errors } = validateWorkspace(wsDir);
  if (!ok) {
    const lines = errors.map(
      (e) => `  ✗ ${e.file}${e.field ? ":" + e.field : ""} — ${e.message}`
    );
    fail(`工作区校验未通过（${errors.length} 个错误），渲染中止:\n${lines.join("\n")}`);
  }
  const deck = readJson(path.join(wsDir, "deck.json"), "deck.json");
  const theme = readJson(path.join(wsDir, "theme.json"), "theme.json");

  const size = LAYOUT_SIZES[deck.size];
  if (!size) fail(`deck.json: 不支持的画幅 "${deck.size}"（可选: ${Object.keys(LAYOUT_SIZES).join(", ")}）`);
  if (!Array.isArray(deck.slides) || deck.slides.length === 0) {
    fail("deck.json: slides 必须是非空数组");
  }
  const seen = new Set();
  const slides = deck.slides.map((meta, i) => {
    if (!meta || typeof meta.sid !== "string" || !/^[a-z0-9_]+$/i.test(meta.sid)) {
      fail(`deck.json: 第 ${i + 1} 页 sid 非法（需匹配 [a-z0-9_]+）`);
    }
    if (seen.has(meta.sid)) fail(`deck.json: sid 重复 "${meta.sid}"`);
    seen.add(meta.sid);
    if (!meta.layout) fail(`deck.json: 第 ${i + 1} 页（${meta.sid}）缺少 layout`);

    const file = path.join(wsDir, "slides", `${meta.sid}.json`);
    const slide = readJson(file, `页面 ${meta.sid}`);
    if (slide.sid !== meta.sid) {
      fail(`${file}: sid "${slide.sid}" 与 deck.json 中的 "${meta.sid}" 不一致`);
    }
    if (slide.layout !== meta.layout) {
      fail(`${file}: layout "${slide.layout}" 与 deck.json 中的 "${meta.layout}" 不一致`);
    }
    const layoutDef = theme.layouts && theme.layouts[meta.layout];
    if (!layoutDef || !layoutDef.zones) {
      fail(`${file}: 未知版式 "${meta.layout}"（theme.layouts 未定义其 zones）`);
    }
    const zones = layoutDef.zones;
    // 必需槽位检查
    for (const slot of REQUIRED_SLOTS[meta.layout] || []) {
      if (!slide[slot]) fail(`${file}: 版式 "${meta.layout}" 的必需槽位 "${slot}" 缺少内容`);
    }
    // 未知槽位检查（防拼写错误静默丢内容）
    for (const key of Object.keys(slide)) {
      if (!SLIDE_META_KEYS.has(key) && !(key in zones)) {
        fail(`${file}: 键 "${key}" 不是版式 "${meta.layout}" 的槽位（可用: ${Object.keys(zones).join(", ")}）`);
      }
    }
    const elements = [];
    for (const [slot, zoneDef] of Object.entries(zones)) {
      if (slide[slot] === undefined) continue; // 可选槽位（如 cover.subtitle）
      elements.push(expandSlot(meta.sid, slot, zoneDef, slide[slot], theme, wsDir));
    }
    return {
      sid: meta.sid,
      layout: meta.layout,
      navTitle: typeof meta.title === "string" ? meta.title : undefined,
      notes: typeof slide.notes === "string" ? slide.notes : "",
      elements,
    };
  });

  return {
    wsDir,
    deckId: deck.deckId || "untitled",
    version: deck.version || "0",
    phase: deck.phase || "wireframe",
    width: size.width,
    height: size.height,
    fonts: theme.fonts,
    colors: theme.colors,
    slides,
  };
}

if (require.main === module) {
  const wsDir = process.argv[2];
  if (!wsDir) {
    console.error("用法: node render.js <workspaceDir>");
    process.exit(2);
  }
  try {
    const tree = renderWorkspace(path.resolve(wsDir));
    const nEl = tree.slides.reduce((n, s) => n + s.elements.length, 0);
    console.log(`[render] OK deck=${tree.deckId} phase=${tree.phase} slides=${tree.slides.length} elements=${nEl}`);
    for (const s of tree.slides) {
      const desc = s.elements
        .map((e) =>
          e.kind === "chart"
            ? `${e.slot || "chart"}:chart(${e.bars.length}bars)`
            : `${e.slot}:${e.kind}@${e.fontSize}pt`
        )
        .join(" ");
      console.log(`[render]   ${s.sid} (${s.layout}) ${desc}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { renderWorkspace, LAYOUT_SIZES, BUDGET, REQUIRED_SLOTS };
