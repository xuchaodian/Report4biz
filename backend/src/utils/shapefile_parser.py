#!/usr/bin/env python3
"""
Shapefile 解析和坐标系转换工具
WGS84 -> GCJ-02 (火星坐标系/高德坐标)

支持编码: UTF-8, GBK, GB2312, GB18030, Latin-1
"""

import math
import json
import sys
import io
import warnings
import zipfile
import os
import tempfile
import shapefile

# pyshp ≥3.1 会自行读 .cpg，并与我们显式传入的 encoding 比对，不一致就 warn
# （实测 250m 网格：cpg 写 gb2312，而候选链要先试 utf-8 ⇒ 每次上传打两行警告）。
# 但「显式指定编码」是本脚本的**刻意设计**（cpg 不可信，见下方 DBF_ENCODING_CANDIDATES
# 的说明：编码必须靠「多候选 + 全量解码校验」来定），所以这条警告属预期噪音，压掉。
warnings.filterwarnings('ignore', message=r'.*different to encoding read from .*\.cpg file')


# 支持的编码列表，按优先级尝试
ENCODINGS = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'latin-1']

# DBF 读取时逐个尝试的编码候选（顺序不可随意调整）
# 🔴 utf-8 必须排在 gb18030 / gbk 之前：
#   - utf-8 是自校验编码，遇到非 utf-8 字节必然解码失败 ⇒ 会正确回退到 GB 系；
#   - 反之 gb18030 字符集极宽，能把 utf-8 中文的 3 字节序列「重新配对」成合法序列，
#     解成功后就锁定该编码 ⇒ 字段名变乱码（名称 -> 鍚嶇О）、属性值取不到，
#     且全程不报错；而商圈搜索是按字段名精确匹配的（routes/shapefiles.js），
#     一处乱码会直接导致商圈搜索失效。
#   实测：utf-8 数据在旧顺序下 20 个真实地名只有 3 个正确、17 个静默乱码。
DBF_ENCODING_CANDIDATES = ['utf-8', 'gb18030', 'gbk']

# 坐标转换开关：默认转换 WGS84→GCJ-02，设为 True 则跳过
SKIP_COORD_CONVERT = False

# 落盘坐标保留小数位（v1.13.276）
# 理由：新商圈数据的源 SHP 是**满精度 double**（形如 121.8912957962747），
#   不裁位会让单城 geojson 从 561KB 涨到 837KB（+49%），而 1e-6° 已约等于 0.1m，
#   远小于商圈边界的实际精度。存量 16 城产物本身就是 6 位小数，这里与之对齐。
COORD_DECIMALS = 6


def try_decode(value, encodings=None):
    """尝试用多种编码解码字符串"""
    if encodings is None:
        encodings = ENCODINGS
    if isinstance(value, bytes):
        # 检查是否是有效的 UTF-8
        try:
            return value.decode('utf-8')
        except UnicodeDecodeError:
            pass
        
        # 尝试 GBK/GB18030（中文 Windows 常用）
        for enc in ['gb18030', 'gbk', 'gb2312']:
            try:
                return value.decode(enc)
            except (UnicodeDecodeError, LookupError):
                continue
        
        # 最后尝试 latin-1（pyshp 默认编码）
        try:
            return value.decode('latin-1')
        except:
            pass
        
        # 最最后，忽略错误
        return value.decode('utf-8', errors='ignore')
    elif isinstance(value, str):
        return value
    return str(value)


def try_decode_field_name(name):
    """专门处理字段名的解码"""
    if isinstance(name, bytes):
        # 先尝试用 UTF-8 解码
        try:
            return name.decode('utf-8')
        except UnicodeDecodeError:
            pass
        
        # 尝试 GB18030（国家标准，支持中文）
        try:
            return name.decode('gb18030')
        except (UnicodeDecodeError, LookupError):
            pass
        
        # 尝试 GBK
        try:
            return name.decode('gbk')
        except (UnicodeDecodeError, LookupError):
            pass
        
        # 最后用 latin-1
        return name.decode('latin-1', errors='ignore')
    return str(name)


def open_shapefile_with_best_encoding(shp_path):
    """按 DBF_ENCODING_CANDIDATES 逐个尝试打开 Shapefile

    返回 (reader, last_error)：全部失败时 reader 为 None。

    🔴 校验必须「全量」，不能只试 record(0)：
    旧实现只读第一条记录，会漏掉「字段名与首条记录都是 ASCII、后续记录才含中文」
    的文件 —— 那种文件在 utf-8 优先时会被误选为 utf-8，随后在第 N 条记录抛异常，
    整包解析失败（比乱码更糟：用户直接看到上传报错）。
    """
    last_error = None
    for dbf_encoding in DBF_ENCODING_CANDIDATES:
        try:
            sf = shapefile.Reader(shp_path, encoding=dbf_encoding)
            # 触发字段名解码
            _ = [field_info[0] for field_info in sf.fields]
            # 触发全部属性值解码（任一条失败即视为该编码不可用）
            for _record in sf.iterRecords():
                pass
            return sf, None
        except Exception as e:
            # pyshp 抛的是 ShapefileException(dbfFileException) 而非 UnicodeDecodeError，
            # 故这里必须兜住 Exception
            last_error = e
            continue
    return None, last_error


# WGS84 to GCJ-02 转换算法
def wgs84_to_gcj02(lng, lat):
    """将 WGS84 坐标转换为 GCJ-02 坐标"""
    a = 6378245.0  # 长半轴
    ee = 0.00669342162296594323  # 扁率

    def transform(lng, lat):
        dlat = _transform_lat(lng - 105.0, lat - 35.0)
        dlng = _transform_lng(lng - 105.0, lat - 35.0)
        radlat = lat / 180.0 * math.pi
        magic = math.sin(radlat)
        magic = 1 - ee * magic * magic
        sqrtmagic = math.sqrt(magic)
        dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * math.pi)
        dlng = (dlng * 180.0) / (a / sqrtmagic * math.cos(radlat) * math.pi)
        return lng + dlng, lat + dlat

    def _transform_lat(x, y):
        ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
        ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
        return ret

    def _transform_lng(x, y):
        ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
        ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
        return ret

    return transform(lng, lat)


def _ring_signed_area(ring):
    """鞋带公式（带符号）：用于按面积降序排环，符号不参与判断（SHP 的环方向在
    各家导出工具里并不统一，靠方向区分外环/内洞并不可靠）。"""
    s = 0.0
    for i in range(len(ring) - 1):
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return s / 2.0


def _point_in_ring(pt, ring):
    """射线法（环已闭合，首尾点相同）"""
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def assemble_polygon(rings):
    """把 SHP 的多 part 组装成 GeoJSON Polygon / MultiPolygon。

    🔴 为什么必须做（v1.13.276）：
      SHP 一个要素的 parts **既可能是「一个面 + 若干内洞」，也可能是互不相连的多个面**。
      实测新商圈数据（20 城 2394 要素）：多环要素 178 个附加环里 **172 个是分离面、
      只有 6 个是内洞**。旧实现把所有 part 一律塞进 `Polygon.coordinates` —— 按 GeoJSON
      语义除第 0 环外**全部被当成洞** ⇒ Leaflet 与各消费方会把分离面渲染成「挖空」，
      面积、点位落圈、竞品计数全部失真，而且不报错。

    判据（不依赖环方向）：按 |面积| 降序，逐环统计「被几个已落位的环包含」= 嵌套深度。
      · 深度 0 ⇒ 独立外环（新多边形）
      · 深度奇 ⇒ 内洞，归入包含它的**最小**环
      · 深度偶 ⇒ 洞中之岛，独立外环
    单环要素走快路径直接返回，**不做任何 PIP** —— 人口网格（10 万级要素）逐要素跑
    包含判定会白烧 CPU，且产物与旧实现逐字节一致。
    """
    if len(rings) <= 1:
        return ('Polygon', rings)

    placed = []   # [{'ring': ring, 'holes': [ring, ...]}]
    for ring in sorted(rings, key=lambda r: abs(_ring_signed_area(r)), reverse=True):
        containers = [p for p in placed if _point_in_ring(ring[0], p['ring'])]
        if len(containers) % 2 == 1:
            parent = min(containers, key=lambda p: abs(_ring_signed_area(p['ring'])))
            parent['holes'].append(ring)
        else:
            placed.append({'ring': ring, 'holes': []})

    if len(placed) == 1:
        return ('Polygon', [placed[0]['ring']] + placed[0]['holes'])
    return ('MultiPolygon', [[p['ring']] + p['holes'] for p in placed])


def parse_shapefile_from_zip(zip_path, out_path=None):
    """从 ZIP 文件中解析 Shapefile

    两种落地方式**共用同一段生成逻辑**（emit），避免两份实现各自漂移：

      · out_path 为 None —— 返回 {'success': True, 'data': <完整 geojson dict>}
        （本地调试用；会把整份文本再 json.loads 成对象，10 万级要素会吃掉大量内存）
      · out_path 给定时 —— 把 geojson **流式写入该文件**，只返回元信息：
        {'success': True, 'featureCount': n, 'fields': [...], 'outPath': path}

    🔴 为什么需要 out_path（v1.13.194）：
      250m 网格人口单城 10.8 万要素 / 35 个字段，整份 JSON 约 95MiB。
      · 若仍走 stdout，Node 侧必须 JSON.parse + JSON.stringify，
        实测该链路进程峰值 RSS 达 1.13GiB —— 而生产服务器总内存只有 1.6GB ⇒ 必然 OOM；
      · 改流式写盘后，Python 侧峰值也从 734MB 降到约 100MB
        （不再累积 features 列表，也不再对全文做一次 json.dumps）。
    """
    try:
        # 创建临时目录
        with tempfile.TemporaryDirectory() as tmpdir:
            # 解压 ZIP 文件
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(tmpdir)

            # 查找 .shp 文件
            shp_files = [f for f in os.listdir(tmpdir) if f.endswith('.shp')]
            if not shp_files:
                return {'success': False, 'error': 'ZIP文件中没有找到 .shp 文件'}

            shp_path = os.path.join(tmpdir, shp_files[0])

            # 读取 Shapefile：按 DBF_ENCODING_CANDIDATES 逐个尝试编码（含全量解码校验）
            sf, encoding_error = open_shapefile_with_best_encoding(shp_path)

            # 如果都失败，使用默认方式
            if sf is None:
                try:
                    sf = shapefile.Reader(shp_path)
                except Exception as e:
                    return {'success': False, 'error': f'无法读取 Shapefile: {str(e)}'}

            # 获取字段名列表（只需获取一次）
            fields = []
            for field_info in sf.fields[1:]:  # 跳过 DeletionFlag
                field_name = field_info[0]
                # 使用专门的字段名解码函数
                decoded_name = try_decode_field_name(field_name)
                fields.append(decoded_name)

            total = len(sf)   # .shx 里直接可读，不必遍历几何

            def emit(write):
                """把整个 FeatureCollection 逐要素写给 write() —— 唯一实现，两种落地共用。

                逐要素写入而非「先堆 features 再整体 dumps」，是为了不把 10 万条
                feature 同时留在内存里（那正是 Python 侧 734MB 峰值的主要来源）。
                """
                write('{"type": "FeatureCollection", "features": [')
                for i, shape in enumerate(sf.iterShapes()):
                    # 获取属性数据
                    record = sf.record(i)
                    # 处理编码问题
                    properties = {}
                    for k, v in zip(fields, record):
                        # 解码字段名
                        decoded_key = try_decode_field_name(k) if isinstance(k, bytes) else str(k)
                        # 解码值
                        decoded_value = try_decode(v)
                        properties[decoded_key] = decoded_value

                    # 转换几何坐标
                    # v1.13.276：多 part 要素改为按「嵌套深度」组装成 Polygon / MultiPolygon
                    #（旧实现一律塞进一个 Polygon ⇒ 分离面被当成洞，详见 assemble_polygon 注释）
                    coordinates = []
                    if shape.shapeType == 5:  # Polygon
                        parts = list(shape.parts) + [len(shape.points)]
                        rings = []
                        for p, part_start in enumerate(shape.parts):
                            part_end = parts[p + 1]
                            part_coords = []
                            for j in range(part_start, part_end):
                                lng, lat = shape.points[j]
                                if SKIP_COORD_CONVERT:
                                    part_coords.append([round(lng, COORD_DECIMALS), round(lat, COORD_DECIMALS)])
                                else:
                                    gcj_lng, gcj_lat = wgs84_to_gcj02(lng, lat)
                                    part_coords.append([round(gcj_lng, COORD_DECIMALS), round(gcj_lat, COORD_DECIMALS)])
                            rings.append(part_coords)
                        geom_type, coordinates = assemble_polygon(rings)
                    elif shape.shapeType == 1:  # Point
                        lng, lat = shape.points[0]
                        if SKIP_COORD_CONVERT:
                            coordinates = [[round(lng, COORD_DECIMALS), round(lat, COORD_DECIMALS)]]
                        else:
                            gcj_lng, gcj_lat = wgs84_to_gcj02(lng, lat)
                            coordinates = [[round(gcj_lng, COORD_DECIMALS), round(gcj_lat, COORD_DECIMALS)]]
                        geom_type = 'Point'
                    else:
                        geom_type = 'Polygon'

                    feature = {
                        'type': 'Feature',
                        'geometry': {
                            'type': geom_type,
                            'coordinates': coordinates
                        },
                        'properties': properties
                    }
                    if i:
                        write(', ')
                    # ensure_ascii=False 必须显式给：旧实现是在整体 json.dumps 时统一指定的，
                    # 逐条 dumps 若漏掉，中文属性会退化成 \uXXXX 且产物体积明显膨胀
                    write(json.dumps(feature, ensure_ascii=False))
                write('], "metadata": ')
                write(json.dumps({'totalCount': total, 'fields': fields}, ensure_ascii=False))
                write('}')

            if out_path:
                with open(out_path, 'w', encoding='utf-8') as fh:
                    emit(fh.write)
                return {
                    'success': True,
                    'featureCount': total,
                    'fields': fields,
                    'outPath': out_path
                }

            buf = io.StringIO()
            emit(buf.write)
            return {'success': True, 'data': json.loads(buf.getvalue())}

    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e) + '\n' + traceback.format_exc()}


def _parse_cli(argv):
    """解析命令行参数：第一个非选项参数为 zip 路径。

    支持 --skip-convert 与 --out <path>，且**顺序无关**
    （Node 侧拼参数时不必关心先后；旧调用 `parser zip --skip-convert` 仍照常工作）。
    返回 (zip_path, out_path, skip_convert, error)。
    """
    zip_path = None
    out_path = None
    skip = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--skip-convert':
            skip = True
        elif a == '--out':
            i += 1
            if i >= len(argv):
                return None, None, False, '--out 缺少文件路径'
            out_path = argv[i]
        elif zip_path is None:
            zip_path = a
        else:
            return None, None, False, f'无法识别的参数: {a}'
        i += 1
    return zip_path, out_path, skip, None


if __name__ == '__main__':
    zip_path, out_path, skip_coord_convert, cli_error = _parse_cli(sys.argv[1:])

    if cli_error:
        print(json.dumps({'success': False, 'error': cli_error}))
        sys.exit(1)
    if not zip_path:
        print(json.dumps({'success': False, 'error': '请提供 ZIP 文件路径'}))
        sys.exit(1)
    if not os.path.exists(zip_path):
        print(json.dumps({'success': False, 'error': f'文件不存在: {zip_path}'}))
        sys.exit(1)

    # 传入参数给 parse 函数
    parse_shapefile_from_zip.__globals__['SKIP_COORD_CONVERT'] = skip_coord_convert

    # out_path 模式下 stdout 只回元信息（几十字节），几何直接流式落盘
    result = parse_shapefile_from_zip(zip_path, out_path)
    print(json.dumps(result, ensure_ascii=False))
