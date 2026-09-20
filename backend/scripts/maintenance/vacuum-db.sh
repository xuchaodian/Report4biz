#!/usr/bin/env bash
# ============================================================================
# Report4biz 数据库空闲页回收（VACUUM）维护脚本
# ----------------------------------------------------------------------------
# 【为什么需要】
#   SQLite 删除行只把页放进 freelist（可复用链表），文件尺寸原地不动。
#   长期「只删不整理」，空洞会持续累积。
#   2026-09-20 线上实测：page_size=4096 page_count=2087 freelist_count=292
#   ⇒ 空洞 1.14MB，占文件 14.0%；VACUUM 后文件缩小 15.1%。
#
# 【为什么必须先停 pm2】
#   后端用 sql.js：整库常驻内存，每个写请求都会把内存态整库导出、覆盖磁盘文件。
#   运行中直接改磁盘库 ⇒ 下一次写入就把它覆盖回去（VACUUM 白做），
#   还可能读到半写状态。所以顺序必须是：停 → 回收 → 启。
#   （已确认 forecast-server 不访问本库，故只停 webgis-backend。）
#
# 【安全设计（任一步失败都不会留下坏状态）】
#   1) 默认只在 freelist 占比 >= 阈值时才动手（默认 10%），否则直接退出
#   2) 用 VACUUM INTO 生成新文件；原文件在全部校验通过前保持不动
#   3) 替换前备份磁盘库，并做 integrity_check + 全表行数一致性比对
#   4) 任何非正常退出都由 trap 兜底把 pm2 启回来
#   5) --check / --dry-run 只读，绝不改动任何东西，可随时执行
#
# 【用法】
#   vacuum-db.sh --check                 # 只报告当前空洞（只读）
#   vacuum-db.sh                         # 按阈值判断后执行
#   vacuum-db.sh --force                 # 忽略阈值强制执行
#   vacuum-db.sh --min-freelist-pct 5    # 自定义阈值（默认 10）
#   vacuum-db.sh --keep-backups 5        # 保留最近 N 份 vacuum 前备份（默认 3）
#
# 【可覆盖的环境变量（便于预发/本地复用）】
#   R4B_DB / R4B_PM2_APP / R4B_HEALTH_URL / R4B_VACUUM_BACKUP_DIR
#   R4B_MAINT_LOG_DIR / R4B_KEEP_BACKUPS / R4B_MIN_FREELIST_PCT
# ============================================================================
set -euo pipefail

DB="${R4B_DB:-/var/www/Report4biz/backend/database/webgis.db}"
PM2_APP="${R4B_PM2_APP:-webgis-backend}"
HEALTH_URL="${R4B_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
BACKUP_DIR="${R4B_VACUUM_BACKUP_DIR:-/root/Report4biz_backups/vacuum}"
LOG_DIR="${R4B_MAINT_LOG_DIR:-/root/Report4biz_maintenance/logs}"
MIN_FREELIST_PCT="${R4B_MIN_FREELIST_PCT:-10}"
KEEP_BACKUPS="${R4B_KEEP_BACKUPS:-3}"

MODE=run
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check|--dry-run)  MODE=check ;;
    --force)            FORCE=1 ;;
    --min-freelist-pct) MIN_FREELIST_PCT="${2:?缺少数值}"; shift ;;
    --keep-backups)     KEEP_BACKUPS="${2:?缺少数值}"; shift ;;
    -h|--help)
      awk 'NR==1{next} /^# =====/{if(c++)exit} {print}' "$0"
      exit 0 ;;
    *) echo "未知参数: $1（用 -h 看用法）" >&2; exit 2 ;;
  esac
  shift
done

TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG_DIR" "$BACKUP_DIR"
LOG="$LOG_DIR/vacuum_${TS}.log"

log()   { printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
die()   { log "❌ $*"; exit 1; }
hsize() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1} bytes"; }
diskinfo() { df -h / | awk 'NR==2{print $3" 已用 / "$2" 总，剩余 "$4}'; }

APP_TOUCHED=0
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$APP_TOUCHED" = "1" ]; then
    log "↩️  异常退出，兜底恢复 $PM2_APP"
    pm2 start "$PM2_APP" >/dev/null 2>&1 || log "⚠️ 兜底启动也失败，请人工执行: pm2 start $PM2_APP"
  fi
  exit "$rc"
}
trap on_exit EXIT

# ------------------------------------------------------------------ 0. 只读预检
command -v sqlite3 >/dev/null 2>&1 || die "缺少 sqlite3 命令"
command -v pm2     >/dev/null 2>&1 || die "缺少 pm2 命令"
[ -f "$DB" ] || die "找不到数据库: $DB"

SIZE_BEFORE=$(stat -c %s "$DB")
PAGE_SIZE=$(sqlite3 "$DB" 'PRAGMA page_size;')
PAGE_COUNT=$(sqlite3 "$DB" 'PRAGMA page_count;')
FREELIST=$(sqlite3 "$DB" 'PRAGMA freelist_count;')
FREE_BYTES=$(( FREELIST * PAGE_SIZE ))
FREE_PCT=$(awk -v f="$FREELIST" -v p="$PAGE_COUNT" 'BEGIN{ printf "%.2f", (p>0 ? f*100/p : 0) }')
GE_THRESHOLD=0
awk -v p="$FREE_PCT" -v t="$MIN_FREELIST_PCT" 'BEGIN{exit !(p+0>=t+0)}' && GE_THRESHOLD=1

log "==================== VACUUM 维护 $TS（模式 $MODE）===================="
log "库: $DB"
log "文件: $(hsize "$SIZE_BEFORE")（$SIZE_BEFORE 字节）"
log "page_size=$PAGE_SIZE  page_count=$PAGE_COUNT  freelist=$FREELIST"
log "空闲页: $(hsize "$FREE_BYTES")（占文件 ${FREE_PCT}%）"
log "阈值: ${MIN_FREELIST_PCT}%   保留备份: ${KEEP_BACKUPS} 份   磁盘: $(diskinfo)"

if [ "$MODE" = "check" ]; then
  log "（--check 只读模式，不做任何改动）"
  if [ "$GE_THRESHOLD" = "1" ]; then
    log "结论: 空洞占比 ${FREE_PCT}% ≥ 阈值 ⇒ 建议回收，预计可拿回约 $(hsize "$FREE_BYTES")"
  else
    log "结论: 空洞占比 ${FREE_PCT}% < 阈值 ⇒ 暂无需回收"
  fi
  exit 0
fi

if [ "$GE_THRESHOLD" != "1" ] && [ "$FORCE" != "1" ]; then
  log "空洞占比 ${FREE_PCT}% < 阈值 ${MIN_FREELIST_PCT}%，跳过（脚本幂等，可安全定时调用）"
  exit 0
fi

# ------------------------------------------------------------------ 1. 停 pm2（sql.js 内存态问题）
PID_BEFORE=$(pm2 pid "$PM2_APP" 2>/dev/null | tr -d '[:space:]' || true)
WAS_RUNNING=0
if [ -n "$PID_BEFORE" ] && [ "$PID_BEFORE" != "0" ]; then WAS_RUNNING=1; fi
log "当前 $PM2_APP pid=${PID_BEFORE:-未知}（$([ "$WAS_RUNNING" = 1 ] && echo 运行中 || echo 未运行)）"

if [ "$WAS_RUNNING" = "1" ]; then
  log "停止 $PM2_APP ..."
  pm2 stop "$PM2_APP" >/dev/null 2>&1 || die "pm2 stop 失败（库未改动）"
  APP_TOUCHED=1
  p=""
  for _ in $(seq 1 30); do
    p=$(pm2 pid "$PM2_APP" 2>/dev/null | tr -d '[:space:]')
    [ "$p" = "0" ] && break
    sleep 1
  done
  [ "$p" = "0" ] || die "进程未停止（pid=$p），已放弃（库未改动）"
  log "已停止（pid=0）"
else
  log "⚠️ 应用当前未运行，跳过停止步骤（仍会备份与回收）"
fi

# ------------------------------------------------------------------ 2. 备份（此时库已静止）
mkdir -p "$BACKUP_DIR"
BAK="$BACKUP_DIR/webgis.db.pre_vacuum_${TS}"
log "备份 → $BAK"
cp -p "$DB" "$BAK" || die "备份失败（库未改动）"
[ "$(stat -c %s "$BAK")" = "$SIZE_BEFORE" ] || die "备份尺寸不一致（库未改动）"
sqlite3 "$BAK" 'PRAGMA integrity_check;' | head -1 | grep -qx 'ok' || die "备份完整性校验未通过（库未改动）"
log "备份校验通过 md5=$(md5sum "$BAK" | cut -d' ' -f1)"

# ------------------------------------------------------------------ 3. VACUUM INTO（原库保持不动）
TMP="${DB}.vacuum_${TS}.tmp"
rm -f "$TMP"
log "执行 VACUUM INTO → $TMP"
nice -n 10 sqlite3 "$DB" "PRAGMA temp_store=FILE; VACUUM INTO '$TMP';" \
  || die "VACUUM INTO 失败（原库未改动）"

NEW_SIZE=$(stat -c %s "$TMP")
NEW_PAGES=$(sqlite3 "$TMP" 'PRAGMA page_count;')
NEW_FREE=$(sqlite3 "$TMP" 'PRAGMA freelist_count;')
sqlite3 "$TMP" 'PRAGMA integrity_check;' | head -1 | grep -qx 'ok' || die "新库完整性校验未通过（原库未改动）"

table_counts() {
  sqlite3 "$1" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;" \
  | while IFS= read -r t; do
      [ -z "$t" ] && continue
      printf '%s=%s\n' "$t" "$(sqlite3 "$1" "SELECT COUNT(*) FROM \"$t\";")"
    done
}
DIFF_FILE="$LOG_DIR/.counts_diff.$$"
if ! diff <(table_counts "$BAK") <(table_counts "$TMP") > "$DIFF_FILE" 2>&1; then
  log "⚠️ 表行数差异（最多显示 20 行）:"
  sed -n '1,20p' "$DIFF_FILE" | tee -a "$LOG"
  rm -f "$DIFF_FILE" "$TMP"
  die "新库与备份表行数不一致，已放弃替换（原库未改动）"
fi
rm -f "$DIFF_FILE"
log "表行数一致性校验通过（$(table_counts "$TMP" | wc -l | tr -d ' ') 张表）"
log "新库: $(hsize "$NEW_SIZE")  page_count=$NEW_PAGES  freelist=$NEW_FREE"

# ------------------------------------------------------------------ 4. 替换
chmod --reference="$DB" "$TMP" 2>/dev/null || true
chown --reference="$DB" "$TMP" 2>/dev/null || true
mv -f "$TMP" "$DB" || die "替换失败（备份在 $BAK）"
SIZE_AFTER=$(stat -c %s "$DB")
RECLAIMED=$(( SIZE_BEFORE - SIZE_AFTER ))
log "已替换磁盘库: $(hsize "$SIZE_BEFORE") → $(hsize "$SIZE_AFTER")，回收 $(hsize "$RECLAIMED")（$(awk -v a="$RECLAIMED" -v b="$SIZE_BEFORE" 'BEGIN{printf "%.1f", (b>0? a*100/b : 0)}')%）"

# ------------------------------------------------------------------ 5. 启 pm2 + 健康检查
if [ "$WAS_RUNNING" = "1" ]; then
  log "启动 $PM2_APP ..."
  pm2 start "$PM2_APP" >/dev/null 2>&1 || die "pm2 start 失败！请立刻手工执行: pm2 start $PM2_APP"
  ok=0
  for _ in $(seq 1 20); do
    if curl -fsS --noproxy '*' --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = "1" ] || die "健康检查未通过（$HEALTH_URL）！备份在 $BACKUP_DIR，请人工介入"
  APP_TOUCHED=0
  log "✅ 服务已恢复，健康检查通过（$HEALTH_URL）"
else
  log "应用原本未运行，保持不启动"
fi

# ------------------------------------------------------------------ 6. 清理旧备份
n=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  n=$((n+1))
  [ "$n" -le "$KEEP_BACKUPS" ] && continue
  log "清理旧备份: $f"
  rm -f "$f"
done < <(ls -1t "$BACKUP_DIR"/webgis.db.pre_vacuum_* 2>/dev/null || true)
log "备份目录（保留最近 ${KEEP_BACKUPS} 份）:"
for f in $(ls -1t "$BACKUP_DIR"/webgis.db.pre_vacuum_* 2>/dev/null | head -n "$KEEP_BACKUPS" || true); do
  log "    $f"
done

log "磁盘: $(diskinfo)"
log "✅ 完成（日志: $LOG）"
