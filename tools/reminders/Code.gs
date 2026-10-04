/**
 * OYW26 toolkit: email reminders for Schneider Electric employees and African Explorers.
 *
 * Runs as a Google Apps Script web app in the owner's Google account. No other backend.
 *   - doPost   : the toolkit's "Remind me" form registers an email + audience (stored in a Google Sheet)
 *   - sendDue  : a daily time-driven trigger emails everyone whose post opens today, with a link to the toolkit
 *   - doGet    : ?unsub=<token> removes an address; anything else is a health check
 *
 * Deploy (once, about five minutes):
 *   1. script.google.com -> New project -> paste this file -> name it "OYW26 reminders".
 *   2. Run setup() once from the editor (creates the sheet and the 07:00 daily trigger; authorise when asked).
 *   3. Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone -> Deploy. Copy the URL.
 *   4. Paste the URL into REMINDER_ENDPOINT at the top of js/posts.js, bump ?v= in index.html, push.
 *   5. Test: Run sendDue(true) from the editor to email yourself a preview of today's digest.
 * To stop everything: Triggers (clock icon) -> delete the sendDue trigger, or undeploy the web app.
 */

var SITE = 'https://messam-lang.github.io/oyw26-values/';      // the reminder links here (first tab)
var DATA_URL = SITE + 'data/posts.json';                         // schedule: same file the toolkit uses
var SHEET_NAME = 'OYW26 reminders';
var SEND_HOUR = 7;                                               // local hour of the daily send (script time zone)
var FROM_NAME = 'OYW26 toolkit';
var REPLY_TO = '';                                               // e.g. 'm.essam@middl-men.com'; empty = account default

function setup() {
  sheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendDue') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendDue').timeBased().atHour(SEND_HOUR).everyDays(1).create();
  Logger.log('Sheet ready and daily trigger set for %s:00 (%s).', SEND_HOUR, Session.getScriptTimeZone());
}

// ---------------------------------------------------------------- storage
function sheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('sheetId');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create(SHEET_NAME);
  if (!id) props.setProperty('sheetId', ss.getId());
  var sh = ss.getSheetByName('subscribers') || ss.insertSheet('subscribers');
  if (sh.getLastRow() === 0) sh.appendRow(['email', 'kind', 'explorerId', 'lang', 'subscribedAt', 'sent']);
  return sh;
}
function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('secret');
  if (!s) { s = Utilities.getUuid(); props.setProperty('secret', s); }
  return s;
}
function token_(email) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret_() + ':' + email.toLowerCase());
  return raw.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 24);
}
function rows_(sh) {
  var v = sh.getDataRange().getValues();
  return v.slice(1).map(function (r, i) { return { row: i + 2, email: String(r[0] || '').trim().toLowerCase(), kind: r[1], explorerId: r[2], lang: r[3], sent: String(r[5] || '') }; })
    .filter(function (r) { return r.email; });
}

// ---------------------------------------------------------------- web app
function doPost(e) {
  var out = { ok: false };
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var email = String(body.email || '').trim().toLowerCase();
    var kind = String(body.kind || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('bad email');
    if (kind !== 'employee' && kind !== 'explorer') throw new Error('bad kind');
    var sh = sheet_();
    var existing = rows_(sh).filter(function (r) { return r.email === email; })[0];
    if (existing) sh.getRange(existing.row, 2, 1, 3).setValues([[kind, body.explorerId || '', body.lang || 'EN']]);
    else sh.appendRow([email, kind, body.explorerId || '', body.lang || 'EN', new Date().toISOString(), '']);
    out.ok = true;
  } catch (err) { out.error = String(err && err.message || err); }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  var tok = e && e.parameter && e.parameter.unsub;
  if (tok) {
    var sh = sheet_();
    var hit = rows_(sh).filter(function (r) { return token_(r.email) === tok; })[0];
    if (hit) sh.deleteRow(hit.row);
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">' + (hit ? 'You will not get further OYW26 reminders.' : 'This link has already been used.') + '</p>');
  }
  return ContentService.createTextOutput('OYW26 reminders: ok');
}

// ---------------------------------------------------------------- daily send
function sendDue(previewToMe) {
  var data = JSON.parse(UrlFetchApp.fetch(DATA_URL, { muteHttpExceptions: true }).getContentText());
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var sh = sheet_();
  var sent = 0;
  rows_(sh).forEach(function (sub) {
    var posts = postsFor_(data, sub);
    var due = posts.filter(function (p) { return opensOn_(p) === today && sub.sent.indexOf(p.id) < 0; });
    if (previewToMe) due = posts.slice(0, 1);                  // editor test: first post, to the account owner
    if (!due.length) return;
    var to = previewToMe ? Session.getActiveUser().getEmail() : sub.email;
    var mail = compose_(due, sub, data);
    MailApp.sendEmail({ to: to, subject: mail.subject, htmlBody: mail.html, body: mail.text, name: FROM_NAME, replyTo: REPLY_TO || undefined });
    sent++;
    if (!previewToMe) sh.getRange(sub.row, 6).setValue((sub.sent ? sub.sent + ',' : '') + due.map(function (p) { return p.id; }).join(','));
  });
  Logger.log('%s: %s email(s) sent', today, sent);
}
function postsFor_(data, sub) {
  if (sub.kind === 'explorer') {
    var ex = (data.explorers || []).filter(function (x) { return x.id === sub.explorerId; })[0];
    return ex ? ex.posts.map(function (p) { var L = p.langs[sub.lang] && p.langs[sub.lang].cards.length ? sub.lang : 'EN'; return { id: p.id, title: p.title, date: p.date, windowStart: p.windowStart, windowEnd: p.windowEnd, caption: p.langs[L].caption, thumb: p.langs[L].cards[0] && p.langs[L].cards[0].thumb }; }) : [];
  }
  return (data.sets.graduates.posts || []).map(function (p) { var v = p.variants.A; return { id: p.id, title: p.title, date: p.date, windowStart: p.windowStart, windowEnd: p.windowEnd, caption: '', thumb: v && v.cards[0] && v.cards[0].thumb }; });
}
function opensOn_(p) { return p.date > p.windowStart ? p.date : p.windowStart; }
function day_(iso) { return Utilities.formatDate(new Date(iso + 'T12:00:00Z'), 'UTC', 'd MMM'); }
function compose_(due, sub, data) {
  var first = due[0];
  var subject = due.length === 1 ? 'Your OYW26 post is open today: ' + first.title : 'Your OYW26 posts are open today';
  var unsub = ScriptApp.getService().getUrl() + '?unsub=' + token_(sub.email);
  var items = due.map(function (p) {
    return '<tr><td style="padding:14px 0;border-top:1px solid #d7e8d4">' +
      (p.thumb ? '<img src="' + SITE + p.thumb + '" width="120" alt="" style="float:left;margin:0 16px 8px 0;border-radius:8px">' : '') +
      '<div style="font:600 17px Poppins,Arial,sans-serif;color:#0a2f24">' + p.title + '</div>' +
      '<div style="font:14px Poppins,Arial,sans-serif;color:#355b4c;margin:4px 0 10px">Open from ' + day_(opensOn_(p)) + ' to ' + day_(p.windowEnd) + '</div>' +
      (p.caption ? '<div style="font:13px/1.5 Poppins,Arial,sans-serif;color:#355b4c;white-space:pre-line;clear:none">' + p.caption.split('\n\n')[0] + '…</div>' : '') +
      '<div style="clear:both"></div></td></tr>';
  }).join('');
  var html = '<div style="background:#e7ffd9;padding:28px 16px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 28px 24px;font-family:Poppins,Arial,sans-serif;color:#0a2f24">' +
    '<div style="font:700 12px Poppins,Arial,sans-serif;letter-spacing:.12em;color:#3dcd58;text-transform:uppercase">Powered by Each Other · #OYW26</div>' +
    '<h1 style="font:700 24px/1.2 Poppins,Arial,sans-serif;margin:8px 0 6px">' + (due.length === 1 ? 'Your post is open today' : 'Your posts are open today') + '</h1>' +
    '<p style="font:15px/1.5 Poppins,Arial,sans-serif;color:#355b4c;margin:0 0 6px">The visual and caption are ready in the toolkit. Open it, go to <b>Posts</b>, and press <b>Post on LinkedIn</b>.</p>' +
    '<table style="width:100%;border-collapse:collapse">' + items + '</table>' +
    '<p style="margin:18px 0 0"><a href="' + SITE + '" style="display:inline-block;background:#5eff59;color:#0a2f24;font:600 15px Poppins,Arial,sans-serif;padding:12px 22px;border-radius:999px;text-decoration:none">Open the toolkit</a></p>' +
    '<p style="font:12px/1.5 Poppins,Arial,sans-serif;color:#7a9a8a;margin:22px 0 0">Schneider Electric × One Young World 2026 · Cape Town, 3–6 Nov. <a href="' + unsub + '" style="color:#7a9a8a">Stop these reminders</a></p>' +
    '</div></div>';
  var text = (due.length === 1 ? 'Your OYW26 post is open today: ' + first.title : 'Your OYW26 posts are open today: ' + due.map(function (p) { return p.title; }).join(', ')) +
    '\n\nOpen the toolkit, go to Posts, and press Post on LinkedIn:\n' + SITE + '\n\nStop these reminders: ' + unsub;
  return { subject: subject, html: html, text: text };
}
