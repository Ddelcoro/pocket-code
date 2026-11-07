"""When the watcher checks mail, and which models it uses: the owner's settings, in one shape for the TOML and for Pocket.

The timer fires every minute (`inbox-monitor tick`); each tick asks `due()` whether a check is owed. Settings come from
Pocket Code when the owner has changed them there (Settings → Inbox Watch), else from the config file's [schedule] and
[judge] tables. Both go through `normalize()`, so a bad value falls back to the default for that field, never breaks a run.

The shape (JSON in Pocket, the same keys in the TOML as snake_case where noted):

  paused        true stops every check and every scheduled item until it is false again
  every         minutes between checks outside every period; 0 = no checks then (scheduled items still run)
  periods       [{name, days, from, to, every}]: days are 0–6 (Monday = 0) or "daily" / "weekdays" / "weekends" in the
                TOML; from/to are "HH:MM" local; to <= from runs past midnight (and belongs to the day it started).
                The first period that covers the moment wins.
  quietHours    [start hour, end hour): ordinary alerts wait until the end (TOML quiet_hours)
  digestHour    the morning digest and the release of held alerts (TOML digest_hour); null: no digest, and held alerts go out
                on their own when quiet hours end
  lookahead     {morning: hour | null, evening: hour | null}: each look-ahead may run from that hour for 4 hours
                (TOML lookahead = { morning = [8, 12], evening = [17, 22] } keeps its own window)
  models        {decisions: {model, reasoning}, lookahead: {model, reasoning}}; reasoning "default" leaves the model's own
  firstPass     {enabled, provider: jev | openai | both, threshold}: a decision model skips routine mail before the judge
                (firstpass.py; TOML [firstpass])
  rules         the owner's own rules, plain text (the preferences file): set in Pocket, they replace the file and are read by
                every turn and by the first pass (engine.sync_rules)
  tidy          {enabled, every}: every so many hours (outside quiet hours) the judge checks the open Inbox entries and takes
                off what has been resolved or handled (TOML [tidy] enabled, every_hours)
  gmailLabel    {enabled}: the owner's open Inbox entries carry a "Pocket Inbox" label in Gmail; labelling a thread there puts it on
                the list, taking the label off takes it off (TOML [gmail_label] enabled, name; on by default; needs gmail.modify)
"""
from __future__ import annotations

import copy
import datetime as dt
import re

EVERY_CHOICES = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]
DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_SETS = {"daily": list(range(7)), "weekdays": [0, 1, 2, 3, 4], "weekends": [5, 6]}
MAX_PERIODS = 12
LOOKAHEAD_HOURS = 4
SLACK_S = 30  # a tick a few seconds early still counts, so a 5-minute interval is not stretched to 6
TIDY_EVERY = [1, 2, 4, 8, 12, 24]
RULES_MAX = 8000
TIME_RX = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")

# Model choices per judge kind. Claude Code takes aliases; the other kinds are offered only what the config names.
CLAUDE_MODELS = [("haiku", "Haiku 5.5"), ("sonnet", "Sonnet 5.5"), ("opus", "Opus 5.5"), ("fable", "Fable 5.1")]
FIRSTPASS_PROVIDERS = ["jev", "openai", "both"]
REASONING = [("default", "Model default"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max")]


def _days(v) -> list[int]:
    if isinstance(v, str):
        v = DAY_SETS.get(v.lower(), [DAY_NAMES.index(v.lower()[:3])] if v.lower()[:3] in DAY_NAMES else None)
    if not isinstance(v, list):
        return list(range(7))
    out = set()
    for d in v:
        if isinstance(d, bool):
            continue
        if isinstance(d, int) and 0 <= d <= 6:
            out.add(d)
        elif isinstance(d, str) and d.lower()[:3] in DAY_NAMES:
            out.add(DAY_NAMES.index(d.lower()[:3]))
    return sorted(out)


def _time(v, default: str) -> str:
    if isinstance(v, int) and 0 <= v <= 23:
        return f"{v:02d}:00"
    m = TIME_RX.match(str(v or "").strip())
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else default


def _every(v, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return n if 0 <= n <= 240 else default


def _hour(v, default):
    if v is None:
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return n if 0 <= n <= 23 else default


def _model(v, default: dict, models: list[str] | None) -> dict:
    v = v if isinstance(v, dict) else {}
    model = str(v.get("model") or default.get("model") or "")
    if models and model not in models:
        model = default.get("model") or (models[0] if models else "")
    reasoning = str(v.get("reasoning") or default.get("reasoning") or "default")
    if reasoning not in {r for r, _ in REASONING}:
        reasoning = default.get("reasoning") or "default"
    return {"model": model, "reasoning": reasoning}


def normalize(raw: dict | None, base: dict, models: list[str] | None = None) -> dict:
    """Settings with every field present and valid; a missing or bad field takes `base`'s value."""
    raw = raw if isinstance(raw, dict) else {}
    out = copy.deepcopy(base)
    if "paused" in raw:
        out["paused"] = bool(raw["paused"])
    out["every"] = _every(raw.get("every", out["every"]), out["every"])
    if isinstance(raw.get("periods"), list):
        periods = []
        for p in raw["periods"][:MAX_PERIODS]:
            if not isinstance(p, dict):
                continue
            days = _days(p.get("days", "daily"))
            if not days:
                continue
            periods.append({"name": str(p.get("name") or "").strip()[:40], "days": days, "from": _time(p.get("from"), "00:00"),
                            "to": _time(p.get("to"), "00:00"), "every": _every(p.get("every"), out["every"])})
        out["periods"] = periods
    q = raw.get("quietHours", raw.get("quiet_hours"))
    if isinstance(q, list) and len(q) == 2:
        a, b = _hour(q[0], None), _hour(q[1], None)
        if a is not None and b is not None:
            out["quietHours"] = [a, b]
    digest = raw.get("digestHour", raw.get("digest_hour", out["digestHour"]))
    out["digestHour"] = None if digest is None else _hour(digest, out["digestHour"])  # None: off
    la = raw.get("lookahead")
    if isinstance(la, dict):
        for slot in ("morning", "evening"):
            if slot in la:
                v = la[slot]
                out["lookahead"][slot] = _hour(v[0] if isinstance(v, list) and v else v, out["lookahead"].get(slot))
    fp = raw.get("firstPass")
    if isinstance(fp, dict) and "firstPass" in out:
        cur = out["firstPass"]
        if "enabled" in fp:
            cur["enabled"] = bool(fp["enabled"])
        if fp.get("provider") in FIRSTPASS_PROVIDERS:
            cur["provider"] = fp["provider"]
        try:
            t = float(fp.get("threshold", cur["threshold"]))
            if 0.5 <= t <= 0.99:
                cur["threshold"] = round(t, 2)
        except (TypeError, ValueError):
            pass
    if isinstance(raw.get("rules"), str):
        out["rules"] = raw["rules"][:RULES_MAX]
    td = raw.get("tidy")
    if isinstance(td, dict) and "tidy" in out:
        if "enabled" in td:
            out["tidy"]["enabled"] = bool(td["enabled"])
        try:
            if int(td.get("every", out["tidy"]["every"])) in TIDY_EVERY:
                out["tidy"]["every"] = int(td.get("every", out["tidy"]["every"]))
        except (TypeError, ValueError):
            pass
    gl = raw.get("gmailLabel")
    if isinstance(gl, dict) and "gmailLabel" in out and "enabled" in gl:
        out["gmailLabel"]["enabled"] = bool(gl["enabled"])
    m = raw.get("models")
    if isinstance(m, dict):
        for job in ("decisions", "lookahead"):
            if job in m:
                out["models"][job] = _model(m[job], out["models"][job], models)
    return out


def from_config(sched: dict, judge: dict, quiet_hours, digest_hour: int, lookahead: dict, firstpass: dict | None = None,
                tidy: dict | None = None, gmail_label: dict | None = None) -> dict:
    """The defaults: what the config file says, in the settings shape."""
    la_judge = judge.get("lookahead") if isinstance(judge.get("lookahead"), dict) else {}
    base = {
        "paused": bool(sched.get("paused", False)),
        "every": _every(sched.get("every", 5), 5),
        "periods": [],
        "quietHours": [int(quiet_hours[0]), int(quiet_hours[1])],
        "digestHour": int(digest_hour),
        "lookahead": {slot: int(lookahead[slot][0]) if slot in lookahead else None for slot in ("morning", "evening")},
        "models": {"decisions": {"model": str(judge.get("model") or ""), "reasoning": str(judge.get("reasoning") or judge.get("thinking") or "default")},
                   "lookahead": {"model": str(la_judge.get("model") or judge.get("model") or ""),
                                 "reasoning": str(la_judge.get("reasoning") or judge.get("reasoning") or judge.get("thinking") or "default")}},
    }
    if firstpass is not None:
        from .firstpass import defaults as fp_defaults
        base["firstPass"] = fp_defaults(firstpass)
    if tidy is not None:
        every = tidy.get("every_hours", 2)
        base["tidy"] = {"enabled": bool(tidy.get("enabled", False)), "every": every if every in TIDY_EVERY else 2}
    if gmail_label is not None:
        base["gmailLabel"] = {"enabled": bool(gmail_label.get("enabled", True))}
    return normalize({"periods": sched.get("period", sched.get("periods", []))}, base)


def lookahead_windows(settings: dict, configured: dict) -> dict[str, tuple[int, int]]:
    """slot -> [start, end) hours. A slot at its configured start keeps the config's window; otherwise 4 hours."""
    out = {}
    for slot, h in settings["lookahead"].items():
        if h is None:
            continue
        c = configured.get(slot)
        out[slot] = (h, c[1]) if c and c[0] == h else (h, min(24, h + LOOKAHEAD_HOURS))
    return out


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def period_at(settings: dict, local: dt.datetime) -> dict | None:
    """The period covering this local moment (the first that does), or None."""
    now_m = local.hour * 60 + local.minute
    wd = local.weekday()
    for p in settings["periods"]:
        a, b = _minutes(p["from"]), _minutes(p["to"])
        if a < b:
            if wd in p["days"] and a <= now_m < b:
                return p
        else:  # runs past midnight (or all day when from == to): the early hours belong to the day before
            if (wd in p["days"] and now_m >= a) or (((wd - 1) % 7) in p["days"] and now_m < b):
                return p
    return None


def interval_at(settings: dict, local: dt.datetime) -> tuple[int, str]:
    """(minutes between checks, the period's name or "") at this moment; 0 = no checks."""
    p = period_at(settings, local)
    if p is None:
        return settings["every"], ""
    return p["every"], p["name"] or f"{p['from']}–{p['to']}"


def next_check(settings: dict, local: dt.datetime, last_check: dt.datetime | None, horizon_h: int = 48) -> dt.datetime | None:
    """When the next check falls due, walking forward minute by minute through the periods (None when paused or never)."""
    if settings["paused"]:
        return None
    t = local.replace(second=0, microsecond=0)
    for _ in range(horizon_h * 60):
        every, _name = interval_at(settings, t)
        if every and (last_check is None or (t - last_check).total_seconds() >= every * 60 - SLACK_S):
            return max(t, local)
        t += dt.timedelta(minutes=1)
    return None


def describe(settings: dict) -> str:
    """One line for logs and the CLI: "every 5 min; Overnight (Mon–Sun 22:00–08:00) every 15 min"."""
    if settings["paused"]:
        return "paused"

    def every(n):
        return "no checks" if n == 0 else f"every {n} min"

    def days(ds):
        for k, v in DAY_SETS.items():
            if ds == v:
                return k
        return ",".join(DAY_NAMES[d] for d in ds)
    parts = [every(settings["every"])]
    parts += [f"{p['name'] or 'period'} ({days(p['days'])} {p['from']}–{p['to']}) {every(p['every'])}" for p in settings["periods"]]
    fp = settings.get("firstPass")
    if fp and fp.get("enabled"):
        parts.append(f"first pass {fp['provider']} at {fp['threshold']:.2f}")
    td = settings.get("tidy")
    if td and td.get("enabled"):
        parts.append(f"tidy every {td['every']} h")
    return "; ".join(parts)


def options(judge_kind: str, cfg_models: list[str], firstpass_available: bool = False) -> dict:
    """What Pocket may offer for this judge."""
    if judge_kind == "claude":
        models = [{"id": i, "label": l} for i, l in CLAUDE_MODELS]
        for m in cfg_models:  # a full model name in the config stays selectable
            if m and m not in {x["id"] for x in models}:
                models.append({"id": m, "label": m})
    else:
        models = [{"id": m, "label": m} for m in dict.fromkeys(m for m in cfg_models if m)]
    from .firstpass import PROVIDERS, THRESHOLDS
    return {"every": EVERY_CHOICES, "models": models, "reasoning": [{"id": i, "label": l} for i, l in REASONING], "judge": judge_kind,
            "maxPeriods": MAX_PERIODS,
            "tidyEvery": TIDY_EVERY,
            "firstPass": {"available": firstpass_available, "providers": [{"id": i, "label": l} for i, l in PROVIDERS], "thresholds": THRESHOLDS}}
