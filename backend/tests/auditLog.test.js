/**
 * 敏感操作审计守卫 —— v1.13.320
 *
 * 由来（2026-11-06 安全审计的第一批整改）：
 *   admin 改配额 / 改角色 / 停用 / 删号 / 重置密码，全站**没有落库留痕**
 *   （只有 2 处 `console.log('[audit]')`，且都在 store-sales，与配额无关）。
 *   同时 `quota_history` 只记「某账号的配额变了多少」，**不记是谁改的**：
 *     · 池级 quota_purchases 有 created_by；
 *     · 账号级 quota_history 没有 ⇒ 一处有、一处没有，追责时正好缺在最需要的地方。
 *   ⇒ 内部人滥用或 admin 账号被盗后，pm2 日志一轮转就彻底无法追溯。
 *
 * 本守卫钉住的不变量（都属于「改坏了不报错、只是静默失去可追溯性」的类型）：
 *   A. audit_log 表定义齐全（actor 快照 + 动作 + 目标 + detail + ip/ua）。
 *   B. quota_history 有 operator_id / operator_name，且插入时真的带上。
 *   C. 六个敏感 handler 各自写了审计，且用对动作码（不串码）。
 *   D. 🔴 写审计的 handler **必须包事务**：审计插入让「单次写」变成两次写，
 *      本库（sql.js）非事务态每次 run() 都整库落盘（~166MB）⇒ 不包事务就多付一次全盘写。
 *   E. 审计插入必须在 `commitTx()` **之前**（放后面就等于落到事务外，D 就白做了）。
 *   F. detail 里**绝不能出现密码值**（审计表长期留存）。
 *   G. writeAudit 自身必须 try/catch —— 审计是旁路，不能把业务拖垮。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', 'src')
const R = (...p) => path.join(SRC, ...p)

const dbSrc = fs.readFileSync(R('models', 'database.js'), 'utf8')
const auditSrc = fs.readFileSync(R('utils', 'auditLog.js'), 'utf8')
const usersSrc = fs.readFileSync(R('routes', 'users.js'), 'utf8')
const vipSrc = fs.readFileSync(R('routes', 'vipApplications.js'), 'utf8')
const citySrc = fs.readFileSync(R('routes', 'city-data.js'), 'utf8')

/** 剥注释再判断（注释里出现的 writeAudit 字样不算数） */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 按 `router.<method>('path'` 切出各 handler 的函数体。
 * 切到「下一个 router.xxx(」或文件结尾为止 —— 足够覆盖本项目的写法。
 */
function handlersOf(src) {
  const code = stripComments(src)
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g
  const marks = []
  let m
  while ((m = re.exec(code)) !== null) {
    marks.push({ method: m[1].toUpperCase(), routePath: m[2], start: m.index })
  }
  return marks.map((x, i) => ({
    ...x,
    body: code.slice(x.start, i + 1 < marks.length ? marks[i + 1].start : code.length),
  }))
}

describe('A. audit_log 表定义齐全', () => {
  const code = stripComments(dbSrc)
  const m = code.match(/CREATE TABLE IF NOT EXISTS audit_log\s*\(([\s\S]*?)\)\s*`\)/)
  const cols = m ? m[1] : ''

  it('表存在', () => {
    expect(m, '找不到 audit_log 建表语句').toBeTruthy()
  })

  for (const col of [
    'actor_id', 'actor_name', 'actor_role', 'action',
    'target_type', 'target_id', 'detail', 'ip', 'user_agent', 'created_at',
  ]) {
    it(`有 ${col} 列`, () => {
      expect(cols, `audit_log 缺 ${col} 列`).toContain(col)
    })
  }

  it('actor_name / actor_role 是快照（注释里必须写明，否则后人会改成关联查询）', () => {
    expect(dbSrc).toMatch(/actor_name TEXT[\s\S]{0,200}快照|快照[\s\S]{0,200}actor_name/)
  })

  it('建了两个索引（按时间 / 按目标查）', () => {
    expect(code).toContain('idx_audit_log_created')
    expect(code).toContain('idx_audit_log_target')
  })
})

describe('B. quota_history 补了操作人', () => {
  it('加列语句存在（幂等 ALTER，包在 try 里）', () => {
    expect(dbSrc).toMatch(/ALTER TABLE quota_history ADD COLUMN operator_id/)
    expect(dbSrc).toMatch(/ALTER TABLE quota_history ADD COLUMN operator_name/)
  })

  it('users.js 的 INSERT 真的带 operator（只加列不写等于没加）', () => {
    const m = usersSrc.match(/INSERT INTO quota_history\s*\(([^)]*)\)/)
    expect(m, '找不到 quota_history 的 INSERT 列清单（守卫已失锚，请同步更新）').toBeTruthy()
    expect(m[1], 'INSERT 的列清单里没有 operator_id —— 只加列不写，等于没记操作人').toMatch(/operator_id/)
    expect(m[1], 'INSERT 的列清单里没有 operator_name').toMatch(/operator_name/)
    // 紧随其后的 .run(...) 参数里必须真的有值传进去
    const tail = usersSrc.slice(m.index, m.index + 700)
    expect(tail, 'INSERT 参数里没有传 req.user.id').toMatch(/req\.user\?\.id/)
    expect(tail, 'INSERT 参数里没有传 req.user.username').toMatch(/req\.user\?\.username/)
  })
})

describe('C. 六个敏感 handler 都写了审计，且动作码不串', () => {
  const users = handlersOf(usersSrc)

  const cases = [
    ['PUT', '/quota', 'QUOTA_POOL', '池级调总配额'],
    ['PUT', '/:id', 'USER_UPDATE', '改用户（角色/配额/密码）'],
    ['POST', '/', 'USER_CREATE', '建号'],
    ['PATCH', '/:id/status', 'USER_DISABLE', '停用'],
    ['DELETE', '/:id', 'USER_DELETE', '删号'],
    ['POST', '/:id/reset-password', 'USER_RESET_PASSWORD', '重置密码'],
  ]

  for (const [method, routePath, action, label] of cases) {
    it(`${method} ${routePath}（${label}）写了 ${action}`, () => {
      const h = users.find((x) => x.method === method && x.routePath === routePath)
      expect(h, `找不到 handler ${method} ${routePath}（守卫已失锚，请同步更新）`).toBeTruthy()
      expect(h.body, `${label} 没有写审计 ⇒ 事后查不到是谁干的`).toContain('writeAudit(')
      expect(h.body, `${label} 用的动作码不是 ${action}`).toContain(`AUDIT_ACTIONS.${action}`)
    })
  }

  it('PATCH /:id/status 的「恢复」分支也写了 USER_ENABLE', () => {
    const h = users.find((x) => x.method === 'PATCH' && x.routePath === '/:id/status')
    expect(h.body).toContain('AUDIT_ACTIONS.USER_ENABLE')
  })

  it('VIP 审批（通过/驳回）都写了 VIP_REVIEW', () => {
    const vips = handlersOf(vipSrc)
    for (const p of ['/:id/approve', '/:id/reject']) {
      const h = vips.find((x) => x.routePath === p)
      expect(h, `找不到 ${p}`).toBeTruthy()
      expect(h.body, `VIP ${p} 没有审计`).toContain('writeAudit(')
      expect(h.body).toContain('AUDIT_ACTIONS.VIP_REVIEW')
    }
  })

  it('城市数据的清空/导入/新增/编辑四种动作码各不相同', () => {
    const city = handlersOf(citySrc)
    const clear = city.find((x) => x.method === 'DELETE' && x.routePath === '/')
    expect(clear.body).toContain('AUDIT_ACTIONS.CITYDATA_CLEAR')
    const imp = city.find((x) => x.method === 'POST' && x.routePath === '/import')
    expect(imp.body).toContain('AUDIT_ACTIONS.CITYDATA_IMPORT')
    const upsert = city.find((x) => x.method === 'POST' && x.routePath === '/')
    expect(upsert.body).toContain('AUDIT_ACTIONS.CITYDATA_UPSERT')
    const upd = city.find((x) => x.method === 'PUT' && x.routePath === '/:city')
    expect(upd.body).toContain('AUDIT_ACTIONS.CITYDATA_UPDATE')
    // 四种必须是四个不同的常量名
    const used = [clear, imp, upsert, upd].map((h) => h.body.match(/AUDIT_ACTIONS\.(\w+)/)[1])
    expect(new Set(used).size, `四个写接口只有 ${new Set(used).size} 种动作码，串码了`).toBe(4)
  })

  it('清空前先数条数（删完就查不到原本有多少）', () => {
    const city = handlersOf(citySrc)
    const clear = city.find((x) => x.method === 'DELETE' && x.routePath === '/')
    expect(clear.body, '清空审计里没有记录清掉了多少条').toMatch(/beforeCount|clearedRecords/)
  })
})

describe('D. 写审计的 handler 必须包事务（否则多付一次整库落盘）', () => {
  const files = [
    ['users.js', usersSrc],
    ['vipApplications.js', vipSrc],
  ]

  for (const [name, src] of files) {
    it(`${name}：每个含 writeAudit 的 handler 都有 beginTx`, () => {
      const bad = handlersOf(src)
        .filter((h) => h.body.includes('writeAudit('))
        .filter((h) => !h.body.includes('beginTx()'))
        .map((h) => `${h.method} ${h.routePath}`)
      expect(
        bad,
        `${name} 里这些 handler 写了审计但没包事务 —— 审计插入让单次写变成两次写，` +
          `本库非事务态每次 run() 都整库落盘（~166MB），不包事务就白白多付一次全盘写：\n  ` +
          bad.join('\n  ')
      ).toEqual([])
    })
  }

  it('users.js 的 beginTx / commitTx / rollbackTx 数量平衡', () => {
    const v = (k) => (stripComments(usersSrc).match(new RegExp(k, 'g')) || []).length
    expect(v('db\\.beginTx\\(\\)')).toBe(v('db\\.commitTx\\(\\)'))
    expect(v('db\\.beginTx\\(\\)')).toBe(v('db\\.rollbackTx\\(\\)'))
  })

  it('vipApplications.js 的 beginTx / commitTx / rollbackTx 数量平衡', () => {
    const v = (k) => (stripComments(vipSrc).match(new RegExp(k, 'g')) || []).length
    expect(v('db\\.beginTx\\(\\)')).toBe(v('db\\.commitTx\\(\\)'))
    expect(v('db\\.beginTx\\(\\)')).toBe(v('db\\.rollbackTx\\(\\)'))
  })
})

describe('E. 审计插入必须在 commitTx 之前', () => {
  const files = [
    ['users.js', usersSrc],
    ['vipApplications.js', vipSrc],
  ]

  for (const [name, src] of files) {
    it(`${name}：writeAudit 不得出现在 commitTx 之后`, () => {
      const bad = []
      for (const h of handlersOf(src)) {
        if (!h.body.includes('writeAudit(')) continue
        const commitIdx = h.body.lastIndexOf('commitTx()')
        if (commitIdx === -1) continue
        const auditIdx = h.body.indexOf('writeAudit(')
        // 只有当审计点在该 handler 的**最后一个** commit 之后才算出界
        if (auditIdx > commitIdx) bad.push(`${h.method} ${h.routePath}`)
      }
      expect(
        bad,
        `${name} 里这些 handler 的审计写在 commitTx 之后 —— 等于落到事务外，` +
          `D 组「不额外落盘」的保证就白做了：\n  ` + bad.join('\n  ')
      ).toEqual([])
    })
  }
})

describe('F. detail 里绝不能出现密码值', () => {
  it('users.js 的审计 detail 不含 password 的实际值', () => {
    // 允许 auditDetail.password = { changed: true } 这种「只记改过」
    const bad = []
    for (const h of handlersOf(usersSrc)) {
      const idx = h.body.indexOf('writeAudit(')
      if (idx === -1) continue
      const block = h.body.slice(idx, idx + 900)
      if (/password\s*:\s*(password|hashedPassword|newPassword)\b/.test(block)) {
        bad.push(`${h.method} ${h.routePath}`)
      }
    }
    expect(bad, '审计里写了密码值 —— 审计表是长期留存的，⛔ 绝不能存密码/哈希：\n  ' + bad.join('\n  ')).toEqual([])
  })
})

describe('G. writeAudit 自身不得抛异常（审计是旁路）', () => {
  it('实现了 try/catch', () => {
    const fn = auditSrc.slice(auditSrc.indexOf('export function writeAudit'))
    expect(fn, 'writeAudit 没有 try/catch —— 审计失败会把业务一起带挂').toMatch(/try\s*\{[\s\S]*\}\s*catch/)
  })

  it('catch 里只记日志、不重新抛出', () => {
    const fn = auditSrc.slice(auditSrc.indexOf('export function writeAudit'))
    const catchBlock = fn.slice(fn.indexOf('catch'))
    expect(catchBlock).not.toMatch(/throw\s/)
  })

  it('detail 有长度上限（防止一条日志撑大整库）', () => {
    expect(auditSrc).toMatch(/MAX_DETAIL_CHARS/)
  })
})
