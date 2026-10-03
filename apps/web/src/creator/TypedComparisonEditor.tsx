import { Input, InputNumber, Select } from 'antd';
import type { ValueComparison } from '@game/contracts';
import { comparisonOperators, defaultComparison } from './condition-tree.js';

interface Props { value: ValueComparison; type: string; options?: { value: string; label: string }[]; onChange: (value: ValueComparison) => void }
const labels: Record<string, string> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
  has: '包含', lacks: '不包含', contains: '文字包含', notContains: '文字不包含' };

export default function TypedComparisonEditor({ value, type, options = [], onChange }: Props) {
  const operators = comparisonOperators(type);
  const active = operators.find(key => value[key as keyof ValueComparison] !== undefined) ?? operators[0];
  const lengthOperator = active === 'length' ? Object.keys(value.length ?? {})[0] ?? 'eq' : 'eq';
  const selection = active === 'length' ? `length:${lengthOperator}` : active;
  const current = active === 'length' ? value.length?.[lengthOperator as keyof NonNullable<ValueComparison['length']>] : value[active as keyof ValueComparison];
  const optionList = operators.flatMap(key => key === 'length' ? ['eq', 'gt', 'gte', 'lt', 'lte'].map(operator => ({ value: `length:${operator}`, label: `数量 ${labels[operator]}` }))
    : [{ value: key, label: labels[key] }]);
  const replace = (operator: string, operand: number | string | boolean) => onChange(operator.startsWith('length:')
    ? { length: { [operator.slice(7)]: operand as number } } : { [operator]: operand });
  const defaultValue = (operator: string) => operator.startsWith('length:') || type === 'number' ? 0 :
    type === 'boolean' ? false : ['enum', 'select', 'radio'].includes(type) ? options[0]?.value ?? '' : '';
  return <div className="creator-typed-compare">
    <Select aria-label="比较方式" size="small" value={selection} options={optionList} onChange={next => replace(next, defaultValue(next))} />
    {selection.startsWith('length:') || type === 'number'
      ? <InputNumber aria-label="比较值" size="small" min={selection.startsWith('length:') ? 0 : undefined} value={typeof current === 'number' ? current : 0}
        onChange={next => replace(selection, next ?? 0)} />
      : type === 'boolean' ? <Select aria-label="比较值" size="small" value={typeof current === 'boolean' ? current : false}
          options={[{ value: true, label: '是' }, { value: false, label: '否' }]} onChange={next => replace(selection, next)} />
      : ['enum', 'select', 'radio', 'checkbox'].includes(type) ? <Select aria-label="比较值" size="small" value={typeof current === 'string' ? current || undefined : undefined}
          options={options} onChange={next => replace(selection, next)} />
      : <Input aria-label="比较值" size="small" type={type === 'date' ? 'date' : 'text'} value={typeof current === 'string' ? current : ''}
          onChange={event => replace(selection, event.target.value)} />}
  </div>;
}
