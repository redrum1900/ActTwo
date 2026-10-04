import { validCalendarDate, type FieldDefinition, type GameState } from '@game/contracts';

export function readPlayer(fields: readonly FieldDefinition[], input: unknown): GameState['player'] {
  const values = (input && typeof input === 'object' && !Array.isArray(input)) ? input as Record<string, unknown> : {};
  const player: GameState['player'] = {};
  for (const field of fields) {
    const raw = field.editable === false ? field.default : values[field.id] ?? field.default ?? (field.type === 'checkbox' ? [] : '');
    if (field.type === 'checkbox') {
      if (!Array.isArray(raw) || raw.some(value => typeof value !== 'string' || !field.options?.some(option => option.value === value))) throw new Error(`${field.label}选项无效`);
      if (raw.length === 0) throw new Error(`请填写${field.label}`);
      player[field.id] = raw as string[];
    } else {
      if (typeof raw !== 'string' || raw.length > (field.type === 'textarea' ? 2000 : 100) || !raw.trim()) throw new Error(`请正确填写${field.label}`);
      if (field.type === 'date' && raw && !validCalendarDate(raw)) throw new Error(`${field.label}日期无效`);
      if ((field.type === 'radio' || field.type === 'select') && !field.options?.some(option => option.value === raw)) throw new Error(`${field.label}选项无效`);
      player[field.id] = raw;
    }
  }
  return player;
}
