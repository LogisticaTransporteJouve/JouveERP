/** Days the daily «Recibidos de ARCA» run looks back: suppliers issue late,
 *  and what is already in the tray is skipped. */
export const DAILY_LOOKBACK_DAYS = 60;
/** Longest period one «Traer de ARCA» may ask for (one query per month). */
export const MAX_SYNC_MONTHS = 12;
/** A period starting further back than this many months gets a warning, to
 *  catch a wrong year in the picker. ARCA serves older periods (2014 and
 *  earlier answered), so there is no hard floor. */
export const SYNC_WARN_MONTHS_BACK = 12;
