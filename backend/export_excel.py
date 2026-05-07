#!/usr/bin/env python3
"""
Excel报表导出脚本 - 从SQLite读取购买数据，用openpyxl填充模板，保存到输出文件
用法: python3 export_excel.py <template_path> <output_path> <db_path> <purchase_id> <user_id>
"""
import sys
import json
import sqlite3
from openpyxl import load_workbook

def main():
    if len(sys.argv) < 6:
        print(json.dumps({"error": "参数不足: template_path output_path db_path purchase_id user_id"}))
        sys.exit(1)

    template_path = sys.argv[1]
    output_path = sys.argv[2]
    db_path = sys.argv[3]
    purchase_id = int(sys.argv[4])
    user_id = int(sys.argv[5])

    try:
        # 从数据库读取购买记录
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT * FROM purchases WHERE id = ? AND user_id = ?",
            (purchase_id, user_id)
        ).fetchone()
        db.close()

        if not row:
            print(json.dumps({"error": "记录不存在"}))
            sys.exit(1)

        row = dict(row)
        store_name = row.get('store_name', '门店')
        radius = row.get('radius', 500)
        city_month = row.get('city_month', '')

        # 解析 result_data
        result_data = row.get('result_data')
        if isinstance(result_data, str):
            result_data = json.loads(result_data)
        api_result = result_data.get('apiResult', {}) if result_data else {}

        # 半径转km
        if isinstance(radius, str):
            radii_list = json.loads(radius)
        elif isinstance(radius, (list, tuple)):
            radii_list = radius
        else:
            radii_list = [radius]
        radius_km = radii_list[0] / 1000 if radii_list else 0.5
        radius_str = f"{radius_km}km"

        # 打开模板
        wb = load_workbook(template_path)

        # ===== 1. 封面 =====
        if '封面' in wb.sheetnames:
            ws = wb['封面']
            ws['E21'] = store_name

        # ===== 2. 商圈数据 =====
        if '商圈数据' in wb.sheetnames:
            ws = wb['商圈数据']
            ws['C1'] = radius_str
            ws['E1'] = city_month

            # 构建字段映射（小写）
            field_map = {}

            # 1001 - 对象
            if '1001' in api_result and isinstance(api_result['1001'], dict):
                for k, v in api_result['1001'].items():
                    field_map[k.lower()] = v

            # 1002 - 标签
            if '1002' in api_result and isinstance(api_result['1002'], list):
                tag_names = ['网上购物', '时政要闻', '商务办公', '金融理财', '手机游戏', '旅游出行', '外卖送餐', '餐饮美食', '求职招聘']
                for item in api_result['1002']:
                    name = item.get('tag_name', '')
                    val = item.get('tag_value', 0)
                    for i, tn in enumerate(tag_names, 1):
                        if tn in name or name in tn:
                            field_map[f'webtag0_{i}'] = val
                            break

            # 1005 - 小时段
            if '1005' in api_result and isinstance(api_result['1005'], list):
                for item in api_result['1005']:
                    dt = item.get('day_type', 0)
                    hp = item.get('hour_period')
                    if hp is not None:
                        field_map[f'hour{dt}_{hp}_visit'] = item.get('hour_visit', 0)
                        field_map[f'hour{dt}_{hp}_all'] = item.get('hour_all', 0)

            # 1006 - 日均
            if '1006' in api_result and isinstance(api_result['1006'], list) and len(api_result['1006']) > 0:
                days = api_result['1006']
                n = len(days)
                keys = ['day_visit', 'day_all', 'stay1', 'stay2', 'stay3', 'stay4', 'stay5']
                totals = {k: 0 for k in keys}
                for d in days:
                    for k in keys:
                        totals[k] += d.get(k, 0) or 0
                field_map['day_avg_visit'] = round(totals['day_visit'] / n)
                field_map['day_avg_total'] = round(totals['day_all'] / n)
                field_map['stay_30'] = round(totals['stay1'] / n)
                field_map['stay_60'] = round(totals['stay2'] / n)
                field_map['stay_120'] = round(totals['stay3'] / n)
                field_map['stay_240'] = round(totals['stay4'] / n)
                field_map['stay_480'] = round(totals['stay5'] / n)

            # 1007
            if '1007' in api_result and isinstance(api_result['1007'], list):
                for item in api_result['1007']:
                    if item.get('popu_type') == 0:
                        for i in range(1, 6):
                            field_map[f'reach{i}'] = item.get(f'reach{i}', 0) or 0
                        break

            # 1009~1013
            for svc in ['1009', '1010', '1011', '1012', '1013']:
                if svc in api_result and isinstance(api_result[svc], list):
                    for item in api_result[svc]:
                        pt = item.get('popu_type', 0)
                        for k, v in item.items():
                            if k.startswith('p') and isinstance(v, (int, float)):
                                field_map[f'pop{pt}_{k}'] = v or 0

            # 1015
            if '1015' in api_result and isinstance(api_result['1015'], list):
                fname_map = {'收入预测': 'income', '有车预测': 'car', '有房预测': 'house'}
                for item in api_result['1015']:
                    fn = fname_map.get(item.get('fname', ''), item.get('fname', ''))
                    pt = item.get('popu_type', 0)
                    for k, v in item.items():
                        if k.startswith('p') and isinstance(v, (int, float)):
                            field_map[f'{fn}_pop{pt}_{k}'] = v or 0

            # 填入E列
            for row_cells in ws.iter_rows(min_row=3, max_row=ws.max_row, min_col=3, max_col=3):
                cell = row_cells[0]
                field_name = str(cell.value or '').strip().lower()
                if field_name and field_name in field_map:
                    ws.cell(row=cell.row, column=5).value = field_map[field_name]

        # 保存
        wb.save(output_path)

        # 输出文件名信息（给Node.js使用）
        file_name = f"{store_name}_{radius_str}_{city_month}.xlsx"
        print(json.dumps({"success": True, "filename": file_name}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
