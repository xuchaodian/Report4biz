#!/usr/bin/env python3
import urllib.request
import urllib.error
import json

BASE_URL = "https://mka-online.cn"
TIMEOUT = 120

def post(url, data, token=None):
    req = urllib.request.Request(
        BASE_URL + url,
        data=json.dumps(data).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {token}' if token else ''
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:500]}"}
    except Exception as e:
        return {"error": str(e)}

# 1. 登录
print("正在登录...")
login = post('/api/auth/login', {"username": "xucd", "password": "123456"})
token = login.get('token')
print(f"登录成功\n")

# 2. 查询全部23个服务
print("=== 查询全部23个服务（上海陆家嘴，1km半径）===")
print("这可能需要较长时间，请耐心等待...")
result = post('/api/smartsteps/query', {
    "centerLng": 121.5109,
    "centerLat": 31.0887,
    "radius": 1000,
    "radii": [1000],
    "services": ["1001","1002","1003","1004","1005","1006","1007","1008","1009","1010","1011","1012","1013","1014","1015","1016","1017","1018","1019","1020","1021","1022","1023"],
    "cityMonth": "202603",
    "quotaUsed": 1,
    "storeName": "测试",
    "storeType": "已开业"
}, token)

# 只显示关键字段，不显示完整data
if 'data' in result:
    print(f"success: {result.get('success')}")
    print(f"wkt: {result.get('wkt')}")
    print(f"centerWgs: {result.get('centerWgs')}")
    print(f"quotaUsed: {result.get('quotaUsed')}")
    print(f"remainingQuota: {result.get('remainingQuota')}")
    print(f"\n返回的数据字段:")
    for key in result['data'].keys():
        val = result['data'][key]
        if isinstance(val, dict):
            print(f"  {key}: 对象，包含 {len(val)} 个字段")
        elif isinstance(val, list):
            print(f"  {key}: 数组，包含 {len(val)} 个元素")
        else:
            print(f"  {key}: {val}")
else:
    print(json.dumps(result, ensure_ascii=False, indent=2))
