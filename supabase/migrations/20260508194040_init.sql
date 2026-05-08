-- Initial migration: seed extensions used across the project.
-- pg_trgm powers fuzzy client matching (Phase C) and any later text similarity
-- searches. Adding it here also exercises the migration + type-generation
-- pipeline before any real schema lands.

create extension if not exists pg_trgm;
