"""Currency exchange rates — public API, cached in-memory 1h."""
import time
import logging
import requests
from typing import Dict, Optional

logger = logging.getLogger(__name__)

FX_URL = "https://open.er-api.com/v6/latest/USD"
_cache: Dict = {"rates": None, "ts": 0.0, "updated": ""}
TTL_SECONDS = 3600  # 1 hour

# Fallback rates (approx, used if API is unreachable)
FALLBACK = {"MXN": 18.5, "COP": 4100.0, "PEN": 3.75, "CLP": 960.0, "USD": 1.0}


def get_rates(force: bool = False) -> Dict:
    now = time.time()
    if not force and _cache["rates"] and (now - _cache["ts"]) < TTL_SECONDS:
        return {"rates": _cache["rates"], "updated": _cache["updated"], "source": "cache"}
    try:
        r = requests.get(FX_URL, timeout=8)
        r.raise_for_status()
        data = r.json()
        if data.get("result") == "success":
            rates = data.get("rates", {})
            wanted = {k: rates[k] for k in ("MXN", "COP", "PEN", "CLP", "USD") if k in rates}
            _cache["rates"] = wanted
            _cache["ts"] = now
            _cache["updated"] = data.get("time_last_update_utc", "")
            return {"rates": wanted, "updated": _cache["updated"], "source": "live"}
    except Exception as e:
        logger.warning(f"FX fetch failed: {e}")
    # Fallback
    _cache["rates"] = _cache["rates"] or FALLBACK
    _cache["updated"] = _cache["updated"] or "fallback"
    return {"rates": _cache["rates"], "updated": _cache["updated"], "source": "fallback"}


# Country → local currency
COUNTRY_CURRENCY = {
    "MX": "MXN",
    "CO": "COP",
    "PE": "PEN",
    "CL": "CLP",
}
