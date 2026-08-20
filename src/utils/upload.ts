import type { UploadProps } from 'antd';

const DEFAULT_UPLOAD_ACCEPT = [
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'application/json'
].join(',');

export function uploadProps(handler: (file: File) => void): UploadProps {
  return {
    accept: DEFAULT_UPLOAD_ACCEPT,
    showUploadList: false,
    beforeUpload: file => {
      handler(file as File);
      return false;
    }
  };
}
