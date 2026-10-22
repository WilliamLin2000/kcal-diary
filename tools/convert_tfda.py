"""把衛福部食品營養成分資料集（長表格）轉成熱量日記用的精簡 JS 檔。
用法：python -I convert_tfda.py <解壓縮資料夾> <輸出 foods-tfda.js>
"""
import json, sys, glob, os, re

src, out = sys.argv[1], sys.argv[2]
path = glob.glob(os.path.join(src, '**', '*.json'), recursive=True)[0]
with open(path, encoding='utf-8-sig') as fh:
    rows = json.load(fh)

WANT = {'修正熱量': 'kcal', '熱量': 'kcal_raw', '粗蛋白': 'p', '總碳水化合物': 'c', '粗脂肪': 'f'}


def number(s):
    try:
        return float(str(s).strip())
    except (TypeError, ValueError):
        return None


foods = {}
for r in rows:
    key = WANT.get(r.get('分析項'))
    if not key:
        continue
    fid = r['整合編號']
    f = foods.setdefault(fid, {
        'name': (r.get('樣品名稱') or '').strip(),
        'alias': (r.get('俗名') or '').strip(),
        'cat': (r.get('食品分類') or '').strip(),
        'unit_g': 0.0,
    })
    f[key] = number(r.get('每100克含量'))
    m = re.match(r'\s*([\d.]+)', r.get('每單位重') or '')
    if m and float(m.group(1)) > 0:
        f['unit_g'] = float(m.group(1))

cats = sorted({f['cat'] for f in foods.values()})
out_rows, skipped = [], 0
for fid in sorted(foods):
    f = foods[fid]
    kcal = f.get('kcal') if f.get('kcal') is not None else f.get('kcal_raw')
    if not f['name'] or kcal is None:
        skipped += 1
        continue
    r1 = lambda v: round(v or 0, 1)
    out_rows.append([f['name'], f['alias'], cats.index(f['cat']), round(kcal), r1(f.get('p')), r1(f.get('c')), r1(f.get('f')), r1(f['unit_g'])])

header = (
    '// 資料來源：衛生福利部食品藥物管理署「食品營養成分資料集」（政府資料開放授權條款第1版）\n'
    '// https://data.gov.tw/dataset/8543 ，由 convert_tfda.py 轉換產生，請勿手動修改\n'
    '// 每列：[名稱, 俗名, 分類索引, 每100g熱量(修正熱量 kcal), 蛋白質g, 碳水g, 脂肪g, 每單位重g(0=無)]\n'
)
with open(out, 'w', encoding='utf-8') as fh:
    fh.write(header)
    fh.write('const TFDA_CATS = ' + json.dumps(cats, ensure_ascii=False) + ';\n')
    fh.write('const TFDA_FOODS = [\n')
    for row in out_rows:
        fh.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + ',\n')
    fh.write('];\n')
print(f'foods={len(out_rows)} skipped={skipped} cats={len(cats)} size={os.path.getsize(out)}')
