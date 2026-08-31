// Preview renderer: draws the same spec list used to build the PPTX onto
// skia-canvas PNGs, so layout can be reviewed without LibreOffice.
"use strict";

const fs = require("fs");
const path = require("path");
const { Canvas, Image } = require("skia-canvas");

const SCALE = 150; // px per inch
const FONT_MAP = {
  "Microsoft YaHei": "Noto Sans CJK SC",
  "微软雅黑": "Noto Sans CJK SC",
  Consolas: "DejaVu Sans Mono",
  Arial: "DejaVu Sans",
};

function mapFont(face) {
  return FONT_MAP[face] || face || "DejaVu Sans";
}
function pt2px(pt) {
  return (pt * SCALE) / 72;
}
function cssColor(c) {
  if (!c) return "#000000";
  return c.startsWith("#") ? c : "#" + c;
}

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF01-\uFF60]/;
function isCJK(ch) {
  return CJK_RE.test(ch);
}

function setFont(ctx, run) {
  const px = pt2px(run.size || 12);
  const fam = mapFont(run.font);
  ctx.font = `${run.bold ? "bold " : ""}${px}px "${fam}"`;
  return px;
}

function wrapText(ctx, text, maxW) {
  const out = [];
  let cur = "";
  for (const ch of text) {
    const test = cur + ch;
    if (cur === "" || ctx.measureText(test).width <= maxW) {
      cur = test;
    } else {
      if (!isCJK(ch)) {
        const li = cur.lastIndexOf(" ");
        if (li > 0) {
          out.push(cur.slice(0, li));
          cur = cur.slice(li + 1) + ch;
          continue;
        }
      }
      out.push(cur);
      cur = ch;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

function drawSimpleText(ctx, spec) {
  const run = {
    size: spec.size,
    font: spec.font,
    bold: spec.bold,
  };
  const px = setFont(ctx, run);
  const maxW = spec.w * SCALE;
  const lines = [];
  for (const seg of String(spec.text).split("\n")) {
    lines.push(...wrapText(ctx, seg, maxW));
  }
  const leading = spec.leading || 1.2;
  const lh = px * leading;
  const totalH = lines.length * lh;
  let y0 = spec.y * SCALE;
  const hPx = spec.h * SCALE;
  if (spec.valign === "m") y0 += Math.max(0, (hPx - totalH) / 2);
  else if (spec.valign === "b") y0 += Math.max(0, hPx - totalH);
  else y0 += (lh - px) / 2;

  ctx.fillStyle = cssColor(spec.color);
  const x0 = spec.x * SCALE;
  const wPx = spec.w * SCALE;
  for (let i = 0; i < lines.length; i++) {
    const lw = ctx.measureText(lines[i]).width;
    let x = x0;
    if (spec.align === "c") x += (wPx - lw) / 2;
    else if (spec.align === "r") x += wPx - lw;
    ctx.fillText(lines[i], x, y0 + lh * i + px * 0.84);
  }
}

function layoutRunsToLines(ctx, runs, maxW) {
  const tokens = [];
  for (const r of runs) {
    const o = r.options || {};
    const style = {
      size: o.fontSize || 12,
      color: o.color || "FFFFFF",
      font: o.fontFace || "Microsoft YaHei",
      bold: !!o.bold,
    };
    const parts = String(r.text).split("\n");
    parts.forEach((p, i) => {
      if (i > 0) tokens.push({ br: true });
      if (p) tokens.push({ text: p, ...style });
    });
  }
  const lines = [[]];
  let lw = 0;
  for (const t of tokens) {
    if (t.br) {
      lines.push([]);
      lw = 0;
      continue;
    }
    const px = setFont(ctx, t);
    const w = ctx.measureText(t.text).width;
    if (lw + w > maxW && lw > 0) {
      lines.push([]);
      lw = 0;
    }
    lines[lines.length - 1].push({ ...t, w });
    lw += w;
  }
  return lines;
}

function drawRunsText(ctx, spec) {
  const probe = ctx.save();
  const maxW = spec.w * SCALE;
  const lines = layoutRunsToLines(ctx, spec.runs, maxW);
  // use first non-empty run size for leading calc
  const firstRun = spec.runs.find((r) => (r.text || "").trim().length > 0);
  const baseSize = firstRun ? firstRun.options.fontSize || 12 : 12;
  const px = pt2px(baseSize);
  const leading = spec.leading || 1.35;
  const lh = px * leading;
  const totalH = lines.length * lh;
  let y0 = spec.y * SCALE;
  const hPx = spec.h * SCALE;
  if (spec.valign === "m") y0 += Math.max(0, (hPx - totalH) / 2);
  else if (spec.valign === "b") y0 += Math.max(0, hPx - totalH);
  else y0 += (lh - px) / 2;

  const x0 = spec.x * SCALE;
  const wPx = spec.w * SCALE;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lwTotal = line.reduce((s, t) => s + t.w, 0);
    let x = x0;
    const align = spec.align || "l";
    if (align === "c") x += (wPx - lwTotal) / 2;
    else if (align === "r") x += wPx - lwTotal;
    for (const t of line) {
      ctx.font = `${t.bold ? "bold " : ""}${pt2px(t.size)}px "${mapFont(t.font)}"`;
      ctx.fillStyle = cssColor(t.color);
      ctx.fillText(t.text, x, y0 + lh * i + pt2px(t.size) * 0.84);
      x += t.w;
    }
  }
  ctx.restore(probe);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawRect(ctx, spec) {
  const x = spec.x * SCALE,
    y = spec.y * SCALE,
    w = spec.w * SCALE,
    h = spec.h * SCALE;
  if (spec.fill) {
    ctx.fillStyle = cssColor(spec.fill);
    if (spec.radius) {
      roundRectPath(ctx, x, y, w, h, spec.radius * SCALE);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }
  if (spec.line) {
    ctx.strokeStyle = cssColor(spec.line.color || spec.line);
    ctx.lineWidth = (spec.line.width || 1) * (SCALE / 96);
    if (spec.radius) {
      roundRectPath(ctx, x, y, w, h, spec.radius * SCALE);
      ctx.stroke();
    } else {
      ctx.strokeRect(x, y, w, h);
    }
  }
}

function drawOval(ctx, spec) {
  const x = spec.x * SCALE,
    y = spec.y * SCALE,
    w = spec.w * SCALE,
    h = spec.h * SCALE;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  if (spec.fill) {
    ctx.fillStyle = cssColor(spec.fill);
    ctx.fill();
  }
  if (spec.line) {
    ctx.strokeStyle = cssColor(spec.line.color || spec.line);
    ctx.lineWidth = (spec.line.width || 1) * (SCALE / 96);
    ctx.stroke();
  }
}

function drawLine(ctx, spec) {
  ctx.beginPath();
  ctx.moveTo(spec.x * SCALE, spec.y * SCALE);
  ctx.lineTo((spec.x + (spec.w || 0)) * SCALE, (spec.y + (spec.h || 0)) * SCALE);
  ctx.strokeStyle = cssColor(spec.color);
  ctx.lineWidth = (spec.width || 1) * (SCALE / 96);
  ctx.stroke();
}

function drawImageEl(ctx, spec) {
  // spec.data: Buffer (svg or png)
  return new Promise((resolve) => {
    const img = new Image();
    img.src = spec.data;
    img
      .decode()
      .then(() => {
        ctx.drawImage(img, spec.x * SCALE, spec.y * SCALE, spec.w * SCALE, spec.h * SCALE);
        resolve();
      })
      .catch(() => resolve());
  });
}

function drawCellText(ctx, text, cx, cy, cw, ch, o) {
  const run = { size: o.fontSize || 10, font: o.fontFace || "Microsoft YaHei", bold: !!o.bold };
  const px = setFont(ctx, run);
  const padX = 0.08 * SCALE;
  const maxW = cw - padX * 2;
  const lines = [];
  for (const seg of String(text).split("\n")) lines.push(...wrapText(ctx, seg, maxW));
  const leading = 1.15;
  const lh = px * leading;
  const totalH = lines.length * lh;
  let y0 = cy;
  if ((o.valign || "middle") === "middle") y0 += Math.max(0, (ch - totalH) / 2);
  else y0 += (lh - px) / 2;
  ctx.fillStyle = cssColor(o.color || "1A2233");
  lines.forEach((ln, i) => {
    const lw = ctx.measureText(ln).width;
    let x = cx + padX;
    const align = o.align || "left";
    if (align === "center") x = cx + (cw - lw) / 2;
    else if (align === "right") x = cx + cw - padX - lw;
    ctx.fillText(ln, x, y0 + lh * i + px * 0.84);
  });
}

function drawTable(ctx, spec) {
  const x = spec.x * SCALE;
  let cy = spec.y * SCALE;
  spec.rows.forEach((row, ri) => {
    const h = (row.h || spec.rowH || 0.5) * SCALE;
    let cx = x;
    row.cells.forEach((cell, ci) => {
      const cw = spec.colW[ci] * SCALE;
      const o = cell.options || {};
      if (o.fill) {
        ctx.fillStyle = cssColor(o.fill);
        ctx.fillRect(cx, cy, cw, h);
      }
      ctx.strokeStyle = cssColor(spec.borderColor || "D8DEE8");
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, cy, cw, h);
      if (cell.text !== "" && cell.text != null) {
        drawCellText(ctx, cell.text, cx, cy, cw, h, o);
      }
      cx += cw;
    });
    cy += h;
  });
}

async function renderSlide(specs, wIn, hIn, outPath) {
  const canvas = new Canvas(wIn * SCALE, hIn * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pending = [];
  for (const spec of specs) {
    switch (spec.type) {
      case "rect":
        drawRect(ctx, spec);
        break;
      case "oval":
        drawOval(ctx, spec);
        break;
      case "line":
        drawLine(ctx, spec);
        break;
      case "text":
        drawSimpleText(ctx, spec);
        break;
      case "runs":
        drawRunsText(ctx, spec);
        break;
      case "table":
        drawTable(ctx, spec);
        break;
      case "image":
        pending.push(drawImageEl(ctx, spec));
        break;
      default:
        break;
    }
  }
  await Promise.all(pending);
  const out = await canvas.toBuffer("png");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out);
}

module.exports = { renderSlide, SCALE };
