# React Effect Anti-Patterns (Vercel Best Practices)

These rules prevent infinite re-render loops. Reference: `~/.claude/skills/vercel-react-best-practices/`

## 1. Narrow Effect Dependencies (`rerender-dependencies`)

Use primitives in dependencies, not objects.

```typescript
// BAD: Object changes every render
useEffect(() => { ... }, [dateRange]);
useEffect(() => { ... }, [user]);
useEffect(() => { ... }, [table]);

// GOOD: Primitives only change when values change
useEffect(() => { ... }, [dateRange?.from?.getTime(), dateRange?.to?.getTime()]);
useEffect(() => { ... }, [user.id]);
useEffect(() => { ... }, [filteredRowCount]);  // derived primitive
```

## 2. Don't Sync Props to State via Effect (`rerender-derived-state-no-effect`)

If syncing external value to internal state, use event handlers.

```typescript
// BAD: Effect runs on every prop change
useEffect(() => {
  setLocalState(prop);
}, [prop]);

// GOOD: Sync in event handler
const handleOpen = () => {
  setLocalState(prop);  // Sync only when action happens
  setIsOpen(true);
};
```

## 3. User Actions Go in Event Handlers (`rerender-move-effect-to-event`)

If a side effect is triggered by user action, put it in the handler.

```typescript
// BAD: Effect + state pattern
const [didClick, setDidClick] = useState(false);
useEffect(() => {
  if (didClick) doSomething();
}, [didClick]);

// GOOD: Direct in handler
const handleClick = () => {
  doSomething();
};
```

## 4. Never Use TanStack Table as Dependency

The `table` object from `useReactTable()` changes reference every render.

```typescript
// NEVER DO THIS
useEffect(() => { ... }, [table]);
useEffect(() => { ... }, [table, someValue]);

// Extract derived values outside, depend on primitives
const filteredRowCount = table.getFilteredRowModel().rows.length;
useEffect(() => { ... }, [filteredRowCount]);

// For user actions, use event handlers
const handleToggle = (checked: boolean) => {
  table.getColumn("status")?.setFilterValue(checked ? ["active"] : undefined);
};
```

## Quick Checklist Before Writing useEffect

| Question | If YES |
|----------|--------|
| Am I syncing child state from props? | Use event handler, not effect |
| Am I responding to a user action? | Move logic to event handler |
| Is my dependency an object/array? | Use primitive: `obj.id` not `obj` |
| Does my effect call `setState` that affects a dependency? | You have a loop - redesign |
| Is `table` (TanStack) in my dependency array? | Remove it, use derived primitives |
