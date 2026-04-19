#!/usr/bin/env python3
"""成本数据 API 服务 — FastAPI + uvicorn

启动：python api_server.py
端点：
  POST /import   — 接收 GLM JSON，自动入库
  GET  /query    — 按关键词搜索价格
  POST /confirm  — 确认待核实记录
  GET  /stats    — 数据库统计
  GET  /health   — 健康检查
"""

import re
import json
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

import cost_db

app = FastAPI(title="成本数据 API", version="3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _clean_json_text(text: str) -> str:
    """Extract JSON from GLM response (may be wrapped in markdown code blocks)."""
    text = text.strip()
    # Remove markdown code fences
    m = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    return text


def _flatten_glm_json(data: dict) -> dict:
    """Convert nested GLM format to flat params dict for insert_record.

    Handles two formats:
    - Nested: {"cost_item": {...}, "cost_price": {...}, "cost_component": [...]}
    - Flat: {"名称": "...", "大类": "...", "单价": 100, ...}
    """
    # Already flat format (has 名称 or name key at top level)
    if '名称' in data or 'name' in data:
        return data

    # Nested format
    params = {}
    ci = data.get('cost_item', {})
    cp = data.get('cost_price', {})

    if ci:
        params['名称'] = ci.get('name', '')
        params['大类'] = ci.get('category', '')

    if cp:
        params['单价'] = cp.get('price')
        params['单位'] = cp.get('unit', '')
        params['日期'] = cp.get('date', '')
        params['询价方式'] = cp.get('price_type', '')
        params['报价人'] = cp.get('source_person', '')
        params['地区'] = cp.get('location', '')
        params['项目'] = cp.get('project_name', '')
        params['规格'] = cp.get('spec', '')
        params['计税方式'] = cp.get('tax_method', '')
        params['备注'] = cp.get('remark', '')
        params['录入设备'] = cp.get('input_device', '') or 'iPhone'
        params['原始文件'] = cp.get('source_file', '')
        params['raw_text'] = cp.get('raw_text', '')

    # Components
    components = data.get('cost_component', [])
    for comp in components:
        ctype = comp.get('component_type', '')
        if ctype == '人工':
            params['人工费'] = comp.get('price')
        elif ctype == '材料':
            params['材料费'] = comp.get('price')
        elif ctype == '机械':
            params['机械费'] = comp.get('price')

    return params


# ── Endpoints ──

@app.post("/import")
def import_data(data: dict):
    """Accept structured cost data from GLM / shortcuts and insert into DB."""
    try:
        params = _flatten_glm_json(data)
        new_id = cost_db.insert_record(params)
        cost_db.export_json(cost_db.open_db())
        return {"status": "ok", "id": new_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/import/raw")
def import_raw(body: dict):
    """Accept raw GLM text response and insert into DB.

    Body: {"text": "GLM response text containing JSON"}
    """
    try:
        raw_text = body.get("text", "")
        cleaned = _clean_json_text(raw_text)
        data = json.loads(cleaned)
        params = _flatten_glm_json(data)
        new_id = cost_db.insert_record(params)
        return {"status": "ok", "id": new_id}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"JSON解析失败: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/query")
def query_prices(q: str = Query("", description="搜索关键词")):
    """Search prices by keyword."""
    if not q:
        raise HTTPException(status_code=400, detail="请提供搜索关键词 ?q=xxx")
    results = cost_db.search_prices(q)
    return {"total": len(results), "results": results}


@app.post("/confirm")
def confirm_record(body: dict):
    """Confirm a record (change status from 待核实 to 已确认)."""
    id_str = body.get("id")
    if not id_str:
        raise HTTPException(status_code=400, detail="请提供 id")
    try:
        cost_db.confirm_record(str(id_str))
        return {"status": "ok"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/stats")
def stats():
    """Database statistics."""
    return cost_db.get_stats()


@app.get("/health")
def health():
    """Health check."""
    try:
        s = cost_db.get_stats()
        return {"status": "running", "db": "成本数据.db", "records": s["total"]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


if __name__ == "__main__":
    print("成本数据 API 服务启动中...")
    print("  地址：http://0.0.0.0:5000")
    print("  文档：http://localhost:5000/docs")
    uvicorn.run(app, host="0.0.0.0", port=5000)
