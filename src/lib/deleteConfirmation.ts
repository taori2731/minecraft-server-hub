export const DELETE_CONFIRMATION_TEXT = "Delete";

export function isValidDeleteConfirmation(value: string): boolean {
  return value === DELETE_CONFIRMATION_TEXT;
}
