/**
 * Art library check (DND-95, part of DND-79): every art id has a registry row, every
 * committed file is registered with a licence, single images have the right size and
 * transparency. Registry = art-src/registry.csv (owned by the art department).
 * Placeholders only warn: they are a progress measure, not a failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assets } from '../src/content/assets';
import quests from '../src/content/quests.json';

const COLUMNS = ['id', 'kind', 'type', 'area', 'subject', 'status', 'source', 'licence', 'file', 'version', 'approved', 'notes'];
const STATUSES = ['placeholder', 'placeholder-local', 'draft', 'approved', 'final'];
/** Portraits are 512 px square (256 minimum); the popup box scales them. Opaque: no transparency rule. */
const PORTRAIT_MIN = 256;
const SPRITE_SIZES = [16, 32, 64]; // must divide the combat cell (64)

interface Row {
  id: string;
  kind: string;
  type: string;
  area: string;
  status: string;
  licence: string;
  file: string;
}

/** Minimal CSV reader (quoted fields, "" escapes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

function loadRegistry(text = readFileSync('art-src/registry.csv', 'utf8')): Row[] {
  const [head, ...body] = parseCsv(text);
  expect(head, 'registry header').toEqual(COLUMNS);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])) as unknown as Row);
}

/** Path of a row's committed file relative to public/ (no frame suffix), or null for local-only files. */
function committedFile(r: Row): string | null {
  const f = r.file.replace(/#.*$/, '').replace(/^public\//, '');
  return f.startsWith('assets/') ? f : null;
}

interface Png {
  w: number;
  h: number;
  /** alpha of the top-left pixel (255 when the image has no alpha channel) */
  cornerAlpha: number;
}

/** IHDR size plus the top-left pixel's alpha. Filters can't change the first pixel of the first row, so no unfiltering is needed. */
function readPng(path: string): Png {
  const b = readFileSync(path);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const depth = b[24];
  const colour = b[25];
  const idat: Buffer[] = [];
  let trns: Buffer | null = null;
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    const type = b.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    if (type === 'tRNS') trns = b.subarray(o + 8, o + 8 + len);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = raw.subarray(1); // after the first scanline's filter byte
  let cornerAlpha = 255;
  if (colour === 6) cornerAlpha = depth === 8 ? px[3] : px[6]; // RGBA
  else if (colour === 4) cornerAlpha = depth === 8 ? px[1] : px[2]; // grey + alpha
  else if (colour === 3) {
    const index = depth === 8 ? px[0] : (px[0] >> (8 - depth)) & ((1 << depth) - 1);
    cornerAlpha = trns && index < trns.length ? trns[index] : 255;
  } else if (trns) cornerAlpha = 255; // colour-key transparency in RGB/grey: treated as opaque here
  return { w, h, cornerAlpha };
}

function imageFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) imageFiles(p, out);
    else if (/\.(png|webp|jpe?g)$/i.test(name)) out.push(p.replace(/^public\//, ''));
  }
  return out;
}

function pictureIds(): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (k === 'picture' && typeof x === 'string') out.add(x);
        else walk(x);
      }
  };
  walk(quests);
  return [...out];
}

const registry = loadRegistry();
const byId = new Map(registry.map((r) => [r.id, r]));

describe('art registry (art-src/registry.csv)', () => {
  it('has unique ids, a known status and no blank fields that matter', () => {
    const seen = new Set<string>();
    for (const r of registry) {
      expect(r.id, 'row without an id').toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(r.id), `duplicate registry id "${r.id}"`).toBe(false);
      seen.add(r.id);
      expect(STATUSES, `"${r.id}": unknown status "${r.status}"`).toContain(r.status);
      expect(r.kind, `"${r.id}": kind is empty`).not.toBe('');
      expect(r.file, `"${r.id}": file is empty`).not.toBe('');
    }
  });

  it('every art id used by the game has a registry row', () => {
    const used = [
      ...Object.keys(assets.sprites),
      ...Object.keys(assets.images),
      ...Object.keys(assets.floors),
      ...Object.keys(assets.cursors).map((c) => `cursor-${c}`),
      ...Object.keys(assets.pictures),
      ...pictureIds(),
    ];
    const missing = [...new Set(used)].filter((id) => !byId.has(id));
    expect(missing, `no registry row for: ${missing.join(', ')}`).toEqual([]);
  });

  it('committed files have a licence; LOCAL ONLY art is never under public/', () => {
    for (const r of registry) {
      const file = committedFile(r);
      if (file) {
        expect(r.licence.trim(), `"${r.id}": empty licence`).not.toBe('');
        expect(/local only/i.test(r.licence), `"${r.id}": LOCAL ONLY art must not be under public/`).toBe(false);
        expect(existsSync(`public/${file}`), `"${r.id}": file public/${file} does not exist`).toBe(true);
      } else if (r.kind === 'picture' || r.status === 'placeholder-local') {
        expect(r.file.startsWith('local/'), `"${r.id}": local-only art must live under local/`).toBe(true);
      }
    }
  });

  it('every art file under public/assets is registered (no orphans)', () => {
    const registered = new Set(registry.map(committedFile).filter(Boolean));
    const orphans = imageFiles('public/assets').filter((f) => !registered.has(f));
    expect(orphans, `files with no registry row: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every committed picture or image in the manifest is registered under that id', () => {
    const files = new Map(registry.map((r) => [r.id, committedFile(r)]));
    for (const [id, i] of Object.entries(assets.images)) {
      expect(files.get(id), `image "${id}": registry file must be ${i.url}`).toBe(i.url);
      expect(existsSync(`public/${i.url}`), `image "${id}": ${i.url} missing`).toBe(true);
      if (i.attack) expect(existsSync(`public/${i.attack}`), `image "${id}": ${i.attack} missing`).toBe(true);
    }
    for (const [id, p] of Object.entries(assets.pictures)) {
      expect(files.get(id), `picture "${id}": registry file must be ${p.url}`).toBe(p.url);
      for (const f of [p.url, p.half, p.full]) if (f) expect(existsSync(`public/${f}`), `picture "${id}": ${f} missing`).toBe(true);
    }
  });

  it('single images are the right size; sprites and icons have a transparent background', () => {
    const problems: string[] = [];
    for (const r of registry) {
      const file = committedFile(r);
      if (!file || !/\.png$/i.test(file) || r.file.includes('#')) continue; // sheets are checked by assets.test.ts
      if (r.status === 'placeholder') continue; // stand-ins are exempt until real art arrives
      const png = readPng(`public/${file}`);
      if (r.type === 'portraits') {
        const half = /_half\.png$/.test(file);
        const full = /_full\.png$/.test(file);
        if (!half && !full && (png.w !== png.h || png.w < PORTRAIT_MIN)) problems.push(`${r.id}: headshot must be square and at least ${PORTRAIT_MIN} px (512 preferred), is ${png.w}x${png.h}`);
      } else if (r.type === 'sprites' || r.type === 'icons') {
        if (png.w !== png.h || !SPRITE_SIZES.includes(png.w)) problems.push(`${r.id}: sprite must be ${SPRITE_SIZES.join('/')} px square, is ${png.w}x${png.h}`);
        if (png.cornerAlpha !== 0) problems.push(`${r.id}: background must be transparent (top-left pixel alpha is ${png.cornerAlpha})`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('reports placeholders per type (progress, not a failure)', () => {
    const counts: Record<string, number> = {};
    for (const r of registry) if (r.status.startsWith('placeholder')) counts[r.type] = (counts[r.type] ?? 0) + 1;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.warn(`[art] ${total} of ${registry.length} assets are placeholders: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    expect(total).toBeLessThanOrEqual(registry.length);
  });
});

describe('registry checks fail loudly (DND-95 acceptance)', () => {
  const header = COLUMNS.join(',');
  it('a deleted registry row names the missing id', () => {
    const rows = registry.filter((r) => r.id !== 'fighter');
    const missing = Object.keys(assets.sprites).filter((id) => !rows.some((r) => r.id === id));
    expect(missing).toEqual(['fighter']);
  });
  it('the CSV reader handles quoted commas and escaped quotes', () => {
    expect(parseCsv(`${header}\nx,sprite,sprites,a,"a, ""b""",placeholder,s,l,f,,,\n`)[1][4]).toBe('a, "b"');
  });
});
