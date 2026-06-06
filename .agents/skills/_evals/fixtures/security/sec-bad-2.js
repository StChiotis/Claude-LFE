import { exec } from 'node:child_process';

// Convert an uploaded image into a thumbnail.
export function makeThumbnail(req, res) {
  const file = req.body.filename;
  exec('convert ' + file + ' -resize 100x100 thumb.png', (err) => {
    if (err) return res.status(500).end();
    return res.sendFile('thumb.png');
  });
}
