import { DownloadOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import { useState } from 'react';
import { downloadM2Artifact } from '../../services/m2Api';
import { getArtifactFileName } from './m2Workflow';

type M2ArtifactButtonProps = {
  label: string;
  path?: string | null;
};

export function M2ArtifactButton({ label, path }: M2ArtifactButtonProps) {
  const [loading, setLoading] = useState(false);

  if (!path) {
    return null;
  }

  return (
    <Button
      icon={<DownloadOutlined />}
      loading={loading}
      onClick={() => {
        setLoading(true);
        void downloadM2Artifact(path)
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = getArtifactFileName(path);
            link.click();
            URL.revokeObjectURL(url);
          })
          .catch(() => void message.error(`${label}下载失败`))
          .finally(() => setLoading(false));
      }}
    >
      {label}
    </Button>
  );
}
