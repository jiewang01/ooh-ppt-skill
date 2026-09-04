"use strict";
// schema.js — Deck DSL 规则与预算常量的单一事实源
//
// 被 validate.js（校验器）、render.js（渲染预检）、gen_slide.js（生成门禁）共同引用。
// 任何“合法工作区必须满足什么”的规则只在此处定义一次，下游一律 import，
// 杜绝规则在多处各写一份导致漂移。
//
// 设计不变量:
//   - 预算硬闸在此声明，校验期与生成期共用同一组阈值
//   - token 估算为保守高估（宁可误判超限触发拆分，也不放行过长分片）

const LAYOUT_SIZES = {
  // 与 pptxgenjs 的 LAYOUT_WIDE 严格同源（12192000×6858000 EMU）
  LAYOUT_WIDE: { width: 12192000 / 914400, height: 6858000 / 914400 },
};

const BUDGET = {
  maxBulletsPerSlot: 6, // 每槽位 bullets 条数上限
  maxBulletChars: 40, // 每条 bullet 字符上限（按码点计，CJK 算 1）
  maxTokensPerShard: 800, // 每页分片（slides/<sid>.json）token 上限
  maxSlidesPerDeck: 30, // 每 deck 页数上限
  maxChartSeries: 12, // 图表系列数上限
};

const REQUIRED_SLOTS = {
  cover: ["title"],
  bullets: ["title", "body"],
  "two-col": ["title", "left", "right"],
};

const SLIDE_META_KEYS = new Set(["sid", "layout", "notes"]);

const SID_REGEX = /^[a-z0-9_]+$/i;

const CONTENT_KINDS = ["text", "bullets", "chart"];

const VALID_CHART_TYPES = ["bar"];

const VALID_PHASES = ["wireframe", "config", "final"];

// 6 位 hex 颜色（无 # 前缀）
const HEX6_REGEX = /^[0-9a-fA-F]{6}$/;

// CJK 码点范围（常用汉字 + CJK 扩展A + 日文假名 + 全角符号）
function isCjk(cp) {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x3000 && cp <= 0x30ff) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
}

// token 估算: CJK ≈1 token/字, 其他 ≈4 字符/token, 向上取整（保守高估）
// 用于分片预算硬闸——宁可高估触发拆分，也不放行可能被截断的超长分片。
function estimateTokens(str) {
  if (typeof str !== "string") return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of str) {
    if (isCjk(ch.codePointAt(0))) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}

// 单页 shard 预算报告
function shardBudget(slideJsonStr) {
  const tokens = estimateTokens(slideJsonStr);
  return {
    tokens,
    limit: BUDGET.maxTokensPerShard,
    overflow: tokens > BUDGET.maxTokensPerShard,
  };
}

module.exports = {
  LAYOUT_SIZES,
  BUDGET,
  REQUIRED_SLOTS,
  SLIDE_META_KEYS,
  SID_REGEX,
  CONTENT_KINDS,
  VALID_CHART_TYPES,
  VALID_PHASES,
  HEX6_REGEX,
  estimateTokens,
  shardBudget,
};
