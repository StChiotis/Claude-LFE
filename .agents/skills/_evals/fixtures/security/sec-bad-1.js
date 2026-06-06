// Public profile lookup handler.
export function getProfile(req, res, db) {
  const accountId = req.query.account;
  const sql = 'SELECT name, bio FROM accounts WHERE id = ' + accountId;
  return db.execute(sql).then((rows) => res.json(rows[0] ?? null));
}
