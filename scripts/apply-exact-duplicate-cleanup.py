"""Retire only verified, acknowledged exact duplicate events; keep originals in backup."""
import argparse
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import subprocess
import uuid
import zipfile

spec = importlib.util.spec_from_file_location('duplicate_plan', Path(__file__).with_name('plan-exact-duplicate-events.py'))
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


def digest_file(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_states(states, candidates):
    if len({state['deviceId'] for state in states}) != 2:
        raise RuntimeError('Two different PC states are required.')
    for state in states:
        if not state.get('initialized') or state.get('identityRevision') != 4:
            raise RuntimeError('An uninitialized or older PC cannot authorize cleanup.')
        if state.get('identityPending') != 0 or state.get('reconciliationPending') != 0 or state.get('legacyBootstrapPending'):
            raise RuntimeError('A PC has unresolved synchronization tasks.')
        applied = set(state.get('appliedBatches', []))
        required = {item['batchId'] for item in candidates} | {PurePosixPath(item['retained']).stem for item in candidates}
        if not required.issubset(applied):
            raise RuntimeError(f'{state["deviceId"]}: missing acknowledgement of {len(required - applied)} batches.')


def event_path(mirror, name):
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or len(relative.parts) != 7:
        raise RuntimeError('Unexpected event path.')
    if relative.parts[:4] != ('mirror', '.armi-sync', 'incremental-v1', 'devices') or relative.parts[5] != 'events':
        raise RuntimeError('Only events inside the intended mirror may be retired.')
    target = mirror.joinpath(*relative.parts[1:]).resolve()
    if not target.is_relative_to(mirror) or target.suffix != '.json' or target.is_symlink():
        raise RuntimeError('Event resolved outside the mirror.')
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('backup')
    parser.add_argument('--pc2', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    folder = Path(args.backup).resolve()
    status = json.loads((folder / 'status.json').read_text(encoding='utf-8'))
    if status.get('status') != 'verified':
        raise RuntimeError('The complete backup is not verified.')
    plan = json.loads((folder / 'exact-duplicate-plan.json').read_text(encoding='utf-8'))
    if plan.get('policy') != 'exact-duplicate-payload-v1' or plan.get('applied'):
        raise RuntimeError('Unrecognized or already-applied plan.')
    mirror = Path(status['mirror']).resolve()
    if Path(plan['mirror']).resolve() != mirror:
        raise RuntimeError('Plan belongs to a different mirror.')
    local = Path(os.environ['APPDATA']) / 'ARMI Docente/sync-runtime'
    config = json.loads((local / 'sync-config.json').read_text(encoding='utf-8-sig'))
    if Path(config['mirrorPath']).resolve() != mirror:
        raise RuntimeError('Configured mirror has changed.')
    tasks = subprocess.check_output(['tasklist', '/fo', 'csv', '/nh'], text=True, creationflags=subprocess.CREATE_NO_WINDOW)
    if any(row and row[0].lower() == 'armi docente.exe' for row in csv.reader(io.StringIO(tasks))):
        raise RuntimeError('Close ARMI Docente before cleanup.')
    if (local / 'incremental-pending-publication.json').exists():
        raise RuntimeError('Local publication is still pending.')
    pc2 = Path(args.pc2)
    capture = folder / pc2.stem
    capture.mkdir(exist_ok=True)
    with zipfile.ZipFile(pc2) as remote:
        for name in remote.namelist():
            target = capture.joinpath(*PurePosixPath(name).parts).resolve()
            if not target.is_relative_to(capture) or PurePosixPath(name).is_absolute():
                raise RuntimeError('Unsafe capture path.')
            if name.endswith('/'):
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(remote.read(name))
    report = json.loads((capture / 'capture-report.json').read_text(encoding='utf-8-sig'))
    if report['deviceId'] != '584392cf9397665d':
        raise RuntimeError('Capture is not from PC 2.')
    for item in report['files']:
        target = (capture / item['Path']).resolve()
        if not target.is_relative_to(capture) or digest_file(target).lower() != item['SHA256'].lower():
            raise RuntimeError('PC 2 capture failed hash verification.')
    if (capture / 'sync-runtime/incremental-pending-publication.json').exists():
        raise RuntimeError('PC 2 has an unfinished publication.')
    remote_state = json.loads((capture / 'sync-runtime/incremental-identity-state.json').read_text(encoding='utf-8-sig'))
    local_state = json.loads((local / 'incremental-identity-state.json').read_text(encoding='utf-8-sig'))
    validate_states([local_state, remote_state], plan['candidates'])
    connection = sqlite3.connect((capture / 'database/armi.db').as_uri() + '?mode=ro', uri=True)
    try:
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise RuntimeError('PC 2 database failed integrity check.')
        consistent = sqlite3.connect(capture / 'consistent.db')
        try: connection.backup(consistent)
        finally: consistent.close()
    finally:
        connection.close()
    records = {item['name']: item for item in json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))}
    protected = set(plan['protectedBatchIds'])
    verified = []
    with zipfile.ZipFile(folder / 'mirror-and-local.zip') as archive:
        for item in plan['candidates']:
            original, retained = event_path(mirror, item['name']), event_path(mirror, item['retained'])
            if item['batchId'] in protected or original == retained or item['batchId'] != original.stem or retained.name >= original.name:
                raise RuntimeError('Unsafe duplicate selection.')
            semantic = []
            for name, source in [(item['name'], original), (item['retained'], retained)]:
                expected = records[name]['sha256']
                archived = archive.read(name)
                if hashlib.sha256(archived).hexdigest() != expected or digest_file(source) != expected:
                    raise RuntimeError('An original or retained event changed: ' + name)
                batch = json.loads(archived)
                if batch['batchId'] != source.stem:
                    raise RuntimeError('Batch name mismatch.')
                semantic.append(planner.event_digest(batch))
            if not semantic[0] or semantic[0] != semantic[1] or semantic[0] != item['semanticSHA256']:
                raise RuntimeError('The events are not exact content duplicates.')
            verified.append((item, original, retained))
    summary = {'phase': 'preflight-verified', 'files': len(verified), 'bytes': sum(item['bytes'] for item, _, _ in verified),
               'pc2Database': 'ok', 'bothPCsAcknowledged': True, 'applied': False}
    (folder / 'cleanup-preflight.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary), flush=True)
    if not args.apply:
        return
    # Stage outside the event inventory before any cloud deletion. Every original
    # also remains in the verified archive. A single isolated folder can later be
    # removed through Drive after its exact cloud inventory has been verified.
    staging = mirror / '.armi-sync/diagnostics' / ('cleanup-exact-duplicates-' + uuid.uuid4().hex)
    staging = staging.resolve()
    if not staging.is_relative_to(mirror) or staging.parent != (mirror / '.armi-sync/diagnostics').resolve():
        raise RuntimeError('Staging folder resolved outside the intended directory.')
    staging.mkdir(exist_ok=False)
    summary['staging'] = str(staging)
    with (folder / 'cleanup-journal.jsonl').open('x', encoding='utf-8') as journal:
        for index, (item, original, retained) in enumerate(verified, 1):
            if digest_file(original) != item['sha256'] or digest_file(retained) != item['retainedSHA256']:
                raise RuntimeError('An event changed after preflight.')
            destination = staging / original.name
            if destination.exists() or destination.resolve().parent != staging:
                raise RuntimeError('Unexpected staging target.')
            journal.write(json.dumps({'intent': str(original), 'staging': str(destination), 'archiveEntry': item['name'], 'sha256': item['sha256']}) + '\n')
            journal.flush()
            os.fsync(journal.fileno())
            original.rename(destination)
            if digest_file(destination) != item['sha256']:
                raise RuntimeError('The staged event failed verification.')
            journal.write(json.dumps({'retired': str(original), 'staged': str(destination)}) + '\n')
            journal.flush()
            if index % 500 == 0:
                print(json.dumps({'phase': 'retire-duplicates', 'files': index, 'total': len(verified)}), flush=True)
    summary['applied'] = True
    (folder / 'cleanup-result.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
