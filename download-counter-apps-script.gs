/**
 * Google Apps Script Web App for downloads/views counters.
 *
 * Setup:
 * 1) Create a new Apps Script project (script.google.com)
 * 2) Paste this file content
 * 3) Replace SHEET_ID with your Google Sheet ID
 * 4) Create a sheet tab named "counts" with headers in row 1:
 *      key | count | updatedAt
 * 5) Deploy -> New deployment -> Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 6) Copy Web App URL and paste into:
 *      window.DOWNLOADS_COUNTER_ENDPOINT in downloads.html
 */

const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';
const SHEET_NAME = 'counts';

function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();

  if (action === 'get') {
    return jsonOut({ counts: getCountsMap_() });
  }

  if (action === 'increment') {
    const key = (e.parameter.key || '').trim();
    if (!key) return jsonOut({ ok: false, error: 'Missing key' });
    const count = incrementKey_(key);
    return jsonOut({ ok: true, key, count });
  }

  return jsonOut({ ok: true, message: 'Use ?action=get or ?action=increment&key=...' });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : '{}');
    const action = String(payload.action || '').toLowerCase();

    if (action === 'increment') {
      const key = String(payload.key || '').trim();
      if (!key) return jsonOut({ ok: false, error: 'Missing key' });
      const count = incrementKey_(key);
      return jsonOut({ ok: true, key, count });
    }

    if (action === 'get') {
      return jsonOut({ counts: getCountsMap_() });
    }

    return jsonOut({ ok: false, error: 'Unsupported action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, 3).setValues([['key', 'count', 'updatedAt']]);
  }
  return sh;
}

function getCountsMap_() {
  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return {};

  const values = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  const out = {};
  values.forEach(function (row) {
    const key = String(row[0] || '').trim();
    if (!key) return;
    out[key] = Number(row[1] || 0);
  });
  return out;
}

function incrementKey_(key) {
  const sh = getSheet_();
  const lastRow = sh.getLastRow();
  const now = new Date();

  if (lastRow >= 2) {
    const keys = sh.getRange(2, 1, lastRow - 1, 1).getValues().map(r => String(r[0] || '').trim());
    const idx = keys.indexOf(key);
    if (idx !== -1) {
      const row = idx + 2;
      const current = Number(sh.getRange(row, 2).getValue() || 0);
      const next = current + 1;
      sh.getRange(row, 2, 1, 2).setValues([[next, now]]);
      return next;
    }
  }

  sh.appendRow([key, 1, now]);
  return 1;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
