#!/usr/bin/env python3
"""初始化成本数据库（空库 + 预置标准数据）

用法：python init_db.py [--db PATH]

创建 8 张表 + 预置 unit_standard / tax_rate / validation_rule / conversion_formula。
cost_item 随入库自动创建，少量预置种子。
"""

import sqlite3
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.environ.get(
    'COST_DATA_DIR',
    r'D:\iCloudDrive\iCloud~md~obsidian\QiZhi库\30_专业领域\成本数据库'
)
DEFAULT_DB = os.path.join(_DATA_DIR, '成本数据.db')


def init(db_path):
    if os.path.exists(db_path):
        print(f'数据库已存在：{db_path}')
        ans = input('是否重建？（会清空所有数据）[y/N] ').strip().lower()
        if ans != 'y':
            print('已取消')
            return
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA journal_mode=WAL')

    # ── 建表 ──

    conn.execute('''CREATE TABLE cost_item (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL,
        unit_id     INTEGER,
        aliases     TEXT DEFAULT '',
        description TEXT DEFAULT '',
        created_at  TEXT DEFAULT (datetime('now','localtime'))
    )''')
    conn.execute('CREATE UNIQUE INDEX idx_item_name_cat ON cost_item(name, category)')

    conn.execute('''CREATE TABLE cost_price (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id             INTEGER NOT NULL,
        price               REAL NOT NULL,
        unit                TEXT NOT NULL,
        date                TEXT NOT NULL,
        tax_method          TEXT DEFAULT '不详',
        tax_rate_id         INTEGER,
        price_type          TEXT DEFAULT '',
        source              TEXT DEFAULT '',
        source_person       TEXT DEFAULT '',
        location            TEXT DEFAULT '',
        project_name        TEXT DEFAULT '',
        spec                TEXT DEFAULT '',
        status              TEXT DEFAULT '待核实',
        input_device        TEXT DEFAULT '',
        source_file         TEXT DEFAULT '',
        raw_text            TEXT DEFAULT '',
        is_composite        INTEGER DEFAULT 0,
        conversion_source   TEXT DEFAULT '',
        conversion_formula  TEXT DEFAULT '',
        legacy_id           TEXT DEFAULT '',
        remark              TEXT DEFAULT '',
        created_at          TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (item_id) REFERENCES cost_item(id)
    )''')
    conn.execute('CREATE INDEX idx_price_item ON cost_price(item_id)')
    conn.execute('CREATE INDEX idx_price_date ON cost_price(date)')
    conn.execute('CREATE INDEX idx_price_location ON cost_price(location)')
    conn.execute('CREATE INDEX idx_price_project ON cost_price(project_name)')

    conn.execute('''CREATE TABLE cost_component (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        price_id        INTEGER NOT NULL,
        component_type  TEXT NOT NULL,
        price           REAL,
        remark          TEXT DEFAULT '',
        FOREIGN KEY (price_id) REFERENCES cost_price(id)
    )''')
    conn.execute('CREATE INDEX idx_component_price ON cost_component(price_id)')

    conn.execute('''CREATE TABLE cost_feature (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        price_id        INTEGER NOT NULL,
        feature_key     TEXT NOT NULL,
        feature_value   TEXT NOT NULL,
        FOREIGN KEY (price_id) REFERENCES cost_price(id)
    )''')
    conn.execute('CREATE INDEX idx_feature_kv ON cost_feature(feature_key, feature_value)')
    conn.execute('CREATE INDEX idx_feature_price ON cost_feature(price_id)')

    conn.execute('''CREATE TABLE unit_standard (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        unit            TEXT NOT NULL,
        standard_form   TEXT NOT NULL,
        precision_rule  TEXT NOT NULL DEFAULT '小数 2 位'
    )''')

    conn.execute('''CREATE TABLE tax_rate (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        rate        REAL DEFAULT 0,
        description TEXT DEFAULT ''
    )''')

    conn.execute('''CREATE TABLE validation_rule (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL,
        unit        TEXT NOT NULL,
        low_price   REAL NOT NULL,
        high_price  REAL NOT NULL
    )''')
    conn.execute('CREATE INDEX idx_val_name_unit ON validation_rule(name, unit)')

    conn.execute('''CREATE TABLE conversion_formula (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        from_unit   TEXT NOT NULL,
        to_unit     TEXT NOT NULL,
        formula     TEXT NOT NULL,
        note        TEXT DEFAULT ''
    )''')

    conn.execute('''CREATE TABLE _meta (
        key   TEXT PRIMARY KEY,
        value TEXT
    )''')
    conn.execute("INSERT INTO _meta VALUES ('version', '3.2')")

    # ── 预置数据 ──

    seed_path = os.path.join(HERE, 'seed_data.json')
    with open(seed_path, 'r', encoding='utf-8') as f:
        seed = json.load(f)

    for row in seed['unit_standard']:
        conn.execute(
            'INSERT INTO unit_standard (unit, standard_form, precision_rule) VALUES (?,?,?)',
            (row['unit'], row['standard_form'], row['precision_rule']))

    for row in seed['tax_rate']:
        conn.execute(
            'INSERT INTO tax_rate (name, rate, description) VALUES (?,?,?)',
            (row['name'], row['rate'], row['description']))

    for row in seed['cost_item']:
        conn.execute(
            'INSERT INTO cost_item (name, category, unit_id, aliases, description) VALUES (?,?,?,?,?)',
            (row['name'], row['category'], row['unit_id'], row['aliases'], row['description']))

    for row in seed['validation_rule']:
        conn.execute(
            'INSERT INTO validation_rule (name, category, unit, low_price, high_price) VALUES (?,?,?,?,?)',
            (row['name'], row['category'], row['unit'], row['low_price'], row['high_price']))

    for row in seed['conversion_formula']:
        conn.execute(
            'INSERT INTO conversion_formula (name, from_unit, to_unit, formula, note) VALUES (?,?,?,?,?)',
            (row['name'], row['from_unit'], row['to_unit'], row['formula'], row['note']))

    conn.commit()

    # ── 统计 ──
    print('数据库初始化完成：')
    for table in ['cost_item', 'cost_price', 'cost_component', 'cost_feature',
                   'unit_standard', 'tax_rate', 'validation_rule', 'conversion_formula']:
        count = conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
        print(f'  {table}: {count} rows')

    conn.close()
    print(f'\n数据库路径：{db_path}')


if __name__ == '__main__':
    db_path = DEFAULT_DB
    if len(sys.argv) >= 3 and sys.argv[1] == '--db':
        db_path = sys.argv[2]
    init(db_path)
