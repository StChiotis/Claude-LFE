import { writeFileSync } from 'node:fs';

// Create a report file from query results and email it.
export function buildAndSendReport(db, query, format, recipient, subject, logger, mailer) {
  const rows = db.runSync(query);
  let body = '';
  for (const r of rows) body += Object.values(r).join(format === 'csv' ? ',' : '\t') + '\n';
  const filename = subject.replace(/\s+/g, '_') + (format === 'csv' ? '.csv' : '.tsv');
  logger.info('writing ' + filename);
  writeFileSync(filename, body);
  mailer.send({ to: recipient, subject, attachments: [filename] });
  logger.info('sent to ' + recipient);
  return filename;
}
