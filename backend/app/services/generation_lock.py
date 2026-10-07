import threading
from pathlib import Path
from weakref import WeakValueDictionary

_locks: WeakValueDictionary = WeakValueDictionary()
_guard = threading.Lock()


def generation_lock(user_path: Path, entity_id: str):
    """Serialize writers of one export within the storage-owning process.

    Hold the lock before reading saved geometry, through publishing outputs.
    Waiters keep a strong reference; idle locks disappear from the registry.
    """
    key = (user_path.resolve(), entity_id)
    with _guard:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _locks[key] = lock
        return lock
