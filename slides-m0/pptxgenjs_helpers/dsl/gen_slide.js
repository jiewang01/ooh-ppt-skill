"use strict";
// gen_slide.js — 分片生成门禁
//
// 这是 LLM 面向的生成原语：每产出一页 slide JSON，经此门禁校验通过后才落盘。
// 校验失败时一次报全部错误（file:field:msg），不写盘——让 LLM 据此修正后重投，
// 而非把半成品写盘造成脏状态。
//
// 用法:
//   echo '<slide-json>' | node gen_slide.js <workspaceDir>            # 从 stdin
//   node gen_slide.js <workspaceDir> -f <slide.json>                  # 从文件
//   node gen_slide.js <workspaceDir> -f <slide.json> -o <out.json>    # 指定输出路径
//
// 流程:
//   1. 读 slide JSON（stdin 或 -f）
//   2. 加载 workspace 的 theme.json（+ 可选 deck.json 取 meta）
//   3. 校验: 结构(validateSlide) + 分片预算(shardBudget)
//   4. 全绿 → 写盘 slides/<sid>.json（或 -o）；有错 → 报告全部，不写盘，exit 1

const fs = require("fs");
const path = require("path");
const S = require("./schema");
const { validateSlide } = require("./validate");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseArgs(argv) {
  const wsDir = argv[0];
  let inFile = null;
  let outFile = null;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "-f" && argv[i + 1]) inFile = argv[++i];
    else if (argv[i] === "-o" && argv[i + 1]) outFile = argv[++i];
  }
  return { wsDir, inFile, outFile };
}

function readJsonSafe(file) {
  try {
    return { data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.wsDir) {
    console.error("用法: node gen_slide.js <workspaceDir> [-f <slide.json>] [-o <out.json>]");
    console.error("  缺省从 stdin 读 slide JSON，输出到 <wsDir>/slides/<sid>.json");
    process.exit(2);
  }
  const wsDir = path.resolve(args.wsDir);

  let raw;
  if (args.inFile) {
    if (!fs.existsSync(args.inFile)) {
      console.error(`[gen_slide] 输入文件不存在: ${args.inFile}`);
      process.exit(1);
    }
    raw = fs.readFileSync(args.inFile, "utf8");
  } else {
    if (process.stdin.isTTY) {
      console.error("[gen_slide] 未提供 -f，且 stdin 无输入（管道传入 slide JSON）");
      process.exit(2);
    }
    raw = await readStdin();
  }

  let slide;
  try {
    slide = JSON.parse(raw);
  } catch (e) {
    console.error(`[gen_slide] slide JSON 解析失败: ${e.message}`);
    process.exit(1);
  }

  if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
    console.error("[gen_slide] slide 必须是 JSON 对象");
    process.exit(1);
  }
  if (typeof slide.sid !== "string" || !S.SID_REGEX.test(slide.sid)) {
    console.error(`[gen_slide] slide.sid 非法（需匹配 [a-z0-9_]+），得到: ${JSON.stringify(slide.sid)}`);
    process.exit(1);
  }
  if (typeof slide.layout !== "string" || !slide.layout) {
    console.error(`[gen_slide] slide.layout 缺失（slides/${slide.sid}.json）`);
    process.exit(1);
  }

  // 分片预算硬闸（写盘前，与结构校验并行报告）
  const sb = S.shardBudget(raw);
  const errors = [];
  if (sb.overflow)
    errors.push({
      file: `slides/${slide.sid}.json`,
      field: "",
      message: `分片 ${sb.tokens} tokens 超出上限（≤${sb.limit}），需拆分或精简`,
    });

  // 加载 theme（slot 名 / 样式 / 颜色均依赖之）
  const themeRes = readJsonSafe(path.join(wsDir, "theme.json"));
  if (themeRes.error) {
    console.error(`[gen_slide] theme.json 不可用: ${themeRes.error}`);
    process.exit(1);
  }
  const theme = themeRes.data;

  // meta：优先从 deck.json 取（保证 sid/layout 与大纲一致）；无 deck.json 则用 slide 自报
  const meta = { sid: slide.sid, layout: slide.layout };
  const deckFile = path.join(wsDir, "deck.json");
  if (fs.existsSync(deckFile)) {
    const deckRes = readJsonSafe(deckFile);
    if (deckRes.data && Array.isArray(deckRes.data.slides)) {
      const found = deckRes.data.slides.find((m) => m && m.sid === slide.sid);
      if (found) {
        meta.layout = found.layout;
        meta.title = found.title;
      } else {
        errors.push({
          file: "deck.json",
          field: `slides`,
          message: `sid "${slide.sid}" 未在 deck.json 中登记（需先在 deck.json 加页再生成）`,
        });
      }
    }
  }

  errors.push(...validateSlide(slide, meta, theme, wsDir));

  if (errors.length) {
    errors.forEach((e) =>
      console.error(`  ✗ ${e.file}${e.field ? ":" + e.field : ""} — ${e.message}`)
    );
    console.error(`[gen_slide] FAIL 共 ${errors.length} 个错误，未写盘（slides/${slide.sid}.json）`);
    process.exit(1);
  }

  const outPath = args.outFile
    ? path.resolve(args.outFile)
    : path.join(wsDir, "slides", `${slide.sid}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, raw.endsWith("\n") ? raw : raw + "\n", "utf8");
  console.log(
    `[gen_slide] OK slides/${slide.sid}.json tokens=${sb.tokens}/${sb.limit} → ${outPath}`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
