#!/usr/bin/env python3
"""Second external certification for a frozen 12% extreme-volatility alert.

The earlier 15% holdout is burned. This practical threshold is fixed using all
prior development/diagnostic data and is applied once to a new non-overlapping
universe. The alert remains non-directional.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pandas as pd
from scipy.stats import beta

DATASET_PATH = Path(os.getenv("EXTERNAL_VOLATILITY_V2_DATASET_PATH", "artifacts/external-volatility-watch-v2-dataset.json"))
REPORT_PATH = Path(os.getenv("EXTERNAL_VOLATILITY_V2_REPORT_PATH", "artifacts/external-volatility-watch-v2-certificate.json"))
MIN_SIGNALS = max(30, int(os.getenv("EXTERNAL_VOLATILITY_V2_MIN_SIGNALS", "30")))
TARGET_ERROR = float(os.getenv("EXTERNAL_VOLATILITY_V2_TARGET_ERROR", "0.10"))
CERTIFICATE_CONFIDENCE = float(os.getenv("EXTERNAL_VOLATILITY_V2_CERTIFICATE_CONFIDENCE", "0.90"))
MIN_UNIQUE_TICKERS = max(15, int(os.getenv("EXTERNAL_VOLATILITY_V2_MIN_UNIQUE_TICKERS", "20")))

RULE = {
    "id": "watch_out_30d_extreme_volatility_after_60pct_drawdown_v2",
    "action": "watch_out",
    "subtype": "extreme_volatility_direction_uncertain",
    "horizonTradingDays": 30,
    "trailing120SessionDrawdownMaximumPercent": -60.0,
    "futureMoveThresholdPercent": 12.0,
    "successDefinition": "Within the following 30 trading sessions, the security rises at least 12% or falls at least 12% from the alert close.",
    "userMeaning": "A large price swing is likely to continue. Direction is uncertain; this is a risk warning, not a Sell instruction.",
    "frozenDevelopmentEvidence": "415 wins from 421 events across five used development/diagnostic universes, with one event per security per 100 sessions.",
}

USED_TICKERS = set("AAPL,MSFT,NVDA,GOOGL,AMZN,META,AVGO,AMD,TSLA,WMT,JPM,BAC,XOM,CVX,KO,PEP,UNH,HD,COST,CRM,ORCL,NFLX,ADBE,INTC,QCOM,CSCO,MCD,NKE,DIS,IBM,TXN,AMAT,LRCX,MU,ADI,KLAC,INTU,ADP,ABT,TMO,DHR,LLY,MRK,PFE,AMGN,GILD,JNJ,PG,CL,PM,MO,SBUX,LOW,TGT,GS,MS,C,BLK,SCHW,CAT,DE,GE,HON,UPS,FDX,COP,SLB,EOG,NEE,DUK,SO,LIN,APD,PLTR,SHOP,PYPL,COIN,MRNA,ENPH,FSLR,RIVN,LCID,NIO,U,DKNG,PINS,ZM,DOCU,SNOW,CRWD,NET,DDOG,MDB,TEAM,OKTA,TWLO,SE,MELI,BABA,JD,PDD,TSM,ASML,SMCI,ROKU,SNAP,SQ,PANW,ZS,ON,MSTR,MARA,RIOT,CLSK,HUT,IREN,CIFR,WULF,BITF,BTDR,CORZ,HOOD,SOFI,AFRM,UPST,CVNA,CHWY,DASH,CART,LYFT,OPEN,RDFN,RKT,AMC,GME,BYND,SPCE,QS,LAZR,ACHR,JOBY,EVGO,CHPT,BE,PLUG,FCEL,RUN,NOVA,SEDG,MAXN,ARRY,RKLB,ASTS,LUNR,RDW,BKSY,IONQ,RGTI,QBTS,QUBT,AI,BBAI,SOUN,PATH,CFLT,ESTC,BILL,HIMS,CELH,DUOL,ELF,CAVA,TOST,APP,RBLX,NU,IOT,TEM,CRSP,EDIT,NTLA,BEAM,RXRX,DNA,PACB,BFLY,CLOV,TDOC,LMND,ROOT,W,FUBO,UPWK,FVRR,ETSY,WBD,PARA,TLRY,CGC,ACB,CRON,SNDL,VFS,LI,XPEV,PSNY,FFIE,MULN,BLNK,FREY,ENVX,SLDP,MVST,STEM,FLNC,NFE,CLNE,GEVO,AMTX,SAVA,VKTX,AXSM,SRPT,FOLD,ALNY,IOVA,IMVT,ARWR,BLUE,VERV,GH,EXAS,NTRA,TWST,ILMN,BMRN,BIIB,GTLB,S,TENB,CYBR,VRNS,GENI,ABNB,RDDT,PCT,LAC,MP,ALB,CCJ,UEC,AA,FCX,CLF,X,NUE,AAL,UAL,DAL,JBLU,RCL,NCLH,LC,MQ,FOUR,PSFE,PAYO,ARM,ACLS,AEHR,COHR,LSCC,MTSI,WOLF,SITM,ALGM,CRDO,MRVL,SWKS,TIGR,FUTU,BILI,IQ,TAL,EDU,YMM,V,MA,AXP,USB,PNC,TFC,BK,STT,ICE,CME,SPGI,MCO,CB,PGR,ALL,MET,PRU,AIG,MMC,AON,ACN,NOW,SAP,SONY,TM,HMC,NVS,AZN,GSK,SNY,UL,DEO,BP,SHEL,RIO,BHP,VALE,BTI,HSBC,UBS,DB,ING,RELX,INFY,WIT,HDB,IBN,TTE,EQNR,KHC,MDLZ,GIS,KMB,EL,LULU,ROST,TJX,ORLY,AZO,CMG,YUM,DPZ,MAR,HLT,BKNG,UBER,NOC,LMT,RTX,GD,BA,ETN,EMR,PH,ROK,MMM,WM,RSG,CCI,AMT,PLD,EQIX,O,PSA,SPG,WELL,CVS,CI,HUM,CNC,ELV,MCK,CAH,COR,ISRG,SYK,BSX,MDT,EW,ZBH,DXCM,PODD,IDXX,IQV,VRTX,REGN,F,GM,STLA,KMX,ANF,URBN,BBY,DHI,LEN,PHM,TOL,NVR,OXY,MPC,VLO,PSX,DVN,FANG,ADMA,APLS,ARDX,BBIO,BPMC,CORT,CYTK,DYN,EWTX,FATE,FGEN,HALO,IMCR,INSM,KRYS,MDGL,NBIX,PTCT,RARE,RCKT,SMMT,TGTX,TMDX,TVTX,XENE,ZLAB,BROS,BRCC,CPNG,DLO,EAT,FRPT,GLOB,GOOS,LEVI,ONON,PRCH,RVLV,SHAK,SKX,TPR,VFC,WING,AUR,BLDE,BWXT,CARR,CEG,CNH,CW,DOV,FLR,GEV,GNRC,GTES,IEX,ITT,JCI,JELD,MOD,MTZ,NVT,OSK,PWR,RR,SAIA,TDG,TKR,URI,WAB,AR,CHRD,CNX,CRC,GPOR,LBRT,NOV,NOG,SM,VTLE,WFRD,CDE,HL,IAG,KGC,NGD,PAAS,SBSW,SSRM,AG,FSM,UUUU,BRO,COF,EWBC,FITB,HBAN,KEY,MTB,RF,SYF,TRU,WBS,ZION,VNO,SLG,BXP,CPT,EQR,ESS,INVH,MAA,UDR,CHTR,LBRDK,LYV,MTCH,NWSA,OMC,RCI,SIRI,SPOT,T,VZ,AMKR,ASX,CAMT,DIOD,FORM,GFS,HIMX,INDI,IPGP,MCHP,NOVT,PI,RMBS,SYNA,UMC,GRAB,STNE,PAGS,XP,VNET,TME,WB,BEKE,HTHT,TCOM,QFIN,FINV,NOK,ERIC,STM,NVO,E,ENI,TEF,VOD,PKX,KB,SHG,MUFG,SMFG,MFG,CAJ,KOF,ABEV,ITUB,BBD,GGB,APPF,ASAN,BASE,BRZE,DT,FROG,KVYO,NCNO,PD,PCOR,PCTY,PAYC,QLYS,RBRK,WDAY,VEEV,HUBS,TTD,TTWO,EA,AKRO,ARVN,AVXL,BCYC,CCCC,CGEM,CLDX,DAWN,DNLI,ERAS,EXEL,FLGT,GERN,GLPG,GMAB,JANX,KDNY,KROS,LEGN,MRUS,NUVB,OCUL,PRAX,PRTA,RVMD,SDGR,VERA,VRNA,ZYME,ALAB,AMBA,ARLO,AVAV,AVPT,BOX,CIEN,COMM,CRUS,EXTR,IRDM,KTOS,MODN,NEOG,NTNX,PRGS,RPD,SAIL,TER,TRMB,UI,VICR,BOOT,CWH,DFH,DRVN,FL,FLWS,GAP,GO,LOPE,MAT,OLLI,PETS,PLNT,RH,SG,TXRH,ULTA,VSCO,XPO,AES,AGL,AMR,ARCH,AROC,CEIX,CHX,CRK,DINO,ET,GLNG,HESM,LNG,NAT,NE,NRP,OVV,PBF,PEQ,PR,RES,SJT,TALO,TRGP,USAC,VAL,VRN,BMA,BSBR,CADE,CFG,ALLY,HOPE,IBOC,LAZ,MAIN,MC,OMF,OZK".split(","))


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
        "averageMaximumGain30d": float(frame["maxGain30d"].mean()) if total else None,
        "averageMaximumDrawdown30d": float(frame["drawdown30d"].mean()) if total else None,
        "averageLargestAbsoluteMove30d": float(frame["largestAbsoluteMove30d"].mean()) if total else None,
    }


def main() -> int:
    payload = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    requested = set(payload.get("requestedTickers") or [])
    overlap = sorted(requested & USED_TICKERS)
    if overlap:
        raise RuntimeError(f"Second volatility holdout overlaps a used ticker: {overlap}")
    rows = []
    for item in payload.get("rows", []):
        features = item.get("features") or {}
        outcomes = item.get("outcomes") or {}
        trailing_drawdown = features.get("drawdown120d")
        future_drawdown = outcomes.get("drawdown30d")
        future_gain = outcomes.get("maxGain30d")
        if not all(isinstance(value, (int, float)) for value in [trailing_drawdown, future_drawdown, future_gain]):
            continue
        if trailing_drawdown <= RULE["trailing120SessionDrawdownMaximumPercent"]:
            largest = max(abs(future_drawdown), abs(future_gain))
            rows.append({
                "ticker": item.get("ticker"),
                "eventDate": item.get("eventDate"),
                "trailingDrawdown120d": trailing_drawdown,
                "drawdown30d": future_drawdown,
                "maxGain30d": future_gain,
                "largestAbsoluteMove30d": largest,
                "won": future_gain >= RULE["futureMoveThresholdPercent"] or future_drawdown <= -RULE["futureMoveThresholdPercent"],
            })
    selected = pd.DataFrame(rows)
    if selected.empty:
        selected = pd.DataFrame(columns=["ticker", "eventDate", "trailingDrawdown120d", "drawdown30d", "maxGain30d", "largestAbsoluteMove30d", "won"])
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
        "version": 2,
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
        "certificationPosture": "serious_extreme_volatility_watch_out_certified" if passed else "second_external_volatility_holdout_failed_alert_remains_research_only",
        "reusePolicy": "This second external volatility holdout is burned after this run and must never be used to tune the rule.",
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
            "version": 2,
            "passed": False,
            "fatalError": str(error)[:500],
            "certificationPosture": "second_external_volatility_holdout_invalid_or_unavailable",
            "safety": {"databaseWrites": False, "publishing": False, "notifications": False},
        }
        REPORT_PATH.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2), file=sys.stderr)
        raise
