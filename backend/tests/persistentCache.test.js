/**
 * S3 持久化缓存单测（v1.13.107）
 * 覆盖：命中/未命中、TTL 过期、maxSize 淘汰最旧、跨实例（模拟重启）持久化、载入时丢弃过期项。
 * 通过 R4B_CACHE_DIR 指向临时目录，绝不触碰 backend/data/cache 真实缓存。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-cache-test-'))
process.env.R4B_CACHE_DIR = TMP

let PersistentCache
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  ({ PersistentCache } = await import('../src/utils/persistentCache.js'))
})

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* ignore */ }
})

describe('PersistentCache：内存语义（TTL / maxSize）', () => {
  it('set 后 get 命中，未写入的 key 返回 undefined', () => {
    const c = new PersistentCache('basic', { ttl: 60_000, maxSize: 10 })
    c.set('a', 1)
    expect(c.get('a')).toEqual({ v: 1, ts: expect.any(Number) })
    expect(c.get('missing')).toBeUndefined()
  })

  it('超过 TTL 即过期，get 返回 undefined 并删除该键', async () => {
    const c = new PersistentCache('ttl', { ttl: 30, maxSize: 10 })
    c.set('k', 'v')
    expect(c.get('k')).toBeDefined()
    await sleep(60)
    expect(c.get('k')).toBeUndefined()
    expect(c.size).toBe(0)
  })

  it('超出 maxSize 淘汰最旧条目（FIFO）', () => {
    const c = new PersistentCache('evict', { ttl: 60_000, maxSize: 3 })
    c.set('k1', 1)
    c.set('k2', 2)
    c.set('k3', 3)
    c.set('k4', 4)
    expect(c.size).toBe(3)
    expect(c.get('k1')).toBeUndefined() // 最旧被淘汰
    expect(c.get('k2')).toBeDefined()
    expect(c.get('k4')).toBeDefined()
  })

  it('ttl<=0 表示永不过期', async () => {
    const c = new PersistentCache('forever', { ttl: 0, maxSize: 10 })
    c.set('k', 'v')
    await sleep(30)
    expect(c.get('k')).toBeDefined()
  })
})

describe('PersistentCache：跨进程持久化（模拟后端重启）', () => {
  it('flush 后新建同名实例可读回未过期条目', () => {
    const c1 = new PersistentCache('persist', { ttl: 60_000, maxSize: 10 })
    c1.set('city:上海', 12345)
    c1.flush()
    expect(fs.existsSync(path.join(TMP, 'persist.json'))).toBe(true)

    const c2 = new PersistentCache('persist', { ttl: 60_000, maxSize: 10 })
    expect(c2.get('city:上海')).toEqual({ v: 12345, ts: expect.any(Number) })
  })

  it('载入时丢弃已过期条目（过期项不复活）', async () => {
    const c1 = new PersistentCache('expire-load', { ttl: 40, maxSize: 10 })
    c1.set('old', 'x')
    c1.flush()
    await sleep(80)

    const c2 = new PersistentCache('expire-load', { ttl: 40, maxSize: 10 })
    expect(c2.get('old')).toBeUndefined()
    expect(c2.size).toBe(0)
  })

  it('落盘文件损坏时按空缓存继续（不抛异常）', () => {
    fs.mkdirSync(TMP, { recursive: true })
    fs.writeFileSync(path.join(TMP, 'broken.json'), '{ not-json')
    expect(() => new PersistentCache('broken', { ttl: 1000, maxSize: 5 })).not.toThrow()
    const c = new PersistentCache('broken', { ttl: 1000, maxSize: 5 })
    expect(c.size).toBe(0)
  })
})
