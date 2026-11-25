# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""THE POOL BUILD JOB (#1741): what `pool.rebuild_pool` runs, on `long`, for the 06:00 entry
(rate_match.daily_pool_rebuild) and the auto-build check (pool_autobuild), and by hand with force=True:

    rebuild(force=False) -> {"built": True, "path", "rows", "kept", "as_of", "secs", "pricing", "driving", ...cut-off}
                          | {"built": False, "path", "why"}

THE MIGRATE GATE: without `force` it builds nothing and takes no lock until a migrate has finished on this database
(pool_autobuild.site_ready). The manual entry:
`bench --site <site> execute nirmaan_stack.services.boq_rate_match.pool.rebuild_pool --kwargs "{'force': True}"`.
"""
import os

from filelock import FileLock


def rebuild(force=False):
    from nirmaan_stack.services.boq_rate_match import pool as P
    from nirmaan_stack.services.boq_rate_match import pool_autobuild

    path = P.pool_path()
    if not force:
        not_ready = pool_autobuild.site_ready()
        if not_ready is not None:
            pool_autobuild.logger().info("match pool build: refused: %s", not_ready)
            return {"path": path, "built": False, "why": not_ready}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with FileLock(path + ".lock", timeout=P.REBUILD_WAIT_SEC):
        pool = P.build_pool()
        P.save_pool(pool, path)
    return {"path": path, "built": True, "rows": len(pool.rows), "kept": len(pool.kept), "as_of": pool.as_of,
            "secs": pool.secs, "pricing": pool.pricing, "driving": {k: pool.driving[k] for k in ("available", "reason")},
            **getattr(pool, "age", {})}
