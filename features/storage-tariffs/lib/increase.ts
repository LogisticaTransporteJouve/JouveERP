/**
 * Whether "Aumentar %" raises this tariff at `validFrom`: active, not moved
 * to the client's tarifario (it is raised there), in force that day and
 * started before it (one starting on or after it is edited by hand). The
 * dialog's preview and increaseStorageTariffsAction share it.
 */
export function isRaisedByIncrease(
  t: {
    is_active: boolean;
    migrated_to_client_tariffs_at: string | null;
    valid_from: string;
    valid_to: string | null;
  },
  validFrom: string,
): boolean {
  return (
    t.is_active &&
    t.migrated_to_client_tariffs_at === null &&
    t.valid_from < validFrom &&
    (t.valid_to === null || t.valid_to >= validFrom)
  );
}
