/** Days the daily «Recibidos de ARCA» run looks back: suppliers issue late,
 *  and what is already in the tray is skipped. */
export const DAILY_LOOKBACK_DAYS = 60;
/** Longest period one «Traer de ARCA» may ask for (one query per month). */
export const MAX_SYNC_MONTHS = 12;
/** How many years back «Traer de ARCA» may reach. Older periods are almost
 *  always a wrong year in the picker, and ARCA refuses or misanswers them. */
export const MAX_SYNC_YEARS_BACK = 5;
/** A period starting further back than this many months gets a warning: it
 *  is probably a wrong year. */
export const SYNC_WARN_MONTHS_BACK = 12;
