"""Plan conservative deduplication from a verified archive. No mirror writes."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import zipfile


def event_digest(batch):
    # Retain every content field, reference, version, deletion and operation order.
    # Only the publication envelope is excluded. Older formats stay untouched.
    if batch.get('format') != 2 or batch.get('identityRevision') != 4:
        return None
    operations = batch.get('operations')
    if not isinstance(operations, list) or not operations:
        return None
    if any(not isinstance(op.get('version'), int) or not op.get('deviceId') for op in operations):
        return None
    payload = {key: value for key, value in batch.items() if key not in {'batchId', 'sequence', 'createdAt'}}
    encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def plan(folder):
    folder = Path(folder)
    status = json.loads((folder / 'status.json').read_text(encoding='utf-8'))
    if status.get('status') != 'verified':
        raise RuntimeError('Backup has not passed full verification.')
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    entries = {entry['name']: entry for entry in manifest}
    events = sorted((name for name in entries if name.startswith('mirror/.armi-sync/incremental-v1/devices/')
                     and '/events/' in name and name.endswith('.json')), key=lambda name: PurePosixPath(name).name)
    protected = set()
    seen = {}
    candidates = []
    eligible = 0
    with zipfile.ZipFile(folder / 'mirror-and-local.zip') as source:
        for name in entries:
            if name.startswith('mirror/') and name.endswith('.json') and '/events/' not in name:
                protected.update(match.decode('ascii') for match in re.findall(rb'[0-9]{13}-[0-9]{8}-[A-Za-z0-9_-]+', source.read(name)))
        for index, name in enumerate(events, 1):
            data = source.read(name)
            if hashlib.sha256(data).hexdigest() != entries[name]['sha256']:
                raise RuntimeError('Archived event hash mismatch: ' + name)
            batch = json.loads(data)
            if batch.get('batchId') != PurePosixPath(name).stem:
                raise RuntimeError('Batch ID does not match path: ' + name)
            semantic = event_digest(batch)
            if semantic:
                eligible += 1
                retained = seen.setdefault(semantic, name)
                if retained != name and batch['batchId'] not in protected:
                    candidates.append({'name': name, 'batchId': batch['batchId'], 'bytes': len(data),
                                       'sha256': entries[name]['sha256'], 'retained': retained,
                                       'retainedSHA256': entries[retained]['sha256'], 'semanticSHA256': semantic})
            if index % 2000 == 0:
                print(json.dumps({'phase': 'plan-duplicates', 'files': index, 'total': len(events), 'duplicates': len(candidates)}), flush=True)
    result = {'policy': 'exact-duplicate-payload-v1', 'mirror': status['mirror'], 'events': len(events),
              'eligible': eligible, 'candidates': candidates, 'candidateBytes': sum(item['bytes'] for item in candidates),
              'protectedBatchIds': sorted(protected), 'applied': False,
              'requires': ['both-PC acknowledgements', 'verified current backup', 'closed applications', 'retained-event verification']}
    (folder / 'exact-duplicate-plan.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in result.items() if key not in {'candidates', 'protectedBatchIds'}}), flush=True)
    print(json.dumps({'candidateCount': len(candidates)}), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('backup')
    plan(parser.parse_args().backup)
