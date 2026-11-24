import { readFileSync } from "node:fs";
import type { ExtractedTerms, Policy, PolicyEvaluation, PolicyRule, RiskFlag, Severity } from "./types.js";

const SEVERITY_ORDER: Severity[] = ["low", "medium", "high"];

export function validatePolicy(policy: Policy): void {
  const ids = new Set<string>();
  for (const rule of policy.rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    if (!policy.routeOrder.includes(rule.route)) throw new Error(`Rule ${rule.id} uses unknown route ${rule.route}`);
  }
  if (!policy.routeOrder.includes(policy.defaultRoute)) throw new Error("defaultRoute is not in routeOrder");
  if (policy.fxToBase[policy.baseCurrency] === undefined) throw new Error("base currency has no FX rate");
}

export function loadPolicy(file: string): Policy {
  const policy = JSON.parse(readFileSync(file, "utf8")) as Policy;
  validatePolicy(policy);
  return policy;
}

export function toBase(amount: number, currency: string, policy: Policy): number {
  const rate = policy.fxToBase[currency];
  if (rate === undefined) throw new Error(`No FX rate configured for ${currency}`);
  return amount * rate;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

interface CheckResult {
  triggered: boolean;
  vars: Record<string, string>;
}

const NOT_TRIGGERED: CheckResult = { triggered: false, vars: {} };

function runCheck(rule: PolicyRule, terms: ExtractedTerms, policy: Policy): CheckResult {
  const check = rule.check;
  switch (check.type) {
    case "amount_gt_eur": {
      const amount = terms.amount.value;
      if (!amount) return NOT_TRIGGERED; // missing amounts are reported by missing_fields
      const eur = toBase(amount.amount, amount.currency, policy);
      return {
        triggered: eur > check.threshold,
        vars: { amountEur: Math.round(eur).toLocaleString("en-US"), threshold: check.threshold.toLocaleString("en-US") },
      };
    }
    case "auto_renew_notice_below": {
      if (terms.autoRenew.value !== true) return NOT_TRIGGERED;
      const notice = terms.noticeDays.value;
      return {
        triggered: notice === null || notice < check.days,
        vars: { notice: notice === null ? "not stated" : `${notice} days`, days: String(check.days) },
      };
    }
    case "dpa_not_confirmed":
      return { triggered: terms.dpaPresent.value !== true, vars: {} };
    case "liability_cap_missing":
      return { triggered: terms.liabilityCap.value === null, vars: {} };
    case "liability_unlimited":
      return { triggered: terms.liabilityCap.value === "unlimited", vars: {} };
    case "missing_fields": {
      const missing = check.fields.filter((f) => terms[f].value === null);
      return { triggered: missing.length > 0, vars: { missing: missing.join(", ") } };
    }
    default:
      throw new Error(`Unknown check type in rule ${rule.id}`);
  }
}

/** Applies every policy rule to the extracted terms and picks the most senior approver route. */
export function evaluate(terms: ExtractedTerms, policy: Policy): PolicyEvaluation {
  const flags: RiskFlag[] = [];
  for (const rule of policy.rules) {
    const result = runCheck(rule, terms, policy);
    if (result.triggered) {
      flags.push({ ruleId: rule.id, severity: rule.severity, route: rule.route, message: fill(rule.message, result.vars) });
    }
  }
  const route =
    flags.length === 0
      ? policy.defaultRoute
      : policy.routeOrder[Math.max(...flags.map((f) => policy.routeOrder.indexOf(f.route)))];
  const riskLevel: PolicyEvaluation["riskLevel"] =
    flags.length === 0
      ? "none"
      : SEVERITY_ORDER[Math.max(...flags.map((f) => SEVERITY_ORDER.indexOf(f.severity)))];
  return { flags, route, riskLevel };
}
