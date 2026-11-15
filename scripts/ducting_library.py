"""DU-2 THE DUCTING PAYLOAD LIBRARY (owner 2026-11-13 23:41 "payloads kept", carried to Ducting by DU-2) - build / verify / manifest /
rebuild-pack, by RE-USING scripts/valve_library.py unchanged (the Valve library's shape: rows/, history/, specs/, capture_logs/, INDEX.tsv,
MANIFEST.tsv, README.md). READ-ONLY on every source; makes no model call and never writes the database.

What differs from the valve tool, set here and nowhere else:
  CATEGORY      hvac_ducting (a part's row files of any other category are skipped)
  ASSETS        HVAC v74 + Electrical v72 (the newest HVAC asset; v74 = v72 + display-only lines - the rows were read on v72)
  harness       scripts/_instruments/ducting_pack_harness.ts (valve_pack_harness.ts + Ducting's sheet-level feed steps)
  --keys        a run_list.tsv (boq, sheet, excel_row, group ...) - every row of it is a Ducting row

Usage (host Python, files only, except rebuild-pack which runs the read-only page fetch + the harness in the container):
  python -I scripts/ducting_library.py build --parts du2=<payload_archive> --pages <page fetch dir> --keys <run_list.tsv> --out <lib>
  python -I scripts/ducting_library.py verify --lib <lib> [--pages <page fetch dir>]
  python -I scripts/ducting_library.py rebuild-pack --lib <lib> --rows <keys file|ALL> --out <dir>
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import valve_library as VL  # noqa: E402

VL.CATEGORY = "hvac_ducting"
VL.ASSETS = [VL.APP + "/nirmaan_stack/services/boq_rate_master/data/rate_master_hvac_all_v74.json",
             VL.APP + "/nirmaan_stack/services/boq_rate_master/data/rate_master_electrical_all_v72.json"]
_docker = VL._docker


def _docker_ducting(*args, cwd=None):
    """the valve tool's docker call, with its pack harness swapped for the Ducting one"""
    return _docker(*[a.replace("valve_pack_harness.ts", "ducting_pack_harness.ts") if isinstance(a, str) else a for a in args], cwd=cwd)


VL._docker = _docker_ducting


def _keys_tsv(run_list):
    """run_list.tsv (boq, sheet, excel_row, group, ...) -> the valve tool's key file shape (group, -, boq, sheet, row, -, category)"""
    fd, p = tempfile.mkstemp(suffix=".tsv")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("group\t\tboq\tsheet\texcel_row\t\tcategory\n")
        for line in open(run_list, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if f[0] == "boq" or len(f) < 3:
                continue
            fh.write("%s\t\t%s\t%s\t%s\t\t%s\n" % (f[3] if len(f) > 3 else "", f[0], f[1], f[2], VL.CATEGORY))
    return p


if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--keys" in argv:
        i = argv.index("--keys")
        argv[i:i + 2] = ["--valve-keys", _keys_tsv(argv[i + 1])]
    sys.exit(VL.main(argv))
