# DraftForge Engine System

This folder contains the isolated DraftForge backend intelligence pipeline.

## Scope

- Runs only on the developer machine.
- Collects, interprets, validates, and writes MLBB intelligence to PocketBase.
- Is fully isolated from the PWA runtime.
- The PWA must only read from PocketBase APIs.

## Structure

- `collectors/`: raw data collectors.
- `interpreters/`: raw-to-structured parsers.
- `validators/`: data integrity checks.
- `engines/`: orchestrators per engine.
- `pocketbase/`: PocketBase client and schema management.
- `run_pipeline.py`: pipeline entrypoint.
- `start_pocketbase.py`: local PocketBase starter.

## Current Stage

Engine 1 (`hero_stats`) is implemented in this folder and is the only active engine in the master pipeline.
