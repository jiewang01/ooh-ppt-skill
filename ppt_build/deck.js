"use strict";

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const HLP = require("./pptxgenjs_helpers");
const { renderSlide } = require("./preview");

const W = 13.333, H = 7.5;
const F = "Microsoft YaHei";
const MONO = "Consolas";

const INK = "1A2233", MUTED = "5A6478", FAINT = "97A1B4";
const BLUE = "0A59F7", BLUE_DK = "0B47B8", BLUE_LT = "EAF1FE";
const NAVY = "0A1633", NAVY2 = "152B4E", NAVY3 = "1E3A6B";
const TEAL = "0E8A8A", PURPLE = "6E56CF", ORANGE = "E8830C";
const GREEN = "1FA24A", RED = "E03E36";
const BG = "F5F7FA", BORDER = "E2E8F0", CARD = "FFFFFF", CARD2 = "FBFCFE";
const CODE_BG = "16233B", CODE_BORDER = "24365A";

const AL = { l: "left", c: "center", r: "right" };
const VA = { t: "top", m: "middle", b: "bottom" };

const pptx = new pptxgen();
pptx.defineLayout({ name: "W169", width: W, height: H });
pptx.layout = "W169";
pptx.author = "TRAE";
pptx.company = "gitcode.com/hdcck";
pptx.subject = "HarmonyOS 应用内存分析工具";
pptx.title = "HarmonyOS 应用内存分析工具";

let specs = [];

function R(s, x, y, w, h, o) {
  o = o || {};
  const opt = { x, y, w, h };
  opt.fill = o.fill ? { color: o.fill } : { type: "none" };
  opt.line = o.line ? { color: o.line.color, width: o.line.width || 1 } : { type: "none" };
  if (o.radius) opt.rectRadius = o.radius;
  if (o.shadow) opt.shadow = o.shadow;
  s.addShape(o.radius ? "roundRect" : "rect", opt);
  specs.push({ type: "rect", x, y, w, h, fill: o.fill, line: o.line, radius: o.radius });
}
function O(s, x, y, w, h, o) {
  o = o || {};
  const opt = { x, y, w, h };
  opt.fill = o.fill ? { color: o.fill } : { type: "none" };
  opt.line = o.line ? { color: o.line.color, width: o.line.width || 1 } : { type: "none" };
  s.addShape("ellipse", opt);
  specs.push({ type: "oval", x, y, w, h, fill: o.fill, line: o.line });
}
function LN(s, x, y, dx, dy, o) {
  o = o || {};
  s.addShape("line", { x, y, w: dx, h: dy, line: { color: o.color || BORDER, width: o.width || 1 } });
  specs.push({ type: "line", x, y, w: dx, h: dy, color: o.color || BORDER, width: o.width || 1 });
}
function T(s, x, y, w, h, text, o) {
  o = o || {};
  s.addText(String(text), {
    x, y, w, h,
    fontSize: o.size, fontFace: o.font || F, bold: !!o.bold, italic: !!o.italic,
    color: o.color || INK, align: AL[o.align] || "left", valign: VA[o.valign] || "top",
    lineSpacingMultiple: o.leading || 1.15,
  });
  specs.push({
    type: "text", x, y, w, h, text: String(text), size: o.size, font: o.font || F,
    bold: !!o.bold, color: o.color || INK, align: o.align || "l", valign: o.valign || "t", leading: o.leading || 1.2,
  });
}
function TR(s, x, y, w, h, runs, o) {
  o = o || {};
  const fr = runs.map((r) => ({ text: r.text, options: Object.assign({ fontFace: F }, r.options || {}) }));
  s.addText(fr, { x, y, w, h, align: AL[o.align] || "left", valign: VA[o.valign] || "top", lineSpacingMultiple: o.leading || 1.35 });
  specs.push({ type: "runs", x, y, w, h, runs: fr, align: o.align || "l", valign: o.valign || "t", leading: o.leading || 1.35 });
}
function CODE(s, x, y, w, h, code, lang, o) {
  o = o || {};
  R(s, x, y, w, h, { fill: CODE_BG, radius: 0.1, line: { color: CODE_BORDER, width: 1 } });
  let runs = HLP.codeToRuns(code, lang);
  if (o.size) runs = runs.map((r) => ({ text: r.text, options: Object.assign({}, r.options, { fontSize: o.size }) }));
  TR(s, x + 0.22, y + 0.16, w - 0.44, h - 0.32, runs, { valign: "t", leading: o.leading || 1.3 });
}
function TB(s, x, y, colW, rows, o) {
  o = o || {};
  const bc = o.borderColor || BORDER;
  const trows = rows.map((r) => r.cells.map((c) => {
    const co = c.options || {};
    const cellOpt = {
      fontSize: co.fontSize || 9.5, fontFace: co.fontFace || F, bold: !!co.bold,
      color: co.color || INK, align: AL[co.align] || "left", valign: VA[co.valign] || "middle",
      border: { type: "solid", pt: 0.5, color: bc }, margin: [0.04, 0.09, 0.04, 0.09],
    };
    if (co.fill) cellOpt.fill = { color: co.fill };
    return { text: String(c.text == null ? "" : c.text), options: cellOpt };
  }));
  s.addTable(trows, { x, y, colW, rowH: rows.map((r) => r.h), border: { type: "solid", pt: 0.5, color: bc }, align: "left", valign: "middle" });
  specs.push({ type: "table", x, y, colW, rows, borderColor: bc });
}

function frame(num, kicker, title) {
  const s = pptx.addSlide();
  s.background = { color: BG };
  specs = [];
  R(s, 0, 0, W, 0.09, { fill: BLUE });
  T(s, 0.6, 0.4, 9.5, 0.3, kicker, { size: 12, color: BLUE, bold: true });
  T(s, 0.6, 0.7, 11.6, 0.62, title, { size: 27, color: NAVY, bold: true });
  LN(s, 0.6, 1.4, 12.13, 0, { color: BORDER, width: 1 });
  T(s, 0.6, 7.08, 7, 0.3, "HarmonyOS 应用内存分析工具", { size: 9, color: FAINT });
  O(s, W - 1.78, 7.17, 0.07, 0.07, { fill: BLUE });
  T(s, W - 1.65, 7.08, 1.05, 0.3, num + " / 11", { size: 9, color: FAINT, align: "r" });
  return s;
}

function pill(s, x, y, w, h, text, fill, color) {
  R(s, x, y, w, h, { fill: fill, radius: h / 2 });
  T(s, x + 0.03, y + 0.02, w - 0.06, h - 0.04, text, { size: 10.5, color: color, bold: true, align: "c", valign: "m" });
}
function card(s, x, y, w, h, o) {
  o = o || {};
  R(s, x, y, w, h, { fill: o.fill || CARD, radius: o.radius || 0.1, line: { color: o.border || BORDER, width: o.borderWidth || 1 } });
  if (o.accent) R(s, x, y + 0.14, 0.06, h - 0.28, { fill: o.accent, radius: 0.03 });
}

/* ============ SLIDE 1 : COVER ============ */
function buildS1() {
  const s = pptx.addSlide();
  s.background = { color: NAVY };
  specs = [];
  R(s, 0, 0, W, H, { fill: NAVY });
  R(s, 0, 0, W, H * 0.55, { fill: NAVY2 });
  R(s, 0, 0, W, 0.12, { fill: BLUE });
  O(s, 10.4, -1.1, 3.6, 3.6, { fill: NAVY3 });
  O(s, 11.6, 4.7, 2.8, 2.8, { fill: NAVY3 });
  O(s, 9.7, 0.7, 0.5, 0.5, { fill: BLUE });

  // peak bar chart (right)
  const bars = [1.0, 1.5, 2.0, 2.85, 2.25, 1.65, 1.15];
  const baseY = 6.45, bx = 8.75, slot = 0.5, bw = 0.34;
  LN(s, 8.6, baseY + 0.02, 3.7, 0, { color: NAVY3, width: 1.5 });
  bars.forEach((bh, i) => {
    const isPeak = i === 3;
    const col = isPeak ? BLUE : (i % 2 === 0 ? BLUE_DK : "1E5BB0");
    R(s, bx + i * slot, baseY - bh, bw, bh, { fill: col, radius: 0.04 });
    if (isPeak) {
      R(s, bx + i * slot, baseY - bh - 0.16, bw, 0.1, { fill: "5B9BFF", radius: 0.03 });
      T(s, bx + i * slot - 0.1, baseY - bh - 0.46, bw + 0.2, 0.28, "峰值", { size: 9, color: "9DBEFF", align: "c", bold: true });
    }
  });

  // left text block
  T(s, 0.75, 2.2, 7.5, 0.34, "鸿蒙 · Native Memory & Ftrace 分析", { size: 14.5, color: "6FA0FF", bold: true });
  LN(s, 0.78, 2.66, 0.62, 0, { color: BLUE, width: 3 });
  T(s, 0.75, 2.86, 7.6, 0.5, "HarmonyOS", { size: 30, color: "8FB6FF", bold: true });
  T(s, 0.75, 3.42, 7.8, 0.6, "应用内存分析工具", { size: 46, color: "FFFFFF", bold: true });
  T(s, 0.78, 4.62, 7.4, 0.4, "Trace 抓取  ·  峰值定位  ·  穿透归属  ·  归因报告", { size: 16, color: "B8C8E6" });

  // repo chip
  R(s, 0.75, 6.35, 6.5, 0.5, { fill: NAVY2, radius: 0.25, line: { color: NAVY3, width: 1 } });
  O(s, 0.98, 6.5, 0.2, 0.2, { fill: BLUE });
  T(s, 1.35, 6.37, 5.85, 0.46, "gitcode.com/hdcck/harmonyos-memory-analyzer", { size: 12, color: "D6E2F7", font: MONO, valign: "m" });
  T(s, 8.75, 6.95, 2.7, 0.3, "技术概览  ·  2026.08", { size: 10, color: "7E92B8", align: "c" });
  return s;
}

/* ============ SLIDE 2 : OVERVIEW ============ */
function buildS2() {
  const s = frame(2, "01 · 项目概览", "是什么 · 解决什么问题");
  // left: positioning card
  card(s, 0.6, 1.7, 6.7, 4.55, { accent: BLUE });
  T(s, 0.95, 1.9, 6.2, 0.34, "工具定位", { size: 15, color: NAVY, bold: true });
  const pts = [
    ["抓取", "采集鸿蒙应用 Native Memory 与 Ftrace 数据"],
    ["分析", "精确峰值定位、内存泄漏检测、调用链归属"],
    ["归因", "多维度内存归因（Native/ARKTS/ION/GPU/JS/Swap）"],
    ["目标", "鸿蒙应用内存性能调优、泄漏排查、版本对比"],
  ];
  pts.forEach((p, i) => {
    const y = 2.42 + i * 0.86;
    R(s, 0.95, y + 0.06, 0.16, 0.16, { fill: BLUE, radius: 0.04 });
    T(s, 1.28, y, 1.1, 0.34, p[0], { size: 12.5, color: BLUE, bold: true, valign: "m" });
    T(s, 2.4, y, 4.7, 0.7, p[1], { size: 12, color: INK, valign: "m", leading: 1.2 });
  });

  // right: stat chips
  const stats = [
    ["4", "种采集模式", "事件 / 统计 / 采样 / 数据", BLUE],
    ["10", "章节归因报告", "--attribution 全景分解", PURPLE],
    ["13.5×", "调用链查询提速", "540s → 40s 批量优化", TEAL],
    ["<3%", "Swap 差距验证", "smaps vs hidumper", GREEN],
  ];
  stats.forEach((st, i) => {
    const x = 7.55, y = 1.7 + i * 1.18;
    card(s, x, y, 5.18, 1.02, {});
    T(s, x + 0.25, y, 1.7, 1.02, st[0], { size: 30, color: st[3], bold: true, align: "l", valign: "m" });
    LN(s, x + 1.95, y + 0.2, 0, 0.62, { color: BORDER, width: 1 });
    T(s, x + 2.15, y + 0.14, 2.9, 0.36, st[1], { size: 12.5, color: NAVY, bold: true, valign: "m" });
    T(s, x + 2.15, y + 0.5, 2.9, 0.36, st[2], { size: 10, color: MUTED, valign: "m" });
  });
  return s;
}

/* ============ SLIDE 3 : CORE FEATURES ============ */
function buildS3() {
  const s = frame(3, "02 · 核心能力", "功能特性全景");
  const feats = [
    ["事件模式（推荐）", "逐事件记录分配/释放，精确峰值与泄漏", BLUE],
    ["采样模式", "仅 hidumper + smaps 快照，低开销", TEAL],
    ["数据模式", "轻量采集，自动生成 PSS 趋势图", PURPLE],
    ["峰值分析", "结合 hidumper 时序，多维度分解峰值", ORANGE],
    ["智能穿透归属", "穿透基础设施库，定位业务调用者", BLUE_DK],
    ["归因分析", "多维度归因 + 差距分析（<3%）", RED],
    ["深度报告", "调用链 / 时间序列 / FD 泄漏检测", GREEN],
    ["屏幕截屏同步", "采集期 ~3FPS 截屏，时间对齐", TEAL],
    ["Ftrace 抓取归档", "抓取系统追踪数据并归档", MUTED],
    ["符号缺失检测", "自动识别待符号化库并给方案", ORANGE],
    ["单 SO 深度分析", "分析指定 SO 的内存分配详情", PURPLE],
    ["ArkUI 节点树可视化", "节点 dump + SVG 布局 + 差分对比", BLUE],
  ];
  const cw = 3.84, ch = 1.05, gx = 0.3, gy = 0.2;
  const x0 = 0.6, y0 = 1.66;
  feats.forEach((f, i) => {
    const c = i % 3, r = Math.floor(i / 3);
    const x = x0 + c * (cw + gx), y = y0 + r * (ch + gy);
    card(s, x, y, cw, ch, {});
    R(s, x + 0.2, y + 0.21, 0.16, 0.16, { fill: f[2], radius: 0.04 });
    T(s, x + 0.46, y + 0.14, cw - 0.6, 0.32, f[0], { size: 12.5, color: NAVY, bold: true, valign: "m" });
    T(s, x + 0.2, y + 0.52, cw - 0.4, 0.46, f[1], { size: 10, color: MUTED, leading: 1.18 });
  });
  return s;
}

/* ============ SLIDE 4 : MODES COMPARISON ============ */
function buildS4() {
  const s = frame(4, "03 · 模式选型", "四种采集模式对比");
  const colW = [1.72, 2.86, 2.4, 2.57, 2.58];
  const hH = 0.42, rH = 0.52;
  const hdr = ["对比项", "事件模式  ★推荐", "统计模式", "采样模式", "数据模式"];
  const data = [
    ["配置", ["statistics_interval:0", "statistics_interval:10", "无需配置", "无需配置"], true],
    ["数据表", ["native_hook", "native_hook_statistic", "CSV 文件", "CSV 文件"], true],
    ["精确峰值", ["支持（配 hidumper）", "不支持", "部分（系统级）", "部分（系统级）"], false],
    ["泄漏检测", ["支持", "不支持", "不支持", "不支持"], false],
    ["趋势图", ["无", "无", "无", "自动生成"], false],
    [".hap 帧", ["支持", "支持", "不支持", "不支持"], false],
    ["采集开销", ["高", "中", "低", "低"], false],
    ["适用场景", ["精确峰值 / 泄漏 / 持有", "分配热点 / ArkTS", "快照 / 长时监控", "快速看趋势"], false],
  ];
  const rows = [];
  rows.push({
    h: hH,
    cells: hdr.map((t, i) => ({
      text: t,
      options: {
        fill: i === 1 ? BLUE : NAVY, color: i === 1 ? "FFFFFF" : "FFFFFF",
        bold: true, fontSize: 10.5, align: i === 0 ? "l" : "c", valign: "m",
      },
    })),
  });
  const valColor = (v) => v === "支持" || v.indexOf("支持") === 0 ? GREEN : v.indexOf("不支持") === 0 ? RED : v.indexOf("部分") === 0 ? ORANGE : INK;
  data.forEach((d, di) => {
    const isCfg = d[2];
    rows.push({
      h: rH,
      cells: [{ text: d[0], options: { fill: di % 2 ? CARD2 : "FFFFFF", bold: true, color: NAVY, fontSize: 9.8, align: "l" } }].concat(
        d[1].map((v) => ({
          text: v,
          options: {
            fill: di % 2 ? CARD2 : "FFFFFF",
            color: isCfg ? MUTED : valColor(v),
            fontSize: isCfg ? 8.6 : 9.3,
            fontFace: isCfg ? MONO : F,
            align: "c", valign: "m",
          },
        }))
      ),
    });
  });
  TB(s, 0.6, 1.62, colW, rows, {});
  T(s, 0.6, 6.35, 12.13, 0.4, "★ 事件模式为推荐默认：精确峰值 + 泄漏检测 + 内存持有分析能力最完整；采样/数据模式适合无需 trace 的快速查看。", { size: 10.5, color: MUTED, leading: 1.2 });
  return s;
}

/* ============ SLIDE 5 : QUICK START ============ */
function buildS5() {
  const s = frame(5, "04 · 快速开始", "环境要求与一键抓取");
  // left: env requirements
  card(s, 0.6, 1.66, 5.95, 2.5, { accent: BLUE });
  T(s, 0.95, 1.86, 5.4, 0.32, "环境要求", { size: 14.5, color: NAVY, bold: true });
  const env = [
    ["macOS / Linux / Windows", "跨平台运行"],
    ["Python 3.x", "分析脚本运行时"],
    ["hdc", "鸿蒙调试工具"],
    ["root 设备（必需）", "采集 Native Memory Trace"],
    ["DFX 小包（必需）", "hiprofiler 数据采集"],
  ];
  env.forEach((e, i) => {
    const y = 2.3 + i * 0.37;
    R(s, 0.97, y + 0.05, 0.1, 0.1, { fill: BLUE });
    T(s, 1.2, y - 0.06, 2.7, 0.3, e[0], { size: 10.5, color: INK, bold: true, valign: "m" });
    T(s, 3.95, y - 0.06, 2.5, 0.3, e[1], { size: 10, color: MUTED, valign: "m" });
  });
  // left: install
  T(s, 0.6, 4.32, 5.95, 0.28, "安装", { size: 12, color: NAVY, bold: true });
  CODE(s, 0.6, 4.62, 5.95, 1.62,
    "git clone https://gitcode.com/hdcck/harmonyos-memory-analyzer.git\ncd harmonyos-memory-analyzer\nchmod +x scripts/*.sh scripts/*.py", "bash", { size: 9.5 });

  // right: one-shot capture
  T(s, 6.78, 1.66, 5.95, 0.28, "一键抓取（事件模式）", { size: 12, color: NAVY, bold: true });
  CODE(s, 6.78, 1.96, 5.95, 2.2,
    "# 事件模式（推荐）\n./scripts/memory_analyze.sh \\\n  --package com.example.app --duration 60 \\\n  --config hiprofiler_nativehook_event.txt\n\n# 启用归因分析\n./scripts/memory_analyze.sh -p com.example.app -d 60 --attribution\n\n# 带屏幕截屏同步\n./scripts/memory_analyze.sh -p com.tencent.wechat -d 70 --screen",
    "bash", { size: 8.8, leading: 1.22 });
  // right: prompts
  T(s, 6.78, 4.32, 5.95, 0.28, "提示词示例", { size: 12, color: NAVY, bold: true });
  card(s, 6.78, 4.62, 5.95, 1.62, { fill: BLUE_LT, border: "CFE0FF" });
  const prompts = [
    "用事件模式抓取 com.example.app 的 Native Memory，60 秒",
    "抓取并分析鸿蒙应用内存峰值，生成深度报告",
    "用事件模式抓取小红书内存，60秒，--attribution",
  ];
  prompts.forEach((p, i) => {
    const y = 4.78 + i * 0.46;
    T(s, 7.0, y, 0.3, 0.3, ">", { size: 12, color: BLUE, bold: true, valign: "m" });
    T(s, 7.32, y, 5.3, 0.4, p, { size: 10, color: INK, valign: "m", leading: 1.15 });
  });
  return s;
}

/* ============ SLIDE 6 : CLI ============ */
function buildS6() {
  const s = frame(6, "05 · 命令行用法", "核心脚本参数一览");
  T(s, 0.6, 1.6, 5.95, 0.28, "memory_analyze.sh — 抓取", { size: 12, color: BLUE, bold: true });
  CODE(s, 0.6, 1.9, 5.95, 3.7,
    "--package, -p <包名>   目标应用包名（必需）\n--duration, -d <秒>    抓取时长（默认 20）\n--config,  -c <文件>   配置文件（推荐 event.txt）\n--type,    -t <类型>   nativehook | ftrace\n                       | hidumper-only | data\n--output,  -o <目录>   输出目录名（可选）\n--screen              采集期间同步截屏（~3FPS）\n--attribution         启用归因分析（仅事件模式）",
    "bash", { size: 10, leading: 1.3 });

  T(s, 6.78, 1.6, 5.95, 0.28, "analyze_peak_memory.py — 分析", { size: 12, color: PURPLE, bold: true });
  CODE(s, 6.78, 1.9, 5.95, 3.7,
    "--db <路径>           memory.db 路径（必需）\n--hidumper <路径>      mem_capture.csv（smaps，必需）\n--hidumper-detail <路径> hidumper_capture.csv（可选）\n--output <路径>        报告输出路径\n--peak-strategy        pss_max | anon_max | smoothed\n--deep-dive            callchain | timeseries | fd | all",
    "bash", { size: 10, leading: 1.3 });

  // bottom: other tools
  const tools = [
    ["align_screen_timestamps.py", "峰值时刻 → 对应截屏帧", TEAL],
    ["get_arkui_node.py", "ArkUI 节点树 dump 采集", BLUE],
    ["analyze_single_so.py", "指定 SO 内存分配深度分析", PURPLE],
  ];
  tools.forEach((t, i) => {
    const x = 0.6 + i * 4.04;
    card(s, x, 5.85, 3.9, 1.0, {});
    R(s, x + 0.2, 6.0, 0.16, 0.16, { fill: t[2], radius: 0.04 });
    T(s, x + 0.46, 5.93, 3.3, 0.34, t[0], { size: 10, color: NAVY, bold: true, valign: "m", font: MONO });
    T(s, x + 0.2, 6.34, 3.5, 0.4, t[1], { size: 9.5, color: MUTED, valign: "m" });
  });
  return s;
}

/* ============ SLIDE 7 : ATTRIBUTION LOGIC ============ */
function buildS7() {
  const s = frame(7, "06 · 核心算法", "智能穿透归属逻辑");
  // left: callstack example
  T(s, 0.6, 1.6, 6.3, 0.28, "调用栈穿透示例", { size: 12.5, color: NAVY, bold: true });
  const stack = [
    ["d0", "libark_jsruntime.so", "基础设施", MUTED, "EEF1F6"],
    ["d13", "libace_napi.z.so", "基础设施", MUTED, "EEF1F6"],
    ["d22", "libuv.so", "基础设施", MUTED, "EEF1F6"],
    ["d24", "libc++.so  operator new", "归属帧", PURPLE, "F1ECFB"],
    ["d25", "libnative_hook", "hook 点", ORANGE, "FDF1E2"],
  ];
  const ry0 = 2.0, rh = 0.62, rg = 0.13;
  stack.forEach((r, i) => {
    const y = ry0 + i * (rh + rg);
    R(s, 0.6, y, 6.3, rh, { fill: r[4], radius: 0.08, line: { color: BORDER, width: 1 } });
    R(s, 0.78, y + 0.12, 0.62, 0.38, { fill: "FFFFFF", radius: 0.06, line: { color: r[3], width: 1 } });
    T(s, 0.80, y + 0.14, 0.58, 0.34, r[0], { size: 11, color: r[3], bold: true, align: "c", valign: "m", font: MONO });
    T(s, 1.55, y, 3.0, rh, r[1], { size: 10.5, color: INK, valign: "m", font: MONO });
    pill(s, 4.7, y + 0.17, 1.55, 0.28, r[2], r[4], r[3]);
  });
  // arrow + result
  LN(s, 3.75, 5.62, 0, 0.32, { color: BLUE, width: 2 });
  T(s, 3.0, 5.62, 1.5, 0.3, "穿透", { size: 9, color: BLUE, bold: true, align: "r", valign: "m" });
  R(s, 0.9, 5.98, 5.7, 0.62, { fill: BLUE, radius: 0.1 });
  T(s, 0.93, 6.0, 5.64, 0.58, "→  归属到更上层的业务调用者", { size: 12, color: "FFFFFF", bold: true, align: "c", valign: "m" });

  // right: rules + infra libs
  T(s, 7.1, 1.6, 5.6, 0.28, "穿透规则（4 步）", { size: 12.5, color: NAVY, bold: true });
  const rules = [
    "找到 hook 点：定位 ohos_malloc_hook / libnative_hook 所在 depth",
    "确定归属帧：取 hook 点前一帧（depth - 1）",
    "穿透基础设施库：若归属帧是基础设施库，向上查找首个非基础设施库",
    "归属业务库：该调用链内存归属于穿透后的帧",
  ];
  rules.forEach((r, i) => {
    const y = 2.0 + i * 0.62;
    O(s, 7.2, y + 0.06, 0.28, 0.28, { fill: BLUE });
    T(s, 7.22, y + 0.08, 0.24, 0.24, i + 1, { size: 11, color: "FFFFFF", bold: true, align: "c", valign: "m" });
    T(s, 7.62, y, 5.0, 0.56, r, { size: 10.3, color: INK, valign: "m", leading: 1.18 });
  });
  T(s, 7.1, 4.62, 5.6, 0.28, "基础设施库清单（自动穿透）", { size: 12, color: NAVY, bold: true });
  const libs = [
    ["C/C++ 标准库", "ld-musl · libc++", MUTED],
    ["ArkTS 运行时", "ark_jsruntime · ace_napi", PURPLE],
    ["事件循环/协程", "libuv · libffrt · taskpool", TEAL],
    ["Native Hook", "libnative_hook · libdfmalloc", ORANGE],
    ["硬件抽象层", "libdh-linux · libhmulibs", BLUE_DK],
    ["系统目录库", "/bin · /lib · /liblinux", MUTED],
  ];
  libs.forEach((l, i) => {
    const c = i % 2, r = Math.floor(i / 2);
    const x = 7.1 + c * 2.85, y = 5.0 + r * 0.62;
    R(s, x, y, 2.7, 0.52, { fill: CARD, radius: 0.08, line: { color: BORDER, width: 1 } });
    R(s, x + 0.12, y + 0.13, 0.12, 0.12, { fill: l[2], radius: 0.03 });
    T(s, x + 0.32, y + 0.05, 2.3, 0.2, l[0], { size: 9.5, color: NAVY, bold: true, valign: "m" });
    T(s, x + 0.32, y + 0.29, 2.3, 0.2, l[1], { size: 8, color: MUTED, valign: "m", font: MONO });
  });
  return s;
}

/* ============ SLIDE 8 : ATTRIBUTION REPORT 10 SECTIONS ============ */
function buildS8() {
  const s = frame(8, "07 · 归因报告", "attribution_report.md · 10 章节结构");
  const secs = [
    ["总览", "各内存类型 分配 / 释放 / 未释放 汇总"],
    ["差距分析", "归因报告 vs hidumper PSS 差距来源"],
    ["Native Heap 归因", "Top SO + Top 调用链（穿透到应用 SO）"],
    ["ARKTS Heap 归因", "Top 包 + 包×函数 + Top 调用链"],
    ["ION 归因", "DMA 缓冲区归属到应用 SO"],
    ["GPU 归因", "Vulkan + OpenGL ES 归属应用 SO"],
    ["JS Heap 归因", "V8 JS 堆归属到应用 SO"],
    ["filepage other", "Preferences / ashmem（取自 smaps）"],
    ["SO 代码段映射", "SO 库代码段 PSS / RSS / Size"],
    ["Swap 内存", "已换出页面分布（取自 smaps）"],
  ];
  const cw = 5.865, ch = 0.92, gx = 0.4, gy = 0.165, x0 = 0.6, y0 = 1.66;
  secs.forEach((sec, i) => {
    const c = i % 2, r = Math.floor(i / 2);
    const x = x0 + c * (cw + gx), y = y0 + r * (ch + gy);
    card(s, x, y, cw, ch, {});
    R(s, x + 0.16, y + 0.18, 0.56, 0.56, { fill: BLUE_LT, radius: 0.1 });
    T(s, x + 0.19, y + 0.21, 0.5, 0.5, String(i + 1), { size: 18, color: BLUE, bold: true, align: "c", valign: "m" });
    T(s, x + 0.88, y + 0.13, cw - 1.1, 0.3, sec[0], { size: 12.5, color: NAVY, bold: true, valign: "m" });
    T(s, x + 0.88, y + 0.45, cw - 1.1, 0.4, sec[1], { size: 9.8, color: MUTED, valign: "m", leading: 1.15 });
  });
  return s;
}

/* ============ SLIDE 9 : OUTPUT FILES ============ */
function buildS9() {
  const s = frame(9, "08 · 产物", "输出文件结构");
  T(s, 0.6, 1.6, 8.0, 0.28, "事件模式 / 统计模式  output/nativehook_<timestamp>/", { size: 11.5, color: NAVY, bold: true });
  CODE(s, 0.6, 1.92, 8.0, 4.55,
    "memory.htrace            # 原始 trace 文件\nmemory.db                # SQLite 数据库\nmem_capture.csv          # smaps（19 列，PSS 时序）\nhidumper_capture.csv     # hidumper --mem（20 列）\nsmaps_detail.csv         # 逐映射明细（按 SO 聚合）\nanalysis_report.md       # 峰值分析主报告\nhidumper_analysis.md     # hidumper 深度分析\nattribution_report.md    # 归因报告（--attribution）\nscreen_capture/          # 屏幕截屏（--screen）\n  frames/                # 截屏帧（JPEG）\n  timestamps.csv         # 对齐时间戳（rel_sec）\nmetadata.json            # 元数据",
    "plaintext", { size: 9.6, leading: 1.26 });

  // right: mode differences
  T(s, 8.8, 1.6, 3.9, 0.28, "其他模式产物", { size: 11.5, color: NAVY, bold: true });
  const modes = [
    ["采样模式", "hidumper-only_<app>_<ts>/", ["hidumper_raw.txt", "hidumper_capture.csv（13列）", "mem_capture.csv（19列）", "hidumper_analysis.md"], TEAL],
    ["数据模式", "data_<app>_<ts>/", ["hidumper_capture.csv", "mem_capture.csv", "memory_time_series.png ★", "（PSS 趋势图 + 峰值标记）"], PURPLE],
    ["关键说明", "", ["不采 trace，不生成 memory.db", "截屏帧与 trace 共享 rel_sec 时间轴", "smaps_detail.csv 按 SO 聚合"], BLUE],
  ];
  modes.forEach((m, i) => {
    const y = 1.92 + i * 1.66;
    card(s, 8.8, y, 3.93, 1.62, { accent: m[3] });
    T(s, 9.05, y + 0.1, 3.5, 0.24, m[0], { size: 11.5, color: NAVY, bold: true });
    if (m[1]) T(s, 9.05, y + 0.38, 3.5, 0.22, m[1], { size: 8, color: MUTED, font: MONO });
    m[2].forEach((line, j) => {
      T(s, 9.05, y + 0.66 + j * 0.24, 3.55, 0.22, line, { size: 8.6, color: INK, leading: 1.1 });
    });
  });
  return s;
}

/* ============ SLIDE 10 : EXPERT PATTERNS ============ */
function buildS10() {
  const s = frame(10, "09 · 经验沉淀", "专家经验模板 P001–P007");
  const colW = [0.9, 5.5, 1.25, 4.48];
  const hH = 0.42, rH = 0.555;
  const hdr = ["ID", "场景", "优先级", "关键 Trace 信号"];
  const rows = [{
    h: hH,
    cells: hdr.map((t, i) => ({ text: t, options: { fill: NAVY, color: "FFFFFF", bold: true, fontSize: 10.5, align: i === 3 ? "l" : "c", valign: "m" } })),
  }];
  const pats = [
    ["P001", "HEIF 解码器缓冲区泄漏", "P0", "Create PixelMap 持续增长不释放"],
    ["P002", "图片解码尺寸过大", "P0", "EXTRawData 高 / 解码尺寸 >> 显示尺寸"],
    ["P003", "页面切换资源重叠", "P1", "页面切换峰值不回落"],
    ["P004", "ION DMA Buffer 泄漏", "P0", "ION / DMA 持续增长"],
    ["P005", "PixelMap 转 Buffer 中间拷贝", "P1", "PixelMap 反复 readPixels"],
    ["P006", "Worker 线程反序列化大对象", "P1", "Worker 线程堆持续增长"],
    ["P007", "图形引擎线程池缓冲", "P2", "图形线程池常驻缓冲"],
  ];
  const pColor = (p) => (p === "P0" ? RED : p === "P1" ? ORANGE : MUTED);
  const pFill = (p) => (p === "P0" ? "FDECEB" : p === "P1" ? "FDF1E2" : "EEF1F6");
  pats.forEach((p) => {
    rows.push({
      h: rH,
      cells: [
        { text: p[0], options: { fill: pFill(p[2]), color: pColor(p[2]), bold: true, fontSize: 10.5, align: "c", valign: "m", fontFace: MONO } },
        { text: p[1], options: { color: NAVY, fontSize: 10, align: "l", valign: "m" } },
        { text: p[2], options: { fill: pFill(p[2]), color: pColor(p[2]), bold: true, fontSize: 10.5, align: "c", valign: "m" } },
        { text: p[3], options: { color: INK, fontSize: 9.3, align: "l", valign: "m" } },
      ],
    });
  });
  TB(s, 0.6, 1.62, colW, rows, {});
  card(s, 0.6, 6.18, 12.13, 0.74, { fill: BLUE_LT, border: "CFE0FF" });
  R(s, 0.78, 6.4, 0.16, 0.16, { fill: BLUE, radius: 0.04 });
  T(s, 1.05, 6.2, 11.5, 0.7, "AI 分析 trace 时自动加载专家模板，逐场景匹配并给出优化建议；可复制空白模板（ID+名称 / 优先级 / Trace 信号 / ArkTS 入口 / 根因 / 方案 / 验证 7 字段）扩展场景列表。", { size: 10, color: INK, valign: "m", leading: 1.2 });
  return s;
}

/* ============ SLIDE 11 : STRUCTURE & SUMMARY ============ */
function buildS11() {
  const s = frame(11, "10 · 总结", "目录结构与核心价值");
  T(s, 0.6, 1.6, 6.6, 0.28, "项目目录结构", { size: 11.5, color: NAVY, bold: true });
  CODE(s, 0.6, 1.92, 6.6, 4.55,
    "harmonyos-memory-analyzer/\n├── SKILL.md                 # 使用指南\n├── scripts/\n│   ├── memory_analyze.sh    # 一键抓取+解析+分析\n│   ├── analyze_peak_memory.py\n│   ├── analyze_attribution.py\n│   ├── analyze_arkts_packages.py\n│   ├── analyze_single_so.py\n│   ├── get_arkui_node.py\n│   └── analyze_arkui_node.py\n├── configs/                 # hiprofiler 配置\n├── references/              # 内部经验文档\n└── docs/                    # 用户教程 / 实战指南",
    "plaintext", { size: 9.4, leading: 1.26 });

  card(s, 7.45, 1.92, 5.28, 3.5, { accent: BLUE });
  T(s, 7.8, 2.12, 4.7, 0.32, "核心价值", { size: 15, color: NAVY, bold: true });
  const vals = [
    ["精确峰值 + 泄漏检测", "事件模式逐分配/释放记录"],
    ["智能穿透归属", "跳过基础设施库，定位业务调用者"],
    ["10 章节归因报告", "Native/ARKTS/ION/GPU/JS/SO/Swap"],
    ["屏幕截屏同步", "内存事件 ↔ 用户操作关联"],
    ["专家模板 P001–P007", "AI 自动匹配优化建议"],
  ];
  vals.forEach((v, i) => {
    const y = 2.6 + i * 0.5;
    R(s, 7.8, y + 0.07, 0.12, 0.12, { fill: BLUE, radius: 0.03 });
    T(s, 8.05, y, 2.2, 0.3, v[0], { size: 10.5, color: NAVY, bold: true, valign: "m" });
    T(s, 10.3, y, 2.3, 0.3, v[1], { size: 9.3, color: MUTED, valign: "m" });
  });
  R(s, 7.45, 5.62, 5.28, 0.62, { fill: NAVY, radius: 0.1 });
  T(s, 7.48, 5.64, 5.22, 0.58, "gitcode.com/hdcck/harmonyos-memory-analyzer", { size: 11, color: "FFFFFF", bold: true, align: "c", valign: "m", font: MONO });
  T(s, 7.45, 6.5, 5.28, 0.3, "鸿蒙应用 Native Memory / Ftrace 抓取与分析工具链", { size: 10, color: MUTED, align: "c" });
  return s;
}

/* ============ MAIN ============ */
async function main() {
  const PRE = path.join(__dirname, "preview");
  fs.mkdirSync(PRE, { recursive: true });
  const builders = [buildS1, buildS2, buildS3, buildS4, buildS5, buildS6, buildS7, buildS8, buildS9, buildS10, buildS11];
  for (let i = 0; i < builders.length; i++) {
    const s = builders[i]();
    const png = path.join(PRE, "slide" + String(i + 1).padStart(2, "0") + ".png");
    await renderSlide(specs.slice(), W, H, png);
    HLP.warnIfSlideHasOverlaps(s, pptx);
    HLP.warnIfSlideElementsOutOfBounds(s, pptx);
    console.log("rendered slide " + (i + 1));
  }
  await pptx.writeFile({ fileName: path.join(__dirname, "deck.pptx") });
  console.log("DONE -> deck.pptx");
}
main().catch((e) => { console.error(e); process.exit(1); });