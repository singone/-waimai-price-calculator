import type { TableProps } from 'antd';

export function tablePagination<T = unknown>(defaultPageSize: number): TableProps<T>['pagination'] {
  return {
    defaultPageSize,
    showSizeChanger: true,
    pageSizeOptions: ['5', '10', '20', '30', '50', '100'],
    showTotal: (total: number) => `共 ${total} 条`
  };
}
