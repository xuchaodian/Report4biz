#!/usr/bin/env python3
"""
Shapefile 解析和坐标系转换工具
WGS84 -> GCJ-02 (火星坐标系/高德坐标)

支持编码: UTF-8, GBK, GB2312, GB18030, Latin-1
"""

import math
import json
import sys
import zipfile
import os
import tempfile
import shapefile


# 支持的编码列表，按优先级尝试
ENCODINGS = ['utf-8', 'gbk', 'gb2312', 'gb18030', 'latin-1']


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


def parse_shapefile_from_zip(zip_path):
    """从 ZIP 文件中解析 Shapefile"""
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
            
            # 尝试使用多种编码读取 Shapefile
            sf = None
            encoding_error = None
            
            # 首先尝试 GB18030（支持中文 Windows）
            for dbf_encoding in ['gb18030', 'gbk', 'utf-8']:
                try:
                    sf = shapefile.Reader(shp_path, encoding=dbf_encoding)
                    # 测试读取第一个记录
                    if len(sf.fields) > 1:
                        test_record = sf.record(0)
                        encoding_error = None
                        break
                except UnicodeDecodeError as e:
                    encoding_error = e
                    continue
                except Exception as e:
                    encoding_error = e
                    continue
            
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

            features = []
            for i, shape in enumerate(sf.shapes()):
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
                coordinates = []
                if shape.shapeType == 5:  # Polygon
                    # shape.parts 定义了每个 part 的起始点索引
                    # 需要添加最后一个边界来获取每个 part 的范围
                    parts = list(shape.parts) + [len(shape.points)]
                    for i, part_start in enumerate(shape.parts):
                        part_end = parts[i + 1]  # 下一个 part 的起始索引就是当前 part 的结束索引
                        part_coords = []
                        for j in range(part_start, part_end):
                            lng, lat = shape.points[j]
                            gcj_lng, gcj_lat = wgs84_to_gcj02(lng, lat)
                            part_coords.append([gcj_lng, gcj_lat])
                        coordinates.append(part_coords)
                elif shape.shapeType == 1:  # Point
                    lng, lat = shape.points[0]
                    gcj_lng, gcj_lat = wgs84_to_gcj02(lng, lat)
                    coordinates = [[gcj_lng, gcj_lat]]

                feature = {
                    'type': 'Feature',
                    'geometry': {
                        'type': 'Polygon' if shape.shapeType == 5 else 'Point',
                        'coordinates': coordinates
                    },
                    'properties': properties
                }
                features.append(feature)

            geojson = {
                'type': 'FeatureCollection',
                'features': features,
                'metadata': {
                    'totalCount': len(features),
                    'fields': fields
                }
            }

            return {'success': True, 'data': geojson}

    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e) + '\n' + traceback.format_exc()}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': '请提供 ZIP 文件路径'}))
        sys.exit(1)

    zip_path = sys.argv[1]
    if not os.path.exists(zip_path):
        print(json.dumps({'success': False, 'error': f'文件不存在: {zip_path}'}))
        sys.exit(1)

    result = parse_shapefile_from_zip(zip_path)
    print(json.dumps(result, ensure_ascii=False))
