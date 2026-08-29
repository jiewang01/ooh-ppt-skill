"""L1 配置加载：读取 data.yml。"""
from __future__ import annotations
import os
from dataclasses import dataclass, field


@dataclass
class DataConfig:
    sources: list[str] = field(default_factory=lambda: ["akshare"])
    cache_dir: str = "data/cache"
    universe: str = "csi300"
    backfill_years: int = 5

    @classmethod
    def load(cls, path: str) -> "DataConfig":
        cfg = cls()
        if not path or not os.path.exists(path):
            return cfg
        try:
            import yaml  # type: ignore
            with open(path, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        except Exception:
            return cfg
        cfg.sources = raw.get("sources", cfg.sources)
        cfg.cache_dir = raw.get("cache_dir", cfg.cache_dir)
        cfg.universe = raw.get("universe", cfg.universe)
        cfg.backfill_years = raw.get("backfill_years", cfg.backfill_years)
        return cfg


__all__ = ["DataConfig"]
