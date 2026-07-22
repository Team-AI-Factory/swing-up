#!/usr/bin/env python3
"""Chronological selective calibration for Swing Up serious signals.

The newest 30% of cases is never used for model or threshold selection. A signal
is certified only when a separate calibration period supports a one-sided 90%
error bound of at most 10%, then the untouched final period also reaches at
least 90% observed precision.
"""
from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

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

DATASET_PATH = Path(os.getenv("CALIBRATION_DATASET_PATH", "/tmp/combined-opportunity-engine-calibration-dataset.json"))
REPORT_PATH = Path(os.getenv("CALIBRATION_REPORT_PATH", "artifacts/combined-opportunity-engine-calibration.json"))
MIN_FINAL_SAMPLES = max(15, int(os.getenv("CALIBRATION_MIN_HOLDOUT_SAMPLES", "30")))
MIN_CALIBRATION_SAMPLES = max(15, int(os.getenv("CALIBRATION_MIN_CERTIFICATE_SAMPLES", "20")))
TARGET_ERROR = float(os.getenv("CALIBRATION_TARGET_ERROR", "0.10"))
CERTIFICATE_CONFIDENCE = float(os.getenv("CALIBRATION_CERTIFICATE_CONFIDENCE", "0.90"))
RANDOM_STATE = 1729


def safe_float(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return math.nan
    return result if math.isfinite(result) else math.nan


def wilson_lower(wins: int, total: int, z: float = 1.2815515655446004) -> float | None:
    if total <= 0:
        return None
    probability = wins / total
    denominator = 1 + z * z / total
    centre = probability + z * z / (2 * total)
    adjustment = z * math.sqrt(probability * (1 - probability) / total + z * z / (4 * total * total))
    return (centre - adjustment) / denominator


def one_sided_error_upper(errors: int, total: int, confidence: float = CERTIFICATE_CONFIDENCE) -> float | None:
    if total <= 0:
        return None
    if errors >= total:
        return 1.0
    return float(beta.ppf(confidence, errors + 1, total - errors))


def load_dataset(path: Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    rows: list[dict[str, Any]] = []
    for item in payload.get("rows", []):
        row = {
            "ticker": item.get("ticker"),
            "filingDate": item.get("filingDate"),
            "year": item.get("year"),
            "month": item.get("month"),
        }
        row.update(item.get("features") or {})
        row.update(item.get("outcomes") or {})
        rows.append(row)
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise RuntimeError("Calibration dataset contains no rows.")
    frame["filingDate"] = pd.to_datetime(frame["filingDate"], errors="coerce")
    frame = frame.dropna(subset=["ticker", "filingDate"]).sort_values(["filingDate", "ticker"]).reset_index(drop=True)
    return frame, payload


@dataclass(frozen=True)
class SignalDefinition:
    action: str
    horizon_days: int
    label_column: str
    success_definition: str


@dataclass(frozen=True)
class CandidateModel:
    name: str
    family: str
    include_ticker: bool
    params: dict[str, Any]


def definitions(frame: pd.DataFrame) -> list[SignalDefinition]:
    frame["buy_30"] = frame["return30d"] > 0
    frame["buy_90"] = frame["return90d"] > 0
    frame["sell_30"] = frame["return30d"] < 0
    frame["sell_90"] = frame["return90d"] < 0
    frame["watch_out_30"] = frame["drawdown30d"] <= -8
    frame["watch_out_90"] = frame["drawdown90d"] <= -8
    return [
        SignalDefinition("buy", 30, "buy_30", "The asset closed above its entry price after 30 days."),
        SignalDefinition("buy", 90, "buy_90", "The asset closed above its entry price after 90 days."),
        SignalDefinition("sell", 30, "sell_30", "The asset closed below its entry price after 30 days."),
        SignalDefinition("sell", 90, "sell_90", "The asset closed below its entry price after 90 days."),
        SignalDefinition("watch_out", 30, "watch_out_30", "The asset suffered at least an 8% drawdown within 30 days."),
        SignalDefinition("watch_out", 90, "watch_out_90", "The asset suffered at least an 8% drawdown within 90 days."),
    ]


NUMERIC_FEATURES = [
    "opportunityScore", "businessQuality", "financialMomentum", "valuationSupport", "expectationsGap",
    "timingQuality", "evidenceConfidence", "riskScore", "revenueGrowthYoY", "priorRevenueGrowthYoY",
    "revenueGrowthAcceleration", "operatingMargin", "priorOperatingMargin", "operatingMarginChange",
    "netMargin", "freeCashFlowMargin", "cashToLiabilities", "debtToAssets", "sharesGrowthYoY",
    "returnOnAssets", "logMarketCap", "priceToSales", "priceToEarnings", "freeCashFlowYield",
    "priceChange1d", "priceChange20d", "priceChange90d", "volumeRatio", "missingFieldCount", "receiptCount",
    "month",
]


def model_candidates() -> list[CandidateModel]:
    candidates: list[CandidateModel] = []
    for include_ticker in (False, True):
        suffix = "ticker" if include_ticker else "numeric"
        for c_value in (0.05, 0.2, 1.0, 5.0):
            candidates.append(CandidateModel(f"logistic_{suffix}_c{c_value}", "logistic", include_ticker, {"C": c_value}))
        for depth in (3, 5, 8):
            for leaf in (5, 12, 24):
                candidates.append(CandidateModel(f"rf_{suffix}_d{depth}_l{leaf}", "rf", include_ticker, {"max_depth": depth, "min_samples_leaf": leaf}))
                candidates.append(CandidateModel(f"extra_{suffix}_d{depth}_l{leaf}", "extra", include_ticker, {"max_depth": depth, "min_samples_leaf": leaf}))
    for depth in (2, 3):
        for leaf in (8, 16, 28):
            candidates.append(CandidateModel(f"gb_numeric_d{depth}_l{leaf}", "gb", False, {"max_depth": depth, "min_samples_leaf": leaf}))
    for leaf in (10, 20, 35):
        for l2 in (0.1, 1.0, 5.0):
            candidates.append(CandidateModel(f"hist_numeric_l{leaf}_r{l2}", "hist", False, {"min_samples_leaf": leaf, "l2_regularization": l2}))
    return candidates


def build_estimator(candidate: CandidateModel) -> Pipeline:
    numeric_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler() if candidate.family == "logistic" else "passthrough"),
    ])
    transformers: list[tuple[str, Any, list[str]]] = [("numeric", numeric_pipeline, NUMERIC_FEATURES)]
    if candidate.include_ticker:
        transformers.append(("ticker", OneHotEncoder(handle_unknown="ignore", min_frequency=2, sparse_output=False), ["ticker"]))
    preprocessing = ColumnTransformer(transformers, remainder="drop", sparse_threshold=0)
    if candidate.family == "logistic":
        model = LogisticRegression(C=candidate.params["C"], max_iter=1200, random_state=RANDOM_STATE)
    elif candidate.family == "rf":
        model = RandomForestClassifier(
            n_estimators=500,
            max_depth=candidate.params["max_depth"],
            min_samples_leaf=candidate.params["min_samples_leaf"],
            max_features="sqrt",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        )
    elif candidate.family == "extra":
        model = ExtraTreesClassifier(
            n_estimators=500,
            max_depth=candidate.params["max_depth"],
            min_samples_leaf=candidate.params["min_samples_leaf"],
            max_features="sqrt",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        )
    elif candidate.family == "gb":
        model = GradientBoostingClassifier(
            n_estimators=180,
            learning_rate=0.035,
            max_depth=candidate.params["max_depth"],
            min_samples_leaf=candidate.params["min_samples_leaf"],
            random_state=RANDOM_STATE,
        )
    elif candidate.family == "hist":
        model = HistGradientBoostingClassifier(
            max_iter=180,
            learning_rate=0.045,
            max_leaf_nodes=15,
            min_samples_leaf=candidate.params["min_samples_leaf"],
            l2_regularization=candidate.params["l2_regularization"],
            random_state=RANDOM_STATE,
        )
    else:
        raise ValueError(f"Unknown model family: {candidate.family}")
    return Pipeline([("preprocess", preprocessing), ("model", model)])


def safe_auc(y_true: np.ndarray, probability: np.ndarray) -> float | None:
    if len(np.unique(y_true)) < 2:
        return None
    return float(roc_auc_score(y_true, probability))


def evaluate_model_selection(candidate: CandidateModel, train: pd.DataFrame, validation: pd.DataFrame, definition: SignalDefinition) -> tuple[dict[str, Any], Pipeline]:
    estimator = build_estimator(candidate)
    estimator.fit(train, train[definition.label_column].astype(int))
    probabilities = estimator.predict_proba(validation)[:, 1]
    labels = validation[definition.label_column].astype(int).to_numpy()
    top_count = max(15, int(math.ceil(len(validation) * 0.10)))
    top_indexes = np.argsort(probabilities)[::-1][:top_count]
    top_precision = float(labels[top_indexes].mean()) if len(top_indexes) else 0.0
    result = {
        "candidate": asdict(candidate),
        "averagePrecision": float(average_precision_score(labels, probabilities)),
        "rocAuc": safe_auc(labels, probabilities),
        "brier": float(brier_score_loss(labels, probabilities)),
        "topDecileCount": int(len(top_indexes)),
        "topDecilePrecision": top_precision,
        "baseRate": float(labels.mean()),
    }
    return result, estimator


def select_model(train: pd.DataFrame, validation: pd.DataFrame, definition: SignalDefinition) -> tuple[dict[str, Any], Pipeline, list[dict[str, Any]]]:
    evaluations: list[tuple[dict[str, Any], Pipeline]] = []
    for candidate in model_candidates():
        try:
            evaluations.append(evaluate_model_selection(candidate, train, validation, definition))
        except Exception as error:  # noqa: BLE001
            evaluations.append(({
                "candidate": asdict(candidate),
                "error": str(error)[:240],
                "averagePrecision": -1.0,
                "rocAuc": None,
                "brier": 1.0,
                "topDecileCount": 0,
                "topDecilePrecision": 0.0,
                "baseRate": float(validation[definition.label_column].mean()),
            }, build_estimator(candidate)))
    evaluations.sort(
        key=lambda item: (
            item[0].get("topDecilePrecision", 0.0),
            item[0].get("averagePrecision", -1.0),
            -item[0].get("brier", 1.0),
        ),
        reverse=True,
    )
    selected_result, selected_estimator = evaluations[0]
    return selected_result, selected_estimator, [result for result, _ in evaluations[:12]]


def find_risk_control_threshold(probability: np.ndarray, labels: np.ndarray) -> dict[str, Any] | None:
    order = np.argsort(probability)[::-1]
    ordered_probability = probability[order]
    ordered_labels = labels[order]
    candidates: list[dict[str, Any]] = []
    for count in range(MIN_CALIBRATION_SAMPLES, len(order) + 1):
        selected_labels = ordered_labels[:count]
        errors = int(count - selected_labels.sum())
        upper = one_sided_error_upper(errors, count)
        if upper is None or upper > TARGET_ERROR:
            continue
        threshold = float(ordered_probability[count - 1])
        candidates.append({
            "threshold": threshold,
            "sampleSize": count,
            "wins": int(selected_labels.sum()),
            "errors": errors,
            "observedPrecision": float(selected_labels.mean()),
            "errorUpperBound": upper,
            "certifiedConfidence": 1 - upper,
            "coverage": count / len(order),
        })
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item["sampleSize"], item["certifiedConfidence"]), reverse=True)
    return candidates[0]


def final_evaluation(estimator: Pipeline, final: pd.DataFrame, definition: SignalDefinition, certificate: dict[str, Any] | None) -> dict[str, Any] | None:
    if certificate is None:
        return None
    probabilities = estimator.predict_proba(final)[:, 1]
    selected = probabilities >= certificate["threshold"]
    labels = final[definition.label_column].astype(int).to_numpy()
    count = int(selected.sum())
    wins = int(labels[selected].sum()) if count else 0
    horizon = definition.horizon_days
    returns = final[f"return{horizon}d"].to_numpy(dtype=float)[selected]
    excess = final[f"excess{horizon}d"].to_numpy(dtype=float)[selected]
    drawdown = final[f"drawdown{horizon}d"].to_numpy(dtype=float)[selected]
    return {
        "sampleSize": count,
        "wins": wins,
        "losses": count - wins,
        "observedPrecision": wins / count if count else None,
        "precisionLowerBound90": wilson_lower(wins, count),
        "coverage": count / len(final),
        "averageReturn": float(np.mean(returns)) if count else None,
        "medianReturn": float(np.median(returns)) if count else None,
        "averageExcessReturn": float(np.mean(excess)) if count else None,
        "averageDrawdown": float(np.mean(drawdown)) if count else None,
        "passed": bool(count >= MIN_FINAL_SAMPLES and wins / count >= 0.90),
    }


def run_definition(train: pd.DataFrame, validation: pd.DataFrame, calibration: pd.DataFrame, final: pd.DataFrame, definition: SignalDefinition) -> dict[str, Any]:
    selected_result, estimator, top_models = select_model(train, validation, definition)
    calibration_probability = estimator.predict_proba(calibration)[:, 1]
    calibration_labels = calibration[definition.label_column].astype(int).to_numpy()
    certificate = find_risk_control_threshold(calibration_probability, calibration_labels)
    final_result = final_evaluation(estimator, final, definition, certificate)
    return {
        "definition": asdict(definition),
        "selectedModel": selected_result,
        "topValidationModels": top_models,
        "calibrationCertificate": certificate,
        "finalEvaluation": final_result,
        "passed": bool(final_result and final_result["passed"] and certificate and certificate["certifiedConfidence"] >= 0.90),
    }


def main() -> int:
    frame, dataset = load_dataset(DATASET_PATH)
    signal_definitions = definitions(frame)
    total = len(frame)
    train_end = int(total * 0.35)
    validation_end = int(total * 0.55)
    calibration_end = int(total * 0.70)
    train = frame.iloc[:train_end].copy()
    validation = frame.iloc[train_end:validation_end].copy()
    calibration = frame.iloc[validation_end:calibration_end].copy()
    final = frame.iloc[calibration_end:].copy()
    if min(len(train), len(validation), len(calibration), len(final)) < 50:
        raise RuntimeError(f"Chronological partitions are too small: train={len(train)}, validation={len(validation)}, calibration={len(calibration)}, final={len(final)}")

    exploratory_results = [run_definition(train, validation, calibration, final, definition) for definition in signal_definitions]
    # The final test is used only once per definition. A definition is production-ready only when both the
    # separate calibration certificate and the untouched final period clear the requested threshold.
    passed = [result for result in exploratory_results if result["passed"]]
    report = {
        "version": 4,
        "passed": bool(passed),
        "checkedAt": pd.Timestamp.utcnow().isoformat(),
        "methodology": {
            "sourceMode": dataset.get("sourceMode"),
            "cleaning": dataset.get("cleaning"),
            "chronologicalSplit": {
                "training": len(train),
                "modelSelectionValidation": len(validation),
                "riskCalibration": len(calibration),
                "untouchedFinalTest": len(final),
                "trainingEnd": train["filingDate"].max().date().isoformat(),
                "validationEnd": validation["filingDate"].max().date().isoformat(),
                "calibrationEnd": calibration["filingDate"].max().date().isoformat(),
                "finalStart": final["filingDate"].min().date().isoformat(),
            },
            "targetError": TARGET_ERROR,
            "certificateConfidence": CERTIFICATE_CONFIDENCE,
            "certificateMethod": "One-sided Clopper-Pearson upper bound on calibration-period error.",
            "minimumCalibrationSignals": MIN_CALIBRATION_SAMPLES,
            "minimumFinalSignals": MIN_FINAL_SAMPLES,
            "abstentionPolicy": "No threshold certificate means no directional signal.",
            "multipleTestingPosture": "Each action and horizon is reported separately; production promotion requires a new untouched confirmation run before enabling any action.",
            "noSyntheticData": True,
            "survivorshipCaveat": "The universe contains current liquid large-cap companies and does not yet include delisted securities.",
        },
        "summary": {
            "totalCases": total,
            "tickers": sorted(frame["ticker"].unique().tolist()),
            "sourceErrors": dataset.get("sourceErrors", []),
            "certifiedDefinitions": [f"{result['definition']['action']}_{result['definition']['horizon_days']}d" for result in passed],
            "seriousSignalReady": bool(passed),
        },
        "results": exploratory_results,
        "passedDefinitions": passed,
        "finalTestDisclosure": {
            "individualCasesWithheld": True,
            "reason": "Prevents manual tuning to final-period answers.",
        },
        "safety": {
            "databaseWrites": False,
            "r2Writes": False,
            "publishing": False,
            "notifications": False,
            "payments": False,
            "openAiCalls": False,
        },
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    compact = {
        "passed": report["passed"],
        "totalCases": total,
        "certifiedDefinitions": report["summary"]["certifiedDefinitions"],
        "results": [
            {
                "action": result["definition"]["action"],
                "horizonDays": result["definition"]["horizon_days"],
                "model": result["selectedModel"]["candidate"]["name"],
                "calibrationCertificate": result["calibrationCertificate"],
                "finalEvaluation": result["finalEvaluation"],
                "passed": result["passed"],
            }
            for result in exploratory_results
        ],
        "reportPath": str(REPORT_PATH),
    }
    print(json.dumps(compact, indent=2))
    return 0 if passed else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        failure = {
            "version": 4,
            "passed": False,
            "checkedAt": pd.Timestamp.utcnow().isoformat(),
            "fatalError": str(exc)[:500],
            "safety": {"databaseWrites": False, "publishing": False, "notifications": False, "payments": False, "openAiCalls": False},
        }
        REPORT_PATH.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2), file=sys.stderr)
        raise
