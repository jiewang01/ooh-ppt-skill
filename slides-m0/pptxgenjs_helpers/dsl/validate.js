"use strict";
// validate.js — Deck DSL 工作区校验器
//
// 与 render.js 的区别: render.js 渲染期 fail-fast（首错即停，便于栈定位）；
// 本校验器收集全部错误后一次性返回（{ ok, errors:[{file,field,message}] }），
// 便于生成期把所有问题一次报给 LLM 修正，而非逐轮只看到第一个错。
//
// 被三方调用:
//   - gen_slide.js: 生成门禁（写盘前校验单页 shard）
//   - render.js:    渲染预检（fail-fast 前置到生成期）
//   - CLI 直接:     node validate.js <wsDir>
//
// 用法: node validate.js <workspaceDir>

const fs = require("fs");
const path = require("path");
const S = require("./schema");

function err(file, field, message) {
  return { file, field, message };
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return { error: `文件缺失: ${file}` };
  try {
    const raw = fs.readFileSync(file, "utf8");
    return { data: JSON.parse(raw), raw };
  } catch (e) {
    return { error: `JSON 解析失败: ${file} (${e.message})` };
  }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
const isHex6 = (v) => typeof v === "string" && S.HEX6_REGEX.test(v);

function validateDeck(deck) {
  const errors = [];
  const f = "deck.json";
  if (!isNonEmptyStr(deck.deckId)) errors.push(err(f, "deckId", "必须是非空字符串"));
  if (typeof deck.version !== "string") errors.push(err(f, "version", "必须是字符串"));
  if (!S.LAYOUT_SIZES[deck.size])
    errors.push(err(f, "size", `不支持的画幅 "${deck.size}"（可选: ${Object.keys(S.LAYOUT_SIZES).join(", ")}）`));
  if (deck.phase !== undefined && !S.VALID_PHASES.includes(deck.phase))
    errors.push(err(f, "phase", `非法 phase "${deck.phase}"（可选: ${S.VALID_PHASES.join(", ")}）`));
  if (!Array.isArray(deck.slides) || deck.slides.length === 0) {
    errors.push(err(f, "slides", "必须是非空数组"));
    return errors;
  }
  if (deck.slides.length > S.BUDGET.maxSlidesPerDeck)
    errors.push(err(f, "slides", `页数 ${deck.slides.length} 超出上限（≤${S.BUDGET.maxSlidesPerDeck}）`));
  const seen = new Set();
  deck.slides.forEach((meta, i) => {
    const where = `slides[${i}]`;
    if (!meta || typeof meta !== "object") {
      errors.push(err(f, where, "必须是对象"));
      return;
    }
    if (!isNonEmptyStr(meta.sid) || !S.SID_REGEX.test(meta.sid)) {
      errors.push(err(f, `${where}.sid`, `非法 sid "${meta.sid}"（需匹配 [a-z0-9_]+）`));
    } else if (seen.has(meta.sid)) {
      errors.push(err(f, `${where}.sid`, `sid 重复 "${meta.sid}"`));
    } else {
      seen.add(meta.sid);
    }
    if (!isNonEmptyStr(meta.layout)) errors.push(err(f, `${where}.layout`, "缺少 layout"));
    if (meta.title !== undefined && typeof meta.title !== "string")
      errors.push(err(f, `${where}.title`, "若提供必须是字符串"));
  });
  return errors;
}

function validateTheme(theme) {
  const errors = [];
  const f = "theme.json";
  if (!theme.fonts || typeof theme.fonts !== "object") errors.push(err(f, "fonts", "必须是对象"));
  if (!theme.colors || typeof theme.colors !== "object") {
    errors.push(err(f, "colors", "必须是对象"));
  } else {
    for (const [k, v] of Object.entries(theme.colors)) {
      if (!isHex6(v)) errors.push(err(f, `colors.${k}`, `必须是 6 位 hex（无 #），得到 "${v}"`));
    }
    if (!theme.colors.accent) errors.push(err(f, "colors.accent", "emphasis 条目需要 accent 颜色"));
  }
  if (!theme.styles || typeof theme.styles !== "object") {
    errors.push(err(f, "styles", "必须是对象"));
  } else {
    const fonts = theme.fonts || {};
    const colors = theme.colors || {};
    for (const [name, s] of Object.entries(theme.styles)) {
      const where = `styles.${name}`;
      if (!s || typeof s !== "object") {
        errors.push(err(f, where, "必须是对象"));
        continue;
      }
      if (!isNonEmptyStr(s.font) || !fonts[s.font])
        errors.push(err(f, `${where}.font`, `字体槽 "${s.font}" 未在 fonts 中定义`));
      if (!isNonEmptyStr(s.color) || !colors[s.color])
        errors.push(err(f, `${where}.color`, `颜色令牌 "${s.color}" 未在 colors 中定义`));
      if (!isNum(s.fontSize)) errors.push(err(f, `${where}.fontSize`, "必须是有限数字"));
      if (!isNum(s.minFontSize)) errors.push(err(f, `${where}.minFontSize`, "必须是有限数字"));
      if (isNum(s.fontSize) && isNum(s.minFontSize) && s.minFontSize > s.fontSize)
        errors.push(err(f, `${where}.minFontSize`, `minFontSize(${s.minFontSize}) 不应大于 fontSize(${s.fontSize})`));
      if (s.bold !== undefined && typeof s.bold !== "boolean")
        errors.push(err(f, `${where}.bold`, "若提供必须是 boolean"));
    }
  }
  if (!theme.layouts || typeof theme.layouts !== "object") {
    errors.push(err(f, "layouts", "必须是对象"));
  } else {
    const styles = theme.styles || {};
    for (const [lname, ldef] of Object.entries(theme.layouts)) {
      const where = `layouts.${lname}`;
      if (!ldef || !ldef.zones || typeof ldef.zones !== "object") {
        errors.push(err(f, where, "缺少 zones 对象"));
        continue;
      }
      for (const [slot, zone] of Object.entries(ldef.zones)) {
        const zw = `${where}.zones.${slot}`;
        if (!zone || typeof zone !== "object") {
          errors.push(err(f, zw, "必须是对象"));
          continue;
        }
        for (const k of ["x", "y", "w", "h"]) {
          if (!isNum(zone[k])) errors.push(err(f, `${zw}.${k}`, "必须是有限数字"));
        }
        if (!isNonEmptyStr(zone.style) || !styles[zone.style])
          errors.push(err(f, `${zw}.style`, `样式 "${zone.style}" 未在 styles 中定义`));
      }
    }
  }
  return errors;
}

function validateSlotContent(sid, slot, content, wsDir) {
  const errors = [];
  const file = `slides/${sid}.json`;
  const where = `槽位 "${slot}"`;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    errors.push(err(file, where, "内容必须是对象 {text|bullets|chart}"));
    return errors;
  }
  const present = S.CONTENT_KINDS.filter((k) => content[k] !== undefined);
  if (present.length === 0) {
    errors.push(err(file, where, "缺少 text/bullets/chart 之一"));
    return errors;
  }
  if (present.length > 1) {
    errors.push(err(file, where, `text/bullets/chart 互斥（同时出现: ${present.join(",")}）`));
    return errors;
  }
  const kind = present[0];
  if (kind === "text") {
    if (!isNonEmptyStr(content.text)) errors.push(err(file, where, "text 必须是非空字符串"));
  } else if (kind === "bullets") {
    if (!Array.isArray(content.bullets) || content.bullets.length === 0) {
      errors.push(err(file, where, "bullets 必须是非空数组"));
    } else {
      if (content.bullets.length > S.BUDGET.maxBulletsPerSlot)
        errors.push(err(file, where, `条目数 ${content.bullets.length} 超出预算（≤${S.BUDGET.maxBulletsPerSlot}）`));
      content.bullets.forEach((it, i) => {
        const bw = `${where}[${i}]`;
        if (!it || !isNonEmptyStr(it.text)) {
          errors.push(err(file, bw, "缺少非空 text"));
        } else {
          const chars = Array.from(it.text).length;
          if (chars > S.BUDGET.maxBulletChars)
            errors.push(err(file, bw, `${chars} 字符，超出预算（≤${S.BUDGET.maxBulletChars}）`));
        }
        if (it && it.emphasis !== undefined && typeof it.emphasis !== "boolean")
          errors.push(err(file, bw, "emphasis 必须是 boolean"));
      });
    }
  } else if (kind === "chart") {
    const spec = content.chart;
    if (!spec || typeof spec !== "object") {
      errors.push(err(file, where, "chart 必须是对象"));
    } else {
      if (!isNonEmptyStr(spec.ref)) {
        errors.push(err(file, where, "chart.ref 必须是非空字符串"));
      } else {
        const dataFile = path.resolve(wsDir, spec.ref);
        if (!fs.existsSync(dataFile)) {
          errors.push(err(file, where, `chart.ref "${spec.ref}" 指向的文件不存在`));
        } else {
          const r = readJsonSafe(dataFile);
          if (r.error) {
            errors.push(err(file, where, `图表数据解析失败: ${r.error}`));
          } else {
            const data = r.data;
            if (!Array.isArray(data.series) || data.series.length === 0) {
              errors.push(err(file, where, `图表数据 ${spec.ref} 缺少非空 series`));
            } else {
              if (data.series.length > S.BUDGET.maxChartSeries)
                errors.push(err(file, where, `图表系列数 ${data.series.length} 超出上限（≤${S.BUDGET.maxChartSeries}）`));
              data.series.forEach((d, i) => {
                if (!d || !isNonEmptyStr(d.label)) errors.push(err(file, where, `图表数据第 ${i + 1} 项缺少 label`));
                if (!d || !isNum(d.value) || d.value < 0)
                  errors.push(err(file, where, `图表数据第 ${i + 1} 项 value 必须是非负数字`));
              });
            }
          }
        }
      }
      const type = spec.type || "bar";
      if (!S.VALID_CHART_TYPES.includes(type))
        errors.push(err(file, where, `chart.type "${type}" 不支持（可选: ${S.VALID_CHART_TYPES.join(", ")}）`));
      if (spec.caption !== undefined && typeof spec.caption !== "string")
        errors.push(err(file, where, "chart.caption 若提供必须是字符串"));
    }
  }
  return errors;
}

function validateSlide(slide, meta, theme, wsDir) {
  const errors = [];
  const file = `slides/${meta.sid}.json`;
  if (slide.sid !== meta.sid)
    errors.push(err(file, "sid", `sid "${slide.sid}" 与 deck.json 中的 "${meta.sid}" 不一致`));
  if (slide.layout !== meta.layout)
    errors.push(err(file, "layout", `layout "${slide.layout}" 与 deck.json 中的 "${meta.layout}" 不一致`));
  const layoutDef = theme.layouts && theme.layouts[meta.layout];
  if (!layoutDef || !layoutDef.zones) {
    errors.push(err(file, "layout", `未知版式 "${meta.layout}"（theme.layouts 未定义）`));
    return errors;
  }
  const zones = layoutDef.zones;
  for (const slot of S.REQUIRED_SLOTS[meta.layout] || []) {
    if (slide[slot] === undefined) errors.push(err(file, slot, `必需槽位 "${slot}" 缺少内容`));
  }
  for (const key of Object.keys(slide)) {
    if (!S.SLIDE_META_KEYS.has(key) && !(key in zones))
      errors.push(err(file, key, `不是版式 "${meta.layout}" 的槽位（可用: ${Object.keys(zones).join(", ")}）`));
  }
  for (const [slot, content] of Object.entries(slide)) {
    if (S.SLIDE_META_KEYS.has(slot)) continue;
    if (!(slot in zones)) continue; // 未知槽位已在上方报告
    errors.push(...validateSlotContent(meta.sid, slot, content, wsDir));
  }
  if (slide.notes !== undefined && typeof slide.notes !== "string")
    errors.push(err(file, "notes", "若提供必须是字符串"));
  return errors;
}

function validateWorkspace(wsDir) {
  const errors = [];
  const deckRes = readJsonSafe(path.join(wsDir, "deck.json"));
  if (deckRes.error) {
    errors.push(err("deck.json", "", deckRes.error));
    return { ok: false, errors };
  }
  const deck = deckRes.data;
  errors.push(...validateDeck(deck));

  const themeRes = readJsonSafe(path.join(wsDir, "theme.json"));
  if (themeRes.error) {
    errors.push(err("theme.json", "", themeRes.error));
    return { ok: false, errors };
  }
  const theme = themeRes.data;
  errors.push(...validateTheme(theme));

  if (Array.isArray(deck.slides) && theme && theme.layouts) {
    for (const meta of deck.slides) {
      if (!meta || !isNonEmptyStr(meta.sid) || !S.SID_REGEX.test(meta.sid)) continue;
      const sFile = path.join(wsDir, "slides", `${meta.sid}.json`);
      if (!fs.existsSync(sFile)) {
        errors.push(err(`slides/${meta.sid}.json`, "", "页面文件缺失"));
        continue;
      }
      const raw = fs.readFileSync(sFile, "utf8");
      const sb = S.shardBudget(raw);
      if (sb.overflow)
        errors.push(err(`slides/${meta.sid}.json`, "", `分片 ${sb.tokens} tokens 超出上限（≤${sb.limit}）`));
      const slideRes = readJsonSafe(sFile);
      if (slideRes.error) {
        errors.push(err(`slides/${meta.sid}.json`, "", slideRes.error));
        continue;
      }
      errors.push(...validateSlide(slideRes.data, meta, theme, wsDir));
    }
  }
  return { ok: errors.length === 0, errors };
}

if (require.main === module) {
  const wsDir = process.argv[2];
  if (!wsDir) {
    console.error("用法: node validate.js <workspaceDir>");
    process.exit(2);
  }
  const { ok, errors } = validateWorkspace(path.resolve(wsDir));
  if (ok) {
    console.log("[validate] OK 工作区校验通过");
    process.exit(0);
  }
  errors.forEach((e) => console.error(`  ✗ ${e.file}${e.field ? ":" + e.field : ""} — ${e.message}`));
  console.error(`[validate] FAIL 共 ${errors.length} 个错误`);
  process.exit(1);
}

module.exports = { validateWorkspace, validateSlide, validateSlotContent };
