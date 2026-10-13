import express from 'express'
import bcrypt from 'bcryptjs'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { signToken, bumpTokenVersion, currentTokenVersion } from '../utils/tokenAuth.js'
import { getPoolInfo } from './resale.js'
// v1.13.160：集团品牌 Logo 读时继承 —— 回执与 login//auth/me 同一口径，见 utils/brandLogo.js
import { withResolvedLogo } from '../utils/brandLogo.js'

const router = express.Router()

// VIP 到期日：vip → 自保存之日起 1 年；trial → 自保存之日起 30 天；其他角色 → null
// v1.13.158：POST 与 PUT 共用本函数。此前 POST（新建用户）的 INSERT 漏了 vip_until 列，
// 导致「新建时直接选 VIP用户/VIP试用」的账号 role 写入了但 vip_until 为 NULL ——
// 表现为用户管理列表该列显示「—」、我的账户误标「已过期」，且 trial 因
// app.js 的降级条件带 `vip_until IS NOT NULL` 而永远不会到期降级（永久白嫖 VIP）。
// v1.13.205：本函数与 VIP_DAYS 已抽到 utils/vipRole.js —— 该批次新增的「VIP 试用申请
// 审批」链路同样要按角色算到期日，就地复制会产生第三份拷贝（历史上已分叉过一次）。
// v1.13.211：同文件再补 isPrivilegeDowngrade —— 「改角色是否降权」也必须有单一判据，
// 否则 PUT /:id 与 app.js 的 trial 到期降级会各写一套位阶表（同一类分叉）。
import { calcVipUntil, isPrivilegeDowngrade } from '../utils/vipRole.js'

// 获取用户列表（包含配额信息）
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const { company } = req.query
    
    // v1.13.216：补 disabled_at / disabled_prev_username —— 前端据此给已停用账号
    // 显示「已停用」徽章并回显**原用户名**（而不是 __disabled_<id>）
    let sql = `SELECT id, username, email, role, vip_until, company, quota, created_at, disabled_at, disabled_prev_username, disabled_prev_email FROM users`
    const params = []
    
    if (company) {
      sql += ` WHERE company LIKE ?`
      params.push(`%${company}%`)
    }
    
    sql += ` ORDER BY created_at DESC`
    
    const users = db.prepare(sql).all(...params)

    // 为每个用户计算配额信息
    const usersWithQuota = users.map(user => {
      // 一次查询取三个聚合（避免 N+1 恶化）：
      //   usedActive  当前消费（仅 active）—— 表格「消费次数」
      //   usedAll     累计消费（含 inactive）—— 表格「累计使用」
      //   cumAllocated 累计分配（quota_history 代数和的净购买）—— 表格「累计配额」
      // 口径与个人中心 GET /purchase/quota（purchase.js:70-88）逐字一致，保证两页对得上
      const agg = db.prepare(`
        SELECT
          COALESCE((SELECT SUM(quota_used) FROM purchases WHERE user_id = ? AND status = 'active'), 0) AS usedActive,
          COALESCE((SELECT SUM(quota_used) FROM purchases WHERE user_id = ?), 0) AS usedAll,
          COALESCE((SELECT SUM(change_amount) FROM quota_history WHERE user_id = ?), 0) AS cumAllocated
      `).get(user.id, user.id, user.id)
      const usedQuota = agg?.usedActive || 0
      const cumulativeUsed = agg?.usedAll || 0
      // 与 purchase.js:88 同口径：Σ 为 0 时回落到 users.quota（老账号无 quota_history 基线记录）
      const cumulativeTotal = agg?.cumAllocated || (user.quota || 0)

      if (user.role === 'admin') {
        // admin 用户不显示剩余配额（由 quotaInfo 统一提供）
        return { ...user, remainingQuota: null, usedQuota, cumulativeTotal, cumulativeUsed }
      }
      const remainingQuota = Math.max(0, (user.quota || 0) - usedQuota)
      return { ...user, remainingQuota, usedQuota, cumulativeTotal, cumulativeUsed }
    })

    // v1.13.202：库内管理员总数（**全表计数，不受 company 筛选影响**）——供前端「最后一个管理员」
    // 保护使用（禁用非 admin 选项 + 提示）。后端 PUT 的校验才是权威，两处口径必须一致。
    const adminCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get()?.c || 0

    // 计算已分配的配额总和（不包括管理员）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0

    // 获取初始总配额与权威剩余配额（v1.13.103 B2：直接读 remaining_quota 列——
    // 该列由 smartsteps/purchase/districts 每次真实上游查询实时 -N，含「区域洞察」
    // （只扣列不写 purchases 履历）。原「initial − Σactive 履历」口径统计不进区域洞察
    // 消费 → 卡片持续虚高；改列后与顶栏「剩余 N 次」、purchase.js:62 同一权威来源）
    const quotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0
    const remainingQuota = Math.max(0, quotaRecord?.remaining_quota || 0)

    // 剩余可分配 = 初始总配额 - 已分配（与用户实际使用无关）
    const availableQuota = Math.max(0, initialQuota - allocatedQuota)

    // API 开放页已分配（真实模式余额合计，测试模式不占池）——共用同一批次配额
    const apiAllocatedResult = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 0`).get()
    const apiAllocatedQuota = apiAllocatedResult?.total || 0
    // 全池剩余可分配 = 总配额 - 用户页已分配 - API 页已分配
    const poolAvailableQuota = Math.max(0, initialQuota - allocatedQuota - apiAllocatedQuota)

    res.json({ 
      users: usersWithQuota,
      adminCount,
      quotaInfo: {
        initialQuota,     // 初始总配额（我手动输入的值）
        remainingQuota,   // 当前剩余配额（实际可查询的次数）
        allocatedQuota,   // 已分配给用户的次数
        availableQuota,   // 剩余可分配次数（仅用户页口径）
        apiAllocatedQuota,   // API 开放页已分配（第三方余额合计）
        poolAvailableQuota   // 全池剩余可分配（用户页+API页共用）
      }
    })
  } catch (error) {
    console.error('获取用户列表错误:', error)
    res.status(500).json({ message: '获取用户列表失败' })
  }
})

// 更新总配额（管理员手动设置）
router.put('/quota', authenticate, requireAdmin, (req, res) => {
  try {
    const { totalQuota } = req.body
    
    if (totalQuota === undefined || totalQuota < 0) {
      return res.status(400).json({ message: '请输入有效的总配额数值' })
    }

    const db = getDb()

    // 获取当前数据用于计算
    const currentQuota = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const currentInitial = currentQuota?.initial_quota || 0
    const currentRemaining = currentQuota?.remaining_quota || 0

    // 计算已分配的配额总和（不包括管理员）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0

    // 计算新的 remaining_quota
    // 规则：新增配额时，remaining_quota 也要增加
    const quotaDiff = parseInt(totalQuota) - currentInitial
    const newRemaining = Math.max(0, currentRemaining + quotaDiff)

    // 本次「真实采购量」= 剩余的实际增量（v1.13.115）
    // 只有 >0 才是采购；≤0（原值重存 / 回调）不记采购履历。
    // 注意用「剩余增量」而非 quotaDiff：极端情况下 newRemaining 会被 Math.max(0,…) 截断，
    // 用实际增量才能保证 quota_before + amount === quota_after 自洽。
    const purchaseAmount = newRemaining - currentRemaining

    // 更新初始总配额和当前剩余配额 + 采购留痕（同事务）
    db.beginTx()
    try {
      db.prepare(`UPDATE admin_quota SET initial_quota = ?, remaining_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
        .run(parseInt(totalQuota), newRemaining)

      if (purchaseAmount > 0) {
        // ⚠️ 写 quota_purchases，**绝不**写 quota_history（后者是账号级台账，见 database.js 注释）
        db.prepare(`
          INSERT INTO quota_purchases (amount, quota_before, quota_after, note, created_by, created_by_name)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          purchaseAmount,
          currentRemaining,
          newRemaining,
          (req.body?.note || '').toString().trim() || null,
          req.user?.id ?? null,
          req.user?.username ?? null
        )
      }

      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    // 剩余可分配 = 初始总配额 - 已分配
    const availableQuota = Math.max(0, parseInt(totalQuota) - allocatedQuota)
    // API 开放页占用与全池口径（与 GET / 一致，前端整体赋值需全字段）
    const apiAllocatedResult = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 0`).get()
    const apiAllocatedQuota = apiAllocatedResult?.total || 0
    const poolAvailableQuota = Math.max(0, parseInt(totalQuota) - allocatedQuota - apiAllocatedQuota)

    res.json({
      message: '总配额已更新',
      purchaseRecorded: purchaseAmount > 0 ? purchaseAmount : 0,   // >0 表示本次记入采购履历
      quotaInfo: {
        initialQuota: parseInt(totalQuota),
        remainingQuota: newRemaining,
        allocatedQuota,
        availableQuota,
        apiAllocatedQuota,
        poolAvailableQuota
      }
    })
  } catch (error) {
    console.error('更新总配额错误:', error)
    res.status(500).json({ message: '更新总配额失败' })
  }
})

// 获取配额采购履历（v1.13.115，仅平台 admin）
// 池级台账：每次「向联通采购 / 上调累计总配额」记一行；纯读接口。
router.get('/quota/purchases', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500)

    const rows = db.prepare(`
      SELECT id, amount, quota_before, quota_after, note, created_by, created_by_name, created_at
      FROM quota_purchases
      ORDER BY id DESC
      LIMIT ?
    `).all(limit)

    const sumRow = db.prepare(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total FROM quota_purchases
    `).get()

    const quotaRecord = db.prepare(`SELECT initial_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0

    res.json({
      purchases: rows,
      summary: {
        count: sumRow?.cnt || 0,
        totalAmount: sumRow?.total || 0,
        initialQuota,
        // 本表建立之前的采购量（无明细），仅作提示，不参与任何计算
        baselineAmount: Math.max(0, initialQuota - (sumRow?.total || 0))
      }
    })
  } catch (error) {
    console.error('获取采购履历错误:', error)
    res.status(500).json({ message: '获取采购履历失败' })
  }
})

// 创建用户
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { username, email, password, role, company } = req.body

    if (!username || !email || !password) {
      return res.status(400).json({ message: '请填写所有必填字段' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少6个字符' })
    }

    const db = getDb()

    // 检查用户名或邮箱是否已存在
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email)
    if (existing) {
      return res.status(400).json({ message: '用户名或邮箱已存在' })
    }

    // 加密密码
    const hashedPassword = bcrypt.hashSync(password, 10)

    // 创建用户
    // v1.13.158：角色为 vip/trial 时必须一并写入 vip_until，否则到期日为空（见文件顶部 calcVipUntil 说明）
    const finalRole = role || 'user'
    const result = db.prepare(`
      INSERT INTO users (username, email, password, role, company, vip_until)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, email, hashedPassword, finalRole, company || '', calcVipUntil(finalRole))

    const user = db.prepare('SELECT id, username, email, role, vip_until, company, created_at FROM users WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      message: '用户创建成功',
      user
    })
  } catch (error) {
    console.error('创建用户错误:', error)
    res.status(500).json({ message: '创建用户失败' })
  }
})

// 用户修改自己的信息（只需要登录，不需要 admin）
router.put('/me', authenticate, (req, res) => {
  try {
    const { email, password, company, logo } = req.body
    const userId = req.user.id

    const db = getDb()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // 更新用户信息
    const updates = []
    const params = []
    let passwordChanged = false

    if (email) {
      // 检查邮箱是否被其他用户使用
      const emailExists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId)
      if (emailExists) {
        return res.status(400).json({ message: '该邮箱已被其他用户使用' })
      }
      updates.push('email = ?')
      params.push(email)
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ message: '密码至少6个字符' })
      }
      updates.push('password = ?')
      params.push(bcrypt.hashSync(password, 10))
      passwordChanged = true
    }

    if (company !== undefined) {
      updates.push('company = ?')
      params.push(company)
    }

    if (logo !== undefined) {
      updates.push('logo = ?')
      params.push(logo)
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: '没有需要更新的字段' })
    }

    params.push(userId)

    // v1.13.150 会话失效：改密码 ⇒ 该账号**所有**已签发 token 作废。
    // 为什么不能只靠 jti 黑名单：黑名单只能精确撤销「某一枚 token」，无从枚举
    // 该账号在别处签发的 token；「改密码踢全部」只能走账号级 token_version。
    // 🔒 本人当前设备不因此掉线：bump 之后按新版本号重签一枚回给前端替换。
    const applyUpdate = () => db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    let refreshedToken = null

    if (passwordChanged) {
      // 两次写 ⇒ 包事务压成一次落盘（落盘铁律：≥2 次才包）
      db.beginTx()
      try {
        applyUpdate()
        bumpTokenVersion(db, userId)
        refreshedToken = signToken(existingUser, currentTokenVersion(db, userId))
        db.commitTx()
      } catch (e) {
        try { db.rollbackTx() } catch (e2) { /* 事务已结束等情况忽略 */ }
        throw e
      }
    } else {
      applyUpdate()   // 单次写：不包事务（包了反而多一次落盘）
    }

    // v1.13.213：本 SELECT **必须带 vip_until** —— 前端 userStore.isVipActive 依赖它判有效期。
    // 此前漏带 ⇒ 用户在「我的账户」保存一次个人资料（改公司名/邮箱/Logo），
    // 前端 `this.user` 就被替换成不含 vip_until 的对象 ⇒ VIP 门禁回退到「长期有效」
    // （`!vip_until ⇒ true`）而**静默放行**；同时徽章的「已过期」标注也会退回「长期有效」。
    // 守卫：backend/tests/vipUntilParity.test.js 的「数据通路」组。
    const user = db.prepare('SELECT id, username, email, role, vip_until, company, logo, created_at FROM users WHERE id = ?').get(userId)

    res.json({
      message: '修改成功',
      // v1.13.160：`logo` 仍是本人自有值；展示用值走 logo_effective（集团继承）。
      // 本人刚上传/清空 logo 时，这里也会立刻反映为 self / group。
      user: withResolvedLogo(db, user),
      ...(refreshedToken ? { token: refreshedToken } : {})
    })
  } catch (error) {
    console.error('修改个人信息错误:', error)
    res.status(500).json({ message: '修改失败' })
  }
})

// 更新用户
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { email, password, role, vip_until, company, quota } = req.body
    const userId = req.params.id

    const db = getDb()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // v1.13.202：「最后一个管理员」保护 —— 禁止把系统中唯一的管理员改成其他角色。
    // 背景：middleware/auth.js 里 req.user = decoded ⇒ requireAdmin 判的是 **JWT 载荷**（读 token
    // 不读库）。把管理员自己改成 trial/user 后当前会话仍可用（库里已变、token 未变），
    // 但**下次登录**签发的新 token 载荷即非 admin ⇒ /users 直接 403；若全站只剩这一个管理员
    // ⇒ 永久失去后台入口，且无处可改回来。故此处按「库内管理员总数」兜住（与 GET / 的
    // adminCount 同一口径）。⛔ 别改成按 req.user 判断 —— 那正是失效的判据。
    if (role && role !== 'admin' && existingUser.role === 'admin') {
      const adminCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get()?.c || 0
      if (adminCount <= 1) {
        return res.status(400).json({ message: '系统必须保留至少一个管理员：不能把最后一个管理员改为其他角色' })
      }
    }

    // 如果要更新配额，检查配额限制（设定模式）
    // v1.13.142：区分「配额真的变了」与「前端原值回填」。编辑弹窗会把当前剩余次数
    // 一并提交，值未变时不应产生任何配额写入 —— 否则每改一次角色/邮箱/VIP 都会多写
    // 一条 0→0 的 quota_history，并多付一次整库落盘（见下方事务化写入说明）。
    const quotaProvided = quota !== undefined
    const newQuota = quotaProvided ? (parseInt(quota) || 0) : 0
    const currentUserQuota = existingUser.quota || 0
    const quotaDiff = newQuota - currentUserQuota  // 正=追加，负=减少
    const quotaChanged = quotaProvided && quotaDiff !== 0

    // 只有在增加时才需要检查可用配额
    if (quotaChanged && quotaDiff > 0) {
      // v1.13.103 B2-C：与 resale.js 同一单一预算池口径（getPoolInfo）——
      // 池剩余 = 总配额 − Σ(users.quota, 非admin) − Σ(api_keys.balance, mock=0)。
      // 原校验只减用户页已分配、漏减 API 开放页占用 → 用户页可超额分配，
      // 两页总和可超买入批次总额（超额部分实际无上游额度支撑）
      const pool = getPoolInfo(db)
      if (quotaDiff > pool.available) {
        return res.status(400).json({
          message: `分配失败：超出可用配额。需追加 ${quotaDiff} 次，当前可用 ${pool.available} 次（总配额 ${pool.poolTotal}，用户页已分配 ${pool.allocatedUsers}，API 开放页已分配 ${pool.allocatedApi}）`
        })
      }
    }

    // 更新用户信息
    const updates = []
    const params = []

    if (email) {
      updates.push('email = ?')
      params.push(email)
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ message: '密码至少6个字符' })
      }
      updates.push('password = ?')
      params.push(bcrypt.hashSync(password, 10))
    }

    if (role) {
      updates.push('role = ?')
      params.push(role)
    }

    if (company !== undefined) {
      updates.push('company = ?')
      params.push(company)
    }

    // VIP 到期：设为 VIP → 自保存日起算自动续期 1 年；设为 VIP 试用 → 自保存日起算 30 天；
    // 未传 role 则保持既有权值不动；改为其他角色 → 清除。
    // v1.13.158：改用文件顶部的 calcVipUntil，与 POST 共用同一份口径（原先两处各写一遍，已分叉过一次）
    const finalRole = role !== undefined ? role : existingUser.role
    if (finalRole === 'vip' || finalRole === 'trial') {
      updates.push('vip_until = ?')
      params.push(calcVipUntil(finalRole))
    } else if (role !== undefined) {
      updates.push('vip_until = ?')
      params.push(null)
    }

    if (quotaChanged) {
      // 设定模式：直接设为输入值（仅在值真的变化时写入，见上方 v1.13.142 说明）
      updates.push('quota = ?')
      params.push(newQuota)
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: '没有需要更新的字段' })
    }

    params.push(userId)

    // v1.13.211：「降权」必须撤销该账号**全部**已签发 token。
    // 背景（v1.13.150 起挂账的治本项）：middleware/auth.js 里 `req.user = decoded` ⇒
    // requireAdmin 等判的是 **JWT 载荷**，不是库。原先只有「改密码」会 bump，于是
    //   管理员把 vip/admin 改成 user ⇒ 库里已降级，但对方手上那枚旧 token 里
    //   仍写着 role:'vip'/'admin' ⇒ 最长 7 天（TOKEN_TTL）继续按旧角色放行。
    //   也就是「后台收回权限」这个动作实际上没有生效。
    // 判据只认 utils/vipRole.js::isPrivilegeDowngrade（单一权威来源，⛔ 勿就地写位阶表）：
    //   降权（user→ 的反向：vip→user / admin→user / vip→trial …）⇒ bump；
    //   提权（user→vip/trial、vip→admin …）⇒ 不 bump。
    // 为什么提权不 bump：提权不会多放行任何东西，而 bump 会把对方当场踢下线；
    //   前端判据走 GET /auth/me（**读库**）⇒ 提权后刷新页面即可见，无需重登。
    const roleChanged = role !== undefined && role !== existingUser.role
    const roleDowngrade = roleChanged && isPrivilegeDowngrade(existingUser.role, role)
    const revokeAllSessions = !!password || roleDowngrade
    // 改的是**自己** ⇒ bump 会把自己当场踢下线，故按新角色/新版本号回签一枚替换
    // （沿用 PUT /me 的 refreshedToken 范式；signToken / currentTokenVersion 文件顶部已 import）
    const isSelfEdit = String(existingUser.id) === String(req.user?.id)
    let refreshedToken = null

    // v1.13.142：容器化写入 —— 原先 UPDATE users 与 quota_history INSERT 各自
    // prepare().run()，而 database.js 的 run() 在非事务态下每次都会触发一次
    // 「db.export() 全库导出 + 整文件写盘」。本库 166MB（其中 141MB 是不可变的
    // 人口网格 geojson 静态数据），一次「编辑用户」要付两份 166MB 内存拷贝 +
    // 两次整库落盘。这种高阶内存分配会直接触发内核 proactive compaction，
    // 本机已多次因 kcompactd0 卡死（D 状态 240s+）导致整机冻结、只能重启。
    // 包进事务后：多次写合并为一次落盘（commitTx 内含统一保存），且避免半截状态落盘。
    db.beginTx()
    try {
      if (quotaChanged) {
        // 记录配额变更历史（用于累计配额统计）
        try {
          db.prepare(`
            INSERT INTO quota_history (user_id, old_quota, new_quota, change_amount, action)
            VALUES (?, ?, ?, ?, ?)
          `).run(userId, currentUserQuota, newQuota, quotaDiff, quotaDiff >= 0 ? 'increase' : 'decrease')
        } catch (e) {
          console.error('写入配额历史失败:', e)
        }
      }
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      // v1.13.150：管理员改了该用户密码 ⇒ 其所有会话立即作废（含 TA 当前登录的设备）。
      // v1.13.211：改角色「降权」同理。
      // 并入既有事务：不额外增加落盘次数。改邮箱/配额/公司等不触发。
      if (revokeAllSessions) {
        bumpTokenVersion(db, userId)
        if (isSelfEdit) {
          refreshedToken = signToken(
            { id: existingUser.id, username: existingUser.username, role: finalRole },
            currentTokenVersion(db, userId)
          )
        }
      }
      db.commitTx()   // 内含统一落盘
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 事务已结束等情况忽略 */ }
      throw e
    }

    // 返回更新后的配额信息（含 API 页占用与全池口径，前端整体赋值需全字段）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0
    const quotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0
    const remainingQuota = quotaRecord?.remaining_quota || 0
    const apiAllocatedResult = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 0`).get()
    const apiAllocatedQuota = apiAllocatedResult?.total || 0
    const availableQuota = Math.max(0, initialQuota - allocatedQuota)
    const poolAvailableQuota = Math.max(0, initialQuota - allocatedQuota - apiAllocatedQuota)

    const user = db.prepare('SELECT id, username, email, role, company, quota, created_at FROM users WHERE id = ?').get(userId)

    res.json({
      message: '用户更新成功',
      user,
      quotaInfo: {
        initialQuota,
        remainingQuota,
        allocatedQuota,
        availableQuota,
        apiAllocatedQuota,
        poolAvailableQuota
      },
      // v1.13.211：仅当「改的是自己」且触发了账号级撤销（降权/改密）时才回签 ——
      // 前端据此替换本地凭据，避免管理员把自己降权后当场 401 掉线（自锁）。
      ...(refreshedToken ? { token: refreshedToken } : {})
    })
  } catch (error) {
    console.error('更新用户错误:', error)
    res.status(500).json({ message: '更新用户失败' })
  }
})

// ============================================================================
// 停用 / 恢复账号（v1.13.216）
//
// 语义：这是**默认的"删除"动作**（可逆冻结）。停用后该账号所有已签发 token 立即失效、
//   再也无法登录，但**数据一行不动** ⇒ 零孤儿风险。物理删除改由 DELETE /:id 承担，
//   且**要求账号已停用**（见该分支内的 gate）。
//
// ⚠️ 为什么必须**改写** username/email 而不能置 NULL：
//   `users.username` 与 `users.email` 都是 `UNIQUE NOT NULL`
//   ⇒ ① 置 NULL 直接违反约束；② 不改写则同名/同邮箱**永远无法重新注册**
//     （注册重名检查见 routes/auth.js 与下方 POST / 的 `username = ? OR email = ?`）。
//   故停用时挪到 `__disabled_<id>` / `__disabled_<id>@disabled.invalid`，
//   原值记入 disabled_prev_*，恢复时还原。
//   副作用（**有意接受**）：账号在集团成员列表等处会显示成 `__disabled_<id>` ——
//   反过来正好是个「该账号已停用」的视觉告警。用户管理列表已用 prev 列回显原名。
//
// ⭐ 停用 ＝ **单条 UPDATE** 一次完成五件事（改名 + 释放 + 记原值 ×2 + bump 版本）。
//   若拆成「bump + UPDATE」两条 ⇒ 同请求 2 个写点，按落盘铁律必须包事务；
//   合成一条只落盘一次，更快也更不容易漏。
// ⭐ 恢复**不 bump**：人被踢下线了，恢复后需重新登录取新 token，旧 token 早已 stale。
// ============================================================================
router.patch('/:id/status', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = req.params.id
    const { disabled } = req.body || {}

    // 严格布尔：不接受 'true' / 1 / 空值 —— 避免"字符串真值"把恢复写成停用
    if (typeof disabled !== 'boolean') {
      return res.status(400).json({ message: '参数 disabled 必须为布尔值' })
    }

    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }

    if (disabled) {
      // 不能停用自己 —— 停用会立刻撤销自己的 token，等于把自己锁在门外且无人能救
      if (user.id === req.user.id) {
        return res.status(400).json({ message: '不能停用自己的账号' })
      }
      // 「最后一个管理员」保护（与 PUT /:id · DELETE /:id 同口径）：
      // 停用后该管理员无法登录 ⇒ 与删除等价地失去后台入口
      if (user.role === 'admin') {
        const adminCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get()?.c || 0
        if (adminCount <= 1) {
          return res.status(400).json({ message: '系统必须保留至少一个管理员：不能停用最后一个管理员' })
        }
      }
      if (user.disabled_at) {
        return res.status(400).json({ message: '该账号已处于停用状态' })
      }

      // SQL 的 SET 赋值全部取**行更新前**的值 ⇒ 同一条里先记 prev 再改名是安全的
      db.prepare(`
        UPDATE users
           SET disabled_at = ?,
               disabled_prev_username = username,
               disabled_prev_email = email,
               username = ?,
               email = ?,
               token_version = COALESCE(token_version, 0) + 1
         WHERE id = ?
      `).run(new Date().toISOString(), `__disabled_${user.id}`, `__disabled_${user.id}@disabled.invalid`, user.id)

      return res.json({
        message: `已停用「${user.username}」：该账号无法再登录，原有登录状态已全部失效（数据保留，可随时恢复）`,
        user: db.prepare('SELECT id, username, email, role, disabled_at FROM users WHERE id = ?').get(user.id)
      })
    }

    // ------------------------------ 恢复 ------------------------------
    if (!user.disabled_at) {
      return res.status(400).json({ message: '该账号未被停用' })
    }
    const prevName = user.disabled_prev_username
    const prevMail = user.disabled_prev_email
    if (!prevName || !prevMail) {
      // 历史脏行（有 disabled_at 却没有 prev 记录）：绝不猜名字 —— 猜错会把账号
      // 变成一个误导性的身份，比报错危险得多
      return res.status(400).json({ message: '该账号缺少停用前的用户名/邮箱记录，无法自动恢复：请先手工修正再恢复' })
    }
    // 停用的意义正是「释放」这两个标识 ⇒ 原值可能已被新账号占用，必须显式检查
    const clash = db.prepare('SELECT id, username FROM users WHERE (username = ? OR email = ?) AND id != ?')
      .get(prevName, prevMail, user.id)
    if (clash) {
      return res.status(400).json({
        message: `无法恢复：原用户名「${prevName}」或原邮箱已被账号「${clash.username}」占用，请先处理该账号`
      })
    }

    db.prepare(`
      UPDATE users
         SET username = disabled_prev_username,
             email = disabled_prev_email,
             disabled_prev_username = NULL,
             disabled_prev_email = NULL,
             disabled_at = NULL
       WHERE id = ?
    `).run(user.id)

    return res.json({
      message: `已恢复「${prevName}」：该账号可重新登录（需重新登录取新会话）`,
      user: db.prepare('SELECT id, username, email, role, disabled_at FROM users WHERE id = ?').get(user.id)
    })
  } catch (error) {
    console.error('停用/恢复用户错误:', error)
    res.status(500).json({ message: '操作失败' })
  }
})

// 删除用户（v1.13.216 起：**要求账号已停用**）
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = req.params.id

    const db = getDb()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // 不能删除自己
    if (existingUser.id === req.user.id) {
      return res.status(400).json({ message: '不能删除自己的账号' })
    }

    // v1.13.203：「最后一个管理员」保护（与 PUT /:id 同口径）—— 禁止删除系统中唯一的管理员。
    // 背景同 PUT：requireAdmin 判 **JWT 载荷**而非库，且 PUT 改 role **不 bump token_version** ⇒ 存在
    // 这条真实路径：① 两个管理员 A/B ② A 把自己降级为 user（202 允许，因 adminCount=2）
    // 但 A 的旧 token 载荷仍是 admin ③ A 用旧 token 删 B ⇒ 全站 0 管理员、永久失去后台入口。
    // ⚠️ 第 ③ 步**不是「删自己」**——「不能删除自己」拦不住 ⇒ 必须按「库内管理员总数」兜住。
    if (existingUser.role === 'admin') {
      const adminCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get()?.c || 0
      if (adminCount <= 1) {
        return res.status(400).json({ message: '系统必须保留至少一个管理员：不能删除最后一个管理员' })
      }
    }

    // v1.13.213：集团 owner 保护 —— 禁止删除「仍是一个未解散集团总部」的账号。
    // 背景：本库**未开** PRAGMA foreign_keys（见 models/database.js 中 org_members 处注释：
    //   「本库未开 PRAGMA foreign_keys，不会报错，只会静默脏掉」）⇒ DELETE users **不级联**，
    //   只会留下一堆孤儿行。其中 `organizations.owner_user_id` 悬空最致命：
    //   requireOrgOwner 靠 `req.user.id === org.owner_user_id` 匹配，悬空后**谁都匹配不上**
    //   ⇒ 该集团永久无法解散、无法增删成员；而成员又受 `org_members.user_id UNIQUE`
    //   （一账号只能属一个集团）约束，**再也加不进别的集团** ⇒ 账号被永久锁死。
    // ⚠️ 已解散（立碑）的集团不算：`dissolved_at` 非空后不再接受任何管理操作，owner 悬空无害。
    // 与上面「最后一个管理员」同风格 —— 都是「删之前先挡住会产生不可逆后果的那一类账号」。
    // 查询照抄 routes/orgs.js 的 GET /me 同款写法，保持一致。
    const ownedOrg = db.prepare(
      `SELECT name FROM organizations WHERE owner_user_id = ? AND dissolved_at IS NULL ORDER BY id LIMIT 1`
    ).get(userId)
    if (ownedOrg) {
      return res.status(400).json({
        message: `该账号是集团「${ownedOrg.name}」的总部账号，删除后该集团将无法再被管理：请先解散该集团或转移总部账号`
      })
    }

    // v1.13.216：物理删除**要求账号已停用**。
    // 理由：停用是默认动作（可逆、零孤儿风险），彻底删除只对「已停用」账号开放 ⇒
    //   ① 彻底消灭「点一下删除就静默产生孤儿行」的路径（本批的起因就是 1253 行孤儿）；
    //   ② 给 S3「对已停用账号彻底删除（含级联）」留好现成接口。
    // ⚠️ 本端点**目前仍不级联**（未开 PRAGMA foreign_keys）—— 级联实现属 S3 批次。
    if (!existingUser.disabled_at) {
      return res.status(400).json({
        message: '请先停用该账号再彻底删除（直接删除会留下无法再清理的孤儿数据）'
      })
    }

    // 删除用户
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)

    res.json({ message: '用户删除成功' })
  } catch (error) {
    console.error('删除用户错误:', error)
    res.status(500).json({ message: '删除用户失败' })
  }
})

// 获取月度使用统计
router.get('/monthly-stats', authenticate, requireAdmin, (req, res) => {
  try {
    const { month, company } = req.query
    
    if (!month) {
      return res.status(400).json({ message: '请选择月份' })
    }
    
    const db = getDb()
    
    // 解析月份，获取起始和结束日期
    const [year, monthNum] = month.split('-')
    const startDate = `${year}-${monthNum}-01`
    const endDate = monthNum === '12' 
      ? `${parseInt(year) + 1}-01-01` 
      : `${year}-${String(parseInt(monthNum) + 1).padStart(2, '0')}-01`
    
    // 构建查询：获取该公司所有用户的月度使用情况
    let sql = `
      SELECT 
        u.id,
        u.username,
        u.email,
        u.company,
        u.quota as total_quota,
        COALESCE(SUM(p.quota_used), 0) as monthly_used,
        u.quota - COALESCE(SUM(p.quota_used), 0) as monthly_remaining
      FROM users u
      LEFT JOIN purchases p ON u.id = p.user_id 
        AND p.status = 'active'
        AND p.created_at >= ?
        AND p.created_at < ?
    `
    
    const params = [startDate, endDate]
    
    // 如果选择了公司，按公司筛选
    if (company) {
      sql += ` WHERE u.company LIKE ?`
      params.push(`%${company}%`)
    }
    
    sql += ` GROUP BY u.id ORDER BY u.created_at DESC`
    
    const users = db.prepare(sql).all(...params)
    
    // 计算汇总
    const totalMonthlyUsed = users.reduce((sum, u) => sum + (u.monthly_used || 0), 0)
    
    res.json({
      month,
      users: users.map(u => ({
        ...u,
        monthly_used: u.monthly_used || 0,
        monthly_remaining: Math.max(0, u.monthly_remaining || 0)
      })),
      summary: {
        totalUsers: users.length,
        totalMonthlyUsed
      }
    })
  } catch (error) {
    console.error('获取月度统计错误:', error)
    res.status(500).json({ message: '获取月度统计失败' })
  }
})

// 重置密码
router.post('/:id/reset-password', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = req.params.id
    const db = getDb()

    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    const hashedPassword = bcrypt.hashSync('123456', 10)

    // v1.13.150：管理员重置密码 ⇒ 该用户所有会话立即作废（场景：账号疑似被盗时强制下线）。
    // 两次写（改密码 + bump 版本）⇒ 包事务压成一次落盘。
    db.beginTx()
    try {
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId)
      bumpTokenVersion(db, userId)
      db.commitTx()
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 事务已结束等情况忽略 */ }
      throw e
    }

    res.json({ message: '密码已重置为 123456' })
  } catch (error) {
    console.error('重置密码错误:', error)
    res.status(500).json({ message: '重置密码失败' })
  }
})

export default router
