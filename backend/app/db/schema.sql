-- APIx schema. SQLite, no ORM — raw SQL, readable by anyone on the team.
-- Aligned with monograph §7 (data architecture) and §25 (canonical data contracts).
-- Column semantics documented in docs/DATA_DICTIONARY.md.

CREATE TABLE IF NOT EXISTS observations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  origin            TEXT NOT NULL,          -- IATA code, e.g. DEL
  destination       TEXT NOT NULL,          -- IATA code, e.g. BOM
  airline           TEXT NOT NULL,          -- carrier code, e.g. SA1
  travel_date       TEXT NOT NULL,          -- ISO date, the date of the flight
  quote_date        TEXT NOT NULL,          -- ISO date, the date the fare was observed
  lead_days         INTEGER NOT NULL CHECK (lead_days >= 0),
  lead_bucket       TEXT NOT NULL CHECK (lead_bucket IN ('D00_03','D04_07','D08_14','D15_30','D31_PLUS')),
  fare_class        TEXT NOT NULL CHECK (fare_class IN ('ECONOMY_SAVER','ECONOMY_FLEX','PREMIUM_ECONOMY','BUSINESS')),

  -- Price anatomy (monograph §4.2, §25.3)
  base_fare         REAL NOT NULL CHECK (base_fare > 0),
  airline_surcharge REAL NOT NULL DEFAULT 0 CHECK (airline_surcharge >= 0),
  statutory_taxes   REAL NOT NULL DEFAULT 0 CHECK (statutory_taxes >= 0),
  airport_charges   REAL NOT NULL DEFAULT 0 CHECK (airport_charges >= 0),
  taxes_fees        REAL NOT NULL CHECK (taxes_fees >= 0),
  total_fare        REAL NOT NULL CHECK (total_fare >= 500 AND total_fare <= 500000),

  source_batch_id   TEXT NOT NULL REFERENCES ingestion_batches(batch_id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),

  -- Provenance fields (monograph §25.4: source transparency).
  -- source_type distinguishes demo/synthetic data from live API data.
  source_type       TEXT NOT NULL DEFAULT 'demo'
                      CHECK (source_type IN ('demo', 'live', 'imported')),
  provider          TEXT,          -- e.g. 'amadeus', 'demo', or NULL for uploaded CSV
  flight_number     TEXT,          -- carrier + flight number if available from provider
  offer_id          TEXT,          -- provider's unique reference for this offer
  offer_expiry      TEXT,          -- ISO datetime when this offer expires, if provided

  -- One fare per carrier, class, flight date and observation date.
  UNIQUE (origin, destination, airline, fare_class, travel_date, quote_date)
);

-- The comparability cell, in the order the index engine groups by.
CREATE INDEX IF NOT EXISTS idx_obs_cell
  ON observations (origin, destination, airline, fare_class, lead_bucket);
CREATE INDEX IF NOT EXISTS idx_obs_quote_date ON observations (quote_date);
CREATE INDEX IF NOT EXISTS idx_obs_travel_date ON observations (travel_date);
CREATE INDEX IF NOT EXISTS idx_obs_lead_bucket ON observations (lead_bucket);

-- Route basket and weights (monograph §5).
CREATE TABLE IF NOT EXISTS route_weights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  origin          TEXT NOT NULL,
  destination     TEXT NOT NULL,
  stratum         TEXT NOT NULL,
  weight          REAL NOT NULL CHECK (weight >= 0 AND weight <= 1),
  source          TEXT NOT NULL DEFAULT 'prototype',
  effective_from  TEXT NOT NULL DEFAULT '2026-01-01',
  effective_to    TEXT,
  UNIQUE (origin, destination, effective_from)
);

CREATE TABLE IF NOT EXISTS ingestion_batches (
  batch_id          TEXT PRIMARY KEY,
  uploaded_at       TEXT NOT NULL DEFAULT (datetime('now')),
  filename          TEXT,
  accepted_count    INTEGER NOT NULL,
  quarantined_count INTEGER NOT NULL
);

-- Exactly one provenance cohort is active for analytical endpoints at a time.
-- Stored demo/imported/live rows may coexist, but are never silently combined.
CREATE TABLE IF NOT EXISTS analysis_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  active_source_type TEXT CHECK (active_source_type IN ('demo', 'live', 'imported')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO analysis_state (id, active_source_type) VALUES (1, NULL);

-- Every row that failed validation, kept with the reason it failed.
CREATE TABLE IF NOT EXISTS quarantined_rows (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id        TEXT NOT NULL REFERENCES ingestion_batches(batch_id),
  raw_row         TEXT NOT NULL,
  reject_reason   TEXT NOT NULL
);
