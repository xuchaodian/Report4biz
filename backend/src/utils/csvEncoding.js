import fs from 'fs'

/**
 * CSV / 文本导入的编码自适应解码（v1.13.197）
 *
 * 背景（Bug）：各导入端点此前一律 `fs.readFileSync(path, 'utf-8')`。
 * Windows 版 Excel / WPS「另存为 CSV」默认写 **GBK（GB2312/GB18030）**，
 * 国内业务方给的文件九成是这种。按 UTF-8 硬解 ⇒ 中文列全部成为替换符（乱码），
 * 且因为中文被破坏，品牌名/门店名/城市等字段全部不可用。
 *
 * 策略（零依赖，基于 Node 内置 TextDecoder + full-icu；不引入 iconv-lite 等新依赖）：
 *   1) **BOM 优先**：UTF-8 BOM → 去 BOM 按 utf-8；UTF-16 LE/BE BOM → 按对应编码。
 *      （顺带修掉一个隐性缺陷：UTF-8-BOM 文件此前会把 `\ufeff` 并进首个表头键，
 *       导致 `row.store_code` 恒 undefined。）
 *   2) **严格 UTF-8 试探**（fatal:true）：能通过 ⇒ 就是 UTF-8，原样返回。
 *      ⚠️ 这一条保证「本就正常的 UTF-8 文件行为完全不变」，绝不误伤存量导入。
 *   3) **回退 GB18030**（GBK / GB2312 的超集）：覆盖中文 Windows / Excel 导出的主流场景。
 *
 * 🔴 顺序不可颠倒：必须先试 UTF-8，再退 GB18030。
 *    若先按 GB18030 解，**任何合法 UTF-8 也会"成功"解成一堆乱码**
 *    （GB18030 几乎没有非法字节序列，不会抛错），等于把好文件也毁了。
 */

const BOMS = [
  { sig: [0xef, 0xbb, 0xbf], enc: 'utf-8', skip: 3 },
  { sig: [0xff, 0xfe], enc: 'utf-16le', skip: 2 },
  { sig: [0xfe, 0xff], enc: 'utf-16be', skip: 2 },
]

/**
 * 把一个 Buffer 解码为字符串（自动探测 UTF-8 / UTF-8-BOM / UTF-16 / GB18030）
 * @param {Buffer|Uint8Array} input
 * @returns {string}
 */
export function decodeCsvBuffer(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)

  for (const { sig, enc, skip } of BOMS) {
    if (buf.length >= sig.length && sig.every((v, i) => buf[i] === v)) {
      return new TextDecoder(enc, { fatal: false }).decode(buf.subarray(skip))
    }
  }

  try {
    // 严格模式：非法 UTF-8 字节序列会抛异常，从而进入回退分支
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('gb18030', { fatal: false }).decode(buf)
  }
}

/**
 * 读取一个 CSV/文本文件并按上述策略解码。
 * 用法：把 `fs.readFileSync(path, 'utf-8')` 直接替换为 `readCsvText(path)`。
 * @param {string} filePath
 * @returns {string}
 */
export function readCsvText(filePath) {
  return decodeCsvBuffer(fs.readFileSync(filePath))
}
