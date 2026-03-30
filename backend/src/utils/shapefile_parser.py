#!/usr/bin/env python3
"""
Shapefile 解析和坐标系转换工具
WGS84 -> GCJ-02 (火星坐标系/高德坐标)
"""

import math
import json
import sys
import zipfile
import os
import tempfile

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
        import shapefile

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
            sf = shapefile.Reader(shp_path)

            features = []
            for i, shape in enumerate(sf.shapes()):
                # 获取属性数据
                record = sf.record(i)
                fields = [field[0] for field in sf.fields[1:]]  # 跳过 DeletionFlag
                properties = dict(zip(fields, record))

                # 转换几何坐标
                coordinates = []
                if shape.shapeType == 5:  # Polygon
                    for part in shape.parts:
                        if part == shape.parts[0]:
                            part_coords = []
                            for j in range(part, len(shape.points)):
                                lng, lat = shape.points[j]
                                gcj_lng, gcj_lat = wgs84_to_gcj02(lng, lat)
                                part_coords.append([gcj_lng, gcj_lat])
                            coordinates.append(part_coords)
                        else:
                            part_coords = []
                            for j in range(part, len(shape.points)):
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
        return {'success': False, 'error': str(e)}


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
