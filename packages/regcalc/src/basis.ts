// Every result says why (R1-regcalc plan §1): the paragraph of the Directions it applies and the
// owner's model (and cell) it reproduces, so a product can show its basis next to the figure.

export interface Basis {
  /** The provision applied, e.g. `RBI/DOR/2025-26/362 para 29(3)`. */
  citation: string;
  /** The owner's model the calculation reproduces, e.g. `KFS-M01`. */
  model: string;
  /** The model's sheet and cell, where one output cell is reproduced (`APR!B13`). */
  cell?: string;
  /** A management choice rather than a prescribed rule (the EWS weights, for example). */
  managementChoice?: true;
}

export const basis = (citation: string, model: string, cell?: string): Basis => ({
  citation,
  model,
  ...(cell ? { cell } : {}),
});
