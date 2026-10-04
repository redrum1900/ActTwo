import { Input, Modal } from 'antd';
import { requiredDialogValue } from './dialog-values.js';

export function confirmAction(content: string, danger = false): Promise<boolean> {
  return new Promise(resolve => {
    Modal.confirm({
      className: 'story-action-dialog',
      title: '请确认操作', content, okText: '确定', cancelText: '取消', okType: danger ? 'danger' : 'primary',
      onOk: () => { resolve(true); },
      onCancel: () => { resolve(false); },
    });
  });
}

export function promptAction(title: string, initial = ''): Promise<string | null> {
  return new Promise(resolve => {
    let value = initial;
    const dialog = Modal.confirm({
      className: 'story-action-dialog', title, okText: '确定', cancelText: '取消',
      okButtonProps: { disabled: !requiredDialogValue(value) },
      content: <Input autoFocus aria-label={title} defaultValue={initial} onChange={event => {
        value = event.target.value;
        dialog.update({ okButtonProps: { disabled: !requiredDialogValue(value) } });
      }} onPressEnter={() => {
        const next = requiredDialogValue(value);
        if (next) { resolve(next); dialog.destroy(); }
      }} />,
      onOk: () => { resolve(requiredDialogValue(value)); },
      onCancel: () => { resolve(null); },
    });
  });
}
