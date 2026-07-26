export type ActionResult =
  | { ok: true; redirectTo?: string }
  | { ok: false; messageKey: string };

export const ACTION_OK: ActionResult = { ok: true };

export function actionError(messageKey: string): ActionResult {
  return { ok: false, messageKey };
}
