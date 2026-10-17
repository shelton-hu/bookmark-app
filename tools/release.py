"""Publish a committed source snapshot with a new version and a verified latest alias."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile


VERSION = re.compile(r'^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
ANNOTATION = 'org.opencontainers.image.version'


class ReleaseError(RuntimeError):
    pass


def version_parts(value):
    match = VERSION.fullmatch(value)
    if not match or len(value) > 128:
        raise ReleaseError('版本号必须使用 v主版本.次版本.补丁版本，例如 v1.2.3。')
    return tuple(map(int, match.groups()))


def next_version(value, bump='patch'):
    major, minor, patch = version_parts(value)
    if bump == 'major':
        major, minor, patch = major + 1, 0, 0
    elif bump == 'minor':
        minor, patch = minor + 1, 0
    elif bump == 'patch':
        patch += 1
    else:
        raise ReleaseError('BUMP 仅支持 patch、minor 或 major。')
    return f'v{major}.{minor}.{patch}'


def manifest(reference):
    result = subprocess.run(['docker', 'buildx', 'imagetools', 'inspect', '--raw', reference], capture_output=True)
    if result.returncode:
        detail = (result.stderr + result.stdout).decode('utf-8', errors='replace').strip()
        if re.search(r'manifest unknown|no such manifest|:\s*not found\s*$', detail, re.I):
            return None
        raise ReleaseError(f'无法检查镜像 {reference}，请检查仓库登录和网络。\n{detail}')
    try:
        data = json.loads(result.stdout)
        if not isinstance(data, dict) or data.get('schemaVersion') != 2 or not isinstance(data.get('annotations', {}), dict):
            raise ValueError('Invalid manifest')
        data['digest'] = 'sha256:' + hashlib.sha256(result.stdout).hexdigest()
        return data
    except (ValueError, KeyError, TypeError) as exc:
        raise ReleaseError(f'镜像仓库返回了无法识别的清单：{reference}') from exc


def choose_version(image, recorded='v0.0.0', bump='patch', explicit=''):
    version_parts(recorded)
    latest = manifest(image + ':latest')
    remote = (latest or {}).get('annotations', {}).get(ANNOTATION)
    if latest and not remote and recorded == 'v0.0.0' and not explicit:
        raise ReleaseError('远端 latest 没有版本信息。首次接管请使用 TAG=v主版本.次版本.补丁版本。')
    base = max([recorded, remote or 'v0.0.0'], key=version_parts)
    candidate = explicit or next_version(base, bump)
    if version_parts(candidate) <= version_parts(base):
        raise ReleaseError(f'新版本必须高于上次成功发布的 {base}。')
    for _ in range(1000):
        if manifest(image + ':' + candidate) is None:
            return base, candidate
        if explicit:
            raise ReleaseError(f'{candidate} 已存在，本次不会覆盖。请使用新的版本号。')
        candidate = next_version(candidate)
    raise ReleaseError('连续版本均已占用，请核对发布记录或显式指定 TAG。')


def configuration(environ):
    image = environ.get('IMAGE', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.:-]*/[a-z0-9][a-z0-9._/-]*', image) or 'your-' in image:
        raise ReleaseError('请先在 .env.release 配置完整 IMAGE（包含仓库域名、命名空间和镜像名，不带 tag）。')
    registry = image.split('/', 1)[0]
    if not ('.' in registry or ':' in registry or registry == 'localhost') or environ.get('REGISTRY', registry) != registry:
        raise ReleaseError('REGISTRY 必须与 IMAGE 中的仓库域名一致，避免上传到错误仓库。')
    platforms = environ.get('PLATFORMS') or 'linux/amd64,linux/arm64'
    values = platforms.split(',')
    if len(set(values)) != len(values) or any(value not in ['linux/amd64', 'linux/arm64'] for value in values):
        raise ReleaseError('PLATFORMS 支持 linux/amd64、linux/arm64，使用逗号分隔且不重复。')
    return image, values


@contextmanager
def release_lock(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (directory / 'lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ReleaseError('本机已有发布任务正在运行，请等待完成后重试。') from exc
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def read_records(path):
    if not path.exists():
        return {}
    try:
        records = json.loads(path.read_text())
        if not isinstance(records, dict) or any(not isinstance(row, dict) for row in records.values()):
            raise ValueError('Invalid release state')
        for row in records.values():
            version_parts(row['version'])
        return records
    except (ValueError, KeyError, TypeError) as exc:
        raise ReleaseError('本机 .release/state.json 格式不正确，请先核对已有发布记录。') from exc


def write_records(path, records):
    # Replace atomically only after both the version and latest were verified.
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def export_source(root, revision, destination):
    archive = subprocess.check_output(['git', 'archive', '--format=tar', revision], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for entry in source:
            name = PurePosixPath(entry.name)
            if name.is_absolute() or '..' in name.parts or not (entry.isfile() or entry.isdir()):
                raise ReleaseError(f'不支持的构建源路径：{entry.name}')
            target = destination.joinpath(*name.parts)
            if entry.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.extractfile(entry).read())
                target.chmod(entry.mode & 0o777)


def verify_image(data, platforms, tag):
    observed = {f"{row.get('platform', {}).get('os')}/{row.get('platform', {}).get('architecture')}"
                for row in (data or {}).get('manifests', [])}
    if observed != set(platforms) or (data or {}).get('annotations', {}).get(ANNOTATION) != tag:
        raise ReleaseError('远端镜像的架构或版本信息不匹配，本次不更新 latest。')


def execute(arguments, cwd=None):
    subprocess.run(arguments, cwd=cwd, check=True)


def release(root, dry_run=False):
    image, platforms = configuration(os.environ)
    directory = root / '.release'
    # Planning is read-only: it neither locks nor creates local release state.
    if dry_run:
        records = read_records(directory / 'state.json')
        base, tag = choose_version(image, records.get(image, {}).get('version', 'v0.0.0'),
                                   os.environ.get('BUMP') or 'patch', os.environ.get('TAG') or '')
        print(f'版本：{base} → {tag}\n目标：{image}:{tag}\n平台：{",".join(platforms)}\n同时更新：{image}:latest\n仅预览，未构建、未上传。', flush=True)
        return
    with release_lock(directory):
        status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=root, text=True)
        if status.strip():
            raise ReleaseError('发布使用已提交的源码。请先提交代码变更；本机配置和被忽略的数据不参与发布。')
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
        records = read_records(directory / 'state.json')
        base, tag = choose_version(image, records.get(image, {}).get('version', 'v0.0.0'),
                                   os.environ.get('BUMP') or 'patch', os.environ.get('TAG') or '')
        print(f'发布：{base} → {tag}\n镜像：{image}:{tag}\n源码：{revision}', flush=True)
        with tempfile.TemporaryDirectory(prefix='source-', dir=directory) as temporary:
            context = Path(temporary)
            export_source(root, revision, context)
            execute(['make', '--no-print-directory', '_publish', f'TAG={tag}', f'IMAGE={image}',
                     f'PLATFORMS={",".join(platforms)}'], cwd=context)
        published = manifest(image + ':' + tag)
        verify_image(published, platforms, tag)
        execute(['docker', 'buildx', 'imagetools', 'create', '--tag', image + ':latest',
                 image + '@' + published['digest']])
        latest = manifest(image + ':latest')
        if not latest or latest['digest'] != published['digest']:
            raise ReleaseError(f'{tag} 已上传，但 latest 校验失败，未写入成功记录。')
        records[image] = {'version': tag, 'digest': published['digest'], 'revision': revision,
                          'published_at': datetime.now(timezone.utc).isoformat()}
        write_records(directory / 'state.json', records)
        print(f'发布成功：{image}:{tag}\nlatest 已同步：{image}:latest\n摘要：{published["digest"]}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='只查询下一版本，不构建、不上传')
    options = parser.parse_args()
    try:
        release(Path(__file__).resolve().parent.parent, options.dry_run)
    except (ReleaseError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'发布停止：{exc}\n')


if __name__ == '__main__':
    main()
