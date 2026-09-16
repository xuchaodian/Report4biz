#!/usr/bin/env bash
#
# 把 shapefiles.geojson 外置成文件（v1.13.143 库瘦身）
#
# 为什么：shapefiles 表 42 行的 geojson 原文合计 133MB，占主库 166MB 的 ~89%，
# 且是写完就不再变的静态数据。sql.js 每次落盘都要「整库导出」，于是改一个用户
# 也要搬运 166MB ⇒ 小内存机器触发内核 compaction 卡死整机（v1.13.142 事故）。
# 外置后主库降到 ~20MB，搬运量降 ~88%。
#
# 存储契约（详见 backend/src/models/geoStore.js）：
#   文件路径 <geo目录>/<id>.geojson（UTF-8 明文）= 唯一真源
#   主库 shapefiles.geojson 恒为 ''（该列是 TEXT NOT NULL，不能置 NULL）
#
# 用法：
#   externalize-shapefile-geojson.sh export <db路径> <geo目录>   # 执行迁移
#   externalize-shapefile-geojson.sh verify <db路径> <geo目录>   # 只校验，不改库
#
# 特性：
#   · 用 sqlite3 CLI 的 writefile()/readfile() 做**逐字节**导出与校验，
#     不经过任何语言运行时，避免编码/转义改造数据
#   · 幂等：只处理 length(geojson) > 0 的行，重复执行不会破坏已外置的数据
#   · VACUUM 不可省 —— 否则文件仍然 166MB，写放大照旧
#
set -euo pipefail

MODE="${1:-}"
DB="${2:-}"
GEO_DIR="${3:-}"

if [[ -z "$MODE" || -z "$DB" || -z "$GEO_DIR" ]]; then
  echo "用法: $0 export|verify <db路径> <geo目录>" >&2
  exit 2
fi
if [[ ! -f "$DB" ]]; then
  echo "[FATAL] 库不存在: $DB" >&2
  exit 2
fi
command -v sqlite3 >/dev/null || { echo "[FATAL] 找不到 sqlite3" >&2; exit 2; }

log() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "────────────────────────────────────────"; }

db_bytes() { wc -c < "$DB" | tr -d ' '; }
human() { awk -v b="$1" 'BEGIN{ if(b>=1048576) printf "%.1fMB", b/1048576; else if(b>=1024) printf "%.1fKB", b/1024; else printf "%dB", b }'; }

# 逐行取 shapefile id
get_ids() {
  sqlite3 -readonly "$DB" "SELECT id FROM shapefiles ORDER BY id;"
}
count_rows() {
  sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM shapefiles;"
}
count_with_geo() {
  sqlite3 -readonly "$DB" "SELECT COUNT(*) FROM shapefiles WHERE length(geojson) > 0;"
}

# ── 校验：三件事都必须成立 ───────────────────────────────────────────
#   ① 文件存在，且字节数 == 原文（有备份库就比备份库，否则比主库当前列）
#   ② 每个文件再读回来，与备份库里的原文**逐字节**相同
#   ③ 主库列已全部清空
do_verify() {
  local backup="${BACKUP_DB:-}"
  local ref_db="$DB" ref_note="主库当前列"
  if [[ -n "$backup" && -f "$backup" ]]; then
    ref_db="$backup"; ref_note="备份库原文($backup)"
  fi

  hr
  if [[ -z "$backup" || ! -f "$backup" ]]; then
    log "① 文件存在性检查（未提供备份库 ⇒ 无法比对字节数；要严格校验请传 BACKUP_DB=<原库>）"
    local miss=0
    while read -r id; do
      [[ -z "$id" ]] && continue
      [[ -f "$GEO_DIR/$id.geojson" ]] || { log "  [缺失] id=$id"; miss=$((miss+1)); }
    done < <(get_ids)
    log "  结果: 缺失=$miss"
  else
    log "① 文件存在性 + 字节数比对（对照：${ref_note}）"
    local bad=0 missing=0 id p fbytes cbytes
    while read -r id; do
      [[ -z "$id" ]] && continue
      p="$GEO_DIR/$id.geojson"
      if [[ ! -f "$p" ]]; then log "  [缺失] id=$id -> $p"; missing=$((missing+1)); continue; fi
      fbytes=$(wc -c < "$p" | tr -d ' ')
      cbytes=$(sqlite3 -readonly "$ref_db" "SELECT COALESCE(length(CAST(geojson AS BLOB)),0) FROM shapefiles WHERE id=$id;")
      if [[ "$fbytes" != "$cbytes" ]]; then
        log "  [字节数不符] id=$id 文件=$fbytes 原文=$cbytes"; bad=$((bad+1))
      fi
    done < <(get_ids)
    log "  结果: 缺失=$missing 字节数不符=$bad"
  fi

  if [[ -n "$backup" && -f "$backup" ]]; then
    hr
    log "② 逐字节回读比对（readfile vs 备份库原文）—— 期望 mismatch=0"
    local m
    m=$(sqlite3 -readonly "$DB" "
      ATTACH '$backup' AS orig;
      SELECT COUNT(*) FROM orig.shapefiles o
       WHERE readfile(rtrim('$GEO_DIR','/') || '/' || o.id || '.geojson') IS NOT CAST(o.geojson AS BLOB);
    ")
    log "  mismatch = $m"
    [[ "$m" == "0" ]] || { log "  [FATAL] 存在逐字节不一致的行"; return 1; }
  else
    hr
    log "② 跳过逐字节比对（未提供备份库）—— 纯 verify 模式建议传 BACKUP_DB=<原库>"
  fi

  hr
  log "③ 主库列是否已清空 + 完整性"
  log "  行数            = $(count_rows)"
  log "  geojson 非空行数 = $(count_with_geo)   (外置完成后期望 0)"
  log "  integrity_check = $(sqlite3 -readonly "$DB" 'PRAGMA integrity_check;')"
  log "  残留 .tmp       = $(ls "$DB".tmp 2>/dev/null || echo none)"
}

case "$MODE" in
  verify)
    do_verify
    ;;

  export)
    mkdir -p "$GEO_DIR"
    before=$(db_bytes)
    log "库      : $DB ($(human "$before"))"
    log "geo 目录: $GEO_DIR"
    log "待外置  : $(count_with_geo) / $(count_rows) 行"
    hr

    # 校验备份库：必须在清空主库列之前先备份一份（供逐字节比对 + 回滚）
    BACKUP_DB="${BACKUP_DB:-}"
    if [[ -z "$BACKUP_DB" ]]; then
      BACKUP_DB="$(dirname "$DB")/externalize_pre_$(date +%Y%m%d_%H%M%S).db"
      cp -p "$DB" "$BACKUP_DB"
      log "已备份原始库 -> $BACKUP_DB ($(human "$(wc -c < "$BACKUP_DB" | tr -d ' ')"))"
      hr
    fi

    log "STEP 1/4  导出 geojson 到文件（writefile，逐字节）"
    sqlite3 "$DB" "
      SELECT writefile(rtrim('$GEO_DIR','/') || '/' || id || '.geojson', geojson)
        FROM shapefiles WHERE length(geojson) > 0;
    " >/dev/null
    log "  已写出 $(ls -1 "$GEO_DIR" | wc -l | tr -d ' ') 个文件，合计 $(human "$(du -sk "$GEO_DIR" | awk '{print $1*1024}')")"

    log "STEP 2/4  逐字节回读校验（不通过则中止，不改主库）"
    mismatch=$(sqlite3 "$DB" "
      ATTACH '$BACKUP_DB' AS orig;
      SELECT COUNT(*) FROM orig.shapefiles o
       WHERE readfile(rtrim('$GEO_DIR','/') || '/' || o.id || '.geojson') IS NOT CAST(o.geojson AS BLOB);
    ")
    log "  mismatch = $mismatch  (期望 0)"
    if [[ "$mismatch" != "0" ]]; then
      log "[FATAL] 校验失败，主库未改动。请检查磁盘/路径后重试。"
      exit 1
    fi

    log "STEP 3/4  主库 geojson 置空占位"
    sqlite3 "$DB" "UPDATE shapefiles SET geojson = '';"

    log "STEP 4/4  VACUUM 回收空洞（不可省）"
    # temp_store=FILE：VACUUM 要重建整库，强制走临时文件而非内存
    # （服务器只有 1.6GB，曾经因高阶内存分配触发内核 compaction 卡死整机）
    sqlite3 "$DB" "PRAGMA temp_store=FILE; VACUUM;"

    after=$(db_bytes)
    hr
    log "瘦身结果: $(human "$before") -> $(human "$after")  （省了 $(human $((before-after)))，$(( (before-after)*100/before ))%）"
    hr
    do_verify
    hr
    log "完成。回滚方式：cp '$BACKUP_DB' '$DB'  （需先 pm2 stop webgis-backend）"
    ;;

  *)
    echo "未知模式: ${MODE}（只支持 export / verify）" >&2
    exit 2
    ;;
esac
