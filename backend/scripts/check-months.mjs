// 临时排查脚本：直接调联通 getCityMonth，复刻后端 /months 逻辑，确认 raw 到底是哪几个月
// 与 smartsteps.js /months 完全一致：getAuthorization 拿 token → GET getCityMonth → 打印原始返回
import { SMARTSTEPS_API_KEY } from '../src/config.js'

const baseUrl = 'https://jm-odp.smartsteps.com/febs'

async function getAuthorization() {
  const url = `${baseUrl}/server/openApi/getAuthorization?key=${SMARTSTEPS_API_KEY}`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  })
  if (!response.ok) {
    throw new Error(`获取Token失败: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  console.log('[getAuthorization] code =', data.code, 'data长度 =', (data.data || '').length)
  if (data.code === 200 && data.data) return data.data
  throw new Error('Token响应异常: ' + JSON.stringify(data))
}

async function main() {
  if (!SMARTSTEPS_API_KEY) { console.error('❌ SMARTSTEPS_API_KEY 为空，无法测试'); process.exit(1) }
  console.log('SMARTSTEPS_API_KEY 已配置，长度 =', SMARTSTEPS_API_KEY.length)
  const token = await getAuthorization()

  const url = `${baseUrl}/server/openApi/getCityMonth`
  console.log('\n>>> GET getCityMonth ...')
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'authorization': token }
  })

  console.log('HTTP status =', response.status)
  const text = await response.text()
  console.log('raw response body =', text)

  let json = null
  try { json = JSON.parse(text) } catch (e) { /* not json */ }

  if (json) {
    console.log('\n=== 解析结果 ===')
    console.log('code =', json.code)
    const rawMonths = Array.isArray(json.data) ? json.data : []
    console.log('data(raw) =', JSON.stringify(rawMonths))
    const months = rawMonths
      .map((m) => {
        const s = String(m).trim()
        const match = s.match(/^(\d{4})[-]?(\d{1,2})$/)
        if (!match) return null
        const year = match[1]
        const monthNum = parseInt(match[2], 10)
        if (monthNum < 1 || monthNum > 12) return null
        return { value: `${year}${String(monthNum).padStart(2, '0')}`, label: `${year}年${monthNum}月` }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.value).localeCompare(String(a.value)))
      .filter((m, i, arr) => i === 0 || m.value !== arr[i - 1].value)
    console.log('months(归一化后) =', JSON.stringify(months))
  }
}

main().catch((e) => {
  console.error('\n❌ 调用失败:', e.message)
  process.exit(1)
})
