"""The Pocket Inbox label kept in step with the Inbox, both ways, and Check now (1.75), against a fake mailbox and a fake
Pocket. No Gmail, model or network.

    python3 tests/test_label.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import config as cfgmod  # noqa: E402
from inbox_monitor import engine as E  # noqa: E402

RUN = E.run  # test_check_now_runs_once stands in for it
A, B, Z = "18f0aa01b2c3d4e5", "18f0aa01b2c3d4e6", "18f0aa01b2c3d4e7"  # Gmail thread ids are hex


class FakeGmail:
    def __init__(self, writable=True):
        self.labels: dict[str, set[str]] = {}  # thread -> label ids
        self.made = []
        self.writable = writable

    def label_access(self):
        return None if self.writable else "the Gmail sign-in is read-only"

    def label_id(self, name, create=True):
        if "L1" in self.made:
            return "L1"
        if not create:
            return None
        self.made.append("L1")
        return "L1"

    def labelled_threads(self, label_id, cap):
        return {t for t, ls in self.labels.items() if label_id in ls}

    def label_thread(self, tid, add=(), remove=()):
        ls = self.labels.setdefault(tid, set())
        ls |= set(add)
        ls -= set(remove)

    def label_threads(self, changes):
        for tid, add, remove in changes:
            self.label_thread(tid, add, remove)
        return {c[0] for c in changes}


class FakePocket:
    inbox = True
    kind = "pocket"

    def __init__(self):
        self.entries = []  # open entries: {id, gmail}
        self.acted = []

    def inbox_open(self):
        return list(self.entries)

    def act(self, eid, action, note):
        self.acted.append((eid, action))
        self.entries = [e for e in self.entries if e["id"] != eid]

    def entry(self, eid, tid):
        self.entries.append({"id": eid, "gmail": f"https://mail.google.com/mail/u/0/#all/{tid}"})


def setup():
    d = Path(tempfile.mkdtemp())
    (d / "config.toml").write_text('[owner]\nname = "Alex"\nemail = "alex@example.com"\ntimezone = "UTC"\n\n[judge]\nkind = "claude"\nmodel = "sonnet"\n')
    E.configure(cfgmod.load(d / "config.toml"))
    pocket = FakePocket()
    E.DELIVERIES = [pocket]
    return E.Store(d / "state" / "m.sqlite"), FakeGmail(), pocket


def states(store):
    return dict(store.db.execute("select thread_id, state from label_sync").fetchall())


def test_both_ways():
    store, g, p = setup()
    assert E.DEFAULTS["gmailLabel"] == {"enabled": True}, "on by default"
    p.entry("e1", A)
    g.labels[Z] = {"L1"}  # labelled before the sync began
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set(), "the first sync brings nothing in"
    assert g.labels[A] == {"L1"} and states(store) == {A: "synced", Z: "judged"}, states(store)
    # the owner labels B in Gmail (with Move to: it left the inbox): it comes in, back in INBOX too
    g.labels[B] = {"L1"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == {B}
    assert g.labels[B] == {"L1", "INBOX"} and states(store)[B] == "incoming"
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set(), "taken up once"
    bundle = {"thread_id": B, "subject": "Quote request", "messages": [{"message_id": "m1", "from": "Pat <pat@vendor.example>", "body": "", "from_owner": False}]}
    E.mark_added(store, [bundle])
    assert bundle.get("added_in_gmail") and not E.firstpass_eligible(store, bundle, [], set())
    dec = E.validate_story_fields({"thread_id": B, "action": "ignore", "issue_key": "b", "confidence": 0.1, "priority": "low", "status": "resolved"}, set())
    E.added_decision(dec, bundle)
    assert dec["action"] == "notify" and dec["priority"] == "normal" and dec["status"] == "open" and dec["evidence"][0]["message_id"] == "m1"
    assert "Quote request" in dec["user_message"]
    # its alert reaches Pocket: in step
    p.entry("e2", B)
    E.label_sync(store, g, bring_in=False, dry_run=False)
    assert states(store)[B] == "synced"
    # resolved in Pocket: the label comes off in Gmail
    p.entries = [e for e in p.entries if e["id"] != "e1"]
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert "L1" not in g.labels[A] and A not in states(store)
    # the owner takes the label off B in Gmail: the entry leaves the list (dismissed)
    g.labels[B].discard("L1")
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert p.acted == [("e2", "dismiss")] and B not in states(store)
    # restored in Pocket: labelled again
    p.entry("e2", B)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert "L1" in g.labels[B]
    assert Z in states(store) and "L1" in g.labels[Z], "the label the owner had before is never touched"


def test_folded_thread_follows_its_entry():
    # 2026-10-28: Brad labelled two copies of Justin's reply (his and the "Sent to Ari only" one); the judge folded the second
    # into the first's alert, the entry linked only the first, and when it was finished the second kept the label for good,
    # never on the list.
    store, g, p = setup()
    E.label_sync(store, g, bring_in=True, dry_run=False)
    g.labels[A], g.labels[B] = {"L1"}, {"L1"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == {A, B}
    aid = store.queue_alert("k|added|m1|1", issue_key="k", thread_id=A, kind="notify", priority="normal", text="t", next_step=None,
                            subject="s", sender="x", status="queued")
    E.mark_label(store, A, "judged")
    E.mark_label(store, B, f"with:{aid}")
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert states(store)[B] == f"with:{aid}" and "L1" in g.labels[B], "waits while the alert has not gone out"
    store.mark_sent(aid, None, None)
    p.entry("e1", A)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert states(store) == {A: "synced", B: f"with:{aid}"} and "L1" in g.labels[B], "in step with the entry it joined"
    p.entries = []  # finished in Pocket
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert "L1" not in g.labels[A] and "L1" not in g.labels[B] and states(store) == {}, (g.labels, states(store))
    # labelled again later: brought in afresh
    g.labels[B].add("L1")
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == {B}
    # an alert that never reached the list (failed): the thread is judged again rather than kept waiting
    aid2 = store.queue_alert("k|added|m2|2", issue_key="k", thread_id=A, kind="notify", priority="normal", text="t", next_step=None,
                             subject="s", sender="x", status="queued")
    E.mark_label(store, B, f"with:{aid2}")
    store.mark_sent(aid2, None, None, "failed")
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set() and B not in states(store)
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == {B}


def test_new_alert_gets_label_and_dry_run():
    store, g, p = setup()
    E.label_sync(store, g, bring_in=True, dry_run=False)
    p.entry("e9", A)
    E.label_sync(store, g, bring_in=False, dry_run=True)
    assert A not in g.labels, "dry run changes nothing"
    E.label_sync(store, g, bring_in=False, dry_run=False)
    assert g.labels[A] == {"L1"}


def test_label_brings_into_inbox_when_asked():
    store, g, p = setup()
    E.label_sync(store, g, bring_in=True, dry_run=False)
    p.entry("e9", A)
    E.label_sync(store, g, bring_in=False, dry_run=False)
    assert g.labels[A] == {"L1"}, "off by default: the label only"
    E.CFG.gmail_label["inbox"] = True
    try:
        p.entry("e8", B)  # a thread a filter kept out of the inbox
        E.label_sync(store, g, bring_in=False, dry_run=False)
        assert g.labels[B] == {"L1", "INBOX"}, g.labels[B]
        g.labels[B].discard("INBOX")  # the owner archives it later: left archived
        E.label_sync(store, g, bring_in=True, dry_run=False)
        assert g.labels[B] == {"L1"}, "put in INBOX once, when the label goes on"
    finally:
        E.CFG.gmail_label.pop("inbox", None)


def test_off_unavailable_and_no_inbox():
    store, g, p = setup()
    p.entry("e1", A)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    E.SETTINGS = {**E.SETTINGS, "gmailLabel": {"enabled": False}}
    g.labels[B] = {"L1"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set() and states(store) == {} and not store.get("label_baseline"), "off clears the ledger"
    E.SETTINGS = {**E.SETTINGS, "gmailLabel": {"enabled": True}}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set(), "on again: a fresh first sync, nothing flooded in"
    store2, g2, p2 = setup()
    g2.writable = False
    p2.entry("e1", A)
    assert E.label_sync(store2, g2, bring_in=True, dry_run=False) == set() and A not in g2.labels
    assert E.label_status(store2)["available"] is False and "read-only" in E.label_status(store2)["reason"]
    store3, _g, p3 = setup()
    st = E.label_status(store3, object())
    assert st["available"] is False and "connector" in st["reason"], "a mail source without label writes"
    store4, g4, p4 = setup()
    p4.inbox = False
    g4.labels[A] = {"L1"}
    store4.db.execute("insert into label_sync values(?, 'synced', '')", (A,))
    store4.set("label_baseline", "x")
    E.label_sync(store4, g4, bring_in=True, dry_run=False)
    assert g4.labels[A] == {"L1"}, "Pocket's Inbox off: an empty list is not 'everything finished'"


def test_connector_syncs_are_spaced():
    store, g, p = setup()
    g.label_sync_min_s = 600
    searches = []
    real = g.labelled_threads
    g.labelled_threads = lambda lid, cap: searches.append(1) or real(lid, cap)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    g.labels[B] = {"L1"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set() and len(searches) == 1, "too soon: no search"
    assert E.label_sync(store, g, bring_in=False, dry_run=False) == set() and len(searches) == 1, "the end-of-run pass needs a first pass"
    assert E.label_sync(store, g, bring_in=True, dry_run=False, force=True) == {B} and len(searches) == 2, "Check now forces one"


def test_read_only_grant_shows_in_settings():
    store, g, p = setup()
    from inbox_monitor.mail_connector import MailError
    def refuse(changes):
        raise MailError(403, "Gmail let this Claude Code connector read mail but not change labels; reconnect Gmail")
    g.label_threads = refuse
    p.entry("e1", A)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    st = E.label_status(store)
    assert st["available"] is False and "reconnect Gmail" in st["reason"], st
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set(), "refused: no further tries until the answer is 30 minutes old"


def test_check_now_runs_once():
    setup()
    calls = []
    E.load_settings = lambda fetch=True: None
    E.run = lambda dry_run, baseline_only, why="", request=None: calls.append((why, request)) or 0
    E.SETTINGS = {**E.SETTINGS, "paused": True}
    E.CHECK_REQUEST = "2026-10-21T18:00:00Z"
    E.tick(False)
    assert calls == [("Check now in Pocket", "2026-10-21T18:00:00Z")], "runs even when paused or not due"
    store = E.Store(E.DB_PATH)
    store.set("check_request_done", "2026-10-21T18:00:00Z")
    store.commit()
    E.tick(False)
    assert len(calls) == 1, "done: not again"


def test_check_now_skips_quiet_hours():
    _, _, p = setup()
    store = E.Store(E.DB_PATH)  # the run's own store
    sent = []
    p.send_alert = lambda a, pocket_url=None, held_note=False: sent.append((a["subject"], held_note)) or "e"
    for i, prio in enumerate(("high", "normal", "low")):
        store.queue_alert(f"k{i}", issue_key=f"s{i}", thread_id=A, kind="notify", priority=prio, text="t", next_step=None,
                          subject=f"held {prio}", sender="x@example.com", status="held")
    store.commit()
    seen = {}
    saved = {k: getattr(E, k) for k in ("apply_feedback", "gmail_client", "label_sync", "process", "scheduled", "tidy_due", "sync_memory", "heartbeat")}

    class G:
        cursor_ok = staticmethod(lambda c: True)
        profile_history_id = staticmethod(lambda: "2")
        changed_threads = staticmethod(lambda c: ([], "2", False))
        baseline_threads = staticmethod(lambda q=None: [])
    try:
        E.apply_feedback = E.sync_memory = E.heartbeat = lambda s, *a: None
        E.gmail_client = lambda: G()
        E.label_sync = lambda *a, **k: set()
        E.process = lambda *a, **k: seen.update(k) or (0, 0, None)
        E.scheduled = lambda *a: None
        E.tidy_due = lambda s: False
        RUN(False, False, why="Check now in Pocket", request="2026-10-22T10:31:37Z")
    finally:
        for k, v in saved.items():
            setattr(E, k, v)
    assert seen.get("awake") is True, "the check's own decisions are not held"
    assert sorted(sent) == [("held high", True), ("held low", True), ("held normal", True)], sent
    assert not E.Store(E.DB_PATH).pending(("notify",), ("held",)), "nothing left waiting for the digest hour"



def test_finished_entry_archives_its_thread():
    """1.77.9: finishing an entry in Pocket takes the label off and archives the thread (2026-10-24: dismissed
    alerts sat unread in the owner's Gmail inbox), except where mail came in after the label went on."""
    store, g, p = setup()
    E.label_sync(store, g, bring_in=True, dry_run=False)
    for eid, tid in (("e1", A), ("e2", B), ("e3", Z)):
        p.entry(eid, tid)
        g.labels[tid] = {"INBOX"}
    E.label_sync(store, g, bring_in=False, dry_run=False)
    assert all(g.labels[t] == {"INBOX", "L1"} for t in (A, B, Z)) and set(states(store)) == {A, B, Z}
    later = E.iso(E.now_utc() + E.dt.timedelta(minutes=5))
    store.record_decision(1, B, {"issue_key": "b", "action": "ignore"})  # a reply to B, judged after its label went on
    store.db.execute("update decisions set created_at=? where thread_id=?", (later, B))
    store.commit()
    p.entries = []  # all three dismissed in Pocket
    E.label_sync(store, g, bring_in=True, dry_run=False, fresh={Z})  # and Z has a reply this very check found
    assert g.labels[A] == set(), f"archived: {g.labels[A]}"
    assert g.labels[B] == {"INBOX"}, "newer mail: the label comes off, the thread stays in the inbox"
    assert g.labels[Z] == {"INBOX"}, "a reply found by this check: stays in the inbox"
    assert states(store) == {}


def test_archive_can_be_turned_off():
    store, g, p = setup()
    E.CFG.gmail_label["archive"] = False
    E.label_sync(store, g, bring_in=True, dry_run=False)
    p.entry("e1", A)
    g.labels[A] = {"INBOX"}
    E.label_sync(store, g, bring_in=False, dry_run=False)
    p.entries = []
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert g.labels[A] == {"INBOX"}, "archive = false: the label alone comes off, as before 1.77.9"


class GmailWithIds(FakeGmail):
    """Real Gmail user-label ids look like Label_51; only those are remembered as a filter's."""
    def label_id(self, name, create=True):
        return "Label_9"

    def labelled_threads(self, label_id, cap):
        return {t for t, ls in self.labels.items() if "Label_9" in ls}


def test_filter_label_is_not_the_owners():
    store, _, p = setup()
    g = GmailWithIds()
    E.label_sync(store, g, bring_in=True, dry_run=False)  # first sync
    # A arrives already carrying the label (a Gmail filter); B is labelled by hand after it arrived
    g.arrived_labels = {A: {"INBOX", "UNREAD", "Label_9", "Label_48"}, B: {"INBOX", "UNREAD"}}
    E.note_arrived(store, g)
    g.labels[A], g.labels[B] = {"Label_9", "INBOX"}, {"Label_9"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == {A, B}
    assert states(store) == {A: "incoming-filter", B: "incoming"}, states(store)
    msg = lambda t: {"thread_id": t, "subject": f"Subject {t[-1]}", "messages": [{"message_id": "m" + t[-1], "from": "Sam <sam@example.com>",
                                                                                "body": "Please add the new project.", "from_owner": False}]}
    ba, bb = msg(A), msg(B)
    E.mark_added(store, [ba, bb])
    assert ba["added_by"] == "filter" and bb["added_by"] == "owner" and ba["added_in_gmail"] and bb["added_in_gmail"]
    da = E.validate_story_fields({"thread_id": A, "action": "ignore", "issue_key": "a", "confidence": 0.1}, set())
    E.added_decision(da, ba)
    assert da["user_message"].startswith("Your Gmail filter put this on your list") and "filter" in da["new_fact"], da
    db = E.validate_story_fields({"thread_id": B, "action": "ignore", "issue_key": "b", "confidence": 0.1}, set())
    E.added_decision(db, bb)
    assert db["user_message"].startswith("You added this"), db
    # only the hand label is a lesson, recorded once however often the check retries
    E.mark_added(store, [ba, bb])
    rows = store.db.execute("select kind, thread_id, before from lessons").fetchall()
    assert [(r["kind"], r["thread_id"], r["before"]) for r in rows] == [("added", B, "not looked at yet")], [tuple(r) for r in rows]
    assert store.db.execute("select count(*) from label_filed").fetchone()[0] == 0, "taken up when brought in"


def test_hand_label_after_a_judgement_says_what_the_watcher_missed():
    store, g, p = setup()
    store.record_decision(1, A, {"issue_key": "a", "action": "digest", "confidence": 0.7, "new_fact": "Vendor asked for a quote."})
    assert E.watcher_before(store, A) == "digest: Vendor asked for a quote."
    store.db.execute("insert into firstpass_log(run_id,at,thread_id,skipped) values(1,?,?,1)", (E.iso(), B))
    assert E.watcher_before(store, B) == "skipped as routine by the first pass"


def test_learn_rewrites_the_learned_section():
    store, g, p = setup()
    E.PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    E.PREFS_FILE.write_text("# Alex's rules\n\n## Always\n- Money problems.\n\n## From Inbox in Pocket\n- Not useful (Wed): \"Boat inquiry\". "
                            "Do not alert.\n- Not useful (Wed): \"Boat inquiry\". Do not alert.\n")
    E.add_lesson(store, "added:x:1", "added", A, None, "Website photos", "Sam <sam@paving.example>", "Website photos", "Add the job.",
                 "skipped as routine by the first pass")
    E.add_lesson(store, "added:x:1", "added", A, None, "Website photos", "", "", "", "")  # the same lesson again: ignored
    seen = {}

    def fake_judge(message, **kw):
        seen["message"], seen["purpose"] = message, kw.get("purpose")
        return {"rules": ["Alert on website-content requests from Sam at the paving company (you added 1, Oct 31).",
                          "A digest line at most for boat inquiries (Not useful, Oct 28)."], "changes": ["added: Sam's website requests"]}

    real = E.call_judge
    E.call_judge = fake_judge
    try:
        assert E.learn(store) == 1
        assert E.learn(store) == 0, "nothing new: no judge call"
    finally:
        E.call_judge = real
    assert seen["purpose"] == "learn" and '"new_lessons"' in seen["message"] and "Boat inquiry" in seen["message"]
    text = E.PREFS_FILE.read_text()
    assert text.count("## ") == 2 and "## Always" in text and "From Inbox in Pocket" not in text, text
    assert "## Learned from Alex's choices" in text and "- Alert on website-content requests from Sam" in text, text
    assert text.index("## Always") < text.index("## Learned"), "the owner's own rules stay first"
    assert list((E.STATE / "preferences-backups").glob("preferences-*.md")), "the old file is kept"
    # a bad answer never wipes the learned rules: the lessons are set aside instead
    E.add_lesson(store, "not_useful:e9", "not_useful", None, None, "Newsletter", "", "Newsletter", "", "alerted")
    E.call_judge = lambda message, **kw: {"rules": []}
    try:
        assert E.learn(store) == 0
    finally:
        E.call_judge = real
    assert "Alert on website-content requests" in E.PREFS_FILE.read_text()
    assert store.db.execute("select learned_at from lessons where ref='not_useful:e9'").fetchone()[0] == "failed"


def test_not_useful_becomes_a_lesson():
    store, g, p = setup()
    E.PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    E.PREFS_FILE.write_text("# rules\n")
    store.db.execute("insert into issues(issue_key,status,priority) values('boat','open','normal')")
    store.queue_alert("k1", issue_key="boat", thread_id=A, kind="alert", priority="normal", text="A boat buyer asked about file 165.",
                      subject="Vessel inquiry", sender="Jo <jo@example.com>", status="sent")
    p.feedback = lambda: [{"id": "e7", "action": "not useful", "story": "boat", "title": "Vessel inquiry", "note": "brokers handle these",
                           "at": E.iso()}]
    acked = []
    p.ack = acked.extend
    E.apply_feedback(store)
    r = store.db.execute("select * from lessons").fetchone()
    assert (r["kind"], r["thread_id"], r["note"], r["sender"]) == ("not_useful", A, "brokers handle these", "Jo <jo@example.com>"), dict(r)
    assert r["before"].startswith("alerted: A boat buyer") and acked == ["e7"]
    assert E.PREFS_FILE.read_text() == "# rules\n", "the rule is written by learn(), not appended here"
    assert store.story("boat")["priority"] == "low"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
