# -*- coding: utf-8 -*-
"""
销售预测 L3 训练服务（FastAPI + LightGBM）
- /train: 接收特征矩阵 + log坪效标签 → 训练 LightGBM → 返回验证集 MAPE + 特征重要性
- /predict: 预测候选店 log坪效 + 影响模拟（周边店 comp500/my500 +1 后坪效变化）
- /health: 健康检查
特征索引约定（与 Node 端 buildX 一致）：
[0]logArea [1]dr [2-5]商圈4维 [6]pop1km [7]pop3km [8]pop5km [9]comp500 [10]my500 [11]yearCode [12]mallCode [13]tradeCode
"""
import json
import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import lightgbm as lgb
from sklearn.model_selection import train_test_split

app = FastAPI()
MODEL = None
MODEL_META = {}


@app.get('/health')
async def health():
    return {'success': True, 'model': MODEL is not None}


@app.post('/train')
async def train(req: Request):
    global MODEL, MODEL_META
    try:
        body = await req.json()
        X = np.array(body.get('X', []), dtype=float)
        y = np.array(body.get('y', []), dtype=float)
        features = body.get('features', [])
        if len(X) < 50 or len(X) != len(y):
            return JSONResponse({'success': False, 'message': '样本不足或维度不一致'})
        Xtr, Xva, ytr, yva = train_test_split(X, y, test_size=0.2, random_state=42)
        params = {
            'objective': 'regression',
            'metric': 'mape',
            'learning_rate': 0.05,
            'num_leaves': 31,
            'min_data_in_leaf': 5,
            'verbosity': -1,
            'seed': 42
        }
        model = lgb.train(
            params, lgb.Dataset(Xtr, label=ytr), num_boost_round=300,
            valid_sets=[lgb.Dataset(Xva, label=yva)],
            callbacks=[lgb.early_stopping(30, verbose=False)]
        )
        pred = model.predict(Xva, num_iteration=model.best_iteration)
        pred_e = np.exp(pred)
        yva_e = np.exp(yva)
        mape = float(np.mean(np.abs(pred_e - yva_e) / np.maximum(yva_e, 1e-6)))
        imp = sorted(zip(features, model.feature_importance('gain')),
                     key=lambda t: -t[1]) if features else []
        MODEL = model
        MODEL_META = {
            'best_iteration': int(model.best_iteration),
            'mape': mape,
            'n': int(len(X)),
            'importance': [{'feature': str(f), 'gain': float(g)} for f, g in imp]
        }
        return JSONResponse({'success': True, 'mape': mape, 'n': len(X),
                             'importance': MODEL_META['importance']})
    except Exception as e:
        return JSONResponse({'success': False, 'message': str(e)})


@app.post('/predict')
async def predict(req: Request):
    global MODEL, MODEL_META
    try:
        if MODEL is None:
            return JSONResponse({'success': False, 'message': '模型未训练'})
        body = await req.json()
        X_cand = np.array([body.get('X_cand', [])], dtype=float)
        pred_log = float(MODEL.predict(X_cand, num_iteration=MODEL_META['best_iteration'])[0])
        result = {
            'success': True,
            'predLog': pred_log,
            'predEff': float(np.exp(pred_log)),
            'importance': MODEL_META['importance'],
            'mape': MODEL_META['mape']
        }
        # 影响模拟：周边已开业店在候选店开业后 comp500(9)/my500(10) +1 → 重预测坪效变化
        near = body.get('X_near', [])
        impacts = []
        if near:
            Xn = np.array(near, dtype=float)
            base = np.exp(MODEL.predict(Xn, num_iteration=MODEL_META['best_iteration']))
            Xn2 = Xn.copy()
            Xn2[:, 9] += 1
            Xn2[:, 10] += 1
            new_ = np.exp(MODEL.predict(Xn2, num_iteration=MODEL_META['best_iteration']))
            for i in range(len(near)):
                if base[i] > 0:
                    impacts.append({
                        'origEff': float(base[i]),
                        'newEff': float(new_[i]),
                        'dropPct': float(max((base[i] - new_[i]) / base[i], 0))
                    })
        result['impacts'] = impacts
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({'success': False, 'message': str(e)})


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=9000)
