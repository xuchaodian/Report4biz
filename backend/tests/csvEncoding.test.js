import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { decodeCsvBuffer, readCsvText } from '../src/utils/csvEncoding.js'

// ---- 测试夹具：必要的编码字节（GBK 无法用 Node 原生编码器生成，故硬编码，已用 Python 校对）----
const GBK = {
  header: Buffer.from([0x73, 0x74, 0x6f, 0x72, 0x65, 0x5f, 0x63, 0x6f, 0x64, 0x65, 0x2c, 0x62, 0x72, 0x61, 0x6e, 0x64, 0x2c, 0x6e, 0x61, 0x6d, 0x65]), // store_code,brand,name
  kendeji: Buffer.from([0xbf, 0xcf, 0xb5, 0xc2, 0xbb, 0xf9]), // 肯德基
  anqing: Buffer.from([0xb0, 0xb2, 0xc7, 0xec, 0xca, 0xd0]), // 安庆市
}

const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf])
const tmpFiles = []

afterAll(() => {
  for (const f of tmpFiles) { try { fs.unlinkSync(f) } catch { /* 忽略 */ } }
})

describe('csvEncoding · decodeCsvBuffer', () => {
  it('① GBK 文件：按 GB18030 回退解出中文（核心修复）', () => {
    const buf = Buffer.concat([GBK.header, Buffer.from('\n'), GBK.kendeji, Buffer.from(','), GBK.anqing])
    const text = decodeCsvBuffer(buf)
    expect(text).toContain('store_code,brand,name')
    expect(text).toContain('肯德基')
    expect(text).toContain('安庆市')
    expect(text).not.toContain('\uFFFD')
  })

  it('② 合法 UTF-8 文件：原样返回，行为不变（绝不误伤存量导入）', () => {
    const s = 'store_code,brand,name\nAH1042,肯德基,石牌联商餐厅\n'
    const buf = Buffer.from(s, 'utf-8')
    expect(decodeCsvBuffer(buf)).toBe(s)
  })

  it('③ 纯 ASCII：原样返回', () => {
    const s = 'a,b,c\n1,2,3\n'
    expect(decodeCsvBuffer(Buffer.from(s, 'ascii'))).toBe(s)
  })

  it('④ UTF-8 BOM：剥离 BOM（否则首个表头键会带 \\ufeff）', () => {
    const buf = Buffer.concat([BOM_UTF8, Buffer.from('store_code,brand\nAH1042,肯德基\n', 'utf-8')])
    const text = decodeCsvBuffer(buf)
    expect(text.startsWith('\uFEFF')).toBe(false)
    expect(text.startsWith('store_code')).toBe(true)
    expect(text).toContain('肯德基')
  })

  it('⑤ UTF-16LE BOM（Excel「Unicode 文本」另存）：按 utf-16le 解码', () => {
    const s = 'store_code,brand\nAH1042,肯德基\n'
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf-16le')])
    expect(decodeCsvBuffer(buf)).toBe(s)
  })

  it('⑥ 判定顺序护栏：GBK 字节在严格 UTF-8 下必须失败（证明走到了回退分支）', () => {
    // 若非严格模式，GBK 会被"成功"解成乱码 —— 这条钉死「先试 UTF-8」的不可颠倒性
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(GBK.kendeji)).toThrow()
    // 而我们的实现给出正确中文
    expect(decodeCsvBuffer(GBK.kendeji)).toBe('肯德基')
  })

  it('⑦ 非法 UTF-8 与 GB18030 会"都成功" ⇒ 只能靠顺序取胜（反例固化）', () => {
    const wrong = new TextDecoder('gb18030', { fatal: false }).decode(Buffer.from('肯德基', 'utf-8'))
    expect(wrong).not.toBe('肯德基') // 好文件被 GBK 误读的结果
    expect(decodeCsvBuffer(Buffer.from('肯德基', 'utf-8'))).toBe('肯德基') // 我们的顺序保住了
  })
})

describe('csvEncoding · readCsvText', () => {
  it('从磁盘读取 GBK 文件并正确解码（模拟真实上传落盘后的读取）', () => {
    const p = path.join(os.tmpdir(), `r4b_gbk_${Date.now()}.csv`)
    fs.writeFileSync(p, Buffer.concat([GBK.header, Buffer.from('\nAH1042,'), GBK.kendeji, Buffer.from(','), GBK.anqing, Buffer.from('\n')]))
    tmpFiles.push(p)
    const text = readCsvText(p)
    expect(text).toContain('肯德基')
    expect(text).toContain('安庆市')
  })

  it('从磁盘读取 UTF-8 文件不改变内容', () => {
    const s = 'name,city\n肯德基,安庆市\n'
    const p = path.join(os.tmpdir(), `r4b_utf8_${Date.now()}.csv`)
    fs.writeFileSync(p, Buffer.from(s, 'utf-8'))
    tmpFiles.push(p)
    expect(readCsvText(p)).toBe(s)
  })
})
