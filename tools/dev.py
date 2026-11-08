"""Loopback-only browser preview with an automatic local session."""
import argparse
from datetime import datetime, timedelta, timezone
import ipaddress
import os
from pathlib import Path
import secrets


ROOT = Path(__file__).resolve().parents[1]


def create_preview(data_dir=None, *, start_worker=True):
    directory = Path(data_dir or ROOT / '.test-data/local-preview').resolve()
    # main also constructs its normal ASGI app when imported. Isolate that store.
    os.environ['DATA_DIR'] = str(directory)
    from backend.main import create_app, digest, password_hash
    from backend.store import now
    from starlette.responses import Response

    app = create_app(directory, start_worker=start_worker)
    store = app.state.store
    if not store.one('SELECT id FROM account'):
        store.execute('INSERT OR IGNORE INTO account VALUES(1,?,?)',
                      ('本地预览', password_hash(secrets.token_urlsafe(32))))

    @app.middleware('http')
    async def local_browser_session(request, call_next):
        try:
            local = request.client and ipaddress.ip_address(request.client.host).is_loopback
        except ValueError:
            local = False
        if not local or request.url.hostname not in {'127.0.0.1', 'localhost', '::1'}:
            return Response('本地预览仅限本机访问', status_code=403)

        token = None
        if request.method == 'GET' and request.url.path == '/':
            cookie = request.cookies.get('bookmark_session')
            session = store.one('SELECT hash FROM sessions WHERE hash=? AND expires>?',
                                (digest(cookie), now())) if cookie else None
            if not session:
                token = secrets.token_urlsafe(32)
                expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
                store.execute('INSERT INTO sessions VALUES(?,?)', (digest(token), expires))
        response = await call_next(request)
        if token:
            response.set_cookie('bookmark_session', token, max_age=30*86400,
                                httponly=True, samesite='strict', secure=False)
        if request.url.path == '/':
            response.headers['Cache-Control'] = 'no-store'
        return response

    return app


def main():
    parser = argparse.ArgumentParser(description='仅本机访问的免密码预览，使用独立开发数据。')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--data-dir', type=Path, default=ROOT / '.test-data/local-preview')
    args = parser.parse_args()
    if not (ROOT / 'web/dist/index.html').is_file():
        parser.error('请先在 web 目录执行 npm run build')
    import uvicorn
    uvicorn.run(create_preview(args.data_dir), host='127.0.0.1', port=args.port,
                proxy_headers=False, access_log=False)


if __name__ == '__main__':
    main()
