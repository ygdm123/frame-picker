// 缩略图压缩缓存服务
// 输入:framesDir + 一组原图路径 + 目标宽度
// 输出:每张原图对应一个压缩好的缩略图,缓存到 <framesDir>/.thumbnails/
// 缓存 key = hash(原图绝对路径 + mtime + 宽度),原图变了或宽度变了自动重建
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const DEFAULT_WIDTH = 320;
const JPEG_QUALITY = 75;

function hashKey(absPath, mtimeMs, width) {
  return crypto.createHash("md5").update(`${absPath}|${mtimeMs}|${width}`).digest("hex").slice(0, 16);
}

/**
 * 给一组原图路径生成缩略图,返回 { 原图路径 -> 缩略图路径 } 映射。
 * 已存在且未失效的缓存直接复用。
 */
async function ensureThumbnails({ framesDir, framePaths, width = DEFAULT_WIDTH }) {
  const cacheDir = path.join(framesDir, ".thumbnails");
  await fs.mkdir(cacheDir, { recursive: true });

  const out = {};
  const tasks = framePaths.map(async (absPath) => {
    try {
      const st = await fs.stat(absPath);
      // 没读出来(可能原图被删了)就跳过,renderer 端 fallback 用原图
      if (!st.isFile()) return;
      const key = hashKey(absPath, st.mtimeMs, width);
      const thumbPath = path.join(cacheDir, `${key}_w${width}.jpg`);
      out[absPath] = await ensureOne(absPath, thumbPath, width);
    } catch {
      // 单个失败不影响整体
    }
  });
  await Promise.all(tasks);
  return out;
}

async function ensureOne(absPath, thumbPath, width) {
  // 已存在就直接返回(同 mtime 时缓存必定有效)
  try {
    const st = await fs.stat(thumbPath);
    if (st.isFile()) return thumbPath;
  } catch {}
  await sharp(absPath)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: false })
    .toFile(thumbPath);
  return thumbPath;
}

module.exports = { ensureThumbnails, DEFAULT_WIDTH };