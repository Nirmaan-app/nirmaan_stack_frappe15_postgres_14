"""Which running processes stop the N-worker check from starting (#1654), on made-up process listings (no container):

    cd .claude/skills/verify/bin && python3 -m unittest test_walk_background_operations
"""

import unittest

from walk_background_operations import site_background_processes

TASK, SITE = "nwc", "t-nwc.localhost"
ENV = "/workspace/development/benches/nwc"
MAIN = "/workspace/development/frappe-bench"
PY = "env/bin/python -m frappe.utils.bench_helper frappe"


def pids(*listing):
    return site_background_processes(list(listing), TASK, SITE)


class SiteBackgroundProcesses(unittest.TestCase):
    def test_a_long_worker_for_the_site_counts(self):
        self.assertEqual(pids((11, f"{ENV}/sites", f"{ENV}/{PY} --site {SITE} worker --queue long")), [11])

    def test_a_worker_on_every_queue_started_in_the_env_bench_counts(self):
        self.assertEqual(pids((12, ENV, f"{ENV}/{PY} worker --queue short,default,long")), [12])

    def test_a_scheduler_of_the_env_counts(self):
        self.assertEqual(pids((13, ENV, "/bin/sh -c bench schedule"), (14, ENV, f"{ENV}/{PY} schedule")), [13, 14])

    def test_the_main_bench_and_another_env_do_not_count(self):
        self.assertEqual(pids((21, MAIN, f"{MAIN}/{PY} worker"), (22, MAIN, f"{MAIN}/{PY} schedule"),
                              (23, "/workspace/development/benches/other", "/bin/sh -c bench worker")), [])

    def test_the_env_web_server_and_other_commands_in_its_bench_do_not_count(self):
        self.assertEqual(pids((31, f"{ENV}/sites", f"{ENV}/{PY} --site {SITE} serve --port 8001"),
                              (32, ENV, "tail -f logs/worker.log")), [])


if __name__ == "__main__":
    unittest.main()
