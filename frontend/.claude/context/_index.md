# Frontend Context Documentation Index

This directory contains reference documentation for the Nirmaan Stack frontend. Load these files on-demand when working on related tasks.

---

## Available Context Files

| File | Domain | When to Load |
|------|--------|--------------|
| [role-access.md](./role-access.md) | Access Control | Role checks, sidebar visibility, page permissions |
| [domain/invoices.md](./domain/invoices.md) | Invoices | PO/SR invoices, 2B reconciliation, date filters |

### Module References (in-code)

| Module | Location | Key Files |
|--------|----------|-----------|
| Assets | `src/pages/Assets/` | `assets.constants.ts` for doctypes/fields |
| Invoices | `src/pages/tasks/invoices/` | `config/*.config.ts` for table config |
| PO Remarks | `src/pages/purchase-order/` | `hooks/usePORemarks.ts`, `components/PORemarks.tsx` |
| SR Remarks | `src/pages/ServiceRequests/approved-sr/` | `hooks/useSRRemarks.ts`, `components/SRRemarks.tsx` |

---

## Quick Reference

### Role Profiles (10 total)
- Admin, PMO Executive, Project Lead, Project Manager
- Procurement Executive, Accountant, Estimates Executive
- Design Lead, Design Executive, HR Executive

### Key Frontend Patterns

**Role check pattern:**
```typescript
["Nirmaan Admin Profile", "Nirmaan PMO Executive Profile"].includes(role)
```

**User context:**
```typescript
const { role, user_id } = useUserData();
```

**Protected routes:** See `src/utils/auth/ProtectedRoute.tsx`

---

## Directory Structure

```
.claude/
├── CHANGELOG.md          # Session change audit trail
├── settings.local.json   # Local Claude settings
└── context/
    ├── _index.md         # This file
    ├── role-access.md    # Role-based access control reference
    └── domain/
        └── invoices.md   # Invoice management & 2B reconciliation
```

---

## Related Backend Context

The backend (`nirmaan_stack/`) has additional context files:
- `.claude/context/doctypes.md` - Doctype definitions
- `.claude/context/apis.md` - API endpoints
- `.claude/context/integrations.md` - Frontend-backend integration
- `.claude/context/workflows.md` - Business logic flows
- `.claude/context/patterns.md` - Code conventions

---

## Adding New Context Files

When creating new context files:
1. Keep each file under 300 lines
2. Focus on one domain per file
3. Include file:line references for code locations
4. Update this index with the new file
