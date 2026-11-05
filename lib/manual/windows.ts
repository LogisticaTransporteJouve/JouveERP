// Named browser windows for the user guide: every link into the guide opens
// the same tab (the user keeps it next to the app), and every link from the
// guide back to the app lands in the app's tab instead of replacing the guide.

export const MANUAL_WINDOW = "jouve-manual";
export const APP_WINDOW = "jouve-app";
// Same origin, so the links carry no rel="noopener": it would stop the
// browser from reusing the named tab.
