## 6.5 BOQ Node Qty By Area — child table for per-area breakdown (EXTENDED Phase 1.8)

Phase 1.8 extends this from 2 fields to 9 fields:

| Field | Type | Reqd | Default | Rule |
|---|---|---|---|---|
| area_name | Data | yes | — | existing |
| qty | Float | yes | — | existing |
| supply_rate | Float | no | None | fallback from parent BOQ Node `supply_rate` if source file doesn't provide |
| install_rate | Float | no | None | fallback from parent `install_rate` |
| combined_rate | Float | no | None | fallback from parent `combined_rate` |
| supply_amount | Float | no | None | from file when given; else `qty × supply_rate` (auto-compute in `before_save`) |
| install_amount | Float | no | None | from file when given; else `qty × install_rate` |
| total_amount | Float | no | None | from file when given; else `qty × combined_rate` OR `supply_amount + install_amount` (mirrors parent §7.14 rule) |
| amount_override | Check | no | 0 | when set, `before_save` skips auto-compute of amounts (parallel to parent's `amount_override`) |

**Fallback semantic:** Every child row always has populated rate and amount fields after `before_save` runs — no nulls for downstream code to branch on.

**Validation:** Per-child-row, `combined_rate == supply_rate + install_rate` when all three set (mirrors parent `BOQ Nodes` validation at controllers/boq_nodes.py:40-46). Zero-cost rows (all three rates None) allowed.

**Weighted-average precedence:** Parent BOQ Node `supply_rate` / `install_rate` / `combined_rate` auto-recompute in `before_save` as `Σ(area_qty × area_rate) ÷ Σ(area_qty)` when any per-area rate diverges from the universal. Computed independently for supply / install / combined.

**Migration:** Phase 1.8 ships a patch that back-populates every existing child-row's per-area rate from the parent line-item's universal rate, and computes amount as `area_qty × that_rate`. Same fallback rule applied retroactively.

