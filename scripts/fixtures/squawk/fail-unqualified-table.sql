-- squawk: require-table-schema (included_rules)
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE fixture_holdings ADD COLUMN note text;
