import type { Diagnostic, DiagnosticCode, Severity } from "../types.js";

// DICOM UIDs are dot-separated digit runs (e.g. 1.2.840.x, 1.2.3.4) and are
// quasi-identifying — see IMPLEMENTATION_PLAN.md section 6.
const UID_PATTERN = /\b\d+(?:\.\d+){2,}\b/g;

function redactString(s: string): string {
  return s.replace(UID_PATTERN, "[redacted-uid]");
}

function redactDetail(
  detail: Readonly<Record<string, number | string | boolean>> | undefined,
): Readonly<Record<string, number | string | boolean>> | undefined {
  if (!detail) return detail;
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(detail)) {
    out[key] = typeof value === "string" ? redactString(value) : value;
  }
  return out;
}

export function createDiagnostic(
  code: DiagnosticCode,
  severity: Severity,
  message: string,
  detail?: Readonly<Record<string, number | string | boolean>>,
): Diagnostic {
  return {
    code,
    severity,
    message,
    detail,
    redact(): Diagnostic {
      return createDiagnostic(code, severity, redactString(message), redactDetail(detail));
    },
  };
}
