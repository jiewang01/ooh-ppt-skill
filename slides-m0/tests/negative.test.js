"use strict";
// negative.test.js — M1 负样本校验：每类非法内容必须被 validate 精确拒绝
//
// 策略: 复制合法 demo_ws 到临时目录 → 单点变异 → 断言 validateWorkspace 失败
//       且 errors 文本命中预期关键词。
// 运行: node tests/negative.test.js

const fs = require("fs");
const path = require("path");
const os = require("os");
const { validateWorkspace } = require("../pptxgenjs_helpers/dsl/validate");
const S = require("../pptxgenjs_helpers/dsl/schema");

const ROOT = path.resolve(__dirname, "..");
const SRC_WS = path.join(ROOT, "tests/golden/demo_ws");

let pass = 0;
let fail = 0;

function mkBadWs(mutate, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsl-bad-"));
  fs.cpSync(SRC_WS, tmp, { recursive: true });
  const ctx = {
    wsDir: tmp,
    readSlide: (sid) =>
      JSON.parse(fs.readFileSync(path.join(tmp, "slides", `${sid}.json`), "utf8")),
    writeSlide: (sid, obj) =>
      fs.writeFileSync(
        path.join(tmp, "slides", `${sid}.json`),
        JSON.stringify(obj, null, 2)
      ),
    readDeck: () => JSON.parse(fs.readFileSync(path.join(tmp, "deck.json"), "utf8")),
    writeDeck: (d) => fs.writeFileSync(path.join(tmp, "deck.json"), JSON.stringify(d, null, 2)),
    readTheme: () => JSON.parse(fs.readFileSync(path.join(tmp, "theme.json"), "utf8")),
    writeTheme: (t) => fs.writeFileSync(path.join(tmp, "theme.json"), JSON.stringify(t, null, 2)),
    writeRawSlide: (sid, raw) =>
      fs.writeFileSync(path.join(tmp, "slides", `${sid}.json`), raw),
  };
  mutate(ctx);
  return { wsDir: tmp, label };
}

function expectInvalid({ wsDir, label }, matcher) {
  const { ok, errors } = validateWorkspace(wsDir);
  const text = errors.map((e) => `${e.file}:${e.field}:${e.message}`).join("\n");
  if (ok) {
    console.error(`  ✗ [${label}] 预期失败但校验通过`);
    fail++;
    return;
  }
  if (matcher && !matcher(text)) {
    console.error(`  ✗ [${label}] 错误未命中预期:\n    ${text.replace(/\n/g, "\n    ")}`);
    fail++;
    return;
  }
  console.log(`  ✓ [${label}] 被拒绝（${errors.length} 错误）`);
  pass++;
}

function expectValid({ wsDir, label }) {
  const { ok, errors } = validateWorkspace(wsDir);
  if (ok) {
    console.log(`  ✓ [${label}] 合法通过`);
    pass++;
  } else {
    console.error(`  ✗ [${label}] 预期合法但报错:\n    ${errors.map((e) => `${e.file}:${e.field}:${e.message}`).join("\n    ")}`);
    fail++;
  }
}

console.log("=== M1 负样本校验 ===");

// 0. 基线：未变异的 demo_ws 必须合法
expectValid(mkBadWs(() => {}, "baseline 合法工作区"));

// 1. bullets 超条数预算（≤6 → 放 8 条）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s02");
    s.body.bullets = Array.from({ length: 8 }, (_, i) => ({ text: `条目${i + 1}` }));
    c.writeSlide("s02", s);
  }, "bullets 超条数预算"),
  (t) => t.includes("条目数 8") && t.includes("超出预算")
);

// 2. bullet 超字符预算（≤40 → 放 50 字）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s02");
    s.body.bullets = [{ text: "一".repeat(50) }];
    c.writeSlide("s02", s);
  }, "bullet 超字符预算"),
  (t) => t.includes("50 字符") && t.includes("超出预算")
);

// 3. 未知槽位键（拼写错误）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s02");
    s.contnet = { text: "拼错了" }; // 应为 content 不存在，body 才是槽位
    c.writeSlide("s02", s);
  }, "未知槽位键"),
  (t) => t.includes("不是版式") && t.includes("槽位")
);

// 4. 缺必需槽位（bullets 版式缺 body）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s02");
    delete s.body;
    c.writeSlide("s02", s);
  }, "缺必需槽位 body"),
  (t) => t.includes("必需槽位") && t.includes("body")
);

// 5. 坏图表引用（ref 指向不存在的文件）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s03");
    s.right.chart.ref = "assets/data/nonexistent.json";
    c.writeSlide("s03", s);
  }, "坏图表引用"),
  (t) => t.includes("chart.ref") && t.includes("不存在")
);

// 6. 类型错误（text 是数字而非字符串）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s01");
    s.title.text = 12345;
    c.writeSlide("s01", s);
  }, "text 类型错误"),
  (t) => t.includes("text 必须是非空字符串")
);

// 7. 分片超 token 预算（≤800 → 塞超长 notes 让整页超限）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s02");
    s.notes = "备注".repeat(600); // ~1200 字符 CJK ≈ 1200 tokens，远超 800
    c.writeSlide("s02", s);
  }, "分片超 token 预算"),
  (t) => t.includes("tokens 超出上限")
);

// 8. theme 颜色非 hex6
expectInvalid(
  mkBadWs((c) => {
    const t = c.readTheme();
    t.colors.ink = "#333333"; // 带了 # 前缀
    c.writeTheme(t);
  }, "theme 颜色带 # 前缀"),
  (t) => t.includes("colors.ink") && t.includes("6 位 hex")
);

// 9. deck sid 重复
expectInvalid(
  mkBadWs((c) => {
    const d = c.readDeck();
    d.slides.push({ sid: "s01", layout: "cover", title: "重复" });
    c.writeDeck(d);
  }, "deck sid 重复"),
  (t) => t.includes("sid 重复") && t.includes("s01")
);

// 10. minFontSize > fontSize
expectInvalid(
  mkBadWs((c) => {
    const t = c.readTheme();
    t.styles.coverTitle.minFontSize = 99;
    c.writeTheme(t);
  }, "minFontSize > fontSize"),
  (t) => t.includes("minFontSize") && t.includes("不应大于")
);

// 11. text/bullets 互斥违反（同一槽位同时出现两种）
expectInvalid(
  mkBadWs((c) => {
    const s = c.readSlide("s02");
    s.body.bullets.push({ text: "额外" });
    s.body.text = "又放了 text";
    c.writeSlide("s02", s);
  }, "text/bullets 互斥违反"),
  (t) => t.includes("互斥")
);

// 12. 图表 value 负数
expectInvalid(
  mkBadWs((c) => {
    const data = JSON.parse(
      fs.readFileSync(path.join(c.wsDir, "assets/data/market_share.json"), "utf8")
    );
    data.series[0].value = -5;
    fs.writeFileSync(
      path.join(c.wsDir, "assets/data/market_share.json"),
      JSON.stringify(data, null, 2)
    );
  }, "图表 value 负数"),
  (t) => t.includes("value 必须是非负数字")
);

// 13. 未知版式
expectInvalid(
  mkBadWs((c) => {
    const d = c.readDeck();
    d.slides[1].layout = "grid-4"; // theme 未定义
    c.writeDeck(d);
    const s = c.readSlide("s02");
    s.layout = "grid-4";
    c.writeSlide("s02", s);
  }, "未知版式"),
  (t) => t.includes("未知版式") || t.includes("grid-4")
);

console.log("");
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
