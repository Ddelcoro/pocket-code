"""Schedule settings: normalize, periods (including past midnight), the interval in force and the next check.

    python3 -m pytest tests/test_schedule.py      (or: python3 tests/test_schedule.py)
"""
import datetime as dt
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import schedule as S  # noqa: E402

TZ = ZoneInfo("America/New_York")
BASE = S.from_config({"every": 5}, {"model": "sonnet", "reasoning": "medium", "lookahead": {"model": "opus"}}, (22, 8), 8,
                     {"morning": (8, 12), "evening": (17, 22)})
MODELS = ["haiku", "sonnet", "opus", "fable"]


def at(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s).replace(tzinfo=TZ)


def test_defaults_from_config():
    assert BASE["every"] == 5 and BASE["periods"] == [] and BASE["quietHours"] == [22, 8] and BASE["digestHour"] == 8
    assert BASE["lookahead"] == {"morning": 8, "evening": 17}
    assert BASE["models"] == {"decisions": {"model": "sonnet", "reasoning": "medium"}, "lookahead": {"model": "opus", "reasoning": "medium"}}


def test_toml_periods_and_day_names():
    b = S.from_config({"every": 10, "period": [{"name": "Work", "days": "weekdays", "from": "7:00", "to": "19:00", "every": 5},
                                               {"days": ["sat", "Sunday"], "from": "09:00", "to": "17:00", "every": 30}]},
                      {"model": "sonnet"}, (22, 8), 8, {"morning": (8, 12)})
    assert b["periods"][0] == {"name": "Work", "days": [0, 1, 2, 3, 4], "from": "07:00", "to": "19:00", "every": 5}
    assert b["periods"][1]["days"] == [5, 6]
    assert b["lookahead"] == {"morning": 8, "evening": None}


def test_normalize_keeps_good_fields_and_drops_bad_ones():
    s = S.normalize({"every": 999, "periods": [{"days": [], "from": "1:00", "to": "2:00", "every": 5}, {"days": [0, 9, "x"], "from": "25:00", "to": "06:30", "every": "15"}],
                     "quietHours": [21, 7], "digestHour": "x", "lookahead": {"morning": None, "evening": [18, 22]},
                     "models": {"decisions": {"model": "gpt-9", "reasoning": "huge"}, "lookahead": {"model": "fable", "reasoning": "default"}}}, BASE, MODELS)
    assert s["every"] == 5  # out of range: the default
    assert s["periods"] == [{"name": "", "days": [0], "from": "00:00", "to": "06:30", "every": 15}]  # no days: dropped; bad time: 00:00
    assert s["quietHours"] == [21, 7] and s["digestHour"] == 8
    assert S.normalize({"digestHour": None}, BASE)["digestHour"] is None, "null is Off, and stays Off"
    assert S.normalize({"digestHour": 6}, BASE)["digestHour"] == 6 and S.normalize({"digestHour": 0}, BASE)["digestHour"] == 0
    assert s["lookahead"] == {"morning": None, "evening": 18}
    assert s["models"]["decisions"] == {"model": "sonnet", "reasoning": "medium"}  # unknown model and level: the defaults
    assert s["models"]["lookahead"] == {"model": "fable", "reasoning": "default"}
    assert S.normalize(None, BASE) == BASE


def test_periods_cover_the_right_moments():
    s = S.normalize({"every": 10, "periods": [
        {"name": "Work", "days": [0, 1, 2, 3, 4], "from": "07:00", "to": "19:00", "every": 5},
        {"name": "Overnight", "days": [0, 1, 2, 3, 4, 5, 6], "from": "22:00", "to": "07:00", "every": 30},
        {"name": "Sunday off", "days": [6], "from": "07:00", "to": "22:00", "every": 0}]}, BASE)
    assert S.interval_at(s, at("2026-10-20T09:00")) == (5, "Work")          # Tuesday
    assert S.interval_at(s, at("2026-10-20T19:00")) == (10, "")             # the end is exclusive: the default
    assert S.interval_at(s, at("2026-10-20T23:30")) == (30, "Overnight")
    assert S.interval_at(s, at("2026-10-21T03:00")) == (30, "Overnight")    # past midnight, from Tuesday's period
    assert S.interval_at(s, at("2026-10-25T12:00")) == (0, "Sunday off")
    assert S.interval_at(s, at("2026-10-24T12:00")) == (10, "")             # Saturday daytime


def test_past_midnight_belongs_to_the_starting_day():
    s = S.normalize({"periods": [{"name": "Fri night", "days": [4], "from": "20:00", "to": "06:00", "every": 60}]}, BASE)
    assert S.interval_at(s, at("2026-10-23T21:00"))[0] == 60   # Friday evening
    assert S.interval_at(s, at("2026-10-24T05:59"))[0] == 60   # Saturday early, still Friday's
    assert S.interval_at(s, at("2026-10-24T21:00"))[0] == 5    # Saturday evening: not covered


def test_next_check():
    s = S.normalize({"every": 15, "periods": [{"name": "Night", "days": "daily", "from": "22:00", "to": "07:00", "every": 0}]}, BASE)
    assert S.next_check(s, at("2026-10-20T10:00"), at("2026-10-20T09:50")) == at("2026-10-20T10:05")
    assert S.next_check(s, at("2026-10-20T23:00"), at("2026-10-20T21:59")) == at("2026-10-21T07:00")  # no checks overnight
    assert S.next_check(s, at("2026-10-20T10:00"), None) == at("2026-10-20T10:00")
    assert S.next_check({**s, "paused": True}, at("2026-10-20T10:00"), None) is None


def test_lookahead_windows():
    assert S.lookahead_windows(BASE, {"morning": (8, 12), "evening": (17, 22)}) == {"morning": (8, 12), "evening": (17, 22)}
    s = S.normalize({"lookahead": {"morning": 7, "evening": None}}, BASE)
    assert S.lookahead_windows(s, {"morning": (8, 12), "evening": (17, 22)}) == {"morning": (7, 11)}
    s = S.normalize({"lookahead": {"evening": 22}}, BASE)
    assert S.lookahead_windows(s, {})["evening"] == (22, 24)


def test_options_and_describe():
    o = S.options("claude", ["sonnet", "claude-opus-5-5"])
    assert [m["id"] for m in o["models"]] == ["haiku", "sonnet", "opus", "fable", "claude-opus-5-5"]
    assert S.options("codex", ["gpt-6-sol"])["models"] == [{"id": "gpt-6-sol", "label": "gpt-6-sol"}]
    s = S.normalize({"periods": [{"name": "Night", "days": "daily", "from": "22:00", "to": "07:00", "every": 0}]}, BASE)
    assert S.describe(s) == "every 5 min; Night (daily 22:00–07:00) no checks"
    assert S.describe({**s, "paused": True}) == "paused"


def test_first_pass_settings():
    b = S.from_config({}, {"model": "sonnet"}, (22, 8), 8, {}, {"enabled": True, "provider": "jev", "threshold": 0.8})
    assert b["firstPass"] == {"enabled": True, "provider": "jev", "threshold": 0.8}
    assert S.from_config({}, {"model": "sonnet"}, (22, 8), 8, {}, {})["firstPass"] == {"enabled": False, "provider": "jev", "threshold": 0.8}
    s = S.normalize({"firstPass": {"enabled": False, "provider": "both", "threshold": 0.9}}, b)
    assert s["firstPass"] == {"enabled": False, "provider": "both", "threshold": 0.9}
    s = S.normalize({"firstPass": {"provider": "gpt", "threshold": 0.2}}, b)
    assert s["firstPass"] == b["firstPass"], "bad values keep the defaults"
    assert "firstPass" not in S.normalize({"firstPass": {"enabled": True}}, BASE), "no [firstpass] table, no setting"
    assert S.describe(b) == "every 5 min; first pass jev at 0.80"
    assert S.options("claude", [], True)["firstPass"]["available"] is True


def test_tidy_settings():
    b = S.from_config({}, {"model": "sonnet"}, (22, 8), 8, {}, {}, {"enabled": True, "every_hours": 2})
    assert b["tidy"] == {"enabled": True, "every": 2}
    assert S.normalize({"tidy": {"enabled": False, "every": 4}}, b)["tidy"] == {"enabled": False, "every": 4}
    assert S.normalize({"tidy": {"every": 3}}, b)["tidy"] == {"enabled": True, "every": 2}, "only the offered intervals"
    assert S.from_config({}, {"model": "sonnet"}, (22, 8), 8, {}, {}, {})["tidy"] == {"enabled": False, "every": 2}
    assert "tidy every 2 h" in S.describe(b)


def test_rules_setting():
    s = S.normalize({"rules": "Never tell me about cameras that go offline."}, BASE)
    assert s["rules"] == "Never tell me about cameras that go offline."
    assert len(S.normalize({"rules": "x" * 9000}, BASE)["rules"]) == S.RULES_MAX
    assert "rules" not in S.normalize({"rules": 5}, BASE), "only text"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
