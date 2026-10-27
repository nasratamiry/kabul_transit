"""
Print an .xlsx file's first sheet as JSON, for the E2E checks (verify-stage14.mjs):

    ..\\.venv\\Scripts\\python scripts\\xlsx_dump.py <file.xlsx>

{"title", "rtl", "freeze", "font", "rows": [[value, …], …], "numeric": [[bool, …], …]}
Numbers stay numbers (Decimal/int/float → float); "numeric" says which cells are real numbers.
"""
import json
import sys
from decimal import Decimal

from openpyxl import load_workbook

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ws = load_workbook(sys.argv[1]).active
rows, numeric = [], []
for row in ws.iter_rows(values_only=True):
    rows.append([float(v) if isinstance(v, (Decimal, int, float)) and not isinstance(v, bool) else v for v in row])
    numeric.append([isinstance(v, (Decimal, int, float)) and not isinstance(v, bool) for v in row])
print(json.dumps({
    'title': ws.title,
    'rtl': bool(ws.sheet_view.rightToLeft),
    'freeze': ws.freeze_panes,
    'font': ws['A4'].font.name,
    'rows': rows,
    'numeric': numeric,
}, ensure_ascii=False, default=str))
