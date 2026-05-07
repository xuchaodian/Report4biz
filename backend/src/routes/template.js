import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()

// 模板存储目录
const templateDir = join(__dirname, '../../uploads/templates')
if (!fs.existsSync(templateDir)) {
  fs.mkdirSync(templateDir, { recursive: true })
}

// 模板文件名
const TEMPLATE_FILENAME = 'report_template.xlsx'

// multer 配置 - 仅允许 .xlsx 文件
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, templateDir),
  filename: (req, file, cb) => cb(null, TEMPLATE_FILENAME)
})

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext !== '.xlsx') {
      return cb(new Error('仅支持 .xlsx 格式文件'), false)
    }
    cb(null, true)
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
})

// 上传模板（仅管理员）
router.post('/upload', authenticate, requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.message === '仅支持 .xlsx 格式文件') {
        return res.status(400).json({ message: err.message })
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '文件大小不能超过10MB' })
      }
      return res.status(500).json({ message: '上传失败' })
    }

    if (!req.file) {
      return res.status(400).json({ message: '请选择文件' })
    }

    res.json({ message: '模板上传成功' })
  })
})

// 下载模板（用于导出Excel时使用）
router.get('/download', authenticate, (req, res) => {
  const filePath = join(templateDir, TEMPLATE_FILENAME)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: '模板文件不存在，请联系管理员上传' })
  }
  res.download(filePath, TEMPLATE_FILENAME)
})

// 检查模板是否存在
router.get('/status', authenticate, (req, res) => {
  const filePath = join(templateDir, TEMPLATE_FILENAME)
  res.json({ exists: fs.existsSync(filePath) })
})

export default router
