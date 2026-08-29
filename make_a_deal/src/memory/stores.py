"""L3 记忆库基座：JSONL + 原子写 + 指纹去重 + 关键词检索 + 相似度检索。

安全设计：
- 原子写：临时文件 + os.replace，进程崩溃不损坏
- 指纹去重：指定字段 SHA256 哈希，防重复追加
- 安全 Purge：单次删除不超过半数记录，防误清空攻击
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import tempfile
import time
from dataclasses import dataclass

# 轻量中文/英文停用词（用于相似度检索分词后过滤）
_STOPWORDS = {
    "the", "a", "an", "of", "in", "on", "and", "or", "to", "for",
    "with", "by", "is", "are", "was", "were", "be", "been", "being",
    "if", "then", "else", "this", "that", "these", "those", "it",
    "its", "not", "no", "do", "does", "did", "can", "could", "should",
    "would", "may", "might", "shall", "will", "has", "have", "had",
    "from", "at", "as", "into", "than", "so", "such", "when", "while",
    "我", "你", "他", "她", "它", "们", "的", "了", "和", "与", "或",
    "在", "是", "有", "也", "就", "都", "而", "及", "等", "之",
    "以", "于", "由", "将", "把", "被", "让", "对", "为", "从",
    "上", "下", "中", "里", "外", "内", "前", "后", "左", "右",
}


def _fingerprint(record: dict, keys: tuple[str, ...]) -> str:
    """基于指定字段生成稳定指纹（顺序无关，按 key 排序）。"""
    payload = {k: record.get(k) for k in sorted(keys)}
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _tokenize(text: str) -> set[str]:
    """轻量分词：中英文混合，按非字母数字字符切分；
    中文按单字作为 token（保证中文也有检索粒度）。"""
    if not text:
        return set()
    # 提取连续英文/数字 token
    tokens = {t.lower() for t in re.findall(r"[A-Za-z0-9_]+", text)}
    # 提取中文字符（单字）
    tokens |= set(re.findall(r"[\u4e00-\u9fff]", text))
    return {t for t in tokens if t and t not in _STOPWORDS and len(t) > 0}


class MemoryStore:
    """JSONL 记忆库：原子写 + 指纹去重 + 关键词/相似度检索。

    Args:
        path: JSONL 文件路径（若目录不存在会自动创建）
        dedup_keys: 哪些字段参与去重指纹；为空则整行指纹
    """

    def __init__(self, path: str, dedup_keys: tuple[str, ...] = ()):
        self.path = path
        self.dedup_keys = dedup_keys
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".",
                    exist_ok=True)
        if not os.path.exists(path):
            # 原子性：先写 tmp 再 replace
            self._atomic_write_lines([])

    # ----------------------------- 内部工具 -----------------------------
    def _atomic_write_lines(self, lines: list[str]) -> None:
        directory = os.path.dirname(os.path.abspath(self.path)) or "."
        fd, tmp = tempfile.mkstemp(dir=directory, suffix=".jsonl.tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                for ln in lines:
                    f.write(ln.rstrip("\n") + "\n")
            os.replace(tmp, self.path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def all_records(self) -> list[dict]:
        out: list[dict] = []
        if not os.path.exists(self.path):
            return out
        with open(self.path, "r", encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    out.append(json.loads(ln))
                except json.JSONDecodeError:
                    # 容忍坏行：不崩整个查询
                    continue
        return out

    # ----------------------------- 写操作 -----------------------------
    def append(self, record: dict) -> bool:
        """追加一条记录；指纹已存在 → False（去重）。"""
        records = self.all_records()
        fp = _fingerprint(record, self.dedup_keys or tuple(record.keys()))
        for r in records:
            if _fingerprint(r, self.dedup_keys or tuple(r.keys())) == fp:
                return False
        line = json.dumps(record, ensure_ascii=False, sort_keys=True)
        # 追加写（原子性用 fsync+rename 的简化版：直接追加，对单进程足够）
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        return True

    def purge(self, predicate) -> int:
        """安全 Purge：删除满足 predicate 的记录；
        单次删除不超过现存半数——防误清空攻击。"""
        records = self.all_records()
        total = len(records)
        keep = [r for r in records if not predicate(r)]
        removed = total - len(keep)
        if total > 0 and removed > total // 2:
            raise RuntimeError(
                f"purge 安全护栏：试图删除 {removed}/{total} 条记录，"
                f"超过半数（>{total // 2}），已拦截")
        lines = [json.dumps(r, ensure_ascii=False, sort_keys=True) for r in keep]
        self._atomic_write_lines(lines)
        return removed

    # ----------------------------- 读操作 -----------------------------
    def search_keyword(self, keyword: str,
                       text_fields: tuple[str, ...] = ()) -> list[dict]:
        """关键词检索：任意指定字段包含 keyword 即命中；
        text_fields 为空 → 所有字符串字段。"""
        kw = (keyword or "").lower()
        if not kw:
            return []
        hits: list[dict] = []
        for r in self.all_records():
            fields = text_fields or tuple(k for k, v in r.items()
                                          if isinstance(v, str))
            for k in fields:
                v = r.get(k)
                if isinstance(v, str) and kw in v.lower():
                    hits.append(r)
                    break
        return hits

    def search_similar(self, query: str, *, threshold: float = 0.6,
                       text_fields: tuple[str, ...] = (),
                       top_k: int = 10) -> list[tuple[float, dict]]:
        """Jaccard 相似度检索：阈值以上按相似度降序返回 top_k。"""
        q_toks = _tokenize(query)
        if not q_toks:
            return []
        scored: list[tuple[float, dict]] = []
        for r in self.all_records():
            fields = text_fields or tuple(k for k, v in r.items()
                                          if isinstance(v, str))
            best = 0.0
            for k in fields:
                v = r.get(k)
                if not isinstance(v, str):
                    continue
                r_toks = _tokenize(v)
                if not r_toks:
                    continue
                inter = len(q_toks & r_toks)
                union = len(q_toks | r_toks)
                if union == 0:
                    continue
                j = inter / union
                if j > best:
                    best = j
            if best >= threshold:
                scored.append((best, r))
        scored.sort(key=lambda x: -x[0])
        return scored[:top_k]


__all__ = ["MemoryStore"]
