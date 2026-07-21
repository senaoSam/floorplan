// Shared Wi-Fi coverage design targets (47-23). These were previously
// duplicated across the Client View store, the planning-quality panel, the
// association-area sweep, and the Stats gap overlay — with the same intent but
// independent literals, so the three "coverage %" numbers the UI shows could
// drift apart. Consolidate to one source.
//
// COVERAGE_THRESHOLD_DBM — a point counts as "good coverage" (association-area
//   blue / planning covered / stats not-a-gap) when the strongest usable AP's
//   RSSI is at or above this. -67 dBm is the common industry "good" design
//   target. NOT the associate-or-not floor (devices associate down to ~-85);
//   this is the quality cutoff.
// COVERAGE_TARGET_PCT — default share of in-scope area that must reach the
//   threshold for the plan to "pass".
//
// Camera FOV coverage is a different physical quantity (visual coverage, not
// RSSI) and keeps its own target in useCameraStore — do not fold it in here.
export const COVERAGE_THRESHOLD_DBM = -67
export const COVERAGE_TARGET_PCT = 90
