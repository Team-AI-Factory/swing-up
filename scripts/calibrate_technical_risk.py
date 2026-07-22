#!/usr/bin/env python3
"""Strict chronological calibration for selective Swing Up serious alerts.

Models and thresholds are selected on old data, certified on a later calibration
period, and tested once on an untouched newest period. Failure means abstention.
"""
from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import beta
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesClassifier, GradientBoostingClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

DATASET_PATH = Path(os.getenv("TECHNICAL_RISK_DATASET_PATH", "artifacts/technical-risk-calibration-dataset.json"))
REPORT_PATH = Path(os.getenv("TECHNICAL_RISK_REPORT_PATH", "artifacts/technical-risk-calibration-report.json"))
MIN_VALIDATION_SIGNALS = max(20, int(os.getenv("TECHNICAL_RISK_MIN_VALIDATION_SIGNALS", "30")))
MIN_CALIBRATION_SIGNALS = max(20, int(os.getenv("TECHNICAL_RISK_MIN_CALIBRATION_SIGNALS", "25")))
MIN_FINAL_SIGNALS = max(30, int(os.getenv("TECHNICAL_RISK_MIN_FINAL_SIGNALS", "30")))
TARGET_ERROR = float(os.getenv("TECHNICAL_RISK_TARGET_ERROR", "0.10"))
CERTIFICATE_CONFIDENCE = float(os.getenv("TECHNICAL_RISK_CERTIFICATE_CONFIDENCE", "0.90"))
EMBARGO_DAYS = max(30, int(os.getenv("TECHNICAL_RISK_EMBARGO_DAYS", "100")))
RANDOM_STATE = 1729


def one_sided_error_upper(errors: int, total: int, confidence: float = CERTIFICATE_CONFIDENCE) -> float | None:
    if total <= 0:
        return None
    if errors >= total:
        return 1.0
    return float(beta.ppf(confidence, errors + 1, total - errors))


def wilson_lower(wins: int, total: int, z: float = 1.2815515655446004) -> float | None:
    if total <= 0:
        return None
    probability = wins / total
    denominator = 1 + z * z / total
    centre = probability + z * z / (2 * total)
    adjustment = z * math.sqrt(probability * (1 - probability) / total + z * z / (4 * total * total))
    return (centre - adjustment) / denominator


def safe_auc(labels: np.ndarray, probabilities: np.ndarray) -> float | None:
    return None if len(np.unique(labels)) < 2 else float(roc_auc_score(labels, probabilities))


def load_dataset() -> tuple[pd.DataFrame, dict[str, Any]]:
    payload = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    rows: list[dict[str, Any]] = []
    for item in payload.get("rows", []):
        row = {"ticker": item.get("ticker"), "eventDate": item.get("eventDate")}
        row.update(item.get("features") or {})
        row.update(item.get("outcomes") or {})
        rows.append(row)
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise RuntimeError("Technical-risk dataset contains no rows.")
    frame["eventDate"] = pd.to_datetime(frame["eventDate"], errors="coerce")
    frame = frame.dropna(subset=["ticker", "eventDate"]).sort_values(["eventDate", "ticker"]).reset_index(drop=True)
    return frame, payload


@dataclass(frozen=True)
class Definition:
    action: str
    horizon_days: int
    label: str
    success_definition: str


@dataclass(frozen=True)
class Candidate:
    name: str
    family: str
    include_ticker: bool
    feature_set: str
    params: dict[str, Any]


NUMERIC_FEATURES = [
    "return1d", "return5d", "return20d", "return60d", "return120d", "return252d",
    "drawdown20d", "drawdown60d", "drawdown120d", "volatility20d", "volatility60d",
    "volumeRatio20d", "rangePosition252d", "gapPercent", "intradayRangePercent",
    "logDollarVolume", "month",
]
PRICE_FEATURES = [
    "return1d", "return5d", "return20d", "return60d", "return120d", "return252d",
    "drawdown20d", "drawdown60d", "drawdown120d", "volatility20d", "volatility60d",
    "volumeRatio20d", "rangePosition252d", "gapPercent", "intradayRangePercent", "month",
]


def add_labels(frame: pd.DataFrame) -> list[Definition]:
    frame["watch_out_30_8"] = frame["drawdown30d"] <= -8
    frame["watch_out_90_8"] = frame["drawdown90d"] <= -8
    frame["watch_out_90_12"] = frame["drawdown90d"] <= -12
    frame["sell_30"] = (frame["return30d"] <= -7) & (frame["excess30d"] <= -4)
    frame["sell_90"] = (frame["return90d"] <= -10) & (frame["excess90d"] <= -5)
    frame["buy_30"] = (frame["return30d"] >= 7) & (frame["excess30d"] >= 4)
    frame["buy_90"] = (frame["return90d"] >= 12) & (frame["excess90d"] >= 6)
    return [
        Definition("watch_out", 30, "watch_out_30_8", "At least an 8% drawdown after the alert close within 30 trading sessions."),
        Definition("watch_out", 90, "watch_out_90_8", "At least an 8% drawdown after the alert close within 90 trading sessions."),
        Definition("watch_out", 90, "watch_out_90_12", "At least a 12% drawdown after the alert close within 90 trading sessions."),
        Definition("sell", 30, "sell_30", "At least a 7% loss and 4% benchmark underperformance after 30 trading sessions."),
        Definition("sell", 90, "sell_90", "At least a 10% loss and 5% benchmark underperformance after 90 trading sessions."),
        Definition("buy", 30, "buy_30", "At least a 7% gain and 4% benchmark outperformance after 30 trading sessions."),
        Definition("buy", 90, "buy_90", "At least a 12% gain and 6% benchmark outperformance after 90 trading sessions."),
    ]


def candidates() -> list[Candidate]:
    result: list[Candidate] = []
    for feature_set in ("all", "price"):
        for include_ticker in (False, True):
            for c_value in (0.05, 0.2, 1.0, 5.0):
                result.append(Candidate(f"logistic_{feature_set}_{include_ticker}_c{c_value}", "logistic", include_ticker, feature_set, {"C": c_value}))
            for depth in (3, 5, 8, None):
                for leaf in (5, 12, 25, 45):
                    result.append(Candidate(f"extra_{feature_set}_{include_ticker}_d{depth}_l{leaf}", "extra", include_ticker, feature_set, {"depth": depth, "leaf": leaf}))
                    result.append(Candidate(f"rf_{feature_set}_{include_ticker}_d{depth}_l{leaf}", "rf", include_ticker, feature_set, {"depth": depth, "leaf": leaf}))
        for depth in (1, 2, 3):
            for leaf in (8, 18, 35, 60):
                result.append(Candidate(f"gb_{feature_set}_d{depth}_l{leaf}", "gb", False, feature_set, {"depth": depth, "leaf": leaf}))
        for leaves in (7, 15, 31):
            for minimum_leaf in (10, 20, 40, 70):
                result.append(Candidate(f"hist_{feature_set}_n{leaves}_l{minimum_leaf}", "hist", False, feature_set, {"leaves": leaves, "leaf": minimum_leaf}))
    return result


def estimator(candidate: Candidate) -> Pipeline:
    features = NUMERIC_FEATURES if candidate.feature_set == "all" else PRICE_FEATURES
    numeric = Pipeline([
        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler() if candidate.family == "logistic" else "passthrough"),
    ])
    transformers: list[tuple[str, Any, list[str]]] = [("numeric", numeric, features)]
    if candidate.include_ticker:
        transformers.append(("ticker", OneHotEncoder(handle_unknown="ignore", min_frequency=3, sparse_output=False), ["ticker"]))
    preprocessing = ColumnTransformer(transformers, remainder="drop", sparse_threshold=0)
    if candidate.family == "logistic":
        model = LogisticRegression(C=candidate.params["C"], max_iter=1800, random_state=RANDOM_STATE)
    elif candidate.family == "extra":
        model = ExtraTreesClassifier(
            n_estimators=450, max_depth=candidate.params["depth"], min_samples_leaf=candidate.params["leaf"],
            max_features="sqrt", class_weight="balanced_subsample", n_jobs=-1, random_state=RANDOM_STATE,
        )
    elif candidate.family == "rf":
        model = RandomForestClassifier(
            n_estimators=450, max_depth=candidate.params["depth"], min_samples_leaf=candidate.params["leaf"],
            max_features="sqrt", class_weight="balanced_subsample", n_jobs=-1, random_state=RANDOM_STATE,
        )
    elif candidate.family == "gb":
        model = GradientBoostingClassifier(
            n_estimators=220, learning_rate=0.035, max_depth=candidate.params["depth"],
            min_samples_leaf=candidate.params["leaf"], subsample=0.8, random_state=RANDOM_STATE,
        )
    elif candidate.family == "hist":
        model = HistGradientBoostingClassifier(
            max_iter=240, learning_rate=0.04, max_leaf_nodes=candidate.params["leaves"],
            min_samples_leaf=candidate.params["leaf"], l2_regularization=2.0, random_state=RANDOM_STATE,
        )
    else:
        raise ValueError(candidate.family)
    return Pipeline([("preprocess", preprocessing), ("model", model)])


def threshold_candidates(probabilities: np.ndarray, labels: np.ndarray) -> list[dict[str, Any]]:
    thresholds = np.unique(np.quantile(probabilities, np.linspace(0.50, 0.9975, 220)))
    results: list[dict[str, Any]] = []
    for threshold in thresholds:
        selected = probabilities >= threshold
        sample_size = int(selected.sum())
        if sample_size < MIN_VALIDATION_SIGNALS:
            continue
        wins = int(labels[selected].sum())
        precision = wins / sample_size
        results.append({
            "threshold": float(threshold),
            "sampleSize": sample_size,
            "wins": wins,
            "losses": sample_size - wins,
            "precision": precision,
            "precisionLowerBound90": wilson_lower(wins, sample_size),
            "coverage": sample_size / len(labels),
        })
    results.sort(key=lambda row: (row["precisionLowerBound90"] or 0, row["precision"], row["sampleSize"]), reverse=True)
    return results


def selection_result(candidate: Candidate, train: pd.DataFrame, validation: pd.DataFrame, definition: Definition) -> tuple[dict[str, Any], Pipeline] | None:
    model = estimator(candidate)
    model.fit(train, train[definition.label].astype(int))
    probabilities = model.predict_proba(validation)[:, 1]
    labels = validation[definition.label].astype(int).to_numpy()
    thresholds = threshold_candidates(probabilities, labels)
    if not thresholds:
        return None
    selected = thresholds[0]
    return ({
        "candidate": asdict(candidate),
        "averagePrecision": float(average_precision_score(labels, probabilities)),
        "rocAuc": safe_auc(labels, probabilities),
        "brier": float(brier_score_loss(labels, probabilities)),
        "baseRate": float(labels.mean()),
        "selectedThreshold": selected,
        "topThresholds": thresholds[:10],
    }, model)


def select_model(train: pd.DataFrame, validation: pd.DataFrame, definition: Definition) -> tuple[dict[str, Any], Pipeline, list[dict[str, Any]]]:
    evaluations: list[tuple[dict[str, Any], Pipeline]] = []
    for candidate in candidates():
        try:
            result = selection_result(candidate, train, validation, definition)
            if result:
                evaluations.append(result)
        except Exception as error:  # noqa: BLE001
            continue
    if not evaluations:
        raise RuntimeError(f"No model could be fit for {definition.label}.")
    evaluations.sort(key=lambda item: (
        item[0]["selectedThreshold"]["precisionLowerBound90"] or 0,
        item[0]["selectedThreshold"]["precision"],
        item[0]["averagePrecision"],
        item[0]["selectedThreshold"]["sampleSize"],
    ), reverse=True)
    selected_result, selected_model = evaluations[0]
    return selected_result, selected_model, [row for row, _ in evaluations[:15]]


def fixed_threshold_evaluation(model: Pipeline, frame: pd.DataFrame, definition: Definition, threshold: float, minimum: int) -> dict[str, Any]:
    probabilities = model.predict_proba(frame)[:, 1]
    selected = probabilities >= threshold
    labels = frame[definition.label].astype(int).to_numpy()
    sample_size = int(selected.sum())
    wins = int(labels[selected].sum()) if sample_size else 0
    errors = sample_size - wins
    horizon = definition.horizon_days
    returns = frame[f"return{horizon}d"].to_numpy(dtype=float)[selected]
    excess = frame[f"excess{horizon}d"].to_numpy(dtype=float)[selected]
    drawdowns = frame[f"drawdown{horizon}d"].to_numpy(dtype=float)[selected]
    error_upper = one_sided_error_upper(errors, sample_size)
    return {
        "sampleSize": sample_size,
        "wins": wins,
        "losses": errors,
        "observedPrecision": wins / sample_size if sample_size else None,
        "precisionLowerBound90": wilson_lower(wins, sample_size),
        "errorUpperBound90": error_upper,
        "certifiedConfidence": 1 - error_upper if error_upper is not None else None,
        "coverage": sample_size / len(frame),
        "averageReturn": float(np.mean(returns)) if sample_size else None,
        "medianReturn": float(np.median(returns)) if sample_size else None,
        "averageExcessReturn": float(np.mean(excess)) if sample_size else None,
        "averageDrawdown": float(np.mean(drawdowns)) if sample_size else None,
        "passed": bool(sample_size >= minimum and error_upper is not None and error_upper <= TARGET_ERROR),
    }


def chronological_partitions(frame: pd.DataFrame) -> dict[str, pd.DataFrame]:
    total = len(frame)
    validation_start = frame.iloc[int(total * 0.35)]["eventDate"]
    calibration_start = frame.iloc[int(total * 0.55)]["eventDate"]
    final_start = frame.iloc[int(total * 0.70)]["eventDate"]
    embargo = pd.Timedelta(days=EMBARGO_DAYS)
    train = frame[frame["eventDate"] < validation_start - embargo].copy()
    validation = frame[(frame["eventDate"] >= validation_start) & (frame["eventDate"] < calibration_start - embargo)].copy()
    calibration = frame[(frame["eventDate"] >= calibration_start) & (frame["eventDate"] < final_start - embargo)].copy()
    final = frame[frame["eventDate"] >= final_start].copy()
    if min(len(train), len(validation), len(calibration), len(final)) < 80:
        raise RuntimeError(f"Chronological partitions are too small after embargo: {len(train)}, {len(validation)}, {len(calibration)}, {len(final)}")
    return {"train": train, "validation": validation, "calibration": calibration, "final": final}


def run_definition(partitions: dict[str, pd.DataFrame], definition: Definition) -> dict[str, Any]:
    selected, model, top_models = select_model(partitions["train"], partitions["validation"], definition)
    threshold = selected["selectedThreshold"]["threshold"]
    calibration = fixed_threshold_evaluation(model, partitions["calibration"], definition, threshold, MIN_CALIBRATION_SIGNALS)
    final = fixed_threshold_evaluation(model, partitions["final"], definition, threshold, MIN_FINAL_SIGNALS) if calibration["passed"] else None
    passed = bool(calibration["passed"] and final and final["passed"])
    return {
        "definition": asdict(definition),
        "selectedModel": selected,
        "topValidationModels": top_models,
        "calibrationCertificate": calibration,
        "untouchedFinalEvaluation": final,
        "passed": passed,
    }


def main() -> int:
    frame, dataset = load_dataset()
    definitions = add_labels(frame)
    partitions = chronological_partitions(frame)
    results = [run_definition(partitions, definition) for definition in definitions]
    passed = [result for result in results if result["passed"]]
    report = {
        "version": 1,
        "passed": bool(passed),
        "checkedAt": pd.Timestamp.utcnow().isoformat(),
        "methodology": {
            "sourceMode": dataset.get("sourceMode"),
            "selectionRule": dataset.get("selectionRule"),
            "chronologicalSplit": {name: len(value) for name, value in partitions.items()},
            "partitionDates": {name: {"start": value["eventDate"].min().date().isoformat(), "end": value["eventDate"].max().date().isoformat()} for name, value in partitions.items()},
            "embargoDays": EMBARGO_DAYS,
            "targetError": TARGET_ERROR,
            "certificateConfidence": CERTIFICATE_CONFIDENCE,
            "minimumValidationSignals": MIN_VALIDATION_SIGNALS,
            "minimumCalibrationSignals": MIN_CALIBRATION_SIGNALS,
            "minimumFinalSignals": MIN_FINAL_SIGNALS,
            "thresholdSelection": "Model and fixed probability threshold selected only on validation data.",
            "certificateMethod": "One-sided Clopper-Pearson upper confidence bound on error in later calibration and untouched final periods.",
            "abstentionPolicy": "No passing calibration and final certificate means no serious directional alert.",
            "noSyntheticData": True,
            "survivorshipCaveat": "The first technical calibration universe contains currently identifiable liquid securities; delisted securities remain a required expansion before broad production claims.",
        },
        "summary": {
            "totalCases": len(frame),
            "requestedTickers": dataset.get("requestedTickerCount"),
            "tickersWithCases": len(dataset.get("tickersWithCases", [])),
            "sourceErrors": dataset.get("sourceErrors", []),
            "certifiedDefinitions": [f"{row['definition']['action']}_{row['definition']['horizon_days']}d_{row['definition']['label']}" for row in passed],
            "seriousSignalReady": bool(passed),
        },
        "results": results,
        "passedDefinitions": passed,
        "safety": {"databaseWrites": False, "r2Writes": False, "publishing": False, "notifications": False, "payments": False, "openAiCalls": False},
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "passed": report["passed"],
        "totalCases": report["summary"]["totalCases"],
        "partitions": report["methodology"]["chronologicalSplit"],
        "certifiedDefinitions": report["summary"]["certifiedDefinitions"],
        "results": [{
            "definition": row["definition"],
            "validation": row["selectedModel"]["selectedThreshold"],
            "calibration": row["calibrationCertificate"],
            "final": row["untouchedFinalEvaluation"],
            "passed": row["passed"],
        } for row in results],
        "reportPath": str(REPORT_PATH),
    }, indent=2))
    return 0 if passed else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        failure = {
            "version": 1,
            "passed": False,
            "checkedAt": pd.Timestamp.utcnow().isoformat(),
            "fatalError": str(error)[:500],
            "safety": {"databaseWrites": False, "publishing": False, "notifications": False, "payments": False, "openAiCalls": False},
        }
        REPORT_PATH.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2), file=sys.stderr)
        raise
