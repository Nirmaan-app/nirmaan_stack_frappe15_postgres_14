# Frontend Feature Testing Guide

Reference for automated browser testing using Playwright via the `webapp-testing` skill.

---

## When to Suggest Testing

Proactively suggest Playwright testing after implementing features that involve:

| Feature Type | Examples | Why Test |
|--------------|----------|----------|
| **Form workflows** | Multi-step wizards, draft systems, validation | Complex state transitions |
| **Dialogs/Modals** | Confirmation dialogs, cancel flows | User decision points |
| **localStorage/persistence** | Draft saving, user preferences | Data integrity across sessions |
| **Real-time updates** | Socket.IO events, live indicators | Timing-dependent behavior |
| **Navigation guards** | Unsaved changes warnings, auth redirects | Route transition handling |
| **Multi-step processes** | PR creation, PO release, project setup | End-to-end flow validation |

### Trigger Phrases

Suggest testing when you see commits or requests like:
- "feat: add draft system..."
- "feat: implement multi-step wizard..."
- "feat: add confirmation dialog..."
- "fix: form state not persisting..."

---

## Test Environment

| Component | URL | Notes |
|-----------|-----|-------|
| **Vite Dev Server** | `http://localhost:8080` | Must be running |
| **Frappe Backend** | `http://localhost:8000` | Required for API calls |
| **Socket.IO** | `http://localhost:9000` | For real-time features |

### Test Credentials

```
Email: playwright@claude.ai
Password: adminclaude1234
```

---

## Testing Workflow

### 1. Verify Server is Running

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080
# Should return 200
```

### 2. Install Playwright (if needed)

```bash
pip install playwright && playwright install chromium
```

### 3. Write Test Script

```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = context.new_page()

    # Login
    page.goto('http://localhost:8080')
    page.wait_for_load_state('networkidle')
    page.fill('input[placeholder*="you@company.com"]', 'playwright@claude.ai')
    page.fill('input[placeholder*="Enter your password"]', 'adminclaude1234')
    page.click('button:has-text("Sign in")')
    page.wait_for_load_state('networkidle')
    time.sleep(2)

    # Navigate and test
    page.goto('http://localhost:8080/your-route')
    page.wait_for_load_state('networkidle')

    # Take screenshots
    page.screenshot(path='/tmp/test_screenshot.png', full_page=True)

    # Check localStorage
    data = page.evaluate('() => localStorage.getItem("key")')

    browser.close()
```

---

## Common Test Patterns

### Form Auto-Save Testing

```python
# Fill form field
page.locator('input[placeholder="Field Name"]').fill('Test Value')

# Wait for debounce (typically 1.5s) + buffer
time.sleep(3)

# Verify save indicator
assert page.locator('text=Saved').first.is_visible()

# Verify localStorage
draft = page.evaluate('() => localStorage.getItem("draft-key")')
assert draft is not None
```

### Dialog Testing

```python
# Trigger dialog
page.get_by_text("Cancel", exact=True).click()
time.sleep(1)

# Verify dialog appeared
assert page.locator('[role="alertdialog"]').is_visible()

# Check buttons
buttons = page.locator('[role="alertdialog"] button').all()
for btn in buttons:
    print(f"Button: {btn.inner_text()}")

# Click specific action
page.locator('button:has-text("Continue Editing")').click()
```

### Resume/Restore State Testing

```python
# Create state, navigate away, return
page.goto('http://localhost:8080/form-page')
page.locator('input').first.fill('Test Data')
time.sleep(3)  # Wait for save

page.goto('http://localhost:8080/other-page')
page.goto('http://localhost:8080/form-page')
time.sleep(2)

# Check for resume dialog
if page.locator('text=Resume').first.is_visible():
    page.locator('button:has-text("Resume")').click()

# Verify data restored
restored = page.locator('input').first.input_value()
assert 'Test Data' in restored
```

### Navigation Guard Testing

```python
# Make changes
page.locator('input').first.fill('Unsaved Data')

# Try to navigate away
page.goto('http://localhost:8080/other-page')

# Check for warning dialog
if page.locator('text=unsaved').first.is_visible():
    print("Navigation guard working!")
```

---

## Key Routes for Testing

| Route | Feature | Test Focus |
|-------|---------|------------|
| `/projects/new-project` | Project wizard | Draft save/resume, multi-step navigation |
| `/prs&milestones/procurement-requests/:projectId/new-pr` | PR creation | Item management, validation |
| `/service-requests/:project/new-sr` | SR creation | Service items, vendor selection |
| `/login` | Authentication | Login flow, error handling |

---

## Screenshot Management

Save screenshots to `/tmp/` during testing:

```python
page.screenshot(path='/tmp/test_01_initial.png', full_page=True)
```

Clean up after testing:
```bash
rm -f /tmp/test_*.png
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError: playwright` | Run `pip install playwright && playwright install chromium` |
| Login fails | Check credentials, ensure backend is running |
| `strict mode violation` | Locator matches multiple elements - use `.first` or more specific selector |
| Socket.IO errors in console | Normal in headless mode, doesn't affect most tests |
| Form data not saving | Check debounce timing, increase sleep duration |

---

## Related Files

- Test credentials user: Backend `Nirmaan User` doctype
- Draft store: `src/zustand/useProjectDraftStore.ts`
- Draft manager hook: `src/hooks/useProjectDraftManager.ts`
- Draft UI components: `src/components/ui/draft-*.tsx`
