"""Back up and verify the mirror without modifying or deleting source files."""
import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid
import zipfile


def save_json(target, value):
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def read_file(item):
    source, name = item
    before = source.stat()
    data = source.read_bytes()
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or len(data) != after.st_size:
        raise RuntimeError(f'Source changed during read: {name}')
    return data, {'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                  'source_mtime_ns': after.st_mtime_ns}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    local = Path(os.environ['APPDATA']) / 'ARMI Docente'
    config = json.loads((local / 'sync-runtime/sync-config.json').read_text(encoding='utf-8-sig'))
    mirror = Path(config['mirrorPath']).resolve()
    destination = Path(args.destination).resolve()
    if destination == mirror or mirror in destination.parents:
        raise RuntimeError('Backup must be outside the mirror.')
    destination.mkdir(parents=True, exist_ok=False)
    save_json(destination / 'status.json', {'status': 'started', 'mirror': str(mirror), 'run': str(uuid.uuid4())})
    database = local / 'database/armi.db'
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as source:
        with sqlite3.connect(destination / 'local-consistent.db') as target:
            source.backup(target)
            result = target.execute('PRAGMA quick_check').fetchall()
            if result != [('ok',)]:
                raise RuntimeError(f'Invalid database backup: {result}')
    items = []
    for base, _, names in os.walk(mirror, onerror=lambda error: (_ for _ in ()).throw(error)):
        for name in names:
            source = Path(base) / name
            items.append((source, 'mirror/' + source.relative_to(mirror).as_posix()))
    for folder in ['sync-runtime', 'uploads', 'repair-records']:
        for base, _, names in os.walk(local / folder, onerror=lambda error: (_ for _ in ()).throw(error)):
            for name in names:
                source = Path(base) / name
                items.append((source, 'local/' + source.relative_to(local).as_posix()))
    entries = []
    archive = destination / 'mirror-and-local.zip'
    print(json.dumps({'phase': 'inventory', 'files': len(items), 'destination': str(destination)}), flush=True)
    with ThreadPoolExecutor(max_workers=3) as pool, zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as output:
        pending = deque()
        iterator = iter(items)
        for _ in range(3):
            item = next(iterator, None)
            if item: pending.append(pool.submit(read_file, item))
        while pending:
            data, entry = pending.popleft().result()
            output.writestr(entry['name'], data)
            entries.append(entry)
            item = next(iterator, None)
            if item: pending.append(pool.submit(read_file, item))
            if len(entries) % 500 == 0:
                print(json.dumps({'phase': 'backup', 'files': len(entries), 'total': len(items)}), flush=True)
        output.writestr('MANIFEST.json', json.dumps(entries, ensure_ascii=False))
    save_json(destination / 'manifest.json', entries)
    verified_bytes = 0
    with zipfile.ZipFile(archive) as saved:
        for index, entry in enumerate(entries, 1):
            digest = hashlib.sha256()
            size = 0
            with saved.open(entry['name']) as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
            if size != entry['bytes'] or digest.hexdigest() != entry['sha256']:
                raise RuntimeError(f'Backup verification failed: {entry["name"]}')
            verified_bytes += size
            if index % 2000 == 0:
                print(json.dumps({'phase': 'verify', 'files': index, 'total': len(entries)}), flush=True)
    result = {'status': 'verified', 'files': len(entries), 'source_bytes': verified_bytes,
              'archive_bytes': archive.stat().st_size, 'mirror': str(mirror),
              'source_modified': False, 'database_quick_check': 'ok'}
    save_json(destination / 'status.json', result)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
