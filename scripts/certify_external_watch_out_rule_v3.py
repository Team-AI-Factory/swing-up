#!/usr/bin/env python3
"""Third external certification for a frozen parabolic-extension Watch Out rule.

The rule was selected after two prior universes were permanently burned. It is
applied once to a third non-overlapping universe. No pass means no production
serious alert and this holdout cannot be reused for tuning.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pandas as pd
from scipy.stats import beta

DATASET_PATH = Path(os.getenv("EXTERNAL_WATCH_OUT_V3_DATASET_PATH", "artifacts/external-watch-out-v3-dataset.json"))
REPORT_PATH = Path(os.getenv("EXTERNAL_WATCH_OUT_V3_REPORT_PATH", "artifacts/external-watch-out-v3-certificate.json"))
MIN_SIGNALS = max(30, int(os.getenv("EXTERNAL_WATCH_OUT_V3_MIN_SIGNALS", "30")))
TARGET_ERROR = float(os.getenv("EXTERNAL_WATCH_OUT_V3_TARGET_ERROR", "0.10"))
CERTIFICATE_CONFIDENCE = float(os.getenv("EXTERNAL_WATCH_OUT_V3_CERTIFICATE_CONFIDENCE", "0.90"))
MIN_UNIQUE_TICKERS = max(15, int(os.getenv("EXTERNAL_WATCH_OUT_V3_MIN_UNIQUE_TICKERS", "20")))

RULE = {
    "id": "watch_out_90d_parabolic_extension_calm_market_v3",
    "action": "watch_out",
    "horizonTradingDays": 90,
    "distanceFrom50dAverageMinimumPercent": 24.6,
    "marketVolatility20dMaximumPercent": 8.8,
    "successDefinition": "A further drawdown of at least 8% from the alert close within the following 90 trading sessions.",
    "frozenDevelopmentEvidence": "75 wins from 77 events across the original development universe and two burned diagnostic universes.",
    "economicRationale": "A security more than 24.6% above its 50-session average while broad-market volatility is unusually low is a parabolic extension vulnerable to mean reversion.",
}

USED_TICKERS = set("AAPL,MSFT,NVDA,GOOGL,AMZN,META,AVGO,AMD,TSLA,WMT,JPM,BAC,XOM,CVX,KO,PEP,UNH,HD,COST,CRM,ORCL,NFLX,ADBE,INTC,QCOM,CSCO,MCD,NKE,DIS,IBM,TXN,AMAT,LRCX,MU,ADI,KLAC,INTU,ADP,ABT,TMO,DHR,LLY,MRK,PFE,AMGN,GILD,JNJ,PG,CL,PM,MO,SBUX,LOW,TGT,GS,MS,C,BLK,SCHW,CAT,DE,GE,HON,UPS,FDX,COP,SLB,EOG,NEE,DUK,SO,LIN,APD,PLTR,SHOP,PYPL,COIN,MRNA,ENPH,FSLR,RIVN,LCID,NIO,U,DKNG,PINS,ZM,DOCU,SNOW,CRWD,NET,DDOG,MDB,TEAM,OKTA,TWLO,SE,MELI,BABA,JD,PDD,TSM,ASML,SMCI,ROKU,SNAP,SQ,PANW,ZS,ON,MSTR,MARA,RIOT,CLSK,HUT,IREN,CIFR,WULF,BITF,BTDR,CORZ,HOOD,SOFI,AFRM,UPST,CVNA,CHWY,DASH,CART,LYFT,OPEN,RDFN,RKT,AMC,GME,BYND,SPCE,QS,LAZR,ACHR,JOBY,EVGO,CHPT,BE,PLUG,FCEL,RUN,NOVA,SEDG,MAXN,ARRY,RKLB,ASTS,LUNR,RDW,BKSY,IONQ,RGTI,QBTS,QUBT,AI,BBAI,SOUN,PATH,CFLT,ESTC,BILL,HIMS,CELH,DUOL,ELF,CAVA,TOST,APP,RBLX,NU,IOT,TEM,CRSP,EDIT,NTLA,BEAM,RXRX,DNA,PACB,BFLY,CLOV,TDOC,LMND,ROOT,W,FUBO,UPWK,FVRR,ETSY,WBD,PARA,TLRY,CGC,ACB,CRON,SNDL,VFS,LI,XPEV,PSNY,FFIE,MULN,BLNK,FREY,ENVX,SLDP,MVST,STEM,FLNC,NFE,CLNE,GEVO,AMTX,SAVA,VKTX,AXSM,SRPT,FOLD,ALNY,IOVA,IMVT,ARWR,BLUE,VERV,GH,EXAS,NTRA,TWST,ILMN,BMRN,BIIB,GTLB,S,TENB,CYBR,VRNS,GENI,ABNB,RDDT,PCT,LAC,MP,ALB,CCJ,UEC,AA,FCX,CLF,X,NUE,AAL,UAL,DAL,JBLU,RCL,NCLH,LC,MQ,FOUR,PSFE,PAYO,ARM,ACLS,AEHR,COHR,LSCC,MTSI,WOLF,SITM,ALGM,CRDO,MRVL,SWKS,TIGR,FUTU,BILI,IQ,TAL,EDU,YMM,V,MA,AXP,USB,PNC,TFC,BK,STT,ICE,CME,SPGI,MCO,CB,PGR,ALL,MET,PRU,AIG,MMC,AON,ACN,NOW,SAP,SONY,TM,HMC,NVS,AZN,GSK,SNY,UL,DEO,BP,SHEL,RIO,BHP,VALE,BTI,HSBC,UBS,DB,ING,RELX,INFY,WIT,HDB,IBN,TTE,EQNR,KHC,MDLZ,GIS,KMB,EL,LULU,ROST,TJX,ORLY,AZO,CMG,YUM,DPZ,MAR,HLT,BKNG,UBER,NOC,LMT,RTX,GD,BA,ETN,EMR,PH,ROK,MMM,WM,RSG,CCI,AMT,PLD,EQIX,O,PSA,SPG,WELL,CVS,CI,HUM,CNC,ELV,MCK,CAH,COR,ISRG,SYK,BSX,MDT,EW,ZBH,DXCM,PODD,IDXX,IQV,VRTX,REGN,F,GM,STLA,KMX,ANF,URBN,BBY,DHI,LEN,PHM,TOL,NVR,OXY,MPC,VLO,PSX,DVN,FANG".split(","))


def one_sided_error_upper(errors: int, total: int) -> float | None:
    if total <= 0:
        return None
    if errors >= total:
        return 1.0
    return float(beta.ppf(CERTIFICATE_CONFIDENCE, errors + 1, total - errors))


def evaluate_period(frame: pd.DataFrame) -> dict:
    total = len(frame)
    wins = int(frame["won"].sum()) if total else 0
    errors = total - wins
    upper = one_sided_error_upper(errors, total)
    return {
        "sampleSize": total,
        "wins": wins,
        "losses": errors,
        "observedPrecision": wins / total if total else None,
        "errorUpperBound90": upper,
        "certifiedConfidence": 1 - upper if upper is not None else None,
        "uniqueTickers": int(frame["ticker"].nunique()) if total else 0,
        "averageDrawdown90d": float(frame["drawdown90d"].mean()) if total else None,
        "medianDrawdown90d": float(frame["drawdown90d"].median()) if total else None,
        "averageReturn90d": float(frame["return90d"].mean()) if total else None,
    }


def main() -> int:
    payload = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    requested = set(payload.get("requestedTickers") or [])
    overlap = sorted(requested & USED_TICKERS)
    if overlap:
        raise RuntimeError(f"Third external holdout overlaps a used ticker: {overlap}")
    rows = []
    for item in payload.get("rows", []):
        features = item.get("features") or {}
        outcomes = item.get("outcomes") or {}
        distance = features.get("distanceFrom50dAverage")
        market_volatility = features.get("marketVolatility20d")
        drawdown = outcomes.get("drawdown90d")
        return90 = outcomes.get("return90d")
        if not all(isinstance(value, (int, float)) for value in [distance, market_volatility, drawdown, return90]):
            continue
        if distance >= RULE["distanceFrom50dAverageMinimumPercent"] and market_volatility <= RULE["marketVolatility20dMaximumPercent"]:
            rows.append({
                "ticker": item.get("ticker"),
                "eventDate": item.get("eventDate"),
                "distanceFrom50dAverage": distance,
                "marketVolatility20d": market_volatility,
                "drawdown90d": drawdown,
                "return90d": return90,
                "won": drawdown <= -8,
            })
    selected = pd.DataFrame(rows)
    if selected.empty:
        selected = pd.DataFrame(columns=["ticker", "eventDate", "distanceFrom50dAverage", "marketVolatility20d", "drawdown90d", "return90d", "won"])
    selected["eventDate"] = pd.to_datetime(selected["eventDate"], errors="coerce")
    selected = selected.dropna(subset=["ticker", "eventDate"]).sort_values(["eventDate", "ticker"]).reset_index(drop=True)
    split = max(1, len(selected) // 2)
    early = selected.iloc[:split]
    late = selected.iloc[split:]
    overall = evaluate_period(selected)
    early_result = evaluate_period(early)
    late_result = evaluate_period(late)
    overall_pass = bool(
        overall["sampleSize"] >= MIN_SIGNALS
        and overall["uniqueTickers"] >= MIN_UNIQUE_TICKERS
        and (overall["observedPrecision"] or 0) >= 0.90
        and overall["errorUpperBound90"] is not None
        and overall["errorUpperBound90"] <= TARGET_ERROR
    )
    consistency_pass = bool(
        early_result["sampleSize"] >= 10
        and late_result["sampleSize"] >= 10
        and (early_result["observedPrecision"] or 0) >= 0.90
        and (late_result["observedPrecision"] or 0) >= 0.90
    )
    passed = overall_pass and consistency_pass
    report = {
        "version": 3,
        "passed": passed,
        "checkedAt": pd.Timestamp.utcnow().isoformat(),
        "rule": RULE,
        "externalHoldout": {
            "requestedTickerCount": payload.get("requestedTickerCount"),
            "tickersWithCases": len(payload.get("tickersWithCases") or []),
            "usedTickerOverlap": overlap,
            "sourceErrors": payload.get("sourceErrors") or [],
            "eventCooldownSessions": payload.get("eventCooldownSessions"),
            "noSyntheticData": payload.get("noSyntheticData") is True,
        },
        "requirements": {
            "minimumSignals": MIN_SIGNALS,
            "minimumUniqueTickers": MIN_UNIQUE_TICKERS,
            "targetError": TARGET_ERROR,
            "certificateConfidence": CERTIFICATE_CONFIDENCE,
            "minimumObservedPrecision": 0.90,
            "earlyAndLateObservedPrecision": 0.90,
            "earlyAndLateMinimumSignals": 10,
        },
        "overall": overall,
        "earlyHalf": early_result,
        "lateHalf": late_result,
        "overallPass": overall_pass,
        "consistencyPass": consistency_pass,
        "selectedEvents": selected.assign(eventDate=selected["eventDate"].dt.strftime("%Y-%m-%d")).to_dict(orient="records"),
        "certificationPosture": "serious_watch_out_alert_certified" if passed else "third_external_holdout_failed_rule_remains_research_only",
        "reusePolicy": "This third external holdout is burned after this run and must never be used to tune the rule.",
        "safety": {"databaseWrites": False, "r2Writes": False, "publishing": False, "notifications": False, "payments": False, "openAiCalls": False},
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "passed": passed,
        "ruleId": RULE["id"],
        "overall": overall,
        "earlyHalf": early_result,
        "lateHalf": late_result,
        "overallPass": overall_pass,
        "consistencyPass": consistency_pass,
        "reportPath": str(REPORT_PATH),
    }, indent=2))
    return 0 if passed else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        failure = {
            "version": 3,
            "passed": False,
            "fatalError": str(error)[:500],
            "certificationPosture": "third_external_holdout_invalid_or_unavailable",
            "safety": {"databaseWrites": False, "publishing": False, "notifications": False},
        }
        REPORT_PATH.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2), file=sys.stderr)
        raise
