"""NCP Python action: disable web action and invoke only storage/scheduled triggers."""

import os

# Package/action parameters are trusted console settings, never browser request bodies.
SETTING_KEYS = (
    "ENVIRONMENT",
    "DATABASE_URL",
    "JWT_SECRET",
    "PUBLIC_API_URL",
    "CORS_ORIGINS",
    "STORAGE_BACKEND",
    "S3_ENDPOINT_URL",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "VERIFICATION_MODE",
    "CLOVA_API_KEY",
    "CLOVA_BASE_URL",
    "CLOVA_MODEL",
    "CLOVA_TIMEOUT",
    "DB_POOL_SIZE",
    "DB_MAX_OVERFLOW",
    "REPORT_POINTS",
    "ACTIVITY_DAYS",
    "JOB_LEASE_SECONDS",
    "AGGREGATE_KEY",
    "STAGE_WINDOW_DAYS",
    "STAGE_VOTE_SIZE",
    "STAGE_MIN_REPORTS",
    "FORECAST_DEFAULT_PEAK",
    "FORECAST_TODAY",
    "MAP_BUCKET",
    "MAP_JSON_KEY",
    "MAP_JSON_ACL",
    "MAP_JSON_CACHE_SECONDS",
)


def main(args):
    # Some NCP runtimes use default action parameters instead of custom environment variables.
    # Supply a nested `settings` object in the console before the FIRST app import.
    settings = args.get("settings", {})
    for key in SETTING_KEYS:
        if key in settings:
            os.environ[key] = str(settings[key])
    if os.environ.get("ENVIRONMENT") != "production":
        raise RuntimeError("Cloud action requires production settings; demo verification is disabled")
    from app.jobs import handle_storage_event, reconcile, tick

    if args.get("scheduled") is True:
        reconcile()
        from app.aggregate import run_aggregation
        processed = tick(limit=1)
        return {"processed": processed, "aggregation": run_aggregation()}
    return handle_storage_event(args)
