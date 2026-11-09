import importlib.util
from pathlib import Path
import unittest
from copy import deepcopy

spec = importlib.util.spec_from_file_location('duplicate_plan', Path(__file__).with_name('plan-exact-duplicate-events.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cleanup_spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).with_name('apply-exact-duplicate-cleanup.py'))
cleanup = importlib.util.module_from_spec(cleanup_spec)
cleanup_spec.loader.exec_module(cleanup)


class DuplicateSafety(unittest.TestCase):
    def test_only_publication_envelope_can_differ(self):
        batch = {'format': 2, 'identityRevision': 4, 'deviceId': 'pc', 'batchId': 'first', 'sequence': 1,
                 'createdAt': 'first', 'references': {'students': {'1': {'token': 'person'}}},
                 'operations': [{'table': 'notes', 'key': 'one', 'action': 'upsert', 'version': 1,
                                 'deviceId': 'pc', 'row': {'value': 'A'}}]}
        repeated = deepcopy(batch)
        repeated.update(batchId='second', sequence=2, createdAt='second')
        self.assertEqual(module.event_digest(batch), module.event_digest(repeated))
        for field, value in [('version', 2), ('action', 'delete'), ('row', {'value': 'B'}), ('deviceId', 'other')]:
            changed = deepcopy(repeated)
            changed['operations'][0][field] = value
            self.assertNotEqual(module.event_digest(batch), module.event_digest(changed))
        changed = deepcopy(repeated)
        changed['references']['students']['1']['token'] = 'different-person'
        self.assertNotEqual(module.event_digest(batch), module.event_digest(changed))
        repeated['format'] = 1
        self.assertIsNone(module.event_digest(repeated))

    def test_both_computers_must_acknowledge_duplicate_and_retained_event(self):
        candidate = {'batchId': 'duplicate', 'retained': 'mirror/.armi-sync/incremental-v1/devices/pc/events/original.json'}
        states = [{'deviceId': device, 'initialized': True, 'identityRevision': 4,
                   'identityPending': 0, 'reconciliationPending': 0,
                   'appliedBatches': ['original', 'duplicate']} for device in ['pc1', 'pc2']]
        cleanup.validate_states(states, [candidate])
        changed = deepcopy(states)
        changed[1]['appliedBatches'] = ['original']
        with self.assertRaises(RuntimeError):
            cleanup.validate_states(changed, [candidate])
        changed = deepcopy(states)
        changed[1]['identityPending'] = 1
        with self.assertRaises(RuntimeError):
            cleanup.validate_states(changed, [candidate])
        with self.assertRaises(RuntimeError):
            cleanup.validate_states([states[0], states[0]], [candidate])

    def test_delete_targets_cannot_escape_event_folder(self):
        mirror = Path.cwd().resolve()
        valid = 'mirror/.armi-sync/incremental-v1/devices/pc/events/batch.json'
        self.assertTrue(cleanup.event_path(mirror, valid).is_relative_to(mirror))
        for unsafe in ['mirror/../outside.json', 'mirror/uploads/file.json', '/outside.json',
                       'mirror/.armi-sync/incremental-v1/devices/pc/events/batch.zip']:
            with self.assertRaises(RuntimeError):
                cleanup.event_path(mirror, unsafe)


if __name__ == '__main__':
    unittest.main()
