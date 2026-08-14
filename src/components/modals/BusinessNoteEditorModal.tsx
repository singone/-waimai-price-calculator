'use client';

import { DatePicker, Input, Modal, Select, Space, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import type { Platform } from '../../domain/types';

const { RangePicker } = DatePicker;
const { Text } = Typography;

export type BusinessNoteEditorValue = {
  id?: string;
  dateStart: string;
  dateEnd: string;
  platform: Platform | 'all';
  title: string;
  content: string;
};

type BusinessNoteEditorModalProps = {
  editor: BusinessNoteEditorValue | null;
  dateRangeValue: [Dayjs, Dayjs] | null;
  platforms: Platform[];
  platformNames: Record<Platform, string>;
  onSave: () => void;
  onCancel: () => void;
  onChangeDateRange: (dateStrings: string[]) => void;
  onChange: (mutator: (editor: BusinessNoteEditorValue) => BusinessNoteEditorValue) => void;
};

export function BusinessNoteEditorModal({
  editor,
  dateRangeValue,
  platforms,
  platformNames,
  onSave,
  onCancel,
  onChangeDateRange,
  onChange
}: BusinessNoteEditorModalProps) {
  if (!editor) return null;

  return (
    <Modal
      title={editor.id ? '编辑备忘录' : '新增备忘录'}
      open
      width={680}
      destroyOnHidden
      okText="保存"
      cancelText="取消"
      onOk={onSave}
      onCancel={onCancel}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Text type="secondary">日期</Text>
          <RangePicker
            format="YYYY-MM-DD"
            placeholder={['开始日期', '结束日期']}
            value={dateRangeValue}
            onChange={(_, dateStrings) => onChangeDateRange(Array.isArray(dateStrings) ? dateStrings : [])}
          />
          <Text type="secondary">平台</Text>
          <Select
            style={{ width: 130 }}
            value={editor.platform}
            onChange={value => onChange(current => ({ ...current, platform: value as Platform | 'all' }))}
            options={[
              { value: 'all', label: '全部平台' },
              ...platforms.map(platform => ({ value: platform, label: platformNames[platform] }))
            ]}
          />
        </Space>
        <Input
          value={editor.title}
          placeholder="标题，例如：平台活动、缺货、天气、竞品变化"
          onChange={event => onChange(current => ({ ...current, title: event.target.value }))}
        />
        <Input.TextArea
          rows={5}
          value={editor.content}
          placeholder="记录当天发生的事情，例如：午高峰主推饭团缺货，曝光正常但下单率下降。"
          onChange={event => onChange(current => ({ ...current, content: event.target.value }))}
        />
      </Space>
    </Modal>
  );
}
