"""Partition already-verified duplicates for bounded complete Drive listings."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import argparse
from concurrent.futures import ThreadPoolExecutor


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('backup')
    args = parser.parse_args()
    backup = Path(args.backup).resolve()
    result = json.loads((backup / 'cleanup-result.json').read_text())
    if not result.get('applied'):
        raise RuntimeError('Staging has not completed.')
    root = Path(result['staging']).resolve()
    mirror = Path(json.loads((backup / 'status.json').read_text())['mirror']).resolve()
    if root.parent != (mirror / '.armi-sync/diagnostics').resolve() or not root.name.startswith('cleanup-exact-duplicates-'):
        raise RuntimeError('Unexpected staging root.')
    plan = json.loads((backup / 'exact-duplicate-plan.json').read_text())
    expected = {PurePosixPath(item['name']).name: item for item in plan['candidates']}
    found = {}
    for entry in root.rglob('*'):
        if entry.is_symlink() or not entry.resolve().is_relative_to(root):
            raise RuntimeError('Unsafe entry in staging.')
        if entry.is_file():
            if entry.name in found or entry.name not in expected or entry.stat().st_size != expected[entry.name]['bytes']:
                raise RuntimeError('Unexpected staged file: ' + str(entry))
            found[entry.name] = entry
        elif entry.parent != root or not entry.name.startswith('part-'):
            raise RuntimeError('Unexpected directory in staging.')
    if found.keys() != expected.keys():
        raise RuntimeError('Staging inventory is incomplete.')
    buckets = []
    names = sorted(expected)
    for offset in range(0, len(names), 750):
        selected = names[offset:offset + 750]
        bucket = root / f'part-{offset // 750 + 1:03}'
        if bucket.resolve().parent != root:
            raise RuntimeError('Partition resolved outside staging.')
        bucket.mkdir(exist_ok=True)
        def move_one(name):
            source = found[name]
            target = bucket / name
            if target.resolve().parent != bucket.resolve() or not source.resolve().is_relative_to(root):
                raise RuntimeError('Unsafe move target.')
            if source != target:
                if target.exists():
                    raise RuntimeError('Target already exists.')
                before = source.stat()
                source.rename(target)
                after = target.stat()
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise RuntimeError('File metadata changed during move.')
        # Each source and destination is distinct and prevalidated. Drive's
        # virtual filesystem has noticeable per-call latency, so keep a small
        # bounded queue; every move is awaited before confirming the bucket.
        with ThreadPoolExecutor(max_workers=4) as workers:
            list(workers.map(move_one, selected))
        text = '\n'.join(name + '\t' + str(expected[name]['bytes']) for name in selected)
        buckets.append({'name': bucket.name, 'files': len(selected),
                        'bytes': sum(expected[name]['bytes'] for name in selected),
                        'inventorySHA256': hashlib.sha256(text.encode('ascii')).hexdigest()})
        print(json.dumps({'phase': 'partition-staging', 'bucket': bucket.name, 'files': len(selected)}), flush=True)
    report = {'staging': str(root), 'buckets': buckets, 'files': len(names), 'bytes': sum(item['bytes'] for item in expected.values())}
    (backup / 'cloud-stage-partition.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'phase': 'partition-complete', 'folders': len(buckets), 'files': len(names)}), flush=True)


if __name__ == '__main__':
    main()
