// Leest nieuwe regels uit groeiende JSONL-bestanden. Begint bij grote bestanden aan het eind.
import fs from 'node:fs';

const START_BYTES = 512 * 1024;
const MAX_CHUNK = 4 * 1024 * 1024;

export function createTail(path) {
  let offset = -1, partial = '', ino = 0;
  return {
    path,
    /** Geeft {lines, mtime} met de volledige nieuwe regels sinds de vorige aanroep, of null als er niets is. */
    read() {
      let st;
      try { st = fs.statSync(path); } catch { return null; }
      if (st.ino !== ino || st.size < offset) { ino = st.ino; offset = -1; partial = ''; }
      let skipFirst = false;
      if (offset < 0) { offset = Math.max(0, st.size - START_BYTES); skipFirst = offset > 0; }
      if (st.size === offset) return null;
      const len = Math.min(st.size - offset, MAX_CHUNK);
      const buf = Buffer.alloc(len);
      let fd;
      try { fd = fs.openSync(path, 'r'); fs.readSync(fd, buf, 0, len, offset); } catch { return null; } finally { if (fd != null) fs.closeSync(fd); }
      offset += len;
      const text = partial + buf.toString('utf8');
      const lines = text.split('\n');
      partial = lines.pop();
      if (skipFirst) lines.shift();
      return { lines: lines.filter((l) => l.trim()), mtime: st.mtimeMs };
    },
  };
}
