// REAL formula text from the PW-2b recon census (2026-07-23), captured from the
// LuckyExcel-CONVERTED output of the raw workbooks -- not from the .xlsx, because the
// converted form is what the pipeline actually sees.
//
// Kept in a plain module (not inside a .test.ts) so both test files can import them
// without re-executing another file's suite.
//
// Provenance, cell by cell:
//   INDEX_MATCH_SINGLE  Electrical 'ALL ITEM WISE RATE'!r39c11   (v = 390)
//   IFS_NESTED_ARRAY    Electrical 'ALL ITEM WISE RATE'!r38c17   (v = 7470)
//   LET                 Electrical 'ALL ITEM WISE RATE'!r3c21    (v = 30)   [abridged
//                       to two of its four conditions; shape identical]
//   XLOOKUP             HVAC 'ADP'!r166c2                        (v = 807.3)
//   IFERROR_VLOOKUP     Electrical 'ALL ITEM WISE RATE'!r3c8     (v = 1500)
//   DUMMY_IMPORTRANGE   ELV 'Sprinkler with Markup'!r14c5        (v = "Sprinkler")
//   ARRAY_LITERAL       ELV 'FA_System with  Markup'!r4c2        (v = 300)
//   ELV_MULTI           ELV 'Extinguisher with Markup'!r3c0      (v = 15500)

export const FIXTURE_INDEX_MATCH_SINGLE =
	"=INDEX('Industrial Sockets'!C26:C97, MATCH(I41,'Industrial Sockets'!B26:B97,0)) * J43";

export const FIXTURE_IFS_NESTED_ARRAY =
	"=IFS( O39=\"Wire\", INDEX('Point Wiring '!L25:L32, MATCH(1, ('Point Wiring '!J25:J32=O40)*('Point Wiring '!K25:K32=O41), 0)), O39=\"Cable\", INDEX('Point Wiring '!L33:L93, MATCH(1, ('Point Wiring '!J33:J93=O40)*('Point Wiring '!K33:K93=O41), 0)) ) * R49";

export const FIXTURE_LET =
	"=ROUND(\n  LET(\n    rate, INDEX('Wiring & cabling'!F2:F293,\n      MATCH(1,\n        ('Wiring & cabling'!A2:A293 = 'ALL ITEM WISE RATE'!V9) *\n        ('Wiring & cabling'!B2:B293 = 'ALL ITEM WISE RATE'!V10),\n      0)\n    ) * 2,\n    IF(rate = 0, 'ALL ITEM WISE RATE'!U4 * 0.2, rate)\n  ),\n-1)";

export const FIXTURE_XLOOKUP =
	"=(2*((B166/1000)+(B167/1000))*(B168/1000))\n*XLOOKUP(B165,Ducting!C7:C12,Ducting!F7:F12)";

export const FIXTURE_IFERROR_VLOOKUP =
	"=IF(J9=0, \n    ROUNDUP(H4 * 'DB & Switchgear'!O5, -1),\n    IFERROR(\n        VLOOKUP(I9, 'DB & Switchgear'!A23:B30, 2, FALSE) * 1.5,\n        ROUNDUP(H4 * 'DB & Switchgear'!O5, -1)\n    )\n)";

export const FIXTURE_DUMMY_IMPORTRANGE =
	'=IFERROR(__xludf.DUMMYFUNCTION("IMPORTRANGE(""https://docs.google.com/spreadsheets/d/1tFR-q37Rw/edit?gid=1879627304#gid=1879627304"", ""Sprinkler!$K$1:$O$23"")"),"Sprinkler")';

export const FIXTURE_ARRAY_LITERAL =
	'=IF(A5:A26="", "",\n  IFERROR(\n   VLOOKUP(\n     $B$2 & "♦" & A5:A26,\n     { \'FA System Purchase price\'!G2:G42 & "♦" & \'FA System Purchase price\'!H2:H42, \n       \'FA System Purchase price\'!I2:I42 },\n     2, FALSE\n   ),\n  "")\n )';

export const FIXTURE_ELV_MULTI =
	"=CEILING(\n  INDEX(\n    Extinguishers!I3:I1000,\n    MATCH(\n      1,\n      (Extinguishers!F3:F1000= B7) * (Extinguishers!G3:G1000 = B8) * (Extinguishers!H3:H1000 = B9),\n      0\n    )\n  ) * (1 + VLOOKUP(B7, Extinguishers!J3:K7, 2, FALSE)),\n  5\n)";

/**
 * Electrical 'ALL ITEM WISE RATE'!Z10 -- VERBATIM. The criterion ranges are
 * Termination!A2:A96, **B2:B97**, C2:C96, D2:D96: the B arm is an off-by-one typo.
 * Owner-adjudicated from the data (Termination row 96 ends the <=25 sub-table; row 97
 * opens the table the formula's OWN second branch reads as 97:297), so :96 is the
 * consensus-correct span. Drives the harmonization tests.
 */
export const FIXTURE_Z10_OFF_BY_ONE =
	'=IF(V12<=25, INDEX(Termination!F2:F96, MATCH(1,(Termination!A2:A96=V9) *(Termination!B2:B97=V10) *(Termination!C2:C96=V11) *(Termination!D2:D96=V12), 0)), IF(V12>=35, INDEX(Termination!G97:G297, MATCH(1,(Termination!A97:A297=V9) *(Termination!B97:B297=V10) *(Termination!C97:C297=V11) *(Termination!D97:D297=V12), 0)), "" ) )';

/** Every fixture, for the round-trip sweep. */
export const ALL_FIXTURES: Record<string, string> = {
	FIXTURE_INDEX_MATCH_SINGLE,
	FIXTURE_IFS_NESTED_ARRAY,
	FIXTURE_LET,
	FIXTURE_XLOOKUP,
	FIXTURE_IFERROR_VLOOKUP,
	FIXTURE_DUMMY_IMPORTRANGE,
	FIXTURE_ARRAY_LITERAL,
	FIXTURE_ELV_MULTI,
	FIXTURE_Z10_OFF_BY_ONE,
};
