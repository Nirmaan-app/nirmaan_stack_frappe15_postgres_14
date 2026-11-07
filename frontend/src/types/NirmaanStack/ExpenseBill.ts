/** An expense bill's Bill check (GLOSSARY *Bill check*, spec #1637). Also kept on an open Collect payment line
 * (`Outflow Import Row.bill_check`, #1642). Mirrors `services/expense_bills/bill_check.py`. */
export type BillCheck = "Checking" | "Matched" | "Mismatched" | "Not read" | "Not checked";
