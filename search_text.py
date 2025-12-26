#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import re
from functools import lru_cache
from typing import Dict, Iterable, List, Optional, Tuple

SYNONYMS_PATH = os.path.join(os.path.dirname(__file__), "search_synonyms.json")
_TOKEN_STRIP_CHARS = ".,;:!?\"'()[]{}<>/\\|"


@lru_cache(maxsize=1)
def _load_synonyms() -> Tuple[Dict[str, str], List[str]]:
    try:
        with open(SYNONYMS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {}
    token_map = {str(k).lower(): str(v).lower() for k, v in (data.get("token_map") or {}).items()}
    stopwords = [str(w).lower() for w in (data.get("stopwords") or [])]
    return token_map, stopwords


def normalize_base(text: Optional[str]) -> str:
    if text is None:
        return ""
    normalized = str(text).lower()
    normalized = normalized.replace("ё", "е")
    normalized = normalized.strip()
    normalized = re.sub(r"[^a-z0-9а-я%\*xх\.\,\s]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def strip_packaging(text: str) -> str:
    if not text:
        return ""
    patterns = [
        r"\b\d+\s*[xх\*]\s*\d+(?:[\.,]\d+)?\s*(кг|г|гр|л|литр|литров|мл|ml)\b",
        r"\b\d+(?:[\.,]\d+)?\s*(кг|г|гр|л|литр|литров|мл|ml)\b",
    ]
    cleaned = text
    for pattern in patterns:
        cleaned = re.sub(pattern, " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def clean_token(token: str) -> str:
    if not token:
        return ""
    cleaned = token.strip(_TOKEN_STRIP_CHARS)
    cleaned = re.sub(r"[-/\\]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def tokenize(text: str) -> List[str]:
    if not text:
        return []
    tokens: List[str] = []
    for token in text.split(" "):
        cleaned = clean_token(token)
        if not cleaned:
            continue
        tokens.extend([t for t in cleaned.split(" ") if t])
    return tokens


def apply_synonyms(tokens: Iterable[str]) -> List[str]:
    token_map, _ = _load_synonyms()
    mapped = []
    for token in tokens:
        key = token.lower()
        mapped.append(token_map.get(key, key))
    return mapped


def drop_noise(tokens: Iterable[str]) -> List[str]:
    _, stopwords = _load_synonyms()
    stop_set = set(stopwords)
    cleaned = []
    for token in tokens:
        if not token:
            continue
        if token in stop_set:
            continue
        if token.endswith("%"):
            cleaned.append(token)
            continue
        if re.fullmatch(r"[\d\.,]+", token):
            continue
        if len(token) < 2:
            continue
        cleaned.append(token)
    return cleaned


def build_core(tokens: Iterable[str], min_words: int = 2, max_words: int = 6) -> Optional[str]:
    seq = [t for t in tokens if t]
    if len(seq) < min_words:
        return None
    return " ".join(seq[:max_words])


def _generate(text: Optional[str], min_words: int) -> Optional[str]:
    base = normalize_base(text)
    if not base:
        return None
    stripped = strip_packaging(base)
    tokens = tokenize(stripped)
    tokens = apply_synonyms(tokens)
    tokens = drop_noise(tokens)
    return build_core(tokens, min_words=min_words)


def generate_search_name(name_input: Optional[str]) -> Optional[str]:
    return _generate(name_input, min_words=1)


def generate_supplier_name_search(name_raw: Optional[str], unit_raw: Optional[str] = None) -> Optional[str]:
    if not name_raw and not unit_raw:
        return None
    combined = f"{name_raw or ''} {unit_raw or ''}".strip()
    return _generate(combined, min_words=1)


def generate_pinned_search_name(text: Optional[str]) -> Optional[str]:
    base = normalize_base(text)
    if not base:
        return None
    stripped = strip_packaging(base)
    tokens = tokenize(stripped)
    tokens = apply_synonyms(tokens)
    tokens = drop_noise(tokens)
    if not tokens:
        return None
    return " ".join(tokens[:20])
