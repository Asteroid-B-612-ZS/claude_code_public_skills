#!/usr/bin/env python3
"""成本数据 API 服务 — FastAPI + uvicorn

启动：python api_server.py
端点：
  POST /import       — 接收 JSON，自动入库
  POST /import/raw   — 接收 GLM 原始文本入库
  GET  /query        — 按关键词搜索价格
  POST /confirm      — 确认待核实记录
  GET  /stats        — 数据库统计
  GET  /health       — 健康检查

环境变量：
  COST_API_KEY  — 可选，设置后所有端点（/health 除外）需携带 X-API-Key header
"""

import os
import re
import json
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, Query, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

import cost_db

app = FastAPI(title="成本数据 API", version="3.2")

# Restrictive CORS — override via reverse proxy if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Optional API Key Auth ──

API_KEY = os.environ.get('COST_API_KEY')


async def verify_api_key(x_api_key: Optional[str] = Header(None)):
    """If COST_API_KEY is set, require matching X-API-Key header."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


# ── Pydantic Models ──

class CostImportRequest(BaseModel):
    """Structured cost data import. Supports both flat and nested GLM format."""
    # Flat Chinese fields
    名称: Optional[str] = None
    大类: Optional[str] = None
    单价: Optional[float] = None
    单位: Optional[str] = None
    日期: Optional[str] = None
    询价方式: Optional[str] = None
    报价人: Optional[str] = None
    地区: Optional[str] = None
    项目: Optional[str] = None
    规格: Optional[str] = None
    计税方式: Optional[str] = None
    备注: Optional[str] = None
    录入设备: Optional[str] = None
    原始文件: Optional[str] = None
    # Flat English fields
    name: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    unit: Optional[str] = None
    date: Optional[str] = None
    price_type: Optional[str] = None
    source_person: Optional[str] = None
    location: Optional[str] = None
    project_name: Optional[str] = None
    spec: Optional[str] = None
    tax_method: Optional[str] = None
    remark: Optional[str] = None
    input_device: Optional[str] = None
    source_file: Optional[str] = None
    raw_text: Optional[str] = None
    # Component breakdown
    人工费: Optional[float] = None
    材料费: Optional[float] = None
    机械费: Optional[float] = None
    # Nested GLM format
    cost_item: Optional[Dict[str, Any]] = None
    cost_price: Optional[Dict[str, Any]] = None
    cost_component: Optional[List[Dict[str, Any]]] = None

    class Config:
        extra = "allow"


class RawImportRequest(BaseModel):
    """Raw GLM text import."""
    text: str


# ── Helpers ──

def _clean_json_text(text: str) -> str:
    """Extract JSON from GLM response (may be wrapped in markdown code blocks)."""
    text = text.strip()
    m = re.search(r'```(?:json)?\s*\n?(.*?)```', text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    return text


def _flatten_glm_json(data: dict) -> dict:
    """Convert nested GLM format to flat params dict for insert_record."""
    if '名称' in data or 'name' in data:
        return data

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

@app.post("/import", dependencies=[Depends(verify_api_key)])
def import_data(data: CostImportRequest):
    """Accept structured cost data and insert into DB."""
    try:
        params = _flatten_glm_json(data.model_dump())
        new_id = cost_db.insert_record(params)
        return {"status": "ok", "id": new_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/import/raw", dependencies=[Depends(verify_api_key)])
def import_raw(body: RawImportRequest):
    """Accept raw GLM text response and insert into DB."""
    try:
        cleaned = _clean_json_text(body.text)
        data = json.loads(cleaned)
        params = _flatten_glm_json(data)
        new_id = cost_db.insert_record(params)
        return {"status": "ok", "id": new_id}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"JSON解析失败: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/query", dependencies=[Depends(verify_api_key)])
def query_prices(q: str = Query("", description="搜索关键词")):
    """Search prices by keyword."""
    if not q:
        raise HTTPException(status_code=400, detail="请提供搜索关键词 ?q=xxx")
    results = cost_db.search_prices(q)
    return {"total": len(results), "results": results}


@app.post("/confirm", dependencies=[Depends(verify_api_key)])
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


@app.get("/stats", dependencies=[Depends(verify_api_key)])
def stats():
    """Database statistics."""
    return cost_db.get_stats()


@app.get("/health")
def health():
    """Health check (no auth required)."""
    try:
        s = cost_db.get_stats()
        return {"status": "running", "db": "成本数据.db", "records": s["total"]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


if __name__ == "__main__":
    print("成本数据 API 服务启动中...")
    print("  地址：http://0.0.0.0:5000")
    print("  文档：http://localhost:5000/docs")
    if API_KEY:
        print("  认证：已启用 X-API-Key")
    else:
        print("  认证：未设置 COST_API_KEY，无认证")
    uvicorn.run(app, host="0.0.0.0", port=5000)
