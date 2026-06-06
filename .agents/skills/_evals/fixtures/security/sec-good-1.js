import { execFile } from 'node:child_process';

// Public profile lookup: parameterized query.
export function getProfile(req, res, db) {
  const accountId = req.query.account;
  return db.execute('SELECT name, bio FROM accounts WHERE id = ?', [accountId])
    .then((rows) => res.json(rows[0] ?? null));
}

// Thumbnail: accept only a plain image basename (leading word char, then word
// chars / dots / dashes, ending in .png/.jpg/.jpeg) — otherwise 400 — before
// invoking the image processor.
const SAFE_THUMBNAIL_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:png|jpe?g)$/;

export function makeThumbnail(req, res) {
  const file = req.body.filename;
  if (typeof file !== 'string' || !SAFE_THUMBNAIL_NAME.test(file)) {
    return res.status(400).end();
  }
  execFile('convert', [file, '-resize', '100x100', 'thumb.png'], (err) => {
    if (err) return res.status(500).end();
    return res.sendFile('thumb.png');
  });
}
