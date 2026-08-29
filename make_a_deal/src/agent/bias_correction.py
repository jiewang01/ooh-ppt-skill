"""L3 偏差校正：检测 Agent 闭环产出的四类典型偏差。

检测类，不自动修改结论；给出偏差类别、证据和建议，
由 Agent/Judge 自行决定是否修订。
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
import re

import pandas as pd


class BiasType(Enum):
    RECENCY = "近因偏差"           # 只看近期数据忽略长期
    CONFIRMATION = "确认偏差"      # 只找支持自己假设的证据
    NO_EVIDENCE = "空证据"         # 结论无任何回测/统计支撑
    OVERFIT = "过拟合风险"         # 参数过多/样本不足/数据窥探


@dataclass
class BiasEvidence:
    bias: BiasType
    score: float           # 0~1，越大越严重
    evidence: str
    suggestion: str


@dataclass
class BiasCheckResult:
    detected: list[BiasEvidence] = field(default_factory=list)

    @property
    def has_bias(self) -> bool:
        return any(b.score > 0.5 for b in self.detected)

    def to_dict(self) -> dict:
        return {"has_bias": self.has_bias,
                "count": len(self.detected),
                "items": [{"bias": b.bias.value, "score": b.score,
                           "evidence": b.evidence,
                           "suggestion": b.suggestion}
                          for b in self.detected]}


class BiasCorrector:
    """四阶闭环偏差校正。"""

    def __init__(self, *, max_params_ratio: float = 0.05,
                 min_samples: int = 60, lookback_min_ratio: float = 0.3):
        self.max_params_ratio = max_params_ratio
        self.min_samples = min_samples
        self.lookback_min_ratio = lookback_min_ratio

    def check(self, *, hypothesis: str, evidence_text: str,
              equity_curve: pd.Series | None = None,
              n_params: int = 0, n_samples: int = 0,
              lookback_days: int = 0, total_days: int = 0) -> BiasCheckResult:
        res = BiasCheckResult()
        hypothesis = (hypothesis or "").strip()
        evidence_text = (evidence_text or "").strip()

        # ---- 空证据 ----
        if not evidence_text:
            res.detected.append(BiasEvidence(
                BiasType.NO_EVIDENCE, 1.0,
                "evidence_text 为空：结论未附回测/偏差检测/统计证据",
                "要求在 submit_for_audit 时附带 evidence JSON（回测指标 + 偏差检测结果）",
            ))
        elif len(evidence_text) < 20:
            res.detected.append(BiasEvidence(
                BiasType.NO_EVIDENCE, 0.7,
                f"evidence_text 过短（{len(evidence_text)} chars），疑似占位",
                "填入真实回测指标：total_return / sharpe / max_drawdown 等",
            ))

        # ---- 过拟合风险 ----
        if n_samples > 0 and n_params > 0:
            ratio = n_params / max(1, n_samples)
            if ratio > self.max_params_ratio or n_samples < self.min_samples:
                res.detected.append(BiasEvidence(
                    BiasType.OVERFIT, min(1.0, ratio / max(1e-6, self.max_params_ratio)),
                    f"参数/样本比 {ratio*100:.2f}% 或样本数 {n_samples} < {self.min_samples}",
                    "降低因子参数数量；做 WFO 滚动验证；增加训练样本；",
                ))

        # ---- 近因偏差 ----
        recency_words = ["最近", "近一周", "近一月", "last week", "recent",
                         "latest", "近 10 日", "近10日"]
        hits = [w for w in recency_words if w in hypothesis or w in evidence_text]
        if hits:
            score = min(1.0, 0.5 + 0.1 * len(hits))
            res.detected.append(BiasEvidence(
                BiasType.RECENCY, score,
                f"hypothesis/evidence 出现短期时间词：{hits}",
                "检查 lookback 覆盖 ≥ 30% 总数据；做滚动窗口样本外验证；",
            ))
        if total_days > 0 and lookback_days > 0:
            r = lookback_days / total_days
            if r < self.lookback_min_ratio:
                res.detected.append(BiasEvidence(
                    BiasType.RECENCY,
                    min(1.0, (self.lookback_min_ratio - r) / self.lookback_min_ratio + 0.3),
                    f"lookback 占比 {r*100:.1f}% < 期望 {self.lookback_min_ratio*100:.0f}%",
                    "扩展回测窗口；至少覆盖一轮完整牛熊（≥ 5 年）。",
                ))

        # ---- 确认偏差：寻找 "仅支持" 的措辞 ----
        confirm_patterns = [
            r"必然", r"一定", r"肯定", r"100%", r"百分百",
            r"always", r"guaranteed", r"must",
            r"只看", r"只看.*就能", r"仅仅.*成立",
            r"所有.*都(支持|符合)",
        ]
        cp_hits: list[str] = []
        for p in confirm_patterns:
            m = re.search(p, hypothesis + evidence_text)
            if m:
                cp_hits.append(m.group(0))
        if cp_hits:
            res.detected.append(BiasEvidence(
                BiasType.CONFIRMATION, min(1.0, 0.4 + 0.12 * len(cp_hits)),
                f"绝对化 / 仅支持 表达：{cp_hits[:5]}",
                "主动寻找反例：写出策略在什么条件下会输，再做压力测试；",
            ))

        return res


__all__ = ["BiasType", "BiasEvidence", "BiasCheckResult", "BiasCorrector"]
