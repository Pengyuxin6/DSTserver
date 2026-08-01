// DST 图标提取工具（在服务器或本地用 Bun 运行）
// 用途：
//   1) 从模组 images/*.xml 图集提取世界设置/预设图标 → panel/public/icons/<xml基名>/*.png
//      例: bun run tools/extract_icons.ts --mod 3322803908            （猪镇 customization_porkland）
//   2) 从游戏文件 images.zip 提取 minimap 图集 → panel/public/icons/minimap/*.png
//      并生成 panel/data/invicons/minimap.xml 索引（为无物品图标的实体补小地图图标）
//      例: bun run tools/extract_icons.ts --minimap --server-dir /home/steam/dst_server
// 说明：KTEX 解码支持 DXT1 / DXT5 / 未压缩 RGBA。PNG 编码为零依赖内置实现。
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
function argVal(name: string): string {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : "";
}
const MOD_ID = argVal("--mod");
const MODS_DIR = argVal("--mods-dir") || "/home/steam/dst_mods";
const SERVER_DIR = argVal("--server-dir") || "/home/steam/dst_server";
const DO_MINIMAP = args.includes("--minimap");
const OUT_ROOT = join(__dirname, "..", "public", "icons");
const INVICON_DIR = join(__dirname, "..", "data", "invicons");

if (!MOD_ID && !DO_MINIMAP) {
  console.log(`用法:
  bun run tools/extract_icons.ts --mod <模组ID> [--mods-dir /home/steam/dst_mods]
  bun run tools/extract_icons.ts --minimap [--server-dir /home/steam/dst_server]`);
  process.exit(0);
}

// ---------- KTEX 解码（DXT1/DXT5/RGBA） ----------
function decodeKTEX(buf: Buffer): { width: number; height: number; rgba: Buffer } | null {
  if (buf.length < 18 || buf.readUInt32LE(0) !== 0x5845544b) return null; // "KTEX"
  const flags = buf.readUInt32LE(4);
  const fmt = (flags >> 4) & 0xf; // 0=DXT1, 2=DXT5, 4=RGBA
  const w = buf.readUInt16LE(8), h = buf.readUInt16LE(10);
  let size = buf.readUInt16LE(14);
  if (!w || !h || w > 8192 || h > 8192) return null;
  if (size === 0) {
    const blocks = Math.ceil(w / 4) * Math.ceil(h / 4);
    size = fmt === 4 ? w * h * 4 : (fmt === 0 ? 8 : 16) * blocks;
  }
  let dataOffset = 8;
  let prevW = w;
  for (let off = 8; off + 10 <= buf.length; off += 10) {
    const mw = buf.readUInt16LE(off), mh = buf.readUInt16LE(off + 2);
    if (mw === 0 || mh === 0) break;
    if (off > 8 && mw > prevW) break;
    prevW = mw;
    dataOffset = off + 10;
  }
  if (dataOffset + size > buf.length) return null;
  const data = buf.subarray(dataOffset, dataOffset + size);
  if (fmt === 4) {
    const rgba = Buffer.alloc(w * h * 4);
    data.copy(rgba, 0, 0, Math.min(data.length, rgba.length));
    return { width: w, height: h, rgba };
  }
  const rgba = decodeDXT(data, w, h, fmt !== 0);
  return rgba ? { width: w, height: h, rgba } : null;
}
function decodeDXT(data: Buffer, width: number, height: number, dxt5: boolean): Buffer | null {
  const rgba = Buffer.alloc(width * height * 4);
  const blocksX = Math.ceil(width / 4), blocksY = Math.ceil(height / 4);
  const blockSize = dxt5 ? 16 : 8;
  const colorOffset = dxt5 ? 8 : 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bo = (by * blocksX + bx) * blockSize;
      if (bo + blockSize > data.length) continue;
      let alphas: number[] = [];
      let aLo = 0, aHi = 0;
      if (dxt5) {
        const a0 = data[bo], a1 = data[bo + 1];
        aLo = data.readUInt32LE(bo + 2);
        aHi = data.readUInt16LE(bo + 6);
        alphas = [a0, a1];
        if (a0 > a1) { for (let i = 0; i < 6; i++) alphas.push(Math.floor(((6 - i) * a0 + (i + 1) * a1) / 7)); }
        else {
          for (let i = 0; i < 4; i++) alphas.push(Math.floor(((4 - i) * a0 + (i + 1) * a1) / 5));
          alphas.push(0, 255);
        }
      }
      const c0 = data.readUInt16LE(bo + colorOffset);
      const c1 = data.readUInt16LE(bo + colorOffset + 2);
      const cBits = data.readUInt32LE(bo + colorOffset + 4);
      const c565 = (c: number) => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
      const [r0, g0, b0] = c565(c0), [r1, g1, b1] = c565(c1);
      const colors: number[][] = [[r0, g0, b0], [r1, g1, b1]];
      if (c0 > c1) {
        colors.push([Math.floor((2 * r0 + r1) / 3), Math.floor((2 * g0 + g1) / 3), Math.floor((2 * b0 + b1) / 3)]);
        colors.push([Math.floor((r0 + 2 * r1) / 3), Math.floor((g0 + 2 * g1) / 3), Math.floor((b0 + 2 * b1) / 3)]);
      } else {
        colors.push([Math.floor((r0 + r1) / 2), Math.floor((g0 + g1) / 2), Math.floor((b0 + b1) / 2)]);
        colors.push([0, 0, 0]);
      }
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const yi = by * 4 + py, xi = bx * 4 + px;
          if (yi >= height || xi >= width) continue;
          const ci = (cBits >>> ((py * 4 + px) * 2)) & 3;
          const [r, g, b] = colors[ci];
          let a = 255;
          if (dxt5) {
            const shift = (py * 4 + px) * 3;
            const aBits = aLo + aHi * 0x100000000;
            a = alphas[Math.floor(aBits / Math.pow(2, shift)) & 7];
          }
          const o = (yi * width + xi) * 4;
          rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
        }
      }
    }
  }
  return rgba;
}
// ---------- PNG 编码（零依赖） ----------
function encodePNG(rgba: Buffer, width: number, height: number): Buffer {
  const crc32Table: number[] = [];
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc32Table.push(c); }
  const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crc32Table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
// UV 裁剪（RGBA 已翻转为自上而下，与 PNG 一致，UV v 坐标原点在上方）
// Klei 的 UV 坐标指向像素中心：u = (pixel_index + 0.5) / texture_width
// 因此 pixel_index = floor(u * width)，像素范围 [floor(u1*W), floor(u2*W)] 闭区间
function cropRGBA(img: { width: number; height: number; rgba: Buffer }, u1: number, u2: number, v1: number, v2: number): { width: number; height: number; rgba: Buffer } {
  let x = Math.floor(u1 * img.width);
  let y = Math.floor(v1 * img.height);
  let w = Math.floor(u2 * img.width) - x + 1;
  let h = Math.floor(v2 * img.height) - y + 1;
  if (w <= 0 || h <= 0) return img;
  x = Math.max(0, Math.min(x, img.width - 1)); y = Math.max(0, Math.min(y, img.height - 1));
  w = Math.min(w, img.width - x); h = Math.min(h, img.height - y);
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    img.rgba.copy(out, row * w * 4, ((y + row) * img.width + x) * 4, ((y + row) * img.width + x + w) * 4);
  }
  return { width: w, height: h, rgba: out };
}

// ---------- 图集 XML 解析（属性顺序无关） ----------
interface AtlasElement { name: string; u1: number; u2: number; v1: number; v2: number }
function parseAtlasXml(xml: string): { texFile: string; elements: AtlasElement[] } | null {
  const tm = /<Texture\s+[^>]*filename="([^"]+)"/.exec(xml) || /<Texture\s+filename="([^"]+)"/.exec(xml);
  if (!tm) return null;
  const elements: AtlasElement[] = [];
  const attr = (tag: string, name: string): string => {
    const m = new RegExp(`${name}="([^"]+)"`).exec(tag);
    return m ? m[1] : "";
  };
  for (const em of xml.matchAll(/<Element\s+([^>]*?)\/>/g)) {
    const a = em[1];
    const name = attr(a, "name");
    const u1 = parseFloat(attr(a, "u1")), u2 = parseFloat(attr(a, "u2"));
    const v1 = parseFloat(attr(a, "v1")), v2 = parseFloat(attr(a, "v2"));
    if (!name || [u1, u2, v1, v2].some((v) => !Number.isFinite(v))) continue;
    elements.push({ name, u1, u2, v1, v2 });
  }
  return { texFile: tm[1], elements };
}

// ---------- 从图集 (xml+tex) 导出全部元素 PNG ----------
// seen: 可选的去重集合，同名元素只在第一次出现时导出，避免多图集覆盖导致内容错乱
function exportAtlas(xmlPath: string, texPath: string, outDir: string, seen?: Set<string>): { count: number; indexLines: string[] } {
  const xml = readFileSync(xmlPath, "utf-8");
  const atlas = parseAtlasXml(xml);
  if (!atlas) { console.log(`  [跳过] ${xmlPath}: 未找到 Texture 声明`); return { count: 0, indexLines: [] }; }
  const texReal = existsSync(texPath) ? texPath : join(join(xmlPath, ".."), atlas.texFile);
  if (!existsSync(texReal)) { console.log(`  [跳过] ${xmlPath}: 贴图 ${atlas.texFile} 不存在`); return { count: 0, indexLines: [] }; }
  const decoded = decodeKTEX(readFileSync(texReal));
  if (!decoded) { console.log(`  [失败] ${xmlPath}: KTEX 解码失败（不支持的格式？）`); return { count: 0, indexLines: [] }; }
  mkdirSync(outDir, { recursive: true });
  let count = 0;
  const indexLines: string[] = [];
  for (const el of atlas.elements) {
    const pngName = el.name.replace(/\.(tex|png)$/i, "") + ".png";
    if (seen) {
      if (seen.has(pngName)) continue; // 已从更早的图集导出，跳过
      seen.add(pngName);
    }
    try {
      const crop = cropRGBA(decoded, el.u1, el.u2, el.v1, el.v2);
      writeFileSync(join(outDir, pngName), encodePNG(crop.rgba, crop.width, crop.height));
      indexLines.push(`  <Element name="${el.name.replace(/\.(tex)$/i, ".png")}" u1="${el.u1}" u2="${el.u2}" v1="${el.v1}" v2="${el.v2}" />`);
      count++;
    } catch (e: any) {
      console.log(`  [警告] 元素 ${el.name} 裁剪失败: ${e?.message || e}`);
    }
  }
  return { count, indexLines };
}

function walk(dir: string, depth: number, out: string[]): void {
  if (depth > 5) return;
  let ents: string[] = [];
  try { ents = readdirSync(dir); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e);
    try {
      if (statSync(p).isDirectory()) walk(p, depth + 1, out);
      else out.push(p);
    } catch {}
  }
}

// ================= 模式 1: 模组图集 =================
if (MOD_ID) {
  const imgRoot = join(MODS_DIR, MOD_ID, "images");
  if (!existsSync(imgRoot)) {
    console.log(`模组图片目录不存在: ${imgRoot}（检查 --mods-dir 或模组是否已下载）`);
    process.exit(1);
  }
  const files: string[] = [];
  walk(imgRoot, 0, files);
  const xmls = files.filter((f) => f.toLowerCase().endsWith(".xml"));
  console.log(`模组 ${MOD_ID}: 发现 ${xmls.length} 个图集 XML`);
  let total = 0;
  for (const xmlPath of xmls) {
    const atlasName = basename(xmlPath).replace(/\.xml$/i, "");
    const texPath = xmlPath.replace(/\.xml$/i, ".tex");
    const outDir = join(OUT_ROOT, atlasName);
    const { count } = exportAtlas(xmlPath, texPath, outDir);
    if (count) console.log(`  [完成] ${atlasName}: ${count} 个图标 → ${outDir}`);
    total += count;
  }
  console.log(`模组 ${MOD_ID} 共导出 ${total} 个图标`);
}

// ================= 模式 2: 游戏 minimap 图集 =================
if (DO_MINIMAP) {
  // 真实文件布局：data/minimap/minimap_data.xml + minimap_atlas.tex（及 _data1/_atlas1、_data2/_atlas2 共3组，散文件非zip）
  // 专用服务端与完整客户端的 data/minimap/ 目录都带这组文件；合并所有元素到 public/icons/minimap/
  const mmDir = join(SERVER_DIR, "data", "minimap");
  if (!existsSync(mmDir)) {
    console.log(`未找到 minimap 图集目录: ${mmDir}（用 --server-dir 指定游戏/服务端目录）`);
    process.exit(1);
  }
  const pairs: { xml: string; tex: string }[] = [];
  for (const f of readdirSync(mmDir)) {
    const m = /^(minimap_data\d*)\.xml$/i.exec(f);
    if (!m) continue;
    const tex = join(mmDir, m[1].replace("minimap_data", "minimap_atlas") + ".tex");
    pairs.push({ xml: join(mmDir, f), tex });
  }
  if (!pairs.length) { console.log(`${mmDir} 里没有 minimap_data*.xml`); process.exit(1); }
  const outDir = join(OUT_ROOT, "minimap");
  let total = 0;
  const allIndex: string[] = [];
  const seen = new Set<string>(); // 去重：同名元素只从第一个出现的图集提取，避免后续图集覆盖
  for (const p of pairs) {
    const { count, indexLines } = exportAtlas(p.xml, p.tex, outDir, seen);
    console.log(`  ${p.xml.split(/[\\/]/).pop()}: ${count} 个图标`);
    total += count;
    allIndex.push(...indexLines);
  }
  console.log(`minimap: 共 ${total} 个图标 → ${outDir}`);
  // 生成物品图标索引（itemIconAtlas 读取）：元素名 → minimap 图集
  if (total) {
    mkdirSync(INVICON_DIR, { recursive: true });
    writeFileSync(join(INVICON_DIR, "minimap.xml"), `<Atlas><Texture filename="minimap.tex" /><Elements>\n${allIndex.join("\n")}\n</Elements></Atlas>\n`);
    console.log(`索引已写入 ${join(INVICON_DIR, "minimap.xml")}`);
  }
}
