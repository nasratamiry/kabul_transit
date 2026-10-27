"""
Light load on a running stack: N branch managers working at the same time for a few minutes.
For the throwaway local test stack (scripts/prod_local_test.ps1), never a live server.

    python scripts/load_test.py --base-url http://localhost:8080 --users 20 --seconds 120

Needs KC_ADMIN_USER / KC_ADMIN_PASS (a super admin) and at least one branch. Creates N temporary
branch managers (random passwords) through the API, lets each one log in and work through the
everyday pages (dashboard, transactions, rates, hawala, office expenses, documents) about once a
second, which stays under the per-user throttle, then deletes the users again. Prints requests,
errors and latency (p50 / p95 / max) as one JSON line.
"""
import argparse
import json
import os
import secrets
import statistics
import threading
import time
import urllib.error
import urllib.request

PAGES = ['/dashboard/summary/', '/transactions/?page=1', '/exchange-rates/', '/hawala/?page=1',
         '/office-expenses/?page=1', '/documents/?page=1', '/auth/me/']


def call(base, method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f'{base}/api{path}', data=data, method=method)
    request.add_header('Content-Type', 'application/json')
    if token:
        request.add_header('Authorization', f'Bearer {token}')
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        payload, status = exc.read(), exc.code
    elapsed = time.perf_counter() - start
    try:
        parsed = json.loads(payload) if payload else None
    except ValueError:
        parsed = None
    return status, parsed, elapsed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://localhost:8080')
    parser.add_argument('--users', type=int, default=20)
    parser.add_argument('--seconds', type=int, default=120)
    options = parser.parse_args()
    base = options.base_url.rstrip('/')

    status, data, _ = call(base, 'POST', '/auth/login/',
                           body={'username': os.environ['KC_ADMIN_USER'], 'password': os.environ['KC_ADMIN_PASS']})
    if status != 200:
        raise SystemExit(f'admin login failed: {status}')
    admin = data['access']
    _, branches, _ = call(base, 'GET', '/branches/', admin)
    branch = (branches['results'] if isinstance(branches, dict) else branches)[0]['id']

    users = []
    try:
        for i in range(options.users):
            password = secrets.token_urlsafe(18)
            status, created, _ = call(base, 'POST', '/users/', admin, {
                'username': f'load_{i:02d}_{secrets.token_hex(3)}', 'password': password,
                'role': 'branch_manager', 'branch': branch})
            if status != 201:
                raise SystemExit(f'could not create load user: {status} {created}')
            users.append((created['id'], created['username'], password))

        timings, statuses, lock = [], {}, threading.Lock()
        deadline = time.time() + options.seconds

        def worker(username, password):
            status, data, _ = call(base, 'POST', '/auth/login/', body={'username': username, 'password': password})
            if status != 200:
                with lock:
                    statuses[f'login {status}'] = statuses.get(f'login {status}', 0) + 1
                return
            token, n = data['access'], 0
            while time.time() < deadline:
                status, _, elapsed = call(base, 'GET', PAGES[n % len(PAGES)], token)
                n += 1
                with lock:
                    timings.append(elapsed)
                    statuses[status] = statuses.get(status, 0) + 1
                time.sleep(max(0.0, 1.0 - elapsed))

        threads = [threading.Thread(target=worker, args=(name, password)) for _, name, password in users]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        for user_id, _, _ in users:
            call(base, 'DELETE', f'/users/{user_id}/', admin)

    timings.sort()
    ok = sum(count for status, count in statuses.items() if status == 200)
    print(json.dumps({
        'users': options.users, 'seconds': options.seconds, 'requests': len(timings), 'ok': ok,
        'statuses': {str(k): v for k, v in statuses.items()},
        'p50_ms': round(statistics.median(timings) * 1000) if timings else None,
        'p95_ms': round(timings[int(len(timings) * 0.95) - 1] * 1000) if timings else None,
        'max_ms': round(timings[-1] * 1000) if timings else None,
    }))
    return 0 if timings and ok == len(timings) else 1


if __name__ == '__main__':
    raise SystemExit(main())
