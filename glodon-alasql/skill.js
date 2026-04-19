#!/usr/bin/env node
/**
 * Glodon-AlaSQL — 广联达清单计价 Excel 分析工具
 *
 * 用法:
 *   node skill.js <文件路径>                           数据概览
 *   node skill.js <文件路径> compare-prices            同清单比价分析
 *   node skill.js <文件路径> search "关键词"           按关键词搜索清单
 *   node skill.js <文件路径> summary [--prefix X]      按编码前缀汇总
 *   node skill.js <文件路径> full-cost                 全费用计算
 *   node skill.js <文件路径> diff <文件2>              修改前后对比
 *   node skill.js <文件路径> "SELECT ..."             自定义SQL查询
 */

const fs = require("fs");
const XLSX = require("xlsx");
const alasql = require("alasql");

// ============================================================================
// 一、Sheet 名称智能解析器
// ============================================================================

/**
 * 解析广联达导出的 Sheet 名称
 * 格式: "{报表编号} {报表类型名}【{单位工程名}】" 或 "{报表编号} {报表类型名}"
 * 后缀: 同名Sheet用 _N 区分
 */
function parseSheetName(sheetName) {
  // 策略: 按优先级依次尝试三种匹配模式
  // 1. 完整格式: C.X.Y 报表类型【分部工程名】_N
  // 2. 截断格式: C.X.Y 报表类型【分部工程名（被截断，无闭合】）
  // 3. 无括号: C.X.Y 报表类型

  // 模式1: 完整的 【...】 格式
  let m = sheetName.match(/^(C[\d.]+)\s+(.*?)【(.*)】(?:_(\d+))?$/);
  if (m) {
    return {
      code: m[1], type: m[2].trim(), unit: m[3] || null,
      suffix: m[4] ? parseInt(m[4]) : null, truncated: false
    };
  }

  // 模式2: 截断的 【... （无闭合】）
  m = sheetName.match(/^(C[\d.]+)\s+(.*?)【(.+)$/);
  if (m) {
    return {
      code: m[1], type: m[2].trim(), unit: m[3].trim(),
      suffix: null, truncated: true
    };
  }

  // 模式3: 无【】
  m = sheetName.match(/^(C[\d.]+)\s+(.+)$/);
  if (m) {
    return {
      code: m[1], type: m[2].trim(), unit: null,
      suffix: null, truncated: false
    };
  }

  return { code: null, type: sheetName, unit: null, suffix: null, truncated: false };
}

/**
 * 报表类型分类
 */
function classifyReport(code) {
  if (!code) return "unknown";
  if (code === "C.1") return "cover";
  if (code === "C.2") return "title_page";
  if (code === "C.3") return "instruction";
  if (code === "C.4") return "project_summary";
  if (code.startsWith("C.5")) return "unit_summary";
  if (code.startsWith("C.6")) return "boq_detail";     // 分部分项工程计价表
  if (code === "C.8") return "measures";
  if (code === "C.8.1") return "safety_measures";
  if (code === "C.10") return "provisional_sum";
  if (code === "C.11") return "material_provisional";
  if (code === "C.12") return "specialty_provisional";
  if (code === "C.14") return "management_fee";
  if (code.startsWith("C.15")) return "vat";            // 增值税计价表
  return "other";
}

/**
 * 解析整个工作簿的 Sheet 结构
 * 返回按类型分组的索引
 */
function parseWorkbookStructure(sheetNames) {
  const index = {
    project_summary: [],  // C.4 项目汇总
    unit_summary: [],     // C.5 单位工程汇总
    boq_detail: [],       // C.6 分部分项明细
    vat: [],              // C.15 增值税
    measures: [],         // C.8 措施项目
    safety_measures: [],  // C.8.1 安全文明施工
    provisional_sum: [],  // C.10 暂列金额
    material_provisional: [], // C.11 材料暂估
    specialty_provisional: [], // C.12 专业工程暂估
    management_fee: [],   // C.14 总承包服务费
    other: []
  };

  const parsed = [];
  sheetNames.forEach((name, idx) => {
    const p = parseSheetName(name);
    const cat = classifyReport(p.code);
    const entry = { idx, sheetName: name, parsed: p, category: cat };
    parsed.push(entry);
    if (index[cat]) {
      index[cat].push(entry);
    } else {
      index.other.push(entry);
    }
  });

  return { parsed, index };
}

// ============================================================================
// 二、数据清洗引擎
// ============================================================================

/**
 * C.6 列名标准化映射
 * 广联达导出的C.6表列名是固定的
 */
const BOQ_COLUMN_MAP = {
  "序号": "序号",
  "项目编码": "项目编码",
  "项目名称": "项目名称",
  "项目特征描述": "项目特征描述",
  "工作内容": "工作内容",
  "计量\n单位": "计量单位",
  "计量\r\n单位": "计量单位",
  "计量单位": "计量单位",
  "工程量": "工程量",
  "金 额(元)": "综合单价",
  "金额(元)": "综合单价",
  "I": "合价",
  "J": "人工费",
  "K": "材料暂估价",
  "__EMPTY": "合价",
  "__EMPTY_1": "人工费",
  "__EMPTY_2": "材料暂估价",
  "备注": "备注"
};

/**
 * 判断是否为有效清单数据行
 * 有效行的项目编码应该匹配9位数字（可能有前导空格）
 */
function isDataItem(row) {
  const code = row["项目编码"];
  if (code == null) return false;
  const trimmed = String(code).trim();
  // 匹配9位数字（标准国标清单编码格式）
  return /^\d{9,12}$/.test(trimmed);
}

/**
 * 判断是否为分部标题行
 * 仅有项目名称，无项目编码和序号
 */
function isSectionTitle(row) {
  const code = row["项目编码"];
  const name = row["项目名称"];
  const seq = row["序号"];
  return (!code || String(code).trim() === "") && name && String(name).trim() !== "" && !seq;
}

/**
 * 判断是否为合计行
 */
function isTotalRow(row) {
  const seq = row["序号"];
  return seq && String(seq).trim() === "合计";
}

/**
 * 清洗单个 C.6 Sheet 的数据
 * 返回 { items: [], sections: [] }
 */
function cleanBOQSheet(rawData, unitName, sheetUnit) {
  const items = [];
  const sections = [];
  let currentSection = "";

  for (const row of rawData) {
    // 跳过表头补充行（含"综合单价"、"人工费"等列标题文字）
    const code = row["项目编码"];
    if (code && (String(code).includes("综合单价") || String(code).includes("人工费"))) {
      continue;
    }
    const priceCol = row["金 额(元)"] || row["金额(元)"];
    if (priceCol && (String(priceCol) === "综合单价")) {
      continue;
    }

    // 分部标题行
    if (isSectionTitle(row)) {
      currentSection = String(row["项目名称"]).trim();
      sections.push(currentSection);
      continue;
    }

    // 合计行，跳过
    if (isTotalRow(row)) continue;

    // 有效数据行
    if (isDataItem(row)) {
      const item = {};
      for (const [origKey, value] of Object.entries(row)) {
        // 查找标准列名映射：先精确匹配，再用去换行符模糊匹配
        let stdKey = BOQ_COLUMN_MAP[origKey];
        if (!stdKey) {
          const cleanKey = origKey.replace(/[\r\n]/g, "");
          for (const [mapKey, mapVal] of Object.entries(BOQ_COLUMN_MAP)) {
            if (mapKey.replace(/[\r\n]/g, "") === cleanKey) {
              stdKey = mapVal;
              break;
            }
          }
        }
        if (stdKey && value !== undefined) {
          // 如果该标准列已有值，不覆盖（优先使用已映射的值）
          if (item[stdKey] === undefined) {
            item[stdKey] = value;
          }
        }
      }
      // 标准化项目编码（去前导空格）
      if (item["项目编码"]) {
        item["项目编码"] = String(item["项目编码"]).trim();
      }
      // 标准化项目名称（去前导空格）
      if (item["项目名称"]) {
        item["项目名称"] = String(item["项目名称"]).trim();
      }
      // 附加元数据
      item["单位工程"] = unitName;
      item["分部工程"] = currentSection;
      item["Sheet归属"] = sheetUnit || "";
      // 数值标准化
      item["工程量"] = toNumber(item["工程量"]);
      item["综合单价"] = toNumber(item["综合单价"]);
      item["合价"] = toNumber(item["合价"]) || (item["工程量"] * item["综合单价"]);
      item["人工费"] = toNumber(item["人工费"]);
      items.push(item);
    }
  }

  return { items, sections };
}

/**
 * 安全转换为数字
 */
function toNumber(val) {
  if (val == null || val === "") return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// ============================================================================
// 三、统一数据视图构建
// ============================================================================

/**
 * 加载并解析广联达Excel文件，构建统一数据视图
 */
function loadGlodonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`错误: 文件不存在 - ${filePath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);
  const sheetNames = workbook.SheetNames;
  const structure = parseWorkbookStructure(sheetNames);

  // --- 加载 C.4 汇总表 ---
  let projectSummary = [];
  const c4Sheet = structure.index.project_summary[0];
  if (c4Sheet) {
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[c4Sheet.sheetName], { defval: null });
    projectSummary = raw.map(row => ({
      序号: String(row["序号"] || ""),
      汇总内容: String(row["汇总内容"] || row["项目名称"] || "").trim(),
      金额: toNumber(row["金额（元）"] || row["金额(元)"])
    }));
  }

  // --- 加载 C.5 单位工程汇总表 ---
  const unitSummaries = [];
  for (const entry of structure.index.unit_summary) {
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[entry.sheetName], { defval: null });
    const unitName = entry.parsed.unit || "";
    const rows = raw.map(row => ({
      序号: String(row["序号"] || ""),
      分部工程名称: String(row["分部工程名称"] || "").trim(),
      金额: toNumber(row["金额（元）"] || row["金额(元)"])
    })).filter(r => r.序号 || r.分部工程名称);
    unitSummaries.push({ unitName, rows, sheetName: entry.sheetName });
  }

  // --- 建立 C.6 Sheet 到单位工程的归属关系 ---
  // 核心策略: C.6 的【】内容是"分部工程名"(如"基坑围护工程")，需通过 C.5 找到所属"单位工程名"(如"地下室")
  const boqEntries = structure.index.boq_detail;

  // 第1步: 从 C.5 构建完整的 分部工程名→单位工程名 映射
  // 包括处理同一分部名出现在多个单位工程的情况（用出现次序区分）
  const divisionToUnitCandidates = {};  // divisionName -> [unitName, ...]
  for (const us of unitSummaries) {
    const divisionRows = us.rows.filter(r => r.分部工程名称 && r.分部工程名称.trim() !== "");
    for (const row of divisionRows) {
      const divName = row.分部工程名称.trim();
      if (!divisionToUnitCandidates[divName]) {
        divisionToUnitCandidates[divName] = [];
      }
      divisionToUnitCandidates[divName].push(us.unitName);
    }
  }

  // 第2步: 为每个 C.6 Sheet 确定所属单位工程
  function resolveBOQUnit(boqEntry, boqIdx) {
    const sheetUnit = boqEntry.parsed.unit;
    const suffix = boqEntry.parsed.suffix;
    const isTruncated = boqEntry.parsed.truncated;
    if (!sheetUnit) return "未知";

    // 精确匹配
    const candidates = divisionToUnitCandidates[sheetUnit];
    if (candidates && candidates.length > 0) {
      const idx = suffix ? Math.min(suffix, candidates.length - 1) : 0;
      return candidates[idx];
    }

    // 模糊匹配: 用于截断的名称或非完全一致的分部名
    // 匹配策略: sheetUnit 是 C.5 分部名的前缀，或 C.5 分部名是 sheetUnit 的前缀
    let bestMatch = null;
    let bestMatchLen = 0;
    for (const [divName, units] of Object.entries(divisionToUnitCandidates)) {
      if (divName.includes(sheetUnit) || sheetUnit.includes(divName)) {
        // 选择匹配长度最长的（避免短前缀误匹配）
        const matchLen = Math.min(divName.length, sheetUnit.length);
        if (matchLen > bestMatchLen) {
          bestMatchLen = matchLen;
          const idx = suffix ? Math.min(suffix, units.length - 1) : 0;
          bestMatch = units[idx];
        }
      }
    }

    if (bestMatch) return bestMatch;

    // 最终回退: 使用分部工程名本身
    return sheetUnit;
  }

  // --- 加载所有 C.6 分部分项计价表 ---
  const allItems = [];
  const boqSheets = [];

  for (let bi = 0; bi < boqEntries.length; bi++) {
    const entry = boqEntries[bi];
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[entry.sheetName], { defval: null });
    const unitName = resolveBOQUnit(entry, bi);
    const sheetUnit = entry.parsed.unit || "";
    const { items, sections } = cleanBOQSheet(raw, unitName, sheetUnit);

    boqSheets.push({
      sheetName: entry.sheetName,
      unitName,
      sheetUnit,
      itemCount: items.length,
      sections
    });
    allItems.push(...items);
  }

  // --- 加载 C.8 措施项目 ---
  let measures = [];
  const measuresSheet = structure.index.measures[0];
  if (measuresSheet) {
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[measuresSheet.sheetName], { defval: null });
    measures = raw.map(row => ({
      序号: String(row["序号"] || ""),
      项目编码: String(row["项目编码"] || ""),
      项目名称: String(row["项 目 名 称"] || row["项目名称"] || "").trim(),
      价格: toNumber(row["价格（元）"] || row["价格(元)"]),
      备注: String(row["备注"] || "")
    }));
  }

  // --- 加载 C.15 增值税 ---
  const vatData = [];
  for (const entry of structure.index.vat) {
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[entry.sheetName], { defval: null });
    for (const row of raw) {
      if (row["序号"] && String(row["序号"]).trim() !== "合计") {
        vatData.push({
          sheetName: entry.sheetName,
          unit: entry.parsed.unit || "",
          项目名称: String(row["项目名称"] || "").trim(),
          计算基础说明: String(row["计算基础说明"] || ""),
          计算基础: toNumber(row["计算基础"]),
          费率: toNumber(row["费率(%)"]),
          金额: toNumber(row["金额(元)"])
        });
      }
    }
  }

  // --- 注册 AlaSQL 内存表 ---
  // 为 bq_items 提供英文列名别名（AlaSQL 不支持中文列名直接用于SQL）
  const CN_TO_EN = {
    "序号": "seq", "项目编码": "code", "项目名称": "name",
    "项目特征描述": "desc", "工作内容": "work", "计量单位": "unit",
    "工程量": "qty", "综合单价": "price", "合价": "amount",
    "人工费": "labor", "材料暂估价": "mat_est", "备注": "remark",
    "单位工程": "unit_project", "分部工程": "division", "Sheet归属": "sheet_unit"
  };
  const EN_TO_CN = {};
  for (const [cn, en] of Object.entries(CN_TO_EN)) EN_TO_CN[en] = cn;

  alasql("CREATE TABLE bq_items");
  alasql.tables.bq_items.data = allItems.map(item => {
    const row = {};
    for (const [cn, en] of Object.entries(CN_TO_EN)) {
      row[en] = item[cn];
    }
    return row;
  });

  alasql("CREATE TABLE project_summary");
  alasql.tables.project_summary.data = projectSummary.map(r => ({
    seq: r["序号"], content: r["汇总内容"], amount: r["金额"]
  }));

  alasql("CREATE TABLE unit_summaries");
  alasql.tables.unit_summaries.data = unitSummaries.map(us => ({
    unit_project: us.unitName,
    division_count: us.rows.filter(r => r.序号.includes(".")).length
  }));

  alasql("CREATE TABLE measures");
  alasql.tables.measures.data = measures.map(m => ({
    seq: m["序号"], code: m["项目编码"], name: m["项目名称"],
    amount: m["价格"], remark: m["备注"]
  }));

  alasql("CREATE TABLE vat");
  alasql.tables.vat.data = vatData.map(v => ({
    sheet: v["sheetName"], unit: v["unit"], name: v["项目名称"],
    base_desc: v["计算基础说明"], base: v["计算基础"],
    rate: v["费率"], amount: v["金额"]
  }));

  return {
    filePath,
    sheetCount: sheetNames.length,
    structure,
    boqSheets,
    allItems,
    projectSummary,
    unitSummaries,
    measures,
    vatData,
    sheetNames
  };
}

// ============================================================================
// 四、预设分析模块
// ============================================================================

/**
 * 概览：显示文件结构和关键统计
 */
function showOverview(data) {
  console.log("\n" + "=".repeat(70));
  console.log("广联达清单计价报表分析");
  console.log("=".repeat(70));
  console.log(`\n文件: ${data.filePath}`);
  console.log(`Sheet 总数: ${data.sheetCount}`);

  // 报表分类统计
  const cats = data.structure.index;
  console.log("\n--- 报表分类 ---");
  console.log(`  C.4  项目汇总表:    ${cats.project_summary.length} 个`);
  console.log(`  C.5  单位工程汇总:  ${cats.unit_summary.length} 个`);
  console.log(`  C.6  分部分项计价表: ${cats.boq_detail.length} 个`);
  console.log(`  C.8  措施项目:      ${cats.measures.length} 个`);
  console.log(`  C.15 增值税表:      ${cats.vat.length} 个`);
  console.log(`  其他:               ${cats.other.length} 个`);

  // 单位工程列表
  console.log("\n--- 单位工程 ---");
  for (const us of data.unitSummaries) {
    console.log(`  ${us.unitName}`);
  }

  // 清单项统计
  console.log("\n--- 清单项统计 ---");
  console.log(`  总清单项数: ${data.allItems.length}`);

  // 各单位工程清单数
  const unitCounts = {};
  for (const item of data.allItems) {
    unitCounts[item["单位工程"]] = (unitCounts[item["单位工程"]] || 0) + 1;
  }
  console.log("\n  各单位工程清单数:");
  for (const [unit, count] of Object.entries(unitCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${unit}: ${count} 项`);
  }

  // 项目汇总（从C.4提取）
  if (data.projectSummary.length > 0) {
    console.log("\n--- 项目费用汇总 ---");
    for (const row of data.projectSummary) {
      if (!row["序号"].includes(".") && row["汇总内容"]) {
        const amount = row["金额"] ? row["金额"].toLocaleString("zh-CN", { minimumFractionDigits: 2 }) : "";
        console.log(`  ${row["汇总内容"]}: ${amount} 元`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
}

/**
 * 同清单比价分析
 * 找出在不同单位工程中出现的相同清单（按项目编码），比较综合单价差异
 */
function comparePrices(data) {
  console.log("\n" + "=".repeat(70));
  console.log("同清单比价分析");
  console.log("=".repeat(70));

  const codeMap = {};
  for (const item of data.allItems) {
    const code = item["项目编码"];
    if (!code) continue;
    if (!codeMap[code]) {
      codeMap[code] = [];
    }
    codeMap[code].push(item);
  }

  // 找出出现多次且价格不同的
  const diffs = [];
  for (const [code, items] of Object.entries(codeMap)) {
    if (items.length < 2) continue;
    const prices = items.map(i => i["综合单价"]);
    const units = items.map(i => i["单位工程"]);
    // 检查是否在不同单位工程中出现
    const uniqueUnits = [...new Set(units)];
    if (uniqueUnits.length < 2) continue;
    // 检查价格是否不同
    const uniquePrices = [...new Set(prices.filter(p => p > 0))];
    if (uniquePrices.length < 2) continue;

    diffs.push({
      项目编码: code,
      项目名称: items[0]["项目名称"],
      计量单位: items[0]["计量单位"],
      出现次数: items.length,
      最低单价: Math.min(...prices.filter(p => p > 0)),
      最高单价: Math.max(...prices.filter(p => p > 0)),
      单价差异: Math.max(...prices.filter(p => p > 0)) - Math.min(...prices.filter(p => p > 0)),
      涉及单位工程: uniqueUnits.join(", "),
      明细: items.map(i => ({
        单位工程: i["单位工程"],
        分部工程: i["分部工程"],
        工程量: i["工程量"],
        综合单价: i["综合单价"],
        合价: i["合价"]
      }))
    });
  }

  // 按单价差异降序排列
  diffs.sort((a, b) => b.单价差异 - a.单价差异);

  console.log(`\n发现 ${diffs.length} 组同编码不同价的清单项:\n`);

  if (diffs.length === 0) {
    console.log("  未发现同编码不同价的清单项。");
  } else {
    const showCount = Math.min(diffs.length, 50);
    for (let i = 0; i < showCount; i++) {
      const d = diffs[i];
      console.log(`[${i + 1}] ${d.项目编码} ${d.项目名称}`);
      console.log(`    计量单位: ${d.计量单位}  出现: ${d.出现次数}次  单价差异: ${d.单价差异.toFixed(2)} 元`);
      console.log(`    最低: ${d.最低单价.toFixed(2)}  最高: ${d.最高单价.toFixed(2)}`);
      console.log(`    涉及: ${d.涉及单位工程}`);
      for (const m of d.明细) {
        console.log(`      ${m.单位工程} | ${m.分部工程} | 工程量: ${m.工程量} | 单价: ${m.综合单价} | 合价: ${m.合价.toFixed(2)}`);
      }
      console.log("");
    }
    if (diffs.length > showCount) {
      console.log(`... 还有 ${diffs.length - showCount} 组（已按差异金额降序排列）`);
    }
  }

  console.log("=".repeat(70));
  return diffs;
}

/**
 * 按关键词搜索清单
 */
function searchItems(data, keyword) {
  console.log("\n" + "=".repeat(70));
  console.log(`清单搜索: "${keyword}"`);
  console.log("=".repeat(70));

  const results = data.allItems.filter(item => {
    const name = item["项目名称"] || "";
    const desc = item["项目特征描述"] || "";
    const code = item["项目编码"] || "";
    const kw = keyword.toLowerCase();
    return name.toLowerCase().includes(kw) ||
           desc.toLowerCase().includes(kw) ||
           code.includes(keyword);
  });

  console.log(`\n找到 ${results.length} 条匹配记录:\n`);

  // 汇总统计
  const totalQty = results.reduce((s, i) => s + i["工程量"], 0);
  const totalAmount = results.reduce((s, i) => s + i["合价"], 0);
  const avgPrice = totalQty > 0 ? totalAmount / totalQty : 0;

  console.log(`  汇总: 总工程量 ${totalQty.toFixed(2)}  总造价 ${totalAmount.toFixed(2)} 元  平均单价 ${avgPrice.toFixed(2)}`);

  // 按单位工程分组
  const byUnit = {};
  for (const item of results) {
    const u = item["单位工程"];
    if (!byUnit[u]) byUnit[u] = { count: 0, qty: 0, amount: 0 };
    byUnit[u].count++;
    byUnit[u].qty += item["工程量"];
    byUnit[u].amount += item["合价"];
  }

  console.log("\n  各单位工程分布:");
  for (const [unit, stat] of Object.entries(byUnit).sort((a, b) => b[1].amount - a[1].amount)) {
    console.log(`    ${unit}: ${stat.count}项  工程量 ${stat.qty.toFixed(2)}  造价 ${stat.amount.toFixed(2)} 元`);
  }

  // 显示明细（最多50条）
  const showCount = Math.min(results.length, 50);
  console.log("\n  明细:");
  for (let i = 0; i < showCount; i++) {
    const item = results[i];
    console.log(`    ${item["项目编码"]} | ${item["单位工程"]} | ${item["项目名称"]}`);
    console.log(`      单位: ${item["计量单位"]}  工程量: ${item["工程量"]}  单价: ${item["综合单价"]}  合价: ${item["合价"].toFixed(2)}`);
  }
  if (results.length > showCount) {
    console.log(`    ... 还有 ${results.length - showCount} 条`);
  }

  console.log("\n" + "=".repeat(70));
  return results;
}

/**
 * 按编码前缀汇总
 */
function summaryByPrefix(data, prefix) {
  console.log("\n" + "=".repeat(70));
  console.log(`编码汇总: 前缀 "${prefix}"`);
  console.log("=".repeat(70));

  const results = data.allItems.filter(item => {
    const code = item["项目编码"] || "";
    return code.startsWith(prefix);
  });

  console.log(`\n匹配清单项: ${results.length} 条\n`);

  if (results.length === 0) {
    console.log("  未找到匹配的清单项。");
    console.log("\n" + "=".repeat(70));
    return;
  }

  // 汇总
  const totalQty = results.reduce((s, i) => s + i["工程量"], 0);
  const totalAmount = results.reduce((s, i) => s + i["合价"], 0);
  console.log(`  总造价: ${totalAmount.toFixed(2)} 元`);

  // 按项目编码分组
  const byCode = {};
  for (const item of results) {
    const code = item["项目编码"];
    if (!byCode[code]) {
      byCode[code] = { 项目编码: code, 项目名称: item["项目名称"], 计量单位: item["计量单位"], items: [] };
    }
    byCode[code].items.push(item);
  }

  console.log(`  不同编码数: ${Object.keys(byCode).length}\n`);

  // 按合价排序显示
  const sorted = Object.values(byCode).sort((a, b) => {
    const totalA = a.items.reduce((s, i) => s + i["合价"], 0);
    const totalB = b.items.reduce((s, i) => s + i["合价"], 0);
    return totalB - totalA;
  });

  const showCount = Math.min(sorted.length, 30);
  for (let i = 0; i < showCount; i++) {
    const g = sorted[i];
    const qty = g.items.reduce((s, i) => s + i["工程量"], 0);
    const amount = g.items.reduce((s, i) => s + i["合价"], 0);
    const units = [...new Set(g.items.map(i => i["单位工程"]))];
    console.log(`  ${g.项目编码} ${g.项目名称}`);
    console.log(`    单位: ${g.计量单位}  总工程量: ${qty.toFixed(2)}  总造价: ${amount.toFixed(2)} 元`);
    console.log(`    涉及: ${units.join(", ")}`);
  }
  if (sorted.length > showCount) {
    console.log(`  ... 还有 ${sorted.length - showCount} 个编码`);
  }

  console.log("\n" + "=".repeat(70));
}

/**
 * 全费用价格计算
 */
function calcFullCost(data) {
  console.log("\n" + "=".repeat(70));
  console.log("全费用价格计算");
  console.log("=".repeat(70));

  // 从 C.4 提取四大费用
  const ps = data.projectSummary;
  function getAmountBySeq(seqPrefix) {
    for (const row of ps) {
      if (row["序号"] === seqPrefix || row["序号"].startsWith(seqPrefix + ".")) {
        if (!row["序号"].includes(".", seqPrefix.length > 1 ? seqPrefix.length : 0)) {
          // 精确匹配层级
        }
      }
    }
    // 直接查找序号完全匹配的
    const match = ps.find(r => r["序号"] === seqPrefix);
    return match ? match["金额"] : 0;
  }

  const feeA = ps.find(r => r["序号"] === "1")?.["金额"] || 0;   // 分部分项工程费
  const feeB = ps.find(r => r["序号"] === "2")?.["金额"] || 0;   // 措施项目费
  const feeC = ps.find(r => r["序号"] === "3")?.["金额"] || 0;   // 其他项目费
  const feeD = ps.find(r => r["序号"] === "4")?.["金额"] || 0;   // 增值税
  const totalCost = ps.find(r => r["序号"].includes("合计"))?.["金额"] ||
                    (feeA + feeB + feeC + feeD);

  console.log("\n--- 费用构成 ---");
  console.log(`  分部分项工程费 (A): ${feeA.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} 元`);
  console.log(`  措施项目费     (B): ${feeB.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} 元`);
  console.log(`  其他项目费     (C): ${feeC.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} 元`);
  console.log(`  增值税         (D): ${feeD.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} 元`);
  console.log(`  合计              : ${totalCost.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} 元`);

  // 计算综合费率
  const measureRate = feeA > 0 ? feeB / feeA : 0;
  const vatRate = (feeA + feeB + feeC) > 0 ? feeD / (feeA + feeB + feeC) : 0;

  console.log("\n--- 综合费率 ---");
  console.log(`  措施费分摊率 (B/A): ${(measureRate * 100).toFixed(4)}%`);
  console.log(`  综合税率 D/(A+B+C): ${(vatRate * 100).toFixed(4)}%`);

  // 各单位工程的全费用计算
  const unitStats = {};
  for (const item of data.allItems) {
    const u = item["单位工程"];
    if (!unitStats[u]) unitStats[u] = { 工程费: 0, 清单数: 0 };
    unitStats[u].工程费 += item["合价"];
    unitStats[u].清单数++;
  }

  console.log("\n--- 各单位工程全费用 ---");
  console.log("  单位工程               分部分项费          措施费分摊        税金              全费用");
  console.log("  " + "-".repeat(90));
  for (const [unit, stat] of Object.entries(unitStats).sort((a, b) => b[1].工程费 - a[1].工程费)) {
    const a = stat.工程费;
    const b = a * measureRate;
    const base = a + b;
    const d = base * vatRate;
    const full = base + d;
    console.log(`  ${unit.padEnd(20)} ${a.toFixed(2).padStart(16)} ${b.toFixed(2).padStart(16)} ${d.toFixed(2).padStart(16)} ${full.toFixed(2).padStart(16)}`);
  }

  // 增值税明细
  if (data.vatData.length > 0) {
    console.log("\n--- 增值税明细 (C.15) ---");
    const vatByUnit = {};
    for (const v of data.vatData) {
      const key = v.unit || "项目级";
      if (!vatByUnit[key]) vatByUnit[key] = [];
      vatByUnit[key].push(v);
    }
    for (const [unit, vats] of Object.entries(vatByUnit)) {
      console.log(`\n  ${unit}:`);
      for (const v of vats) {
        console.log(`    ${v.项目名称} | 基础: ${v.计算基础.toFixed(2)} | 税率: ${v.费率}% | 税额: ${v.金额.toFixed(2)}`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
}

/**
 * 修改前后对比
 */
function diffFiles(data1, filePath2) {
  console.log("\n" + "=".repeat(70));
  console.log("修改前后对比分析");
  console.log("=".repeat(70));

  const data2 = loadGlodonFile(filePath2);

  // 建立编码索引
  const map1 = {};
  for (const item of data1.allItems) {
    map1[item["项目编码"]] = item;
  }
  const map2 = {};
  for (const item of data2.allItems) {
    map2[item["项目编码"]] = item;
  }

  const codes1 = new Set(Object.keys(map1));
  const codes2 = new Set(Object.keys(map2));

  // 新增项
  const added = [...codes2].filter(c => !codes1.has(c));
  // 删除项
  const removed = [...codes1].filter(c => !codes2.has(c));
  // 共同项
  const common = [...codes1].filter(c => codes2.has(c));

  // 价格变动
  const priceChanged = [];
  const qtyChanged = [];
  for (const code of common) {
    const i1 = map1[code];
    const i2 = map2[code];
    if (i1["综合单价"] !== i2["综合单价"]) {
      priceChanged.push({
        项目编码: code,
        项目名称: i1["项目名称"],
        修改前单价: i1["综合单价"],
        修改后单价: i2["综合单价"],
        单价差异: i2["综合单价"] - i1["综合单价"],
        修改前合价: i1["合价"],
        修改后合价: i2["合价"],
        合价差异: i2["合价"] - i1["合价"]
      });
    }
    if (i1["工程量"] !== i2["工程量"]) {
      qtyChanged.push({
        项目编码: code,
        项目名称: i1["项目名称"],
        修改前工程量: i1["工程量"],
        修改后工程量: i2["工程量"],
        工程量差异: i2["工程量"] - i1["工程量"]
      });
    }
  }

  // 统计
  console.log(`\n文件1: ${data1.filePath} (${data1.allItems.length} 项)`);
  console.log(`文件2: ${filePath2} (${data2.allItems.length} 项)`);
  console.log(`\n--- 变动概要 ---`);
  console.log(`  共同清单: ${common.length} 项`);
  console.log(`  新增清单: ${added.length} 项`);
  console.log(`  删除清单: ${removed.length} 项`);
  console.log(`  单价变动: ${priceChanged.length} 项`);
  console.log(`  工程量变动: ${qtyChanged.length} 项`);

  // 造价总差异
  const total1 = data1.allItems.reduce((s, i) => s + i["合价"], 0);
  const total2 = data2.allItems.reduce((s, i) => s + i["合价"], 0);
  console.log(`\n--- 造价对比 ---`);
  console.log(`  修改前分部分项费: ${total1.toFixed(2)} 元`);
  console.log(`  修改后分部分项费: ${total2.toFixed(2)} 元`);
  console.log(`  差额: ${(total2 - total1).toFixed(2)} 元 (${((total2 - total1) / total1 * 100).toFixed(2)}%)`);

  // 新增项明细
  if (added.length > 0) {
    console.log("\n--- 新增清单 ---");
    const showCount = Math.min(added.length, 20);
    for (let i = 0; i < showCount; i++) {
      const item = map2[added[i]];
      console.log(`  ${item["项目编码"]} ${item["项目名称"]} | ${item["单位工程"]} | 单价: ${item["综合单价"]} | 合价: ${item["合价"].toFixed(2)}`);
    }
    if (added.length > showCount) console.log(`  ... 还有 ${added.length - showCount} 项`);
  }

  // 删除项明细
  if (removed.length > 0) {
    console.log("\n--- 删除清单 ---");
    const showCount = Math.min(removed.length, 20);
    for (let i = 0; i < showCount; i++) {
      const item = map1[removed[i]];
      console.log(`  ${item["项目编码"]} ${item["项目名称"]} | ${item["单位工程"]} | 单价: ${item["综合单价"]}`);
    }
    if (removed.length > showCount) console.log(`  ... 还有 ${removed.length - showCount} 项`);
  }

  // 单价变动（按差异金额排序）
  if (priceChanged.length > 0) {
    priceChanged.sort((a, b) => Math.abs(b.合价差异) - Math.abs(a.合价差异));
    console.log("\n--- 单价变动（按合价差异排序） ---");
    const showCount = Math.min(priceChanged.length, 30);
    for (let i = 0; i < showCount; i++) {
      const d = priceChanged[i];
      const dir = d.单价差异 > 0 ? "↑" : "↓";
      console.log(`  ${d.项目编码} ${d.项目名称}`);
      console.log(`    单价: ${d.修改前单价} → ${d.修改后单价} (${dir}${Math.abs(d.单价差异).toFixed(2)}) | 合价差: ${d.合价差异.toFixed(2)}`);
    }
    if (priceChanged.length > showCount) console.log(`  ... 还有 ${priceChanged.length - showCount} 项`);
  }

  // 工程量变动
  if (qtyChanged.length > 0) {
    qtyChanged.sort((a, b) => Math.abs(b.工程量差异) - Math.abs(a.工程量差异));
    console.log("\n--- 工程量变动（按差异排序） ---");
    const showCount = Math.min(qtyChanged.length, 20);
    for (let i = 0; i < showCount; i++) {
      const d = qtyChanged[i];
      const dir = d.工程量差异 > 0 ? "↑" : "↓";
      console.log(`  ${d.项目编码} ${d.项目名称}: ${d.修改前工程量} → ${d.修改后工程量} (${dir}${Math.abs(d.工程量差异).toFixed(2)})`);
    }
    if (qtyChanged.length > showCount) console.log(`  ... 还有 ${qtyChanged.length - showCount} 项`);
  }

  console.log("\n" + "=".repeat(70));
}

/**
 * 执行自定义 SQL 查询
 * 列名使用英文别名（AlaSQL限制），显示时翻译为中文
 */
function executeSQL(data, sql) {
  // 安全检查
  const upper = sql.toUpperCase();
  const forbidden = ["UPDATE", "DELETE", "INSERT", "DROP", "CREATE", "ALTER", "TRUNCATE", "REPLACE"];
  for (const kw of forbidden) {
    if (upper.includes(kw)) {
      console.error(`禁止的操作: ${kw}。仅支持 SELECT 查询。`);
      process.exit(1);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`SQL: ${sql}`);
  console.log("=".repeat(70) + "\n");

  try {
    const result = alasql(sql);
    console.log(`查询结果: ${result.length} 条\n`);

    // 翻译列名为中文
    const EN_TO_CN = {
      seq: "序号", code: "项目编码", name: "项目名称",
      desc: "项目特征描述", content: "工作内容", unit: "计量单位",
      qty: "工程量", price: "综合单价", total: "合价",
      labor: "人工费", mat_est: "材料暂估价", remark: "备注",
      unit_project: "单位工程", division: "分部工程", sheet_unit: "Sheet归属",
      amount: "金额", content_col: "汇总内容", rate: "费率",
      base: "计算基础", base_desc: "计算基础说明", sheet: "Sheet",
      division_count: "分部数"
    };

    const translated = result.map(row => {
      const r = {};
      for (const [k, v] of Object.entries(row)) {
        r[EN_TO_CN[k] || k] = v;
      }
      return r;
    });

    if (translated.length <= 100) {
      console.table(translated);
    } else {
      console.table(translated.slice(0, 50));
      console.log(`... 还有 ${translated.length - 50} 条`);
    }
  } catch (err) {
    console.error(`SQL 错误: ${err.message}`);
    console.log("\n可用表及列名映射:");
    console.log("  bq_items (分部分项清单明细):");
    console.log("    code=项目编码, name=项目名称, unit_project=单位工程, division=分部工程,");
    console.log("    unit=计量单位, qty=工程量, price=综合单价, total=合价, labor=人工费");
    console.log("  project_summary (C.4项目汇总): seq=序号, content=汇总内容, amount=金额");
    console.log("  measures (措施项目): seq, code, name, amount, remark");
    console.log("  vat (增值税): sheet, unit, name, base, rate, amount");
    console.log("\n示例:");
    console.log("  SELECT code, name, unit_project, price FROM bq_items WHERE price > 1000 LIMIT 20");
    console.log("  SELECT unit_project, COUNT(*) FROM bq_items GROUP BY unit_project");
    console.log("  SELECT code, name, MIN(price), MAX(price) FROM bq_items GROUP BY code, name HAVING MIN(price) <> MAX(price) LIMIT 20");
  }

  console.log("\n" + "=".repeat(70));
}

// ============================================================================
// 五、主入口
// ============================================================================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(`
广联达清单计价 Excel 分析工具 (Glodon-AlaSQL)

用法:
  node skill.js <文件路径>                            数据概览
  node skill.js <文件路径> compare-prices             同清单比价分析
  node skill.js <文件路径> search "关键词"            按关键词搜索清单
  node skill.js <文件路径> summary --prefix "0105"    按编码前缀汇总
  node skill.js <文件路径> full-cost                  全费用计算
  node skill.js <文件路径> diff <文件2路径>           修改前后对比
  node skill.js <文件路径> "SELECT ..."              自定义SQL查询

示例:
  node skill.js "D:/data/某某某工程.xlsx"
  node skill.js "D:/data/某某某工程.xlsx" compare-prices
  node skill.js "D:/data/某某某工程.xlsx" search "混凝土"
  node skill.js "D:/data/某某某工程.xlsx" summary --prefix "0105"
  node skill.js "D:/data/某某某工程.xlsx" full-cost
  node skill.js "D:/data/修改前.xlsx" diff "D:/data/修改后.xlsx"
  node skill.js "D:/data/某某某工程.xlsx" "SELECT 项目编码, 项目名称, 综合单价 FROM bq_items WHERE 综合单价 > 1000 LIMIT 20"
`);
    process.exit(0);
  }

  const filePath = args[0];
  const command = args[1] || "";

  // 加载文件
  const data = loadGlodonFile(filePath);

  if (!command) {
    showOverview(data);
  } else if (command === "compare-prices") {
    comparePrices(data);
  } else if (command === "search") {
    const keyword = args[2] || "";
    if (!keyword) {
      console.error("请提供搜索关键词: node skill.js <文件> search \"关键词\"");
      process.exit(1);
    }
    searchItems(data, keyword);
  } else if (command === "summary") {
    const prefixIdx = args.indexOf("--prefix");
    const prefix = prefixIdx >= 0 ? args[prefixIdx + 1] : "";
    if (!prefix) {
      console.error("请提供编码前缀: node skill.js <文件> summary --prefix \"0105\"");
      process.exit(1);
    }
    summaryByPrefix(data, prefix);
  } else if (command === "full-cost") {
    calcFullCost(data);
  } else if (command === "diff") {
    const file2 = args[2] || "";
    if (!file2) {
      console.error("请提供对比文件: node skill.js <文件1> diff <文件2>");
      process.exit(1);
    }
    diffFiles(data, file2);
  } else if (command.toUpperCase().startsWith("SELECT")) {
    // 将剩余参数拼接为完整SQL
    const sql = args.slice(1).join(" ");
    executeSQL(data, sql);
  } else {
    // 尝试作为SQL
    const sql = args.slice(1).join(" ");
    if (sql.toUpperCase().startsWith("SELECT")) {
      executeSQL(data, sql);
    } else {
      console.error(`未知命令: ${command}`);
      console.log("可用命令: compare-prices, search, summary, full-cost, diff");
      process.exit(1);
    }
  }
}

main();
