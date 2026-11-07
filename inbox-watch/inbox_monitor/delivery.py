"""Where alerts go. Each delivery takes the same plain text (citations as [label](msg:<id>), bullets as "- ") and renders
it for its channel. Configure one or more in the TOML as [[delivery]] tables.

  kind = "telegram"  a bot DM: token from `token_env`, or `openclaw_config` (channels.telegram.botToken), `chat_id`.
                     Buttons: Open in Pocket Code (when a start link exists) and Open in Gmail.
  kind = "pocket"    Pocket Code (1.58.1+): a push through scripts/pocket-notify.mjs whose tap opens the start link;
                     digests and look-aheads are kept in Files (pocket-docs) and the push links there. `email = true`
                     also mails the owner's notification address through Pocket.
  kind = "email"     plain SMTP: `smtp_url` (smtps://user:pass@host:465 or smtp://user:pass@host:587), `from`, `to`.

[pocket] (top level, optional): `root` (the Pocket Code checkout), `session_dir`, `provider` — makes the start link
that every delivery can use as its button. Before Pocket knows its public address the link is a Pocket path
(/#/start/<id>): the Inbox keeps it, Telegram and email, which need an address, leave the button out.
"""
from __future__ import annotations

import datetime as dt
import html as htmlmod
import json
import os
import re
import tempfile
import smtplib
import subprocess
import urllib.parse
import urllib.request
from email.message import EmailMessage
from pathlib import Path

GMAIL_THREAD_URL = "https://mail.google.com/mail/u/0/#all/{thread_id}"
GMAIL_MSG_URL = "https://mail.google.com/mail/u/0/#all/{message_id}"
CITE_RX = re.compile(r"\[([^\]\n]{1,80})\]\(msg:([0-9a-f]{6,24})\)")
TG_MAX_CHARS = 3900  # Telegram rejects sendMessage text over 4096 characters


def cite_html(text: str) -> str:
    """Plain text to HTML: escape, [label](msg:id) to Gmail links, '- ' bullets to '•'."""
    e = htmlmod.escape(text or "")
    e = CITE_RX.sub(lambda m: f'<a href="{GMAIL_MSG_URL.format(message_id=m.group(2))}">{m.group(1)}</a>', e)
    return re.sub(r"(?m)^\s*[-*] ", "• ", e)


def cite_markdown(text: str) -> str:
    return CITE_RX.sub(lambda m: f"[{m.group(1)}]({GMAIL_MSG_URL.format(message_id=m.group(2))})", text or "")


def cite_plain(text: str) -> str:
    return CITE_RX.sub(lambda m: m.group(1), text or "")


def chunks_under(lines: list[str], limit: int) -> list[str]:
    """Join lines into messages under a size limit, breaking only between lines."""
    out, cur = [], ""
    for line in lines:
        line = line[:limit]
        if cur and len(cur) + 1 + len(line) > limit:
            out.append(cur)
            cur = line
        else:
            cur = f"{cur}\n{line}" if cur else line
    if cur.strip():
        out.append(cur)
    return out


# ---------------------------------------------------------------- Pocket start links (the briefed session)
def absolute_link(url: str | None) -> str | None:
    """1.81: the link as a channel outside Pocket (Telegram, email) can open it. Until Pocket knows its public address
    pocket-start prints a Pocket path (/#/start/<id>), which opens inside Pocket and means nothing anywhere else."""
    return url if url and url.startswith(("http://", "https://")) else None


def start_link(pocket: dict, briefing: str, title: str, log) -> str | None:
    root = pocket.get("root")
    if not root:
        return None
    cli = Path(root) / "scripts" / "pocket-start.mjs"
    if not cli.exists():
        return None
    cmd = ["node", str(cli), "add", "--file", "-", "--title", title[:120]]
    if pocket.get("session_dir"):
        cmd += ["--dir", pocket["session_dir"]]
    if pocket.get("provider"):
        cmd += ["--provider", pocket["provider"]]
    try:
        r = subprocess.run(cmd, input=briefing, capture_output=True, text=True, timeout=20)
        if r.returncode == 0:
            url = r.stdout.strip().splitlines()[-1]
            return url if url.startswith(("http://", "https://", "/#/")) else None  # 1.81: a Pocket path is kept: the Inbox opens it
        log(f"pocket-start failed: {r.stderr.strip()[:200]}")
    except Exception as e:  # noqa: BLE001
        log(f"pocket-start error: {e}")
    return None


# ---------------------------------------------------------------- deliveries
class Delivery:
    kind = "delivery"

    def __init__(self, cfg: dict, log):
        self.cfg = cfg
        self.log = log

    def send_alert(self, alert: dict, *, pocket_url: str | None, held_note: bool = False) -> str | None:
        raise NotImplementedError

    def send_digest(self, title: str, text: str, items: list[dict] | None = None) -> str | None:
        """`items` (1.95): the digest's lines as data, [{ref, section, title, text, story, gmail, priority}], for a channel that can
        offer a choice per line (Pocket). Telegram and email render the text and ignore them."""
        raise NotImplementedError

    def send_lookahead(self, alert: dict, *, pocket_url: str | None, items: list[dict] | None = None) -> str | None:
        """`items` (1.95): the look-ahead's cards, as for a digest."""
        return self.send_alert(alert, pocket_url=pocket_url)


class Telegram(Delivery):
    kind = "telegram"

    def __init__(self, cfg: dict, log):
        super().__init__(cfg, log)
        self.chat_id = str(cfg["chat_id"])
        self.reply_note = cfg.get("reply_note", "")

    def token(self) -> str:
        env = self.cfg.get("token_env")
        if env and os.environ.get(env):
            return os.environ[env]
        if self.cfg.get("openclaw_config"):
            with open(self.cfg["openclaw_config"]) as f:
                return json.load(f)["channels"]["telegram"]["botToken"]
        if self.cfg.get("token"):
            return self.cfg["token"]
        raise RuntimeError("telegram: no token (set token_env, openclaw_config or token)")

    def _send(self, text_html: str, buttons: list[dict] | None) -> str:
        payload = {"chat_id": self.chat_id, "text": text_html, "parse_mode": "HTML", "disable_web_page_preview": True}
        if buttons:
            payload["reply_markup"] = {"inline_keyboard": [buttons]}
        req = urllib.request.Request(f"https://api.telegram.org/bot{self.token()}/sendMessage",
                                     data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
        if not data.get("ok"):
            raise RuntimeError(f"telegram: {data}")
        return str(data["result"]["message_id"])

    def send_alert(self, alert: dict, *, pocket_url: str | None, held_note: bool = False) -> str | None:
        pocket_url = absolute_link(pocket_url)
        head = "🚨 " if alert.get("priority") == "critical" else ""
        parts = [f"{head}<b>{htmlmod.escape(alert.get('subject') or '(no subject)')}</b>", "", cite_html(alert.get("text") or "")]
        if held_note:
            parts += ["", "<i>Held overnight.</i>"]
        if self.reply_note:
            parts += ["", f"<i>{htmlmod.escape(self.reply_note)}</i>"]
        buttons = []
        if pocket_url:
            buttons.append({"text": "Open in Pocket Code", "url": pocket_url})
        if alert.get("thread_id"):
            buttons.append({"text": "Open in Gmail", "url": GMAIL_THREAD_URL.format(thread_id=alert["thread_id"])})
        mid = None
        for chunk in chunks_under("\n".join(parts).split("\n"), TG_MAX_CHARS):
            mid = self._send(chunk, buttons) or mid
        return mid

    def send_digest(self, title: str, text: str, items: list[dict] | None = None) -> str | None:
        lines = [f"<b>{htmlmod.escape(title)}</b>", ""] + [cite_html(l) if not l.startswith("## ") else f"<b>{htmlmod.escape(l[3:])}</b>"
                                                            for l in text.split("\n")]
        mid = None
        for chunk in chunks_under(lines, TG_MAX_CHARS):
            mid = self._send(chunk, None) or mid
        return mid


class PocketPush(Delivery):
    """Pocket Code. With Pocket 1.69+ every alert, digest and look-ahead becomes an Inbox entry (POST /api/inbox through
    scripts/pocket-inbox.mjs), which also sends the push and the optional email; the owner's Resolved / Not useful /
    Dismiss come back through `feedback()`. On an older Pocket (1.65–1.68) it falls back to pocket-notify pushes and
    Files for the digests."""
    kind = "pocket"

    def __init__(self, cfg: dict, log):
        super().__init__(cfg, log)
        self.root = Path(cfg["root"])
        self.email = bool(cfg.get("email", False))
        self.docs_dir = Path(cfg.get("docs_dir", "")) if cfg.get("docs_dir") else None
        self.source = cfg.get("source", "inbox-monitor")
        self.inbox = (self.root / "scripts" / "pocket-inbox.mjs").exists()

    def _node(self, script: str, args: list[str], stdin: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(["node", str(self.root / "scripts" / script), *args], input=stdin, capture_output=True, text=True, timeout=30)

    def _json(self, r: subprocess.CompletedProcess, what: str):
        """The command's --json reply: pretty-printed JSON (an object or a list), or the last line for the older commands."""
        if r.returncode != 0:
            raise RuntimeError(f"{what}: {r.stderr.strip()[:300] or r.stdout.strip()[:300]}")
        out = r.stdout.strip()
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            try:
                return json.loads(out.splitlines()[-1])
            except (json.JSONDecodeError, IndexError):
                return {}

    # ---- Pocket 1.69+: the Inbox library
    def _add(self, kind: str, title: str, text: str, *, priority: str = "normal", story: str = "", url: str | None = None,
             gmail: str | None = None, doc: str | None = None, dedupe: str | None = None, items: list[dict] | None = None) -> str:
        args = ["add", "--title", title[:160], "--file", "-", "--kind", kind, "--priority", priority or "normal", "--source", self.source, "--json"]
        if story:
            args += ["--story", story[:120]]
        if url:
            args += ["--url", url]
        if gmail:
            args += ["--gmail", gmail]
        if doc:
            args += ["--doc", doc]
        if dedupe:
            args += ["--dedupe", dedupe[:120]]
        if self.email:
            args.append("--email")
        items_file = None
        if items:  # 1.95: a digest's items go in a file beside the text (stdin carries the text); an older Pocket ignores the option
            items_file = tempfile.NamedTemporaryFile("w", suffix=".json", prefix="pocket-inbox-items-", delete=False)
            json.dump(items, items_file)
            items_file.close()
            args += ["--items", items_file.name]
        try:
            d = self._json(self._node("pocket-inbox.mjs", args, stdin=text), "pocket-inbox add")
        except RuntimeError as ex:
            if "inbox_off" in str(ex) or "Inbox Watch is off" in str(ex):  # Pocket 1.69 without the library switched on: the push still goes
                self.log("Pocket's Inbox library is off (Settings → Projects, files, tasks & vault → Inbox Watch); sending the push only")
                self.inbox = False
                return None
            raise
        finally:
            if items_file:
                try:
                    os.unlink(items_file.name)
                except OSError:
                    pass
        d = d if isinstance(d, dict) else {}
        return f"inbox={d.get('entry', {}).get('id', '?')} push={d.get('push')} mail={d.get('mail')}"

    def feedback(self) -> list[dict]:
        """What the owner did in Pocket since the last ack: [{id, action, at, note, title, story, source, kind}]."""
        if not self.inbox:
            return []
        d = self._json(self._node("pocket-inbox.mjs", ["feedback", "--json"]), "pocket-inbox feedback")
        items = d if isinstance(d, list) else d.get("feedback", []) if isinstance(d, dict) else []
        return [f for f in items if isinstance(f, dict)]

    def ack(self, ids: list[str]) -> None:
        if ids and self.inbox:
            self._json(self._node("pocket-inbox.mjs", ["ack", *ids]), "pocket-inbox ack")

    def seen(self, profile: dict | None = None) -> None:
        """The heartbeat; with Pocket 1.70+ it carries the watcher's profile (defaults, choices, status, usage) for Settings."""
        if self.inbox:
            args = ["seen", "--source", self.source] + (["--profile", "-"] if profile is not None else [])
            r = self._node("pocket-inbox.mjs", args, stdin=json.dumps(profile) if profile is not None else None)
            if r.returncode != 0:
                raise RuntimeError(f"pocket-inbox seen: {r.stderr.strip()[:300]}")

    def inbox_open(self) -> list[dict]:
        """This watcher's entries still on the owner's list (not dismissed, resolved or marked not useful)."""
        if not self.inbox:
            return []
        d = self._json(self._node("pocket-inbox.mjs", ["list", "--state", "all", "--json"]), "pocket-inbox list")
        items = d if isinstance(d, list) else d.get("entries", []) if isinstance(d, dict) else []
        return [e for e in items if isinstance(e, dict) and e.get("state") in ("new", "opened") and e.get("source", self.source) == self.source]

    def act(self, entry_id: str, action: str, note: str) -> None:
        self._json(self._node("pocket-inbox.mjs", ["act", entry_id, action, "--note", note[:290], "--json"]), "pocket-inbox act")

    def watch(self) -> dict | None:
        """The owner's Inbox Watch settings from Pocket (1.70+): {settings: {...} or None, revision, checkRequestedAt (1.75: Check now)}. None when this Pocket
        has no such settings (older, or the Inbox library off), so the config's apply; raises when Pocket did not answer."""
        if not self.inbox:
            return None
        r = self._node("pocket-inbox.mjs", ["watch", "--source", self.source, "--json"])
        if r.returncode != 0:
            err = (r.stderr or r.stdout).strip()
            if "Unknown command" in err or "Inbox Watch is off" in err:
                return None
            raise RuntimeError(err[:300] or f"pocket-inbox watch exited {r.returncode}")
        d = json.loads(r.stdout)
        return {"settings": d.get("settings"), "revision": d.get("revision"), "checkRequestedAt": d.get("checkRequestedAt")} if isinstance(d, dict) else None

    # ---- Pocket 1.65–1.68: pushes and Files
    def _push(self, title: str, body: str, url: str | None, tag: str) -> str | None:
        args = ["--title", title[:70], "--file", "-", "--tag", tag[:80], "--json"]
        if url:
            args += ["--url", url]
        if self.email:
            args.append("--email")
        d = self._json(self._node("pocket-notify.mjs", args, stdin=body), "pocket-notify")
        return f"push={d.get('push')} mail={d.get('mail')}"

    def _keep(self, title: str, markdown: str, name: str) -> str | None:
        """A digest or look-ahead goes into Files, where it renders; returns the Files id."""
        folder = self.docs_dir or Path("/tmp")
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        path.write_text(markdown)
        r = self._node("pocket-docs.mjs", ["add", str(path), "--title", title[:120]])
        if r.returncode != 0:
            self.log(f"pocket-docs failed: {r.stderr.strip()[:200]}")
            return None
        for line in r.stdout.splitlines():
            m = re.match(r"\s*([0-9a-f]{12})\s", line)
            if m:
                return m.group(1)
        return None

    def send_alert(self, alert: dict, *, pocket_url: str | None, held_note: bool = False) -> str | None:
        title = alert.get("subject") or "Email alert"
        text = alert.get("text") or ""
        if held_note:
            text = "Held overnight. " + text
        gmail = GMAIL_THREAD_URL.format(thread_id=alert["thread_id"]) if alert.get("thread_id") else None
        if self.inbox:
            ref = self._add("alert", title, text, priority=alert.get("priority") or "normal", story=alert.get("issue_key") or "",
                            url=pocket_url, gmail=gmail, dedupe=alert.get("dedupe_key"))
            if ref:
                return ref
        return self._push(title, cite_plain(text)[:1800], pocket_url, alert.get("dedupe_key") or title)

    def send_digest(self, title: str, text: str, items: list[dict] | None = None) -> str | None:
        md = f"# {title}\n\n" + cite_markdown(text).replace("\n## ", "\n\n## ")
        doc = self._keep(title, md, f"digest-{dt.datetime.now().strftime('%Y-%m-%d-%H%M')}.md")
        if self.inbox:
            try:
                ref = self._add("digest", title, text, doc=doc, dedupe=f"digest|{dt.datetime.now().date()}", items=items)
            except RuntimeError as ex:  # Pocket refused a card: one bad line must not cost the owner the digest, or mint every link again next run
                if not items or not re.search(r"\bItem \d+:|\bitems:", str(ex)):
                    raise
                self.log(f"Pocket refused the digest's cards ({ex}); sending the digest without them")
                ref = self._add("digest", title, text, doc=doc, dedupe=f"digest|{dt.datetime.now().date()}")
            if ref:
                return ref
        first = next((l for l in text.split("\n") if l.strip() and not l.startswith("## ")), "")
        return self._push(title, cite_plain(first)[:300] or "Open to read.", "/#/documents/" + doc if doc else None, f"digest|{dt.datetime.now().date()}")

    def send_lookahead(self, alert: dict, *, pocket_url: str | None, items: list[dict] | None = None) -> str | None:
        title = alert.get("subject") or "Look-ahead"
        text = alert.get("text") or ""
        md = f"# {title}\n\n" + cite_markdown(text)
        doc = self._keep(title, md, f"lookahead-{dt.datetime.now().strftime('%Y-%m-%d-%H%M')}.md")
        if self.inbox:
            add = dict(priority=alert.get("priority") or "normal", url=pocket_url, doc=doc, dedupe=alert.get("dedupe_key"))
            try:
                ref = self._add("lookahead", title, text, items=items, **add)
            except RuntimeError as ex:  # as for a digest: a refused card must not cost the owner the look-ahead
                if not items or not re.search(r"\bItem \d+:|\bitems:", str(ex)):
                    raise
                self.log(f"Pocket refused the look-ahead's cards ({ex}); sending it without them")
                ref = self._add("lookahead", title, text, **add)
            if ref:
                return ref
        return self._push(title, cite_plain(text)[:1800], ("/#/documents/" + doc) if doc else pocket_url, alert.get("dedupe_key") or title)


class Email(Delivery):
    kind = "email"

    def __init__(self, cfg: dict, log):
        super().__init__(cfg, log)
        url = cfg.get("smtp_url") or os.environ.get(cfg.get("smtp_url_env", ""), "")
        if not url:
            raise RuntimeError("email: smtp_url (or smtp_url_env) is required")
        u = urllib.parse.urlsplit(url)
        self.host, self.port, self.tls = u.hostname, u.port or (465 if u.scheme == "smtps" else 587), u.scheme == "smtps"
        self.user = urllib.parse.unquote(u.username or "")
        self.password = urllib.parse.unquote(u.password or "")
        self.sender = cfg.get("from") or self.user
        self.to = cfg["to"]

    def _send(self, subject: str, text: str, html: str) -> str:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, self.to, subject
        msg.set_content(text)
        msg.add_alternative(html, subtype="html")
        if self.tls:
            with smtplib.SMTP_SSL(self.host, self.port, timeout=30) as s:
                if self.user:
                    s.login(self.user, self.password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(self.host, self.port, timeout=30) as s:
                s.starttls()
                if self.user:
                    s.login(self.user, self.password)
                s.send_message(msg)
        return msg["Subject"]

    def send_alert(self, alert: dict, *, pocket_url: str | None, held_note: bool = False) -> str | None:
        pocket_url = absolute_link(pocket_url)
        subject = alert.get("subject") or "Email alert"
        text = cite_plain(alert.get("text") or "")
        links = []
        if pocket_url:
            links.append(f'<a href="{htmlmod.escape(pocket_url)}">Open in Pocket Code</a>')
        if alert.get("thread_id"):
            links.append(f'<a href="{GMAIL_THREAD_URL.format(thread_id=alert["thread_id"])}">Open in Gmail</a>')
        html = f"<p>{cite_html(alert.get('text') or '').replace(chr(10), '<br>')}</p>" + (f"<p>{' · '.join(links)}</p>" if links else "")
        if held_note:
            html = "<p><i>Held overnight.</i></p>" + html
        return self._send(("[Alert] " if alert.get("priority") in ("critical", "high") else "") + subject, text + ("\n\n" + pocket_url if pocket_url else ""), html)

    def send_digest(self, title: str, text: str, items: list[dict] | None = None) -> str | None:
        html = "".join(f"<h3>{htmlmod.escape(l[3:])}</h3>" if l.startswith("## ") else f"<p>{cite_html(l)}</p>" for l in text.split("\n") if l.strip())
        return self._send(title, cite_plain(text), html)


def make_deliveries(cfgs: list[dict], log) -> list[Delivery]:
    kinds = {"telegram": Telegram, "pocket": PocketPush, "email": Email}
    out = []
    for c in cfgs:
        k = c.get("kind")
        if k not in kinds:
            raise ValueError(f"delivery.kind must be one of {sorted(kinds)}, not {k!r}")
        out.append(kinds[k](c, log))
    return out
