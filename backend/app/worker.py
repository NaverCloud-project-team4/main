import argparse
import logging
import signal
import threading
import time
from .jobs import tick, reconcile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    last_reconcile = 0
    while not stop.is_set():
        try:
            if time.monotonic() - last_reconcile >= 60:
                reconcile()
                last_reconcile = time.monotonic()
            count = tick()
            if args.once:
                return
            stop.wait(0.2 if count else 1)
        except Exception:
            logging.exception("Worker iteration failed; pending jobs remain in DB")
            if args.once:
                raise
            stop.wait(3)


if __name__ == "__main__":
    main()
