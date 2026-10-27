"""
Run every check of the project in one go and print a summary table.

    .venv\\Scripts\\python scripts\\run_all_checks.py            (or scripts\\run_all_checks.ps1)
    .venv/bin/python scripts/run_all_checks.py                 (or scripts/run_all_checks.sh)

Options:  --skip-e2e        backend scripts + frontend static checks only
          --only NAME ...   run just these steps (names as in the summary table)
          --base-url URL    E2E only, against a running stack (e.g. the local Docker test,
                            http://localhost:8080): only Vite is started, proxying /api to it.
                            The fixture scripts reach that stack's database through the DB_*
                            environment variables (they override .env).

1. The six backend verify scripts (each rolls back its own data).
2. Frontend static checks: typecheck, lint, production build.
3. Every E2E suite with its fixtures: setup → verify → cleanup (cleanup also runs after a
   failure). Django and Vite are started on their own ports (8010 / 5183 by default), so a
   developer's servers on 8000 / 5173 are left alone, and are always stopped at the end,
   process tree included (no orphan vite / runserver). Stage 9 runs last: its final check
   locks the test user and this IP in axes; its cleanup lifts that again.

Logs of every step: checks-output/<step>.log, screenshots: checks-output/<stage>/,
the table: checks-output/summary.md. Exit code 0 only when every step passed.
"""
import argparse
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / 'frontend'
OUT = ROOT / 'checks-output'
PYTHON = sys.executable
WINDOWS = os.name == 'nt'
API_PORT = int(os.environ.get('KC_CHECK_API_PORT', 8010))
WEB_PORT = int(os.environ.get('KC_CHECK_WEB_PORT', 5183))
NPM = 'npm.cmd' if WINDOWS else 'npm'

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BACKEND_SCRIPTS = ['verify_field_config', 'verify_transaction', 'verify_finance', 'verify_api',
                   'verify_statement', 'verify_security', 'verify_documents']

# name, fixture script, setup args, cleanup args, verify script, password env, extra env
E2E_STAGES = [
    ('e2e-stage10', 'cleanup-stage10.py', ['--setup'], ['e2e_admin', '--drop-admin'], 'verify-stage10.mjs',
     {'KC_ADMIN_USER': 'e2e_admin', 'KC_ADMIN_PASS': 'E2e-Stage10-Pass-2026'}),
    ('e2e-stage11', 'cleanup-stage11.py', ['--setup'], [], 'verify-stage11.mjs', {}),
    ('e2e-stage12a', 'cleanup-stage12a.py', ['--setup'], [], 'verify-stage12a.mjs', {}),
    ('e2e-stage12b', 'cleanup-stage12b.py', ['--setup'], [], 'verify-stage12b.mjs', {}),
    ('e2e-stage13', 'cleanup-stage13.py', ['--setup'], [], 'verify-stage13.mjs', {}),
    ('e2e-stage14', 'cleanup-stage14.py', ['--setup'], [], 'verify-stage14.mjs', {}),
    ('e2e-documents', 'cleanup-documents.py', ['--setup'], [], 'verify-documents.mjs', {}),
    ('e2e-field-settings', 'cleanup-field-settings.py', ['--setup'], [], 'verify-field-settings.mjs', {}),
    ('e2e-stage9', 'cleanup-stage9.py', ['--setup'], [], 'verify-e2e.mjs',
     {'KC_ADMIN_USER': 'e2e_admin', 'KC_ADMIN_PASS': 'E2e-Stage09-Pass-2026',
      'KC_MANAGER_USER': 'e2e_manager', 'KC_MANAGER_PASS': 'E2e-Stage09-Pass-2026'}),
]

PY_RESULT = re.compile(r'^\s*\[(OK|FAIL)\]')
JS_RESULT = re.compile(r'^\s*(PASS|FAIL)\b')
JS_TOTAL = re.compile(r'^(\d+)/(\d+) passed')


class Step:
    def __init__(self, name):
        self.name, self.status, self.passed, self.total, self.seconds, self.note = name, 'SKIP', 0, 0, 0.0, ''


def run(step, command, cwd=ROOT, env=None, timeout=1800):
    """Run one command, tee its output to checks-output/<step>.log, count its checks."""
    start = time.time()
    log = OUT / f'{step.name}.log'
    full_env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', **(env or {})}
    with open(log, 'a', encoding='utf-8') as handle:
        handle.write(f'$ {" ".join(map(str, command))}\n')
        try:
            done = subprocess.run(command, cwd=cwd, env=full_env, capture_output=True, timeout=timeout)
            output = (done.stdout + done.stderr).decode('utf-8', 'replace')
            code = done.returncode
        except subprocess.TimeoutExpired as exc:
            output = ((exc.stdout or b'') + (exc.stderr or b'')).decode('utf-8', 'replace') + '\nTIMEOUT'
            code = -1
        handle.write(output + f'\n[exit {code}]\n\n')
    step.seconds += time.time() - start
    return code, output


def count(step, output):
    lines = output.splitlines()
    totals = [JS_TOTAL.match(line) for line in lines]
    totals = [m for m in totals if m]
    if totals:
        step.passed, step.total = int(totals[-1].group(1)), int(totals[-1].group(2))
        return
    marks = [m.group(1) for m in (PY_RESULT.match(line) or JS_RESULT.match(line) for line in lines) if m]
    step.passed = sum(mark in ('OK', 'PASS') for mark in marks)
    step.total = len(marks)


def finish(step, code, output, note=''):
    step.status = 'PASS' if code == 0 else 'FAIL'
    if code != 0 and not note:
        failed = [line.strip() for line in output.splitlines() if '[FAIL]' in line or line.startswith('FAIL')]
        note = (failed[0] if failed else output.strip().splitlines()[-1] if output.strip() else '')[:110]
    step.note = note
    print(f'  {step.status:4}  {step.name}  {step.passed}/{step.total}  ({step.seconds:.0f}s)'
          f'{"  — " + step.note if step.note else ""}', flush=True)


# ---------------------------------------------------------------- servers
def port_in_use(port):
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def start(command, cwd, env, log_name):
    log = open(OUT / log_name, 'w', encoding='utf-8')
    kwargs = {'cwd': cwd, 'env': {**os.environ, 'PYTHONIOENCODING': 'utf-8', **env},
              'stdout': log, 'stderr': subprocess.STDOUT}
    if WINDOWS:
        kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs['start_new_session'] = True
    return subprocess.Popen(command, **kwargs)


def stop(process):
    """Stop a server and every process it started."""
    if process is None or process.poll() is not None:
        return
    if WINDOWS:
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()


def wait_http(url, seconds=60):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                return response.status
        except urllib.error.HTTPError as exc:  # 401 from the API is "up"
            return exc.code
        except OSError:
            time.sleep(0.5)
    raise RuntimeError(f'{url} did not answer within {seconds}s')


# ---------------------------------------------------------------- steps
def kabul_today():
    done = subprocess.run([PYTHON, 'manage.py', 'shell', '-c', 'from finance.utils import kabul_today; print(kabul_today())'],
                          cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    return done.stdout.strip().splitlines()[-1]


def foreign_usd_rate_today():
    """True when today's USD rate exists and was not entered by an E2E user (stage 10 needs none)."""
    code = ('from finance.models import ExchangeRate; from finance.utils import kabul_today; '
            "print(ExchangeRate.objects.filter(date=kabul_today(), currency='USD')"
            ".exclude(created_by__username__startswith='e2e_').exists())")
    done = subprocess.run([PYTHON, 'manage.py', 'shell', '-c', code], cwd=ROOT, capture_output=True, text=True,
                          encoding='utf-8')
    return done.stdout.strip().endswith('True')


def e2e(step, fixture, setup_args, cleanup_args, script, env, base_url, api_url):
    fixture_path = FRONTEND / 'scripts' / fixture
    shots = OUT / step.name.removeprefix('e2e-')
    env = {'KC_BASE_URL': base_url, 'KC_API_URL': api_url, 'KC_PYTHON': PYTHON, **env}
    args = [str(shots)] + ([kabul_today()] if script == 'verify-e2e.mjs' else [])
    code, output = run(step, [PYTHON, str(fixture_path), *setup_args], cwd=FRONTEND)
    if code != 0:
        finish(step, code, output, 'setup failed')
    else:
        try:
            code, output = run(step, ['node', f'scripts/{script}', *args], cwd=FRONTEND, env=env)
            count(step, output)
        finally:
            clean_code, clean_output = run(step, [PYTHON, str(fixture_path), *cleanup_args], cwd=FRONTEND)
        finish(step, code or clean_code, output if code else clean_output, '' if not clean_code or code else 'cleanup failed')


def run_stages(steps, stages, base_url, api_url):
    for name, fixture, setup_args, cleanup_args, script, env in stages:
        step = Step(name)
        steps.append(step)
        if name == 'e2e-stage10' and foreign_usd_rate_today():
            step.note = "today's USD rate already entered by a real user; stage 10 needs none"
            print(f'  SKIP  {name}  — {step.note}', flush=True)
            continue
        e2e(step, fixture, setup_args, cleanup_args, script, env, base_url, api_url)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-e2e', action='store_true')
    parser.add_argument('--only', nargs='*')
    parser.add_argument('--base-url')
    options = parser.parse_args()
    if options.base_url:
        options.only = options.only or [stage[0] for stage in E2E_STAGES]
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob('*.log'):
        old.unlink()
    wanted = (lambda name: name in options.only) if options.only else (lambda name: True)
    steps = []
    began = time.time()
    print(f'Kabul Cargo — all checks ({datetime.now():%Y-%m-%d %H:%M})\n', flush=True)

    print('1) backend verify scripts', flush=True)
    for name in BACKEND_SCRIPTS:
        if wanted(name):
            step = Step(name)
            steps.append(step)
            code, output = run(step, [PYTHON, f'scripts/{name}.py'])
            count(step, output)
            finish(step, code, output)

    print('2) frontend static checks', flush=True)
    for name, command in (('typecheck', [NPM, 'run', 'typecheck']), ('lint', [NPM, 'run', 'lint']),
                          ('build', [NPM, 'run', 'build'])):
        if wanted(name):
            step = Step(name)
            steps.append(step)
            code, output = run(step, command, cwd=FRONTEND)
            step.passed, step.total = (1 if code == 0 else 0), 1
            finish(step, code, output)

    stages = [stage for stage in E2E_STAGES if wanted(stage[0])] if not options.skip_e2e else []
    if stages:
        # With --base-url only Vite is started, its /api proxy pointed at that stack: the E2E
        # scripts read helpers from the dev server (/src/lib/date.ts …), so the UI comes from
        # Vite while every API call goes through the stack under test.
        api_base = options.base_url.rstrip('/') if options.base_url else f'http://127.0.0.1:{API_PORT}'
        ports = [WEB_PORT] if options.base_url else [API_PORT, WEB_PORT]
        print(f'3) E2E (API {api_base}, Vite :{WEB_PORT})', flush=True)
        busy = [port for port in ports if port_in_use(port)]
        if busy:
            for stage in stages:
                step = Step(stage[0])
                step.status, step.note = 'FAIL', f'port {busy} already in use — stop that process first'
                steps.append(step)
            print(f'  ports {busy} are in use; E2E not run', flush=True)
        else:
            django = vite = None
            try:
                if not options.base_url:
                    django = start([PYTHON, 'manage.py', 'runserver', f'127.0.0.1:{API_PORT}', '--noreload'],
                                   ROOT, {}, 'server-django.log')
                vite = start(['node', 'node_modules/vite/bin/vite.js', '--port', str(WEB_PORT), '--strictPort'],
                             FRONTEND, {'KC_API_TARGET': api_base}, 'server-vite.log')
                wait_http(f'{api_base}/api/health/')
                wait_http(f'http://localhost:{WEB_PORT}/')
                run_stages(steps, stages, f'http://localhost:{WEB_PORT}', f'{api_base}/api')
            finally:
                stop(vite)
                stop(django)
                left = [port for port in ports if port_in_use(port)]
                print(f'  servers stopped{"; STILL LISTENING: " + str(left) if left else " (ports free)"}', flush=True)

    passed = sum(step.passed for step in steps)
    total = sum(step.total for step in steps)
    bad = [step for step in steps if step.status == 'FAIL']
    table = ['| step | result | checks | time | note |', '| --- | --- | --- | --- | --- |']
    table += [f'| {s.name} | {s.status} | {s.passed}/{s.total} | {s.seconds:.0f}s | {s.note} |' for s in steps]
    table.append(f'| **total** | **{"FAIL" if bad else "PASS"}** | **{passed}/{total}** | '
                 f'{time.time() - began:.0f}s | |')
    summary = '\n'.join(table)
    (OUT / 'summary.md').write_text(summary + '\n', encoding='utf-8')
    print('\n' + summary)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
