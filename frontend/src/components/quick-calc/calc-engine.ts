/**
 * Quick Calc -- the calculation engine.
 *
 * Hand-written on purpose: no `eval`, no `new Function`, no expression library,
 * and no network call. Everything here is pure in/out, so the percent semantics
 * site staff actually rely on (`12500*18%` = 2250 for GST on a line, but
 * `12500+18%` = 14750 for the amount including it) are pinned by unit tests in
 * calc-engine.test.ts instead of by trying it in the browser.
 *
 * Grammar, loosest binding first:
 *
 *   expr    -> term (('+' | '-') term)*
 *   term    -> unary (('*' | '/' | implicit) unary)*
 *   unary   -> ('+' | '-')* postfix
 *   postfix -> primary ('%')*
 *   primary -> number | '(' expr ')'
 */

export class CalcError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CalcError";
    }
}

type Token =
    | { kind: "number"; value: number }
    | { kind: "operator"; value: "+" | "-" | "*" | "/" }
    | { kind: "open" }
    | { kind: "close" }
    | { kind: "percent" };

/**
 * Every character the expression field will hold. Kept deliberately wider than
 * the grammar so display glyphs (x, ×, ÷) and pasted amounts (`12,500`) survive
 * long enough for normalisation to fold them.
 */
export const CALC_INPUT_PATTERN = /^[0-9+\-*\/%().,\s×÷✕xX−–—]*$/;

/** Strips anything the field will not hold -- used for paste and dictation. */
export function sanitiseExpressionInput(value: string): string {
    return value.replace(/[^0-9+\-*\/%().,\s×÷✕xX−–—]/g, "");
}

/**
 * The display form: the operator glyphs the keypad shows, so what you read back in
 * the expression matches the key you pressed (× not *, ÷ not /, − not -).
 *
 * Every replacement is ONE character for ONE character. That is load-bearing, not a
 * coincidence: the caller rewrites the input's value in place while the user is
 * typing, and a length change would move the caret out from under them.
 * `normaliseExpression` folds all of it straight back before parsing.
 */
export function toDisplayOperators(src: string): string {
    return src.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−");
}

/** Folds human typing and display glyphs into the canonical operator set. */
export function normaliseExpression(src: string): string {
    return String(src)
        .replace(/[×✕xX]/g, "*")
        .replace(/[÷]/g, "/")
        .replace(/[−–—]/g, "-")
        .replace(/[,_\s]/g, "");
}

export function tokenise(src: string): Token[] {
    const s = normaliseExpression(src);
    const tokens: Token[] = [];
    let i = 0;

    while (i < s.length) {
        const c = s[i];

        if ((c >= "0" && c <= "9") || c === ".") {
            let j = i;
            let dots = 0;
            while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) {
                if (s[j] === ".") dots++;
                j++;
            }
            const raw = s.slice(i, j);
            if (dots > 1) throw new CalcError(`"${raw}" has more than one decimal point`);
            if (raw === ".") throw new CalcError("A decimal point needs digits around it");
            tokens.push({ kind: "number", value: parseFloat(raw) });
            i = j;
            continue;
        }

        if (c === "+" || c === "-" || c === "*" || c === "/") {
            tokens.push({ kind: "operator", value: c });
            i++;
            continue;
        }
        if (c === "(") { tokens.push({ kind: "open" }); i++; continue; }
        if (c === ")") { tokens.push({ kind: "close" }); i++; continue; }
        if (c === "%") { tokens.push({ kind: "percent" }); i++; continue; }

        throw new CalcError(`"${c}" is not something the calculator can use`);
    }

    return tokens;
}

/**
 * A parsed value, plus whether it arrived as a percentage. The operator one
 * level up reads that flag to decide what the percentage is *of*:
 *   a * b%  ->  a * (b/100)          18% of a
 *   a + b%  ->  a + a * (b/100)      a plus 18% of itself
 */
interface Operand {
    value: number;
    isPercent: boolean;
}

export function evaluateExpression(src: string): number {
    const tokens = tokenise(src);
    if (!tokens.length) throw new CalcError("Nothing to calculate yet");

    let pos = 0;
    const peek = (): Token | undefined => tokens[pos];
    const take = (): Token | undefined => tokens[pos++];

    function parseExpr(): Operand {
        let left = parseTerm();
        for (;;) {
            const next = peek();
            if (!next || next.kind !== "operator" || (next.value !== "+" && next.value !== "-")) break;
            const op = (take() as { kind: "operator"; value: "+" | "-" }).value;
            const right = parseTerm();
            const rhs = right.isPercent ? left.value * right.value : right.value;
            left = { value: op === "+" ? left.value + rhs : left.value - rhs, isPercent: false };
        }
        return left;
    }

    function parseTerm(): Operand {
        let left = parseUnary();
        for (;;) {
            const next = peek();
            let op: "*" | "/" | null = null;
            if (next && next.kind === "operator" && (next.value === "*" || next.value === "/")) {
                op = (take() as { kind: "operator"; value: "*" | "/" }).value;
            } else if (next && next.kind === "open") {
                op = "*"; // implicit: 2(3+4)
            } else {
                break;
            }
            const right = parseUnary();
            if (op === "/") {
                if (right.value === 0) throw new CalcError("Division by zero");
                left = { value: left.value / right.value, isPercent: false };
            } else {
                left = { value: left.value * right.value, isPercent: false };
            }
        }
        return left;
    }

    function parseUnary(): Operand {
        const next = peek();
        if (next && next.kind === "operator" && (next.value === "-" || next.value === "+")) {
            take();
            const operand = parseUnary();
            return {
                value: next.value === "-" ? -operand.value : operand.value,
                isPercent: operand.isPercent,
            };
        }
        return parsePostfix();
    }

    function parsePostfix(): Operand {
        let operand = parsePrimary();
        while (peek()?.kind === "percent") {
            take();
            operand = { value: operand.value / 100, isPercent: true };
        }
        return operand;
    }

    function parsePrimary(): Operand {
        const token = take();
        if (!token) throw new CalcError("The expression stops early — it needs a number");
        if (token.kind === "number") return { value: token.value, isPercent: false };
        if (token.kind === "open") {
            const inner = parseExpr();
            const closing = take();
            if (!closing || closing.kind !== "close") throw new CalcError('Missing a closing ")"');
            return inner;
        }
        if (token.kind === "close") throw new CalcError('There is a ")" with nothing to close');
        if (token.kind === "percent") throw new CalcError('"%" needs a number before it');
        throw new CalcError(`"${token.value}" needs a number before it`);
    }

    const result = parseExpr();
    if (pos < tokens.length) throw new CalcError("There is extra input after the expression");
    if (!Number.isFinite(result.value)) throw new CalcError("That does not come out to a finite number");
    return settle(result.value);
}

/** Trims binary floating-point dust so 0.1 + 0.2 reads as 0.3, not 0.30000000000000004. */
export function settle(n: number): number {
    if (n === 0) return 0;
    const abs = Math.abs(n);
    if (abs > 1e15 || abs < 1e-12) return n;
    return parseFloat(n.toPrecision(12));
}

const RESULT_FORMAT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 });

/** For reading on screen: Indian digit grouping, as amounts are read here. */
export function formatResult(n: number): string {
    return RESULT_FORMAT.format(n);
}

/**
 * For the clipboard: no separators, no symbol. The destination is almost always
 * a Frappe currency field, which rejects "2,250".
 */
export function toClipboardValue(n: number): string {
    return String(n);
}

/** True when the expression parses -- used to keep the result live as you type. */
export function tryEvaluate(src: string): { ok: true; value: number } | { ok: false; message: string } {
    try {
        return { ok: true, value: evaluateExpression(src) };
    } catch (error) {
        return { ok: false, message: error instanceof CalcError ? error.message : "That expression cannot be read" };
    }
}
