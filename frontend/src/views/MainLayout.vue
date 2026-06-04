<template>
  <div class="main-layout">
    <!-- 顶部导航栏 -->
    <header class="header">
      <div class="header-left">
        <img src="@/assets/logo.png" alt="Logo" class="header-logo">
        <h1 class="logo-text">选址赢家Online</h1>
      </div>
      
      <nav class="nav-menu">
        <router-link to="/" class="nav-item" :class="{ active: $route.path === '/' }">
          <el-icon><MapLocation /></el-icon>
          <span>地图</span>
        </router-link>
        <router-link to="/data" class="nav-item" :class="{ active: $route.path === '/data' }">
          <el-icon><DataAnalysis /></el-icon>
          <span>我的门店</span>
        </router-link>
        <router-link to="/competitors" class="nav-item" :class="{ active: $route.path === '/competitors' }">
          <el-icon><DataLine /></el-icon>
          <span>竞品门店</span>
        </router-link>
        <router-link to="/brand-stores" class="nav-item" :class="{ active: $route.path === '/brand-stores' }">
          <el-icon><MapLocation /></el-icon>
          <span>品牌门店</span>
        </router-link>
        <router-link to="/shopping-centers" class="nav-item" :class="{ active: $route.path === '/shopping-centers' }">
          <el-icon><Shop /></el-icon>
          <span>购物中心</span>
        </router-link>
        <router-link to="/shapefiles" class="nav-item" :class="{ active: $route.path === '/shapefiles' }">
          <el-icon><Document /></el-icon>
          <span>统计数据</span>
        </router-link>
        <router-link v-if="userStore.isAdmin" to="/users" class="nav-item" :class="{ active: $route.path === '/users' }">
          <el-icon><User /></el-icon>
          <span>用户</span>
        </router-link>
      </nav>

      <div class="header-right">
        <el-tooltip content="帮助" placement="bottom">
          <el-button class="help-btn" text @click="showHelpDialog">
            <el-icon><QuestionFilled /></el-icon>
          </el-button>
        </el-tooltip>
        <el-dropdown @command="handleCommand">
          <span class="user-info">
            <el-avatar :size="32" :icon="UserFilled" />
            <span class="username">{{ userStore.username }}</span>
            <el-icon class="arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">
                <el-icon><User /></el-icon>个人中心
              </el-dropdown-item>
              <el-dropdown-item command="brands">
                <el-icon><Setting /></el-icon>设置图标
              </el-dropdown-item>
              <el-dropdown-item v-if="userStore.isAdmin" command="template">
                <el-icon><Upload /></el-icon>设置模板
              </el-dropdown-item>
              <el-dropdown-item command="purchase">
                <el-icon><Document /></el-icon>购买履历
              </el-dropdown-item>
              <el-dropdown-item command="logout" divided>
                <el-icon><SwitchButton /></el-icon>退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>
    
    <!-- 主体内容区 -->
    <main class="main-content">
      <router-view />
    </main>

    <!-- 上传模板对话框 -->
    <el-dialog v-model="templateDialogVisible" title="上传Excel报表模板" width="500px">
      <div class="template-upload-tips">
        <p>请上传 .xlsx 格式的Excel报表模板文件，该模板将用于门店购买数据的Excel导出。</p>
        <p style="margin-top:8px;color:#999;font-size:12px;">上传后将覆盖现有模板，建议先下载当前模板备份。</p>
      </div>
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx"
        :on-change="handleTemplateFileChange"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx 格式，最大10MB</div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="templateDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="templateUploading" @click="handleTemplateUpload">确定上传</el-button>
      </template>
    </el-dialog>

    <!-- 帮助对话框 -->
    <el-dialog v-model="helpDialogVisible" title="❓ 帮助中心" width="600px" :close-on-click-modal="false">
      <div class="help-search">
        <el-input
          v-model="helpKeyword"
          placeholder="输入功能关键词，如：添加门店、人口分析、热力图"
          size="large"
          clearable
          @keyup.enter="searchHelp"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
          <template #append>
            <el-button @click="searchHelp" :icon="Search">查询</el-button>
          </template>
        </el-input>
        <div class="help-hot-tags">
          <span class="hot-label">热门：</span>
          <el-tag
            v-for="tag in hotTags" :key="tag"
            size="small"
            class="help-tag"
            @click="helpKeyword = tag; searchHelp()"
          >{{ tag }}</el-tag>
        </div>
      </div>

      <div v-if="helpResults.length > 0" class="help-results">
        <div v-for="(item, idx) in helpResults" :key="idx" class="help-card">
          <div class="help-card-title">
            <el-icon><InfoFilled /></el-icon>
            <span>{{ item.title }}</span>
          </div>
          <div class="help-card-body" v-html="item.content"></div>
        </div>
      </div>
      <div v-else-if="searched" class="help-empty">
        <el-empty description="未找到相关帮助，试试其他关键词" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MapLocation, DataAnalysis, DataLine, Shop, User, UserFilled, SwitchButton, ArrowDown, Setting, Document, Upload, QuestionFilled, Search, InfoFilled } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import axios from 'axios'

const router = useRouter()
const userStore = useUserStore()

// 模板上传
const templateDialogVisible = ref(false)
const templateUploading = ref(false)
const uploadRef = ref(null)
const templateFile = ref(null)

const handleTemplateFileChange = (file) => {
  templateFile.value = file.raw
}

const handleTemplateUpload = async () => {
  if (!templateFile.value) {
    ElMessage.warning('请选择文件')
    return
  }
  templateUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', templateFile.value)
    const { data } = await axios.post('/api/template/upload', formData)
    ElMessage.success(data.message || '模板上传成功')
    templateDialogVisible.value = false
    templateFile.value = null
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '上传失败')
  } finally {
    templateUploading.value = false
  }
}

onMounted(() => {
  userStore.fetchUser()
})

// ====== 帮助中心 ======
const helpDialogVisible = ref(false)
const helpKeyword = ref('')
const helpResults = ref([])
const searched = ref(false)

const hotTags = ['添加门店', '筛选门店', '人口分析', '热力图', '购买履历', '开店余地', '商场商户']

const helpData = [
  {
    keywords: ['添加门店', '新增门店', '创建门店', '门店录入'],
    title: '添加门店',
    content: `
      <ol>
        <li>打开左侧导航栏「<b>地图</b>」页面</li>
        <li>在地图工具栏中点击「<b>添加门店</b>」按钮</li>
        <li>在地图上点击选择门店位置，或直接输入经纬度</li>
        <li>在弹出的表单中填写门店信息（名称、类型、分类、品牌、地址等）</li>
        <li>点击「确定」保存</li>
      </ol>
      <p style="color:#909399;font-size:12px;margin-top:8px;">也可在「<b>我的门店</b>」页面点击「添加门店」按钮批量录入。</p>
    `
  },
  {
    keywords: ['筛选门店', '搜索门店', '过滤门店', '查找门店'],
    title: '筛选门店',
    content: `
      <p>在地图页面或「<b>我的门店</b>」页面，可使用以下方式筛选：</p>
      <ul>
        <li><b>按城市/区县</b>：选择城市和区县下拉框</li>
        <li><b>按门店类型</b>：已开业 / 重点候选 / 一般候选</li>
        <li><b>按门店分类</b>：社区店 / 临街店 / 商场店 / 写字楼店 等</li>
        <li><b>按品牌</b>：选择品牌名称</li>
        <li><b>关键词搜索</b>：输入门店名称或地址关键词</li>
        <li><b>AI 助手</b>：直接对 AI 说「帮我筛选北京的门店」</li>
      </ul>
    `
  },
  {
    keywords: ['竞品门店', '添加竞品', '竞品筛选', '竞品分析'],
    title: '竞品门店管理',
    content: `
      <p><b>添加竞品门店</b>：在「<b>竞品门店</b>」页面点击「添加竞品」按钮，填写品牌和位置信息。</p>
      <p><b>筛选竞品</b>：按城市、区县、品牌进行过滤。</p>
      <p><b>AI 助手</b>：对 AI 说「帮我筛选北京的竞品门店」即可快速筛选。</p>
    `
  },
  {
    keywords: ['品牌门店', '共享门店'],
    title: '品牌门店',
    content: `
      <p>品牌门店是其他用户共享的门店数据，可用于参考和分析。</p>
      <p>在「<b>品牌门店</b>」页面可按城市、品牌、关键词进行筛选。</p>
      <p>在地图页面可通过图层控制显示/隐藏品牌门店图层。</p>
    `
  },
  {
    keywords: ['购物中心', '商场', '商场商户', '餐饮商户', '商户查询'],
    title: '购物中心与商场商户',
    content: `
      <p><b>查看购物中心</b>：在「<b>购物中心</b>」页面查看所有商场列表。</p>
      <p><b>餐饮商户</b>：点击商场名称进入详情，在「<b>餐饮商户</b>」Tab 中查看商户列表，支持：</p>
      <ul>
        <li>按归类（快餐、火锅、日料等）筛选</li>
        <li>按楼层、品牌名称搜索</li>
        <li><b>商户对比</b>：选择2个以上商场，点击「商户对比」查看分类饼图</li>
      </ul>
    `
  },
  {
    keywords: ['商圈分析', '人口分布', '人口分析', '人口数据', '商圈人口'],
    title: '商圈人口分布分析',
    content: `
      <ol>
        <li>在地图页面选中一个<b>门店</b>（我的门店 / 竞品门店均可）</li>
        <li>点击门店弹窗中的「<b>商圈分析</b>」按钮</li>
        <li>设置分析半径（0.5~10公里）</li>
        <li>系统将展示该门店周边的人口分布热力图和统计数据</li>
        <li>可切换查看到访人口、居住人口、工作人口等不同指标</li>
      </ol>
      <p style="color:#909399;font-size:12px;margin-top:8px;">需要已上传 Shapefile 人口数据方可使用。</p>
    `
  },
  {
    keywords: ['人口对比', '门店对比', '对比分析', '对比门店', '对比人口'],
    title: '人口对比分析',
    content: `
      <p><b>人口对比</b>：选择 2~5 家门店，在地图工具栏点击「<b>门店对比</b>」，可对比各门店周边的人口指标。</p>
      <p><b>购买履历对比</b>：在「<b>我的门店</b>」页面选择 2~5 家门店，点击「<b>购买对比</b>」，查看到访、居住、工作人口的对比图表。</p>
      <p><b>AI 助手</b>：对 AI 说「对比门店A和门店B的人口」即可触发。</p>
    `
  },
  {
    keywords: ['门店排名', '排名', '排行'],
    title: '门店排名',
    content: `
      <p>查看全部门店在各人口指标上的排名情况：</p>
      <ol>
        <li>在地图工具栏中点击「<b>门店排名</b>」</li>
        <li>选择要查看的指标：到访人口 / 居住人口 / 工作人口</li>
        <li>系统将分别显示前10名和后10名门店</li>
      </ol>
      <p>也可对 AI 说「门店排名」快速查看。</p>
    `
  },
  {
    keywords: ['开店余地', '开店空间', '适合开店', '选址分析'],
    title: '开店余地分析',
    content: `
      <p>分析某个城市哪些区域还有开店空间：</p>
      <ol>
        <li>在地图工具栏中点击「<b>开店余地</b>」按钮</li>
        <li>选择城市，设置分析半径和门店数量条件</li>
        <li>可添加人口筛选条件（人口数 > / >= 指定值）</li>
        <li>点击「开始分析」，地图上高亮显示符合条件的网格</li>
      </ol>
      <p>也可对 AI 说「帮我看一下上海的开店余地」快速分析。</p>
    `
  },
  {
    keywords: ['热力图', '热力', 'heatmap'],
    title: '热力图',
    content: `
      <p>在地图页面显示门店分布热力图：</p>
      <ol>
        <li>在地图工具栏中点击「<b>热力图</b>」按钮</li>
        <li>地图上将以热力形式展示门店密度分布</li>
        <li>再次点击「热力图」或点击「清除绘制」可关闭</li>
      </ol>
      <p>也可对 AI 说「打开热力图」快速切换。</p>
    `
  },
  {
    keywords: ['聚合', '聚合显示', 'cluster'],
    title: '聚合显示',
    content: `
      <p>当地图上门店过多时，可使用聚合显示：</p>
      <ul>
        <li>在地图工具栏中点击「<b>聚合</b>」按钮</li>
        <li>门店将按距离合并为数字标记，数字越大表示该区域门店越多</li>
        <li>滚动缩放地图时自动重新聚合</li>
        <li>再次点击「聚合」可关闭</li>
      </ul>
    `
  },
  {
    keywords: ['测量', '测量距离', '测量面积', '测距', '测面积'],
    title: '测量工具',
    content: `
      <p><b>测量距离</b>：点击地图工具栏「测量」按钮，在地图上依次点击测距。</p>
      <p><b>测量面积</b>：点击「面积」按钮，在地图上点击围成区域后会自动计算面积。</p>
      <p>双击完成绘制，点击「清除绘制」可清除所有测量结果。</p>
    `
  },
  {
    keywords: ['图层', '图层控制', '显示图层', '隐藏图层'],
    title: '图层控制',
    content: `
      <p>在地图页面可控制各图层的显示与隐藏：</p>
      <ul>
        <li>我的门店图层</li>
        <li>竞品门店图层</li>
        <li>品牌门店图层</li>
        <li>购物中心图层</li>
        <li>Shapefile 人口数据图层</li>
      </ul>
      <p>也可对 AI 说「隐藏竞品门店图层」进行控制。</p>
    `
  },
  {
    keywords: ['POI', '搜索周边', '周边搜索', '附近', '周边', '查找附近'],
    title: 'POI 周边搜索',
    content: `
      <p>在地图页面搜索指定位置周边的商户/设施：</p>
      <ol>
        <li>在地图工具栏中点击「<b>周边搜索</b>」</li>
        <li>在地图上点击选择中心点位置</li>
        <li>输入搜索关键词（如：咖啡厅、餐厅、超市）</li>
        <li>设置搜索半径</li>
        <li>搜索结果将在地图上标记显示</li>
      </ol>
      <p>也可对 AI 说「上海闵行浦江欢乐颂周边2公里内有什么咖啡厅」快速搜索。</p>
    `
  },
  {
    keywords: ['AI助手', '智能助手', 'AI', '人工智能'],
    title: 'AI 助手',
    content: `
      <p>AI 助手支持通过自然语言操作地图和管理数据：</p>
      <p><b>支持的操作：</b></p>
      <ul>
        <li>🗺️ 地图操作：定位城市、筛选门店、图层控制、激活工具</li>
        <li>🔍 POI 搜索：周边搜索、关键词搜索</li>
        <li>📊 商圈分析：人口分布、人口对比、门店对比、排名</li>
        <li>🏙️ 城市数据：查询城市 GDP、人口、收入等统计数据</li>
        <li>🏬 商场商户：查询商户列表、对比商户构成</li>
        <li>📍 开店余地：分析城市开店空间</li>
      </ul>
      <p style="color:#E6A23C;font-size:12px;">⚠️ AI 助手消耗月度 token 配额，高消耗查询建议自行在页面操作。</p>
    `
  },
  {
    keywords: ['统计数据', 'shapefile', '上传数据', '人口数据上传'],
    title: '统计数据（Shapefile）',
    content: `
      <p>上传和管理人口统计数据：</p>
      <ul>
        <li><b>常住人口</b>：上传七普人口 Shapefile（WGS84 坐标，系统自动转为 GCJ-02）</li>
        <li><b>城市商圈</b>：上传城市商圈 Shapefile（使用高德坐标系）</li>
        <li><b>城市宏观数据</b>：查看全国30重点城市的 GDP、人口、收入等统计数据</li>
      </ul>
      <p>在「<b>统计数据</b>」页面上传和管理。</p>
    `
  },
  {
    keywords: ['购买履历', '采购记录', '历史购买', '购买记录'],
    title: '购买履历',
    content: `
      <p>查看联通人口数据的购买和使用记录：</p>
      <ul>
        <li>点击右上角用户头像 → 「<b>购买履历</b>」</li>
        <li>或在「<b>个人中心</b>」页面点击「购买履历」按钮</li>
        <li>可按门店名称、门店类型、城市、区县、半径、数据年月筛选</li>
      </ul>
    `
  },
  {
    keywords: ['个人中心', '账户', '账号', '配额', '充值', '剩余次数'],
    title: '个人中心 / 配额管理',
    content: `
      <p>在「<b>个人中心</b>」（右上角头像 → 个人中心）可查看：</p>
      <ul>
        <li><b>联通人口数据配额</b>：剩余查询次数、已使用次数</li>
        <li><b>充值</b>：配额不足时点击「充值」联系采购</li>
        <li><b>购买履历</b>：查看历史购买记录</li>
        <li><b>个人资料</b>：修改个人信息</li>
      </ul>
    `
  },
  {
    keywords: ['品牌图标', '设置图标', '图标'],
    title: '品牌图标设置',
    content: `
      <p>在地图上为各品牌门店设置显示图标：</p>
      <ol>
        <li>点击右上角用户头像 → 「<b>设置图标</b>」</li>
        <li>或在导航栏打开「<b>品牌图标</b>」页面</li>
        <li>可为每个品牌上传自定义图标</li>
      </ol>
    `
  },
  {
    keywords: ['导出', '导出数据', '导出Excel', '报表'],
    title: '数据导出',
    content: `
      <p>在「<b>我的门店</b>」页面：</p>
      <ul>
        <li>点击「<b>导出 Excel</b>」可将当前筛选的门店数据导出为 Excel 文件</li>
        <li>包含门店名称、地址、经纬度、类型、分类、品牌等信息</li>
      </ul>
    `
  }
]

const showHelpDialog = () => {
  helpKeyword.value = ''
  helpResults.value = []
  searched.value = false
  helpDialogVisible.value = true
}

const searchHelp = () => {
  const kw = helpKeyword.value.trim().toLowerCase()
  if (!kw) {
    ElMessage.warning('请输入关键词')
    return
  }
  searched.value = true
  helpResults.value = helpData.filter(item =>
    item.keywords.some(k => k.toLowerCase().includes(kw) || kw.includes(k.toLowerCase()))
  )
}

const handleCommand = async (command) => {
  if (command === 'profile') {
    router.push('/account')
  } else if (command === 'brands') {
    router.push('/brands')
  } else if (command === 'template') {
    templateDialogVisible.value = true
  } else if (command === 'purchase') {
    // 跳转到个人中心并自动打开购买履历
    router.push('/account?openHistory=true')
  } else if (command === 'logout') {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      type: 'warning'
    })
    userStore.logout()
    router.push('/login')
  }
}
</script>

<style lang="scss" scoped>
.main-layout {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  height: var(--header-height);
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  padding: 0 20px;
  z-index: 100;
  
  .header-left {
    width: var(--sidebar-width);
    display: flex;
    align-items: center;
    
    .logo-text {
      font-size: 14px;
      font-weight: 600;
      color: #333;
      white-space: nowrap;
    }
  }
  
  .nav-menu {
    flex: 1;
    display: flex;
    gap: 10px;
    
    .nav-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      color: #666;
      font-size: 14px;
      transition: all 0.3s;
      
      &:hover {
        background: #f5f7fa;
        color: #409eff;
      }
      
      &.active {
        background: #ecf5ff;
        color: #409eff;
      }
    }
  }
  
  .header-right {
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      
      &:hover {
        background: #f5f7fa;
      }
      
      .username {
        font-size: 14px;
        color: #333;
      }
      
      .arrow {
        font-size: 12px;
        color: #999;
      }
    }
  }
}

.main-content {
  flex: 1;
  overflow: hidden;
}

.template-upload-tips {
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;
  p { margin: 0; font-size: 14px; color: #666; }
}

.help-btn {
  font-size: 18px;
  margin-right: 4px;
  color: #909399;
  &:hover { color: #409eff; }
}

.help-search {
  margin-bottom: 16px;
}

.help-hot-tags {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  .hot-label {
    font-size: 12px;
    color: #909399;
    white-space: nowrap;
  }
  .help-tag {
    cursor: pointer;
    &:hover { opacity: 0.8; }
  }
}

.help-results {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 420px;
  overflow-y: auto;
}

.help-card {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fafafa;
}

.help-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}

.help-card-body {
  font-size: 13px;
  line-height: 1.8;
  color: #606266;
  ol, ul { padding-left: 20px; margin: 6px 0; }
  li { margin-bottom: 4px; }
}

.help-empty {
  padding: 40px 0;
}
</style>
