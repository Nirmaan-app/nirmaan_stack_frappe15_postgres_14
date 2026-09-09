# Quick Calc — a calculator inside Nirmaan

Quick Calc is a small calculator that floats over whatever page you are on. It is
there so you never have to leave a Purchase Order to work out a GST figure, and
never have to retype a number you have already calculated.

It works the same on **Mac** and on **Windows**, and on a **tablet** with or
without a keyboard. Everything to do with the actual maths is identical on both;
only the copy, select and open shortcuts differ, and both versions are listed
below.

---

## Finding it

Look for the calculator button — it starts in the bottom-right corner of the
screen, and stays wherever you last moved it to.

> 🧮

It is always there, on every screen, once you are signed in.

**Click it to open the calculator.** It opens right where the button was.

---

## Moving it out of the way

Drag it anywhere on the page — hold the button (or the grey bar across the top of
the calculator, next to the word QUICK CALC) and move it. It stays where you put
it, even after you close it or reload the page.

You can see the page **through** the calculator, so it does not hide the row you
are checking.

**To put it away**, click the `–` at its top-right corner, or keep pressing `Esc`
until it closes (see [Escape clears one thing at a time](#escape-clears-one-thing-at-a-time)).
It shrinks back to the small calculator button. It never disappears completely,
so you can always get it back with one click.

---

## Two ways to use it — both work

### 1. Type it

Click once inside the calculator, then type as you would anywhere else:

```
12500*18%
```

Press `Enter`. The answer appears underneath.

### 2. Tap the buttons

Every operation has a button — numbers, `+ − × ÷`, `%`, brackets, a decimal
point, backspace and clear. Use it entirely with the mouse or your finger if you
prefer. You get exactly the same answers either way.

The clear button changes with what there is to clear. While you have a sum on
screen it reads **`C`** and clears that sum. Once the sum is gone it turns into a
red **`AC`**, which clears your recent-calculations list — that one cannot be
undone, which is why it is marked in red. When there is nothing left to clear it
greys out.

You can also mix the two: type part of a sum and tap the rest.

---

## Percentages — the part worth knowing

Quick Calc reads percentages the way you would say them out loud.

| You type | It means | Answer |
|---|---|---|
| `12500*18%` | 18% **of** 12,500 — the GST on a line | **2,250** |
| `12500+18%` | 12,500 **plus** 18% — the amount including GST | **14,750** |
| `12500-2.5%` | 12,500 **less** 2.5% — a retention deduction | **12,187.50** |
| `18%` | just the fraction, for use in your own sum | **0.18** |

Other things that work:

| You type | Answer |
|---|---|
| `250*50` — quantity × rate | 12,500 |
| `(5000+2500)/3` — split across three zones | 2,500 |
| `80000*1.18` — GST the other way round | 94,400 |
| `12,500 + 800` — commas are ignored | 13,300 |
| `3x4` — `x` also means times | 12 |

---

## Putting the answer into a Nirmaan field

Click **COPY**, then paste into the field as normal.

Quick Calc deliberately copies the **plain number** — `2250`, not `2,250` — because
Nirmaan's amount fields will not accept a number with commas in it. So the answer
pastes in cleanly every time.

You can also press `⌘C` (Mac) or `Ctrl+C` (Windows) instead of clicking COPY.

---

## Doing one sum after another

**Press `Enter` first, then carry on:**

- Type a **number** next and it starts a **fresh** calculation.
- Type an **operator** (`+ − × ÷`) next and it **continues from the answer**.

So after working out `12500×18%` = `2,250`, typing `+500` gives you `2,750`
without retyping anything.

### Your recent calculations

The last few sums stay listed above the answer.

- **Click any line** to load that calculation back in.
- **Scroll the list** to look further back — on a tablet, swipe it.
- **Click the small arrow** on the left of the list to make it taller, so you can
  see many calculations at once. Click it again to shrink it back. Quick Calc
  remembers which you prefer.

The list keeps your last 20 calculations.

**To clear the list**, first clear the sum you are working on, then press the red
**`AC`** button (or `Esc` again). This cannot be undone.

---

## Keyboard — which key is for what

Find the thing you want to do in the left column. Then read across to your own
computer.

### Entering a sum

| What you want to do | 🍎 Mac | 🪟 Windows / Linux |
|---|---|---|
| Type a number | `0` – `9` | `0` – `9` |
| Add | `+` | `+` |
| Subtract | `-` | `-` |
| Multiply | `*` — or `x`, if you prefer | `*` — or `x` |
| Divide | `/` | `/` |
| Work out a percentage | `%` | `%` |
| Group part of a sum | `(` and `)` | `(` and `)` |
| Decimal point | `.` | `.` |

The number pad on the right of a full keyboard works too — digits, `+`, `-`,
`*`, `/`, `.` and its own `Enter`.

### Getting the answer

| What you want to do | 🍎 Mac | 🪟 Windows / Linux |
|---|---|---|
| Work it out | `return` | `Enter` |
| Start a **new** sum with the answer still showing | just type a **number** | just type a **number** |
| Carry on **from** the answer | type an **operator** first (`+ - * /`) | same |

### Fixing a mistake

| What you want to do | 🍎 Mac | 🪟 Windows / Linux |
|---|---|---|
| Delete the character before the cursor | `delete` | `Backspace` |
| Delete the character after the cursor | `fn` + `delete` | `Delete` |
| Delete a whole word back | `⌥` + `delete` | `Ctrl` + `Backspace` |
| Delete everything back to the start | `⌘` + `delete` | *(use `Esc`)* |
| Clear the sum you are working on | `esc` | `Esc` |
| Clear your recent-calculations list | `esc` again | `Esc` again |
| Undo what you just typed | `⌘` + `Z` | `Ctrl` + `Z` |

### Taking the answer with you

| What you want to do | 🍎 Mac | 🪟 Windows / Linux |
|---|---|---|
| Copy the answer | `⌘` + `C` | `Ctrl` + `C` |
| Copy just part of the expression | select it first, then `⌘` + `C` | select it first, then `Ctrl` + `C` |
| Select the whole expression | `⌘` + `A` | `Ctrl` + `A` |
| Paste a figure in | `⌘` + `V` | `Ctrl` + `V` |

Pasting cleans the figure up for you — `₹1,25,000*18%` copied straight out of a
Purchase Order pastes in and gives you **22,500**.

### Moving around inside the expression

| What you want to do | 🍎 Mac | 🪟 Windows / Linux |
|---|---|---|
| Move one character | `←` `→` | `←` `→` |
| Jump a whole word | `⌥` + `←` `→` | `Ctrl` + `←` `→` |
| Jump to the start or end | `⌘` + `←` `→` | `Home` / `End` |
| Select as you move | hold `⇧` | hold `Shift` |

### The calculator itself

| What you want to do | 🍎 Mac | 🪟 Windows / Linux |
|---|---|---|
| Open it, or put it away, from anywhere | `⌥` + `K` | `Alt` + `K` |
| Put it away once there is nothing left to clear | `esc` | `Esc` |
| Leave it and go back to Nirmaan | `tab`, or click anywhere outside | `Tab`, or click outside |

---

### Escape clears one thing at a time

`Esc` never closes work that is still on screen. Each press deals with the
topmost thing that still has something in it, and only then closes:

1. **First press** — clears the sum you are working on.
2. **Second press** — clears your recent-calculations list.
3. **Third press** — puts the calculator away.

It is a check, not a count: if there is no sum and no list, the very first `Esc`
puts it away.

---

### Where these keys are

**On a Mac:** `⌘` is the **command** key, either side of the space bar. `⌥` is
the **option** key, just outside it — some Mac keyboards print `alt` on that same
cap. They are the same key.

**On Windows:** `Ctrl` is at the bottom-left corner. `Alt` sits beside the space
bar.

---

## It will not interfere with your work

This is worth saying plainly, because it is the thing people worry about.

**Quick Calc only takes your typing while you are actually inside it.** The
moment you click into a Nirmaan field, a search box, a table or a dialog, every
key goes to Nirmaan as normal — including `+`, `-`, `/`, `Enter` and `Backspace`.

Even while you are inside it, it reserves only these:

- **`Enter`** — work out the answer
- **`Esc`** — clear the sum, then the list, then put it away
- **`⌘C` / `Ctrl+C`** — and only when you have not selected anything
- **`⌥K` / `Alt+K`** — the one shortcut that works from anywhere, so you can open
  the calculator without reaching for the mouse

Everything else behaves exactly as it always does — reload, find, print, new tab,
zoom, and every arrow and navigation key. You can leave the calculator open all
day and nothing else in Nirmaan changes.

---

## On a tablet

Everything works by touch — no separate mode, nothing to switch on.

- **Tap** the buttons. They are sized for a fingertip.
- **Drag** the calculator with your finger, exactly like with a mouse.
- **Swipe** the list of recent calculations to scroll through it.
- If you have a **keyboard attached**, typing works at the same time. You do not
  have to choose between the two.

---

## If something looks wrong

**The calculator button has gone.**
It cannot be removed. If you cannot see it, it may be behind a dialog — close the
dialog, or press `⌥K` / `Alt+K`.

**I am typing but nothing appears in the calculator.**
Click inside the calculator first. It only listens while you are in it — that is
deliberate, so it cannot interfere with the form you are filling in.

**It says "Check the expression" or similar.**
Something in the sum is incomplete — usually a missing bracket or a number after
an operator. The message says which.

**The answer will not paste into an amount field.**
Use the **COPY** button rather than selecting the number by hand. COPY strips the
commas out, which is what the amount fields need.

---

## Two things it deliberately does not do

- **It never sends your calculations anywhere.** Everything is worked out inside
  your own browser. Nothing is saved to the server, and it works with a poor
  connection.
- **It does not fill fields in for you.** You copy and paste, so nothing is ever
  written into a Purchase Order without you doing it yourself.
