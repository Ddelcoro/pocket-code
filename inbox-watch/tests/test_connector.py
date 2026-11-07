"""The connector mail source against a fake `claude` that answers the way Claude Code's stream-json does.

    python3 -m pytest tests/test_connector.py      (or: python3 tests/test_connector.py)

No mailbox, model or network: the fake reads the requested calls from the prompt and answers from a JSON mailbox file.
"""
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import mail_connector as C  # noqa: E402

FAKE = r'''#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
box = json.load(open(os.environ["FAKE_BOX"]))
log = open(os.environ["FAKE_LOG"], "a"); log.write(json.dumps(args) + "\n"); log.close()
prompt = sys.stdin.read()
calls = json.loads(prompt[prompt.index("["):])
open(os.environ["FAKE_LOG"] + ".calls", "a").write(json.dumps(calls) + "\n")
def emit(e): print(json.dumps(e))
tools = [] if box.get("no_connector") else ["mcp__claude_ai_Gmail__" + t for t in ("search_threads", "get_thread", "get_message", "send_message", "list_labels", "create_label", "label_thread", "unlabel_thread")]
emit({"type": "system", "subtype": "init", "tools": tools})
skip = box.get("skip_first", 0) if len(open(os.environ["FAKE_LOG"]).readlines()) == 1 else 0  # only the first run skips
for i, c in enumerate(calls):
    if i < skip:
        continue
    tid = f"tu{i}"
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": tid, "name": c["tool"], "input": c["input"]}]}})
    name = c["tool"].rsplit("__", 1)[-1]
    if name in ("label_thread", "unlabel_thread", "create_label") and box.get("read_only_grant"):
        emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "is_error": True, "content": "Insufficient scope: required https://mail.google.com/"}]}})
        continue
    elif name == "list_labels":
        res = {"labels": [{"id": "INBOX", "name": "INBOX"}] + [{"id": i, "name": n} for n, i in box.get("labels", {}).items()]}
    elif name == "create_label":
        box.setdefault("labels", {})[c["input"]["displayName"]] = "Label_9"; json.dump(box, open(os.environ["FAKE_BOX"], "w"))
        res = {"id": "Label_9", "name": c["input"]["displayName"]}
    elif name in ("label_thread", "unlabel_thread"):
        res = {"id": c["input"]["threadId"], "labelIds": c["input"]["labelIds"]}
    elif name == "search_threads":
        q = c["input"]["query"]
        threads = sorted(box["threads"], key=lambda t: -max(int(x["internalDate"]) for x in t["messages"]))
        newest = lambda t: max(int(x["internalDate"]) for x in t["messages"]) / 1000
        import calendar, time as _t
        day = lambda s: calendar.timegm(_t.strptime(s, "%Y/%m/%d"))
        if re.search(r"\b(after|before):\d{9,}\b", q):  # the real connector since 2026-10-27: the seconds form finds nothing, no error
            threads = []
        if (m := re.search(r"after:(\d{4}/\d{2}/\d{2})", q)):
            threads = [] if box.get("date_blind") else [t for t in threads if newest(t) >= day(m.group(1))]
        if (m := re.search(r"before:(\d{4}/\d{2}/\d{2})", q)):
            threads = [t for t in threads if newest(t) < day(m.group(1))]
        if (m := re.search(r"newer_than:(\d+)d", q)):
            threads = [t for t in threads if newest(t) >= _t.time() - int(m.group(1)) * 86400]
        if q.strip() == "in:sent":
            threads = [t for t in box["threads"] if any("SENT" in x["labelIds"] for x in t["messages"])]
        start, size = int(c["input"].get("pageToken") or 0), int(c["input"].get("pageSize") or 50)
        page = threads[start:start + size]
        res = {"threads": [{"id": t["id"], "messageCount": len(t["messages"]), "messages": [{k: v for k, v in t["messages"][-1].items() if k != "plaintextBody"}]} for t in page]}
        if start + size < len(threads):
            res["nextPageToken"] = str(start + size)
    else:
        t = next((t for t in box["threads"] if t["id"] == c["input"].get("threadId")), None)
        if t is None:
            emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "is_error": True, "content": "Thread not found"}]}})
            continue
        res = {"id": t["id"], "messageCount": len(t["messages"]), "messages": t["messages"]}
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": [{"type": "text", "text": json.dumps(res)}]}]},
          "tool_use_result": {"structuredContent": res}})
emit({"type": "assistant", "message": {"content": [{"type": "text", "text": "DONE"}]}})
emit({"type": "result", "subtype": "success", "result": "DONE", "total_cost_usd": 0.002, "duration_ms": 900, "usage": {"input_tokens": 1200, "output_tokens": 20}})
'''


def msg(mid, tid, ts, sender="Pat Doe <pat@vendor.example>", labels=("INBOX",), body="The invoice is attached."):
    return {"id": mid, "threadId": tid, "internalDate": str(ts * 1000), "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
            "labelIds": list(labels), "sender": sender, "toRecipients": ["Alex <alex@example.com>"], "subject": "Invoice 42",
            "snippet": body[:40], "plaintextBody": body}


def test_codex_labels_in_a_home_of_their_own():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 120), msg("m2", "t1", now - 60)]}, {"id": "t2", "messages": [msg("m3", "t2", now - 30)]}]
    b.save()
    m = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}, "alex@example.com", "", "", b.dir)
    assert m.label_access() is None and m.label_id("Pocket Inbox") == "Pocket Inbox"
    assert m.labelled_threads("Pocket Inbox", 50) == {"t1", "t2"}
    assert "label:pocket-inbox" in b.argv()[-1]["argv"][-1], "searched by the label's Gmail name"
    m.db.execute("create table if not exists mail(message_id text primary key, thread_id text, ts integer)")
    m.db.executemany("insert or replace into mail values(?,?,?)", [("m1", "t1", now - 120), ("m2", "t1", now - 60), ("m3", "t2", now - 30)])
    m.db.commit()
    ok = m.label_threads([("t1", ["Pocket Inbox"], []), ("t2", [], ["Pocket Inbox"]), ("t9", ["Pocket Inbox"], [])])
    assert ok == {"t1", "t2"}, "a thread with no known message is skipped"
    run = b.argv()[-1]
    sent = json.loads(run["argv"][-1].split("in order: ", 1)[1].split("]. Make no", 1)[0] + "]")
    assert sent[0]["message_ids"] == ["m2"] and sent[0]["create_missing_labels"] is True, "added on the newest message"
    assert sorted(sent[1]["message_ids"]) == ["m3"] and sent[1]["remove_label_names"] == ["Pocket Inbox"]
    home = Path(run["home"])
    cfg = (home / "config.toml").read_text()
    assert home.name == "codex-home-label" and ".tools.apply_labels_to_emails]\nenabled = true" in cfg
    assert not any(f".tools.{t}]" in cfg for t in C.CODEX_READS) and "send_email" not in cfg and "destructive_enabled = false" in cfg
    b.data["codex_label_tamper"] = True
    b.save()
    assert m.label_threads([("t1", ["Pocket Inbox"], [])]) == set(), "a call with other arguments than asked does not count"
    claude = Box().mail()
    assert claude.label_access() is None, "1.75.1: Claude's connector changes labels too"


def test_claude_labels_locked_down():
    b = Box()
    m = b.mail()
    assert m.label_id("Pocket Inbox") == "Label_9", "made when missing"
    n = len(b.argv())
    assert m.label_id("Pocket Inbox") == "Label_9" and len(b.argv()) == n, "remembered: no second lookup"
    assert m.label_threads([("t1", ["Label_9"], []), ("t2", [], ["Label_9"])]) == {"t1", "t2"}
    args = b.argv()[-1]
    allowed = args[args.index("--allowedTools") + 1].split(",")
    assert sorted(allowed) == sorted(C.LABEL_TOOLS) and "send_message" not in allowed
    blocked = args[args.index("--disallowedTools") + 1].split(",")
    assert C.PREFIX + "send_message" in blocked and C.PREFIX + "get_thread" in blocked and C.PREFIX + "label_thread" not in blocked
    w = m.fetch
    guard = lambda tool, inp: subprocess.run(["python3", "-I", str(w.label_guard)], input=json.dumps({"tool_name": C.PREFIX + tool, "tool_input": inp}),
                                             capture_output=True, text=True).stdout
    assert guard("label_thread", {"threadId": "t1", "labelIds": ["Label_9"]}) == "", "the asked-for change passes"
    assert "deny" in guard("label_thread", {"threadId": "t7", "labelIds": ["Label_9"]}), "another thread is refused"
    assert "deny" in guard("label_thread", {"threadId": "t1", "labelIds": ["TRASH"]}), "another label is refused"
    assert "deny" in guard("send_message", {"to": "x@example.com"}), "anything else is refused"
    assert "deny" in guard("create_label", {"displayName": "Other"})
    b.data["read_only_grant"] = True
    b.save()
    try:
        m.label_threads([("t1", ["Label_9"], [])])
        raise AssertionError("a read-only grant must raise")
    except C.MailError as e:
        assert e.resp.status == 403 and "reconnect Gmail" in str(e), "a read-only grant says what to do"


def test_claude_read_only_falls_back_to_codex_for_labels():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.data["read_only_grant"] = True
    b.save()
    m = C.ConnectorMail({"agent": "claude", "bin": str(b.bin), "fallback_agent": "codex", "fallback": {"bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}},
                        "alex@example.com", "", "", b.dir)
    m.db.execute("create table if not exists mail(message_id text primary key, thread_id text, ts integer)")
    m.db.execute("insert or replace into mail values('m1','t1',?)", (now - 60,))
    m.db.commit()
    lid = m.label_id("Pocket Inbox")
    assert lid == "Pocket Inbox", "Claude may not even make the label (a read-only grant, 2026-10-21): Codex does, by name"
    assert m.label_threads([("t1", [lid], [])]) == {"t1"}, "the change went through Codex instead"
    sent = b.argv()[-1]
    assert Path(sent["home"]).name == "codex-home-label" and '"add_label_names": ["Pocket Inbox"]' in sent["argv"][-1], "by name, in Codex's label home"


class Box:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix="conn-test-"))
        self.bin = self.dir / "claude"
        self.bin.write_text(FAKE)
        self.bin.chmod(self.bin.stat().st_mode | stat.S_IEXEC)
        self.file, self.log = self.dir / "box.json", self.dir / "calls.log"
        os.environ["FAKE_BOX"], os.environ["FAKE_LOG"] = str(self.file), str(self.log)
        self.data = {"threads": []}
        self.save()

    def save(self):
        self.file.write_text(json.dumps(self.data))

    def mail(self, **kw):
        return C.ConnectorMail({"provider": "connector", "bin": str(self.bin), **kw}, "alex@example.com", "newer_than:2d", "", self.dir)

    def argv(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()]


def test_changed_threads_sees_new_messages_once():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.save()
    m = b.mail()
    changed, cur, rebase = m.changed_threads(f"t:{now - 300}")
    assert changed == {"t1"} and cur.startswith("t:") and rebase is False
    changed, _, _ = m.changed_threads(cur)
    assert changed == set(), "a thread with nothing new is not changed again"
    b.data["threads"][0]["messages"].append(msg("m2", "t1", now))
    b.save()
    changed, _, _ = m.changed_threads(cur)
    assert changed == {"t1"}


def searches(b):
    """Every search_threads call the fake was asked for, in order."""
    calls = (json.loads(x) for x in Path(str(b.log) + ".calls").read_text().splitlines())
    return [c["input"] for call in calls for c in call if c["tool"].endswith("search_threads")]


def test_time_bounds_reach_the_connector_as_dates():
    """Since 2026-10-27 the claude.ai connector answers `after:<seconds>` with nothing and no error (Damon, 2026-10-28)."""
    import datetime as dt
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.save()
    m = b.mail()
    assert m.changed_threads(f"t:{now - 300}")[0] == {"t1"}, "found through the date form; the fake answers the seconds form with nothing"
    sent = searches(b)[-1]["query"]
    since = now - 300 - C.OVERLAP_S
    assert sent.startswith("after:" + dt.datetime.fromtimestamp(since - 86400, dt.timezone.utc).strftime("%Y/%m/%d") + " "), sent
    assert not re.search(r"(after|before):\d{9,}", sent)
    ids = m.search_ids(f"(from:pat@vendor.example) before:{now + 1} -in:spam", 25)
    assert ids == ["m1"]
    sent = searches(b)[-1]["query"]
    assert "before:" + dt.datetime.fromtimestamp(now + 1 + 2 * 86400, dt.timezone.utc).strftime("%Y/%m/%d") in sent, sent
    assert C.date_form("after:1793178247 -in:spam before:1793264647") == "after:2026/10/27 -in:spam before:2026/10/31", "a day back, two days on (both are 09:04 UTC)"
    assert C.date_form("newer_than:2d before:2026/10/30 after:12345") == "newer_than:2d before:2026/10/30 after:12345", "only Unix seconds change"


def test_the_scope_reaches_every_fetch():
    """1.100: inbox only, or inbox plus labels, bounds the window search, the baseline and the blind probe alike; the archive search is not bounded."""
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.save()
    m = b.mail(scope={"mode": "inbox"})
    m.changed_threads(f"t:{now - 300}")
    assert searches(b)[-1]["query"].endswith(" -in:spam -in:trash -in:draft {in:inbox in:sent}"), searches(b)[-1]["query"]
    m.baseline_threads()
    assert searches(b)[-1]["query"] == "newer_than:2d in:inbox", searches(b)[-1]["query"]
    m.search_ids("from:pat@vendor.example", 10)
    assert "in:inbox" not in searches(b)[-1]["query"], "an archive or research search is not the scope's business"
    m = b.mail(scope={"mode": "inbox_labels", "labels": ["Clients", "Ultra/Ask first"]})
    m.baseline_threads("newer_than:1d")
    assert searches(b)[-1]["query"] == "newer_than:1d {in:inbox label:Clients label:Ultra-Ask-first}", searches(b)[-1]["query"]
    b.data["threads"] = []
    b.data["date_blind"] = True
    b.save()
    m.changed_threads(f"t:{now - 300}")
    probe = searches(b)[-1]["query"]
    assert probe.startswith("newer_than:1d ") and probe.endswith(" {in:inbox label:Clients label:Ultra-Ask-first}"), probe
    assert b.mail().scope == "" and "in:inbox" not in (b.mail().baseline_threads() or searches(b)[-1]["query"])


def test_a_scoped_read_keeps_the_owners_replies_not_a_new_email():
    """A reply carries neither INBOX nor a filter's label, and it is how the watcher learns a story was answered. An email the owner starts stays out."""
    from inbox_monitor.mail_connector import new_outbound
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "reply", "messages": [msg("r1", "reply", now - 900), msg("r2", "reply", now - 60, labels=("SENT",))]},
                         {"id": "new", "messages": [msg("n1", "new", now - 60, labels=("SENT",))]},
                         {"id": "got", "messages": [msg("g1", "got", now - 60)]}]
    b.save()
    changed, _, _ = b.mail(scope={"mode": "inbox"}).changed_threads(f"t:{now - 300}")
    assert changed == {"reply", "got"}, changed
    sent = {"labelIds": ["SENT"]}
    assert new_outbound({"messageCount": 1, "messages": [sent]})
    assert not new_outbound({"messageCount": 2, "messages": [sent]}), "a reply"
    assert not new_outbound({"messageCount": 1, "messages": [{"labelIds": ["SENT", "INBOX"]}]}), "an email to yourself"
    assert not new_outbound({"messageCount": 1, "messages": [{"labelIds": ["SENT", "Label_2"]}]}), "under a label"
    assert not new_outbound({"messages": [sent]}), "Codex's search does not say how long a thread is, so the email is read"


def test_gmail_history_keeps_the_owners_replies_inside_a_scope():
    """The same rule on the Gmail API path, which reads history rather than searching."""
    try:
        import googleapiclient  # noqa: F401
    except ImportError:  # CI has no Google client, and this test makes no real call
        class HttpError(Exception):
            def __init__(self, resp, content):
                super().__init__(resp.reason)
                self.resp = resp

        fake = {"googleapiclient": {}, "googleapiclient.discovery": {"build": None}, "googleapiclient.errors": {"HttpError": HttpError}}
        for name, attrs in fake.items():
            sys.modules[name] = type(sys)(name)
            vars(sys.modules[name]).update(attrs)
    from inbox_monitor.mail_gmail import Gmail, HttpError

    class Req:
        def __init__(self, v):
            self.v = v

        def execute(self):
            if isinstance(self.v, Exception):
                raise self.v
            return self.v

    class Api:
        def history(self):
            return self

        def threads(self):
            return self

        def list(self, **_kw):
            added = [("reply", ["SENT"]), ("new", ["SENT"]), ("gone", ["SENT"]), ("got", ["INBOX"]), ("filed", ["Label_9"])]
            return Req({"history": [{"messagesAdded": [{"message": {"threadId": t, "labelIds": ls}} for t, ls in added]}], "historyId": "9"})

        def get(self, id, **_kw):
            if id == "gone":
                return Req(HttpError(type("R", (), {"status": 404, "reason": "gone"})(), b"{}"))
            return Req({"messages": [{"id": "1"}, {"id": "2"}] if id == "reply" else [{"id": "1"}]})

    g = Gmail.__new__(Gmail)
    g.u, g.scope, g._scope_ids, g.arrived_labels = Api(), {"mode": "inbox"}, None, {}
    assert g.changed_threads("1") == ({"reply", "got"}, "9", False), "a 404 on one thread is not an expired cursor"
    g.scope, g._scope_ids = {"mode": "all"}, None
    assert g.changed_threads("1")[0] == {"reply", "new", "gone", "got", "filed"}, "Everything asks nothing extra"


def test_list_labels_names_the_owners_labels():
    """1.100: the scope picker's label list, from the Claude transport; Gmail's own labels (INBOX) are left out, names sorted."""
    b = Box()
    b.data["labels"] = {"Ultra/Ask first": "Label_174", "Clients": "Label_2"}
    b.save()
    assert b.mail().list_labels() == ["Clients", "Ultra/Ask first"]


def test_paging_stops_at_mail_already_seen():
    """The date window holds a day or two of seen mail; pages are newest first and stop once a page has nothing unseen."""
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": f"t{i}", "messages": [msg(f"m{i}", f"t{i}", now - 3600 - i * 10)]} for i in range(120)]
    b.save()
    m = b.mail()
    changed, cur, _ = m.changed_threads(f"t:{now - 300}")
    assert len(changed) == 120 and len(searches(b)) == 3, "50 + 50 + 20: every page had unseen mail"
    b.data["threads"].append({"id": "new", "messages": [msg("mnew", "new", now)]})
    b.save()
    assert m.changed_threads(cur)[0] == {"new"}
    assert len(searches(b)) == 5, "two pages: the first had the new thread, the second nothing unseen, so the third was not read"
    assert m.changed_threads(cur)[0] == set() and len(searches(b)) == 6, "nothing new: one page"


def test_a_blind_search_fails_the_check():
    """Nothing found in a window of a day or more while newer_than:1d has mail: the third such check raises, status says why."""
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 600)]}]
    b.data["date_blind"] = True
    b.save()
    m = b.mail()
    for i in range(C.BLIND_RUNS - 1):
        assert m.changed_threads(f"t:{now - 300}")[0] == set()
        assert len(searches(b)) == 2 * (i + 1), "the window search and the newer_than:1d probe"
    try:
        m.changed_threads(f"t:{now - 300}")
        assert False, "the third blind check should fail"
    except C.MailError as e:
        assert e.resp.status == 502 and "blind" in str(e) and "newer_than:1d finds 1 thread" in str(e) and "Gmail connector" not in str(e), str(e)
    b.data["date_blind"] = False
    b.save()
    assert m.changed_threads(f"t:{now - 300}")[0] == {"t1"}, "the search works again: the check passes and the mail is seen"
    assert m._meta("blind_runs") == "0"
    b.data["date_blind"] = True
    b.save()
    assert m.changed_threads(f"t:{now - 300}")[0] == set(), "counting starts over"


def test_a_quiet_mailbox_is_not_blind():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "old", "messages": [msg("mo", "old", now - 10 * 86400)]}]
    b.save()
    m = b.mail()
    for _ in range(C.BLIND_RUNS + 1):
        assert m.changed_threads(f"t:{now - 300}")[0] == set()
    assert m._meta("blind_runs") == "0" and len(searches(b)) == 2 * (C.BLIND_RUNS + 1), "the probe found nothing either: no mail in a day is just quiet"


def test_spam_and_promotions_alone_do_not_count():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t9", "messages": [msg("m9", "t9", now - 10, labels=("CATEGORY_PROMOTIONS",))]}]
    b.save()
    assert b.mail().changed_threads(f"t:{now - 300}")[0] == set()


def test_thread_raw_reads_like_the_gmail_api():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60, body="Please confirm the install date.")]}]
    b.save()
    raw = b.mail().thread_raw("t1")
    assert raw[0]["id"] == "m1" and raw[0]["threadId"] == "t1" and raw[0]["internalDate"] == str((now - 60) * 1000)
    from inbox_monitor import engine as E
    E.MAILBOX = "alex@example.com"
    row = E.parse_message(raw[0])
    assert row["subject"] == "Invoice 42" and row["sender"].startswith("Pat Doe") and "install date" in row["body"]
    assert row["ts"] == now - 60 and row["from_owner"] == 0


def test_missing_thread_is_a_404():
    b = Box()
    try:
        b.mail().thread_raw("nope")
    except C.MailError as e:
        assert e.resp.status == 404
    else:
        raise AssertionError("expected a 404")


def test_prefetch_batches_threads_into_few_calls():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": f"t{i}", "messages": [msg(f"m{i}", f"t{i}", now - i)]} for i in range(10)]
    b.save()
    m = b.mail()
    m.prefetch_threads([f"t{i}" for i in range(10)])
    assert len(b.argv()) == 2, "10 threads at 8 per call is two calls"
    m.thread_raw("t3")
    assert len(b.argv()) == 2, "a prefetched thread costs no further call"


def test_skipped_calls_are_retried():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now)]}, {"id": "t2", "messages": [msg("m2", "t2", now)]}]
    b.data["skip_first"] = 1
    b.save()
    m = b.mail()
    m.prefetch_threads(["t1", "t2"])
    assert len(b.argv()) == 2 and "t1" in m._cache and "t2" in m._cache


def test_the_call_is_locked_to_read_tools():
    b = Box()
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", int(time.time()))]}]
    b.save()
    m = b.mail()
    m.thread_raw("t1")
    argv = b.argv()[0]
    assert argv[argv.index("--tools") + 1] == ""
    assert argv[argv.index("--permission-mode") + 1] == "dontAsk"
    denied = argv[argv.index("--disallowedTools") + 1].split(",")
    assert "mcp__claude_ai_Gmail__send_message" in denied and "mcp__claude_ai_Gmail__trash_thread" in denied and "mcp__claude_ai_Google_Drive" in denied
    assert set(argv[argv.index("--allowedTools") + 1].split(",")) == set(C.READ_TOOLS)
    settings = json.loads(argv[argv.index("--settings") + 1])
    hook = settings["hooks"]["PreToolUse"][0]
    assert hook["matcher"] == "*"
    guard = m.fetch.guard
    import subprocess
    for tool, allowed in (("mcp__claude_ai_Gmail__get_thread", True), ("mcp__claude_ai_Gmail__send_message", False), ("Bash", False)):
        r = subprocess.run([sys.executable, "-I", str(guard)], input=json.dumps({"tool_name": tool}), capture_output=True, text=True)
        decided = json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"] if r.stdout.strip() else "allow"
        assert (decided == "allow") == allowed, (tool, decided)


def test_no_connector_says_how_to_fix_it():
    b = Box()
    b.data["no_connector"] = True
    b.save()
    try:
        b.mail().changed_threads(f"t:{int(time.time())}")
    except C.MailError as e:
        assert e.resp.status == 401 and "Connectors" in str(e)
    else:
        raise AssertionError("expected a 401")


def test_whoami_is_the_sender_of_sent_mail():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now, sender="Alex Rivera <Alex@Example.com>", labels=("SENT",))]}]
    b.save()
    assert b.mail().whoami() == {"email": "alex@example.com", "name": "Alex Rivera", "senders": ["alex@example.com"]}


def test_whoami_lists_every_sender_of_recent_sent_mail():
    """1.81: an owner who sometimes sends from an alias: the newest sender is the answer, the others are listed, replies from
    other people in a sent thread are not."""
    b = Box()
    now = int(time.time())
    b.data["threads"] = [
        {"id": "t1", "messages": [msg("m1", "t1", now, sender="Alex Rivera <alias@example.org>", labels=("SENT",))]},
        {"id": "t2", "messages": [msg("m2", "t2", now - 60, sender="Alex Rivera <Alex@Example.com>", labels=("SENT",))]},
        {"id": "t4", "messages": [msg("m5", "t4", now - 200, sender="Alex <alex@example.com>", labels=("SENT",)),
                                  msg("m3", "t4", now - 100, sender="Pat <pat@vendor.example>", labels=("INBOX",))]},
        {"id": "t3", "messages": [msg("m4", "t3", now - 120, sender="Alex <alex@example.com>", labels=("SENT",))]}]
    b.save()
    who = b.mail().whoami()
    assert who["email"] == "alias@example.org" and who["senders"] == ["alias@example.org", "alex@example.com"], who


def test_cursors_do_not_cross_sources():
    assert C.ConnectorMail.cursor_ok("t:1790000000") and not C.ConnectorMail.cursor_ok("123456")


FAKE_CODEX = r"""#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
box = json.load(open(os.environ["FAKE_BOX"]))
log = open(os.environ["FAKE_LOG"], "a"); log.write(json.dumps({"argv": args, "home": os.environ.get("CODEX_HOME")}) + "\n"); log.close()
prompt = args[-1]
def emit(e): print(json.dumps(e))
if box.get("codex_bot_check"):
    emit({"type": "turn.failed", "error": {"message": "unexpected status 403 Forbidden: cloudflare challenge"}}); sys.exit(1)
lab = re.search(r"Call gmail_apply_labels_to_emails once for each of these argument objects, exactly as given, in order: (\[.*\])\.", prompt)
if lab:  # 1.75: label changes, one call per item; box["codex_label_tamper"] makes the model swap a label name
    for i, a in enumerate(json.loads(lab.group(1))):
        if box.get("codex_label_tamper") and i == 0:
            a = {**a, "add_label_names": ["SPAM"]}
        emit({"type": "item.completed", "item": {"type": "mcp_tool_call", "server": "codex_apps", "tool": "gmail.apply_labels_to_emails", "arguments": a,
              "status": "completed", "result": {"structured_content": {"success": True, "added_label_ids": a["add_label_names"], "removed_label_ids": a["remove_label_names"]}}}})
    emit({"type": "turn.completed", "usage": {"input_tokens": 900, "output_tokens": 10}})
    sys.exit(0)
m = re.search(r"Call gmail_(\w+) exactly once(?: with these arguments: (\{.*\}))?\.", prompt)
tool, a = m.group(1), json.loads(m.group(2) or "{}")
if tool == "get_profile":
    res = {"email": "Alex@Example.com", "name": "Alex Rivera"}
elif tool == "search_emails":
    res = {"emails": [{"id": x["id"], "thread_id": t["id"], "from_": x["sender"], "labels": x["labelIds"]} for t in box["threads"] for x in t["messages"][-1:]]}
else:
    res = {"responses": [{"id": t["id"], "messages": [{"id": x["id"], "thread_id": t["id"], "label_ids": x["labelIds"], "internal_date": x["internalDate"],
            "snippet": x["snippet"], "payload": {"mime_type": "multipart/alternative", "headers": [{"name": "From", "value": x["sender"]}, {"name": "Subject", "value": x["subject"]}],
            "body": {"content": None}, "parts": [{"mime_type": "text/plain", "body": {"content": x["plaintextBody"]}, "parts": []}]}} for x in t["messages"]]}
            for t in box["threads"] if t["id"] in a.get("thread_ids", [])]}
emit({"type": "item.completed", "item": {"type": "mcp_tool_call", "server": "codex_apps", "tool": "gmail." + tool, "arguments": a, "status": "completed",
      "result": {"content": [{"type": "text", "text": "ok"}], "structured_content": res}}})
emit({"type": "item.completed", "item": {"type": "agent_message", "text": "DONE"}})
emit({"type": "turn.completed", "usage": {"input_tokens": 3000, "cached_input_tokens": 1000, "output_tokens": 20}})
"""


def codex_box():
    b = Box()
    b.codex = b.dir / "codex"
    b.codex.write_text(FAKE_CODEX)
    b.codex.chmod(b.codex.stat().st_mode | stat.S_IEXEC)
    (b.dir / "codex-src").mkdir()
    (b.dir / "codex-src" / "auth.json").write_text("{}")
    return b


def test_codex_reads_and_locks_down():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60, body="Codex body text.")]}]
    b.save()
    m = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}, "alex@example.com", "", "", b.dir)
    assert m.whoami() == {"email": "alex@example.com", "name": "Alex Rivera"}
    changed, cur, _ = m.changed_threads(f"t:{now - 300}")
    assert changed == {"t1"} and m.changed_threads(cur)[0] == set()
    from inbox_monitor import engine as E
    E.MAILBOX = "alex@example.com"
    row = E.parse_message(m.thread_raw("t1")[0])
    assert row["subject"] == "Invoice 42" and "Codex body text" in row["body"] and row["ts"] == now - 60
    home = Path(b.argv()[0]["home"])
    cfg = (home / "config.toml").read_text()
    assert (home / "auth.json").is_symlink() and os.readlink(home / "auth.json") == str(b.dir / "codex-src" / "auth.json")
    assert "[apps._default]\nenabled = false" in cfg and "default_tools_enabled = false" in cfg and "destructive_enabled = false" in cfg
    assert "shell_tool = false" in cfg and 'sandbox_mode = "read-only"' in cfg
    assert all(f".tools.{t}]\nenabled = true" in cfg for t in C.CODEX_READS) and "send_email" not in cfg


def test_codex_bot_check_is_a_503_and_claude_takes_over():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.data["codex_bot_check"] = True
    b.save()
    alone = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}, "", "", "", b.dir)
    try:
        alone.changed_threads(f"t:{now - 300}")
    except C.MailError as e:
        assert e.resp.status == 503
    else:
        raise AssertionError("expected a 503")
    logs = []
    both = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src"), "fallback_agent": "claude",
                            "fallback": {"bin": str(b.bin)}}, "", "", "", b.dir, log=logs.append)
    assert both.changed_threads(f"t:{now - 300}")[0] == {"t1"}
    assert any("using ClaudeConnector" in x for x in logs)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
